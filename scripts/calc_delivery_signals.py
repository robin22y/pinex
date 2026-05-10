"""
Compute delivery / volume / price-divergence signals and upsert into delivery_signals.

Run after fetch_delivery.py (uses delivery_data rows up to today's date).

Usage:
  python scripts/calc_delivery_signals.py --full
  python scripts/calc_delivery_signals.py --test
Requires --full or --test.

Requires: numpy (see scripts/requirements.txt)
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np

from db import log_event, supabase, upsert

SIGNAL_TABLE = "delivery_signals"
DELIVERY_TABLE = "delivery_data"
PRICE_TABLE = "price_data"
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]

SLOPE_RISING = 0.5
SLOPE_FALLING = -0.5
PRICE_FLAT_PCT = 3.0
VOLUME_SURGE_RATIO = 1.3


def _parse_flags() -> str:
    if "--test" in sys.argv:
        return "test"
    if "--full" in sys.argv:
        return "full"
    print("Error: specify --test (SYRMA, APTUS, TEJASNET) or --full (all companies with delivery data).")
    sys.exit(1)


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    s = str(v).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _stage_key(stage: Any) -> str:
    """Normalize 'Stage 2' / 'stage 2' → 'stage2'."""
    return str(stage or "").strip().lower().replace(" ", "").replace("-", "")


def classify_delivery_signal(
    pct_trend: str,
    vol_trend: str,
    stage: Any,
    price_change: float | None,
) -> str:
    """
    Combined interpretation of % delivery slope vs absolute delivery qty slope.

    pct_trend / vol_trend: 'rising' | 'falling' | 'flat'
    """
    pk = _stage_key(stage)

    if pct_trend == "falling" and vol_trend == "rising" and pk == "stage2":
        return "breakout_signature"

    if pct_trend == "rising" and vol_trend == "rising":
        return "strong_accumulation"

    if pct_trend == "rising" and vol_trend == "flat":
        return "accumulation"

    if pct_trend == "falling" and vol_trend == "falling" and pk in ("stage3", "stage4"):
        return "distribution"

    if pct_trend == "falling" and price_change is not None and price_change < -5:
        return "weakness"

    return "neutral"


def _trend_and_avg(values: list[float]) -> tuple[str, float | None]:
    """Linear slope on delivery_pct (oldest → newest); thresholds are in %-points per step."""
    if not values:
        return "flat", None
    avg = sum(values) / len(values)
    if len(values) < 2:
        return "flat", avg
    x = np.arange(len(values), dtype=float)
    ys = np.array(values, dtype=float)
    coef = np.polyfit(x, ys, 1)
    slope = float(coef[0])
    if slope > SLOPE_RISING:
        return "rising", avg
    if slope < SLOPE_FALLING:
        return "falling", avg
    return "flat", avg


def _trend_linear_snr(values: list[float]) -> str:
    """
    Rising/falling/flat from linear slope of absolute delivery_volume (or similar scale-mixing series).
    Uses slope / std(y) so thresholds match the spirit of _trend_and_avg without share-count units.
    """
    if len(values) < 2:
        return "flat"
    x = np.arange(len(values), dtype=float)
    ys = np.array(values, dtype=float)
    slope = float(np.polyfit(x, ys, 1)[0])
    std_y = float(np.std(ys))
    if std_y < 1e-12:
        return "flat"
    snr = slope / std_y
    if snr > SLOPE_RISING:
        return "rising"
    if snr < SLOPE_FALLING:
        return "falling"
    return "flat"


def _window_rows(
    rows_asc: list[dict[str, Any]],
    signal_date: date,
    calendar_days: int,
) -> list[dict[str, Any]]:
    """Rows with date in [signal_date - calendar_days, signal_date] (calendar days)."""
    cutoff = signal_date - timedelta(days=calendar_days)
    out: list[dict[str, Any]] = []
    for r in rows_asc:
        d = _parse_date(r.get("date"))
        if d is None:
            continue
        if cutoff <= d <= signal_date:
            out.append(r)
    return out


def _fetch_delivery_rows(company_id: str, signal_date: date) -> list[dict[str, Any]]:
    lookback = signal_date - timedelta(days=120)
    res = (
        supabase.table(DELIVERY_TABLE)
        .select("date,delivery_pct,delivery_volume,total_volume")
        .eq("company_id", company_id)
        .gte("date", lookback.isoformat())
        .lte("date", signal_date.isoformat())
        .order("date", desc=False)
        .execute()
    )
    return getattr(res, "data", None) or []


def _fetch_price_rows(company_id: str, signal_date: date) -> list[dict[str, Any]]:
    res = (
        supabase.table(PRICE_TABLE)
        .select("date,close")
        .eq("company_id", company_id)
        .lte("date", signal_date.isoformat())
        .order("date", desc=True)
        .limit(260)
        .execute()
    )
    return getattr(res, "data", None) or []


def _close_on_or_before(rows_desc: list[dict[str, Any]], boundary: date) -> float | None:
    for r in rows_desc:
        d = _parse_date(r.get("date"))
        if d is None:
            continue
        if d <= boundary:
            return _safe_float(r.get("close"))
    return None


def _price_change_pct(latest_close: float | None, past_close: float | None) -> float | None:
    if latest_close is None or past_close is None or past_close == 0:
        return None
    return (latest_close - past_close) / past_close * 100.0


def _company_ids_test() -> list[str]:
    sym_set = {s.strip().upper() for s in TEST_SYMBOLS}
    res = (
        supabase.table("companies")
        .select("id,symbol")
        .in_("symbol", list(sym_set))
        .execute()
    )
    rows = getattr(res, "data", None) or []
    out: list[str] = []
    for r in rows:
        cid = str(r.get("id") or "").strip()
        if cid:
            out.append(cid)
    return out


def _fetch_latest_stages_batch(company_ids: list[str]) -> dict[str, Any]:
    """Latest price_data row per company (is_latest=true) → stage label."""
    out: dict[str, Any] = {}
    if not company_ids:
        return out
    chunk_size = 200
    for i in range(0, len(company_ids), chunk_size):
        chunk = company_ids[i : i + chunk_size]
        res = (
            supabase.table(PRICE_TABLE)
            .select("company_id,stage")
            .eq("is_latest", True)
            .in_("company_id", chunk)
            .execute()
        )
        for r in getattr(res, "data", None) or []:
            cid = str(r.get("company_id") or "").strip()
            if cid:
                out[cid] = r.get("stage")
    return out


def _company_ids_full() -> list[str]:
    seen: set[str] = set()
    page_size = 1000
    start = 0
    while True:
        res = (
            supabase.table(DELIVERY_TABLE)
            .select("company_id")
            .range(start, start + page_size - 1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if not rows:
            break
        for r in rows:
            cid = str(r.get("company_id") or "").strip()
            if cid:
                seen.add(cid)
        if len(rows) < page_size:
            break
        start += page_size
    return sorted(seen)


def _build_payload(
    company_id: str,
    signal_date: date,
    deliveries_asc: list[dict[str, Any]],
    prices_desc: list[dict[str, Any]],
    stage_latest: Any,
) -> dict[str, Any] | None:
    if not deliveries_asc:
        return None

    def period_metrics(days: int) -> tuple[list[float], list[float], list[float]]:
        rows = _window_rows(deliveries_asc, signal_date, days)
        pcts = [
            float(v)
            for v in (_safe_float(r.get("delivery_pct")) for r in rows)
            if v is not None
        ]
        dvols = [
            float(v)
            for v in (_safe_float(r.get("delivery_volume")) for r in rows)
            if v is not None
        ]
        vols = [
            float(v)
            for v in (_safe_float(r.get("total_volume")) for r in rows)
            if v is not None
        ]
        return pcts, dvols, vols

    p7, dvp7, v7 = period_metrics(7)
    p30, dvp30, v30 = period_metrics(30)
    p60, _, v60 = period_metrics(60)
    p90, _, v90 = period_metrics(90)

    trend_7, avg_d7 = _trend_and_avg(p7)
    trend_30, avg_d30 = _trend_and_avg(p30)
    trend_60, avg_d60 = _trend_and_avg(p60)
    trend_90, avg_d90 = _trend_and_avg(p90)

    vol_trend_7 = _trend_linear_snr(dvp7)
    vol_trend_30 = _trend_linear_snr(dvp30)

    avg_v7 = sum(v7) / len(v7) if v7 else None
    avg_v30 = sum(v30) / len(v30) if v30 else None
    avg_v60 = sum(v60) / len(v60) if v60 else None
    avg_v90 = sum(v90) / len(v90) if v90 else None

    today_vol: float | None = None
    for r in reversed(deliveries_asc):
        d = _parse_date(r.get("date"))
        if d == signal_date:
            today_vol = _safe_float(r.get("total_volume"))
            break
    if today_vol is None and deliveries_asc:
        last = deliveries_asc[-1]
        if _parse_date(last.get("date")) == signal_date:
            today_vol = _safe_float(last.get("total_volume"))

    latest_close = _close_on_or_before(prices_desc, signal_date)
    close_7 = _close_on_or_before(prices_desc, signal_date - timedelta(days=7))
    close_30 = _close_on_or_before(prices_desc, signal_date - timedelta(days=30))

    pc_7 = _price_change_pct(latest_close, close_7)
    pc_30 = _price_change_pct(latest_close, close_30)

    delivery_signal_7d = classify_delivery_signal(trend_7, vol_trend_7, stage_latest, pc_7)
    delivery_signal_30d = classify_delivery_signal(trend_30, vol_trend_30, stage_latest, pc_30)

    deliv_rising_price_flat_7 = bool(
        trend_7 == "rising" and pc_7 is not None and abs(pc_7) < PRICE_FLAT_PCT,
    )
    deliv_rising_price_flat_30 = bool(
        trend_30 == "rising" and pc_30 is not None and abs(pc_30) < PRICE_FLAT_PCT,
    )

    vol_rising_7 = bool(
        avg_v7 is not None
        and avg_v30 not in (None, 0)
        and avg_v7 > avg_v30 * VOLUME_SURGE_RATIO,
    )
    vol_rising_price_flat_7 = bool(
        vol_rising_7 and pc_7 is not None and abs(pc_7) < PRICE_FLAT_PCT,
    )
    vol_rising_price_flat_30 = bool(
        avg_v30 is not None
        and avg_v60 not in (None, 0)
        and avg_v30 > avg_v60 * VOLUME_SURGE_RATIO
        and pc_30 is not None
        and abs(pc_30) < PRICE_FLAT_PCT,
    )

    unusual = bool(deliv_rising_price_flat_7 and trend_30 in ("rising", "flat"))

    return {
        "company_id": company_id,
        "date": signal_date.isoformat(),
        "delivery_trend_7d": trend_7,
        "delivery_trend_30d": trend_30,
        "delivery_volume_trend_7d": vol_trend_7,
        "delivery_volume_trend_30d": vol_trend_30,
        "delivery_signal_7d": delivery_signal_7d,
        "delivery_signal_30d": delivery_signal_30d,
        "delivery_trend_60d": trend_60,
        "delivery_trend_90d": trend_90,
        "avg_delivery_7d": avg_d7,
        "avg_delivery_30d": avg_d30,
        "avg_delivery_60d": avg_d60,
        "avg_delivery_90d": avg_d90,
        "avg_volume_7d": avg_v7,
        "avg_volume_30d": avg_v30,
        "avg_volume_60d": avg_v60,
        "avg_volume_90d": avg_v90,
        "total_traded_volume_today": today_vol,
        "price_change_7d": pc_7,
        "price_change_30d": pc_30,
        "delivery_rising_price_flat_7d": deliv_rising_price_flat_7,
        "delivery_rising_price_flat_30d": deliv_rising_price_flat_30,
        "volume_rising_price_flat_7d": vol_rising_price_flat_7,
        "volume_rising_price_flat_30d": vol_rising_price_flat_30,
        "unusual_accumulation": unusual,
    }


def main() -> None:
    mode = _parse_flags()
    signal_date = date.today()

    if mode == "test":
        company_ids = _company_ids_test()
        print(f"TEST mode: processing {len(company_ids)} companies for symbols {TEST_SYMBOLS}")
    else:
        company_ids = _company_ids_full()
        print(f"FULL mode: {len(company_ids)} distinct companies with delivery_data rows.")

    print(f"Signal date: {signal_date.isoformat()}")
    log_event(
        "calc_delivery_signals_started",
        {"mode": mode, "companies": len(company_ids), "date": signal_date.isoformat()},
    )

    stage_by_company = _fetch_latest_stages_batch(company_ids)
    print(f"Loaded latest price_data.stage for {len(stage_by_company)} companies.")

    ok = 0
    skipped_no_delivery = 0
    failures = 0

    total = len(company_ids)
    for i, cid in enumerate(company_ids, start=1):
        try:
            del_rows = _fetch_delivery_rows(cid, signal_date)
            price_rows = _fetch_price_rows(cid, signal_date)
            payload = _build_payload(
                cid,
                signal_date,
                del_rows,
                price_rows,
                stage_by_company.get(cid),
            )
            if not payload:
                skipped_no_delivery += 1
                continue
            res = upsert(SIGNAL_TABLE, payload, "company_id,date")
            if res is not None:
                ok += 1
            else:
                failures += 1
            if i % 50 == 0 or i == total:
                print(f"  Progress: {i}/{total} processed (upsert ok so far={ok})")
        except Exception as exc:
            failures += 1
            print(f"  WARN company_id={cid}: {exc}")

    print()
    print("Summary:")
    print(f"  Companies in run: {total}")
    print(f"  Upserted: {ok}")
    print(f"  Skipped (no delivery rows in window): {skipped_no_delivery}")
    print(f"  Failed: {failures}")
    log_event(
        "calc_delivery_signals_finished",
        {
            "date": signal_date.isoformat(),
            "mode": mode,
            "companies_total": total,
            "upserted": ok,
            "skipped": skipped_no_delivery,
            "failures": failures,
        },
    )


if __name__ == "__main__":
    main()
