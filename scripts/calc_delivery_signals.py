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

from db import get_active_symbols, log_event, supabase, upsert
from nse_holidays import NSE_HOLIDAYS_2026
from symbols import ALL_SYMBOLS

SIGNAL_TABLE = "delivery_signals"
DELIVERY_TABLE = "delivery_data"
PRICE_TABLE = "price_data"
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]

SLOPE_RISING = 0.5
SLOPE_FALLING = -0.5
PRICE_FLAT_PCT = 3.0
VOLUME_SURGE_RATIO = 1.3
# Compare rolling averages of total_volume (turnover) for delivery_volume_trend_* + frontend.
VOLUME_AVG_TREND_HIGH = 1.15
VOLUME_AVG_TREND_LOW = 0.85

ACCUM_DELIVERY_MULT_TYPE1 = 1.3
ACCUM_DELIVERY_MIN_TYPE1 = 45.0
ACCUM_PRICE_FLAT_PCT = 5.0
ACCUM_VOL_RATIO_TYPE2 = 1.3
ACCUM_DELIVERY_MULT_TYPE2 = 1.2

DIST_VOL_RATIO_TYPE1 = 1.5
DIST_DELIVERY_MULT_TYPE1 = 0.7
DIST_PRICE_MAX_CHANGE_TYPE1 = 2.0
DIST_DELIVERY_MAX_TYPE2 = 30.0

BREAKOUT_30W_PC_7_MIN = 3.0
BREAKOUT_30W_MA_SLOPE_MIN = -1.0
BREAKOUT_30W_PCT_FROM_MA_MAX = 10.0

BREAKDOWN_30W_PC_7_MAX = -3.0
BREAKDOWN_30W_PCT_FROM_MA_MIN = -10.0

BREAKOUT_50D_PC_7_MIN = 2.0
BREAKOUT_50D_VOL_RATIO_MIN = 1.2
BREAKDOWN_50D_PC_7_MAX = -2.0
BREAKDOWN_50D_VOL_RATIO_MIN = 1.2

# Optional columns added by scripts/sql/add_delivery_signal_detection_flags.sql.
EXTENSION_PAYLOAD_KEYS = (
    "delivery_pct_today",
    "vol_ratio",
    "is_accumulation",
    "is_distribution",
    "breakout_30wma",
    "breakdown_30wma",
    "breakout_50dma",
    "breakdown_50dma",
)

_extension_columns_enabled: bool | None = None


def _parse_flags() -> str:
    if "--test" in sys.argv:
        return "test"
    if "--full" in sys.argv:
        return "full"
    print("Error: specify --test (SYRMA, APTUS, TEJASNET) or --full (all companies with delivery data).")
    sys.exit(1)


def _skip_reason_for_daily_update(mode: str) -> str | None:
    if mode == "test":
        return None
    if "--force" in sys.argv:
        print("FORCE MODE — skipping market closed check")
        return None
    today = date.today()
    if today.weekday() >= 5:
        return "Market closed — skipping calc_delivery_signals"
    if today.isoformat() in NSE_HOLIDAYS_2026:
        return "NSE holiday — skipping calc_delivery_signals"
    return None


def _schema_extension_error(exc: BaseException) -> bool:
    parts = [str(exc), repr(exc)]
    for attr in ("message", "details", "hint", "code"):
        val = getattr(exc, attr, None)
        if val is not None:
            parts.append(str(val))
    if hasattr(exc, "args"):
        parts.extend(str(a) for a in exc.args)

    msg = " ".join(parts).lower()
    if any(token in msg for token in ("pgrst204", "schema cache", "does not exist", "42703")):
        return True

    for arg in getattr(exc, "args", ()):
        if isinstance(arg, dict):
            code = str(arg.get("code", "")).lower()
            message = str(arg.get("message", "")).lower()
            if code in ("pgrst204", "42703") or "does not exist" in message:
                return True

    return False


def _delivery_signal_extension_columns_enabled() -> bool:
    global _extension_columns_enabled
    if _extension_columns_enabled is not None:
        return _extension_columns_enabled

    select_cols = ",".join(EXTENSION_PAYLOAD_KEYS)
    try:
        supabase.table(SIGNAL_TABLE).select(select_cols).limit(1).execute()
        _extension_columns_enabled = True
    except Exception as exc:
        if _schema_extension_error(exc):
            _extension_columns_enabled = False
            print(
                "WARN: delivery_signals extension columns missing in Supabase — "
                "run scripts/sql/add_delivery_signal_detection_flags.sql, then re-run. "
                "Upserting legacy columns only.",
            )
        else:
            raise

    return _extension_columns_enabled


def _payload_for_upsert(payload: dict[str, Any]) -> dict[str, Any]:
    if _delivery_signal_extension_columns_enabled():
        return payload
    return {k: v for k, v in payload.items() if k not in EXTENSION_PAYLOAD_KEYS}


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


def _pct_from_ma(close: float | None, ma: float | None) -> float | None:
    if close is None or ma in (None, 0):
        return None
    return (close - ma) / ma * 100.0


def _vol_ratio(today_volume: float | None, avg_volume_30d: float | None) -> float | None:
    if today_volume is None or avg_volume_30d in (None, 0):
        return None
    return today_volume / avg_volume_30d


def _price_change_within_pct(price_change_7d: float | None, max_abs_pct: float) -> bool:
    return price_change_7d is not None and abs(price_change_7d) < max_abs_pct


def _is_high_delivery_accumulation(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
) -> bool:
    if not _price_change_within_pct(price_change_7d, ACCUM_PRICE_FLAT_PCT):
        return False
    if (
        delivery_pct_today is None
        or avg_delivery_30d is None
        or avg_delivery_30d <= 0
    ):
        return False
    return (
        delivery_pct_today > avg_delivery_30d * ACCUM_DELIVERY_MULT_TYPE1
        and delivery_pct_today > ACCUM_DELIVERY_MIN_TYPE1
    )


def _is_volume_delivery_accumulation(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    if not _price_change_within_pct(price_change_7d, ACCUM_PRICE_FLAT_PCT):
        return False
    if (
        vol_ratio is None
        or delivery_pct_today is None
        or avg_delivery_30d is None
        or avg_delivery_30d <= 0
    ):
        return False
    return (
        vol_ratio > ACCUM_VOL_RATIO_TYPE2
        and delivery_pct_today > avg_delivery_30d * ACCUM_DELIVERY_MULT_TYPE2
    )


def _is_accumulation(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    return _is_high_delivery_accumulation(
        delivery_pct_today,
        avg_delivery_30d,
        price_change_7d,
    ) or _is_volume_delivery_accumulation(
        delivery_pct_today,
        avg_delivery_30d,
        price_change_7d,
        vol_ratio,
    )


def _is_high_volume_low_delivery_distribution(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    if (
        vol_ratio is None
        or delivery_pct_today is None
        or avg_delivery_30d is None
        or avg_delivery_30d <= 0
        or price_change_7d is None
    ):
        return False
    return (
        vol_ratio > DIST_VOL_RATIO_TYPE1
        and delivery_pct_today < avg_delivery_30d * DIST_DELIVERY_MULT_TYPE1
        and price_change_7d <= DIST_PRICE_MAX_CHANGE_TYPE1
    )


def _is_falling_delivery_price_stalling_distribution(
    delivery_pct_today: float | None,
    delivery_trend_30d: str,
    price_change_7d: float | None,
) -> bool:
    if delivery_pct_today is None or price_change_7d is None:
        return False
    return (
        delivery_trend_30d == "falling"
        and delivery_pct_today < DIST_DELIVERY_MAX_TYPE2
        and price_change_7d < 0
    )


def _is_distribution(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    delivery_trend_30d: str,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    return _is_high_volume_low_delivery_distribution(
        delivery_pct_today,
        avg_delivery_30d,
        price_change_7d,
        vol_ratio,
    ) or _is_falling_delivery_price_stalling_distribution(
        delivery_pct_today,
        delivery_trend_30d,
        price_change_7d,
    )


def _is_breakout_30wma(
    close: float | None,
    ma30w: float | None,
    price_change_7d: float | None,
    ma30w_slope: float | None,
) -> bool:
    pct_from_ma = _pct_from_ma(close, ma30w)
    if close is None or ma30w is None or price_change_7d is None or ma30w_slope is None:
        return False
    if pct_from_ma is None:
        return False
    return (
        close > ma30w
        and price_change_7d > BREAKOUT_30W_PC_7_MIN
        and ma30w_slope > BREAKOUT_30W_MA_SLOPE_MIN
        and 0 < pct_from_ma < BREAKOUT_30W_PCT_FROM_MA_MAX
    )


def _is_breakdown_30wma(
    close: float | None,
    ma30w: float | None,
    price_change_7d: float | None,
) -> bool:
    pct_from_ma = _pct_from_ma(close, ma30w)
    if close is None or ma30w is None or price_change_7d is None or pct_from_ma is None:
        return False
    return (
        close < ma30w
        and price_change_7d < BREAKDOWN_30W_PC_7_MAX
        and BREAKDOWN_30W_PCT_FROM_MA_MIN < pct_from_ma < 0
    )


def _is_breakout_50dma(
    close: float | None,
    ma50: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    if close is None or ma50 is None or price_change_7d is None or vol_ratio is None:
        return False
    return (
        close > ma50
        and price_change_7d > BREAKOUT_50D_PC_7_MIN
        and vol_ratio > BREAKOUT_50D_VOL_RATIO_MIN
    )


def _is_breakdown_50dma(
    close: float | None,
    ma50: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    if close is None or ma50 is None or price_change_7d is None or vol_ratio is None:
        return False
    return (
        close < ma50
        and price_change_7d < BREAKDOWN_50D_PC_7_MAX
        and vol_ratio > BREAKDOWN_50D_VOL_RATIO_MIN
    )


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


def _avg_total_volume_trend(
    avg_short: float | None,
    avg_long: float | None,
) -> str:
    """
    Trend from average total turnover: short window vs longer baseline.
    Same thresholds as DeliveryPanel (1.15 / 0.85).
    """
    if avg_short is None or avg_long is None or avg_long <= 0:
        return "flat"
    if avg_short > avg_long * VOLUME_AVG_TREND_HIGH:
        return "rising"
    if avg_short < avg_long * VOLUME_AVG_TREND_LOW:
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


def _fetch_latest_delivery_snapshot(company_id: str) -> dict[str, Any] | None:
    res = (
        supabase.table(DELIVERY_TABLE)
        .select("delivery_pct,total_volume,date")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


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


def _fetch_latest_price_snapshots_batch(company_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Latest price_data row per company (is_latest=true)."""
    out: dict[str, dict[str, Any]] = {}
    if not company_ids:
        return out
    chunk_size = 200
    for i in range(0, len(company_ids), chunk_size):
        chunk = company_ids[i : i + chunk_size]
        res = (
            supabase.table(PRICE_TABLE)
            .select("company_id,stage,close,ma50,ma30w,ma30w_slope")
            .eq("is_latest", True)
            .in_("company_id", chunk)
            .execute()
        )
        for r in getattr(res, "data", None) or []:
            cid = str(r.get("company_id") or "").strip()
            if cid:
                out[cid] = r
    return out


def _company_ids_full() -> list[str]:
    """Company IDs for active (non-suspended) tracked symbols only."""
    symbols = get_active_symbols(ALL_SYMBOLS)
    if not symbols:
        return []
    out: list[str] = []
    chunk = 500
    for i in range(0, len(symbols), chunk):
        batch = symbols[i : i + chunk]
        res = supabase.table("companies").select("id").in_("symbol", batch).execute()
        for r in getattr(res, "data", None) or []:
            cid = str(r.get("id") or "").strip()
            if cid:
                out.append(cid)
    return out


def _build_payload(
    company_id: str,
    signal_date: date,
    deliveries_asc: list[dict[str, Any]],
    prices_desc: list[dict[str, Any]],
    price_snapshot: dict[str, Any] | None,
    latest_delivery: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not deliveries_asc:
        return None

    def period_metrics(days: int) -> tuple[list[float], list[float]]:
        rows = _window_rows(deliveries_asc, signal_date, days)
        pcts = [
            float(v)
            for v in (_safe_float(r.get("delivery_pct")) for r in rows)
            if v is not None
        ]
        vols = [
            float(v)
            for v in (_safe_float(r.get("total_volume")) for r in rows)
            if v is not None
        ]
        return pcts, vols

    p7, v7 = period_metrics(7)
    p30, v30 = period_metrics(30)
    p60, v60 = period_metrics(60)
    p90, v90 = period_metrics(90)

    trend_7, avg_d7 = _trend_and_avg(p7)
    trend_30, avg_d30 = _trend_and_avg(p30)
    trend_60, avg_d60 = _trend_and_avg(p60)
    trend_90, avg_d90 = _trend_and_avg(p90)

    # Averages of total_volume (traded quantity) over last N calendar-window rows.
    avg_v7 = sum(v7) / len(v7) if v7 else None
    avg_v30 = sum(v30) / len(v30) if v30 else None
    avg_v60 = sum(v60) / len(v60) if v60 else None
    avg_v90 = sum(v90) / len(v90) if v90 else None

    vol_trend_7 = _avg_total_volume_trend(avg_v7, avg_v30)
    vol_trend_30 = _avg_total_volume_trend(avg_v30, avg_v90)

    delivery_pct_today = _safe_float((latest_delivery or {}).get("delivery_pct"))
    today_vol = _safe_float((latest_delivery or {}).get("total_volume"))

    snap = price_snapshot or {}
    stage_latest = snap.get("stage")
    latest_close = _safe_float(snap.get("close")) or _close_on_or_before(prices_desc, signal_date)
    ma50 = _safe_float(snap.get("ma50"))
    ma30w = _safe_float(snap.get("ma30w"))
    ma30w_slope = _safe_float(snap.get("ma30w_slope"))
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
        and avg_v7 > avg_v30 * VOLUME_AVG_TREND_HIGH,
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

    vol_ratio = _vol_ratio(today_vol, avg_v30)
    is_accumulation = _is_accumulation(delivery_pct_today, avg_d30, pc_7, vol_ratio)
    is_distribution = _is_distribution(
        delivery_pct_today,
        avg_d30,
        trend_30,
        pc_7,
        vol_ratio,
    )
    breakout_30wma = _is_breakout_30wma(latest_close, ma30w, pc_7, ma30w_slope)
    breakdown_30wma = _is_breakdown_30wma(latest_close, ma30w, pc_7)
    breakout_50dma = _is_breakout_50dma(latest_close, ma50, pc_7, vol_ratio)
    breakdown_50dma = _is_breakdown_50dma(latest_close, ma50, pc_7, vol_ratio)

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
        "delivery_pct_today": delivery_pct_today,
        "vol_ratio": vol_ratio,
        "price_change_7d": pc_7,
        "price_change_30d": pc_30,
        "is_accumulation": is_accumulation,
        "is_distribution": is_distribution,
        "breakout_30wma": breakout_30wma,
        "breakdown_30wma": breakdown_30wma,
        "breakout_50dma": breakout_50dma,
        "breakdown_50dma": breakdown_50dma,
        "delivery_rising_price_flat_7d": deliv_rising_price_flat_7,
        "delivery_rising_price_flat_30d": deliv_rising_price_flat_30,
        "volume_rising_price_flat_7d": vol_rising_price_flat_7,
        "volume_rising_price_flat_30d": vol_rising_price_flat_30,
        "unusual_accumulation": unusual,
    }


def main() -> None:
    mode = _parse_flags()
    skip = _skip_reason_for_daily_update(mode)
    if skip:
        print(skip)
        log_event(
            "calc_delivery_signals_skipped",
            {"reason": skip, "iso_date": date.today().isoformat(), "mode": mode},
        )
        return

    signal_date = date.today()

    if mode == "test":
        company_ids = _company_ids_test()
        print(f"TEST mode: processing {len(company_ids)} companies for symbols {TEST_SYMBOLS}")
    else:
        company_ids = _company_ids_full()
        print(f"FULL mode: {len(company_ids)} companies (active symbols from DB, by company id).")

    print(f"Signal date: {signal_date.isoformat()}")
    log_event(
        "calc_delivery_signals_started",
        {
            "mode": mode,
            "companies": len(company_ids),
            "date": signal_date.isoformat(),
            "force": "--force" in sys.argv,
        },
    )

    price_by_company = _fetch_latest_price_snapshots_batch(company_ids)
    print(f"Loaded latest price_data snapshots for {len(price_by_company)} companies.")
    _delivery_signal_extension_columns_enabled()

    ok = 0
    skipped_no_delivery = 0
    failures = 0

    total = len(company_ids)
    for i, cid in enumerate(company_ids, start=1):
        try:
            del_rows = _fetch_delivery_rows(cid, signal_date)
            latest_delivery = _fetch_latest_delivery_snapshot(cid)
            price_rows = _fetch_price_rows(cid, signal_date)
            payload = _build_payload(
                cid,
                signal_date,
                del_rows,
                price_rows,
                price_by_company.get(cid),
                latest_delivery,
            )
            if not payload:
                skipped_no_delivery += 1
                continue
            res = upsert(SIGNAL_TABLE, _payload_for_upsert(payload), "company_id,date")
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
