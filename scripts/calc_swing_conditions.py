"""Calculate daily swing conditions from price + delivery data."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from typing import Any

from db import log_event, supabase, upsert
from symbols import ALL_SYMBOLS, COMPANY_META

SWING_TABLE = "swing_conditions"
SECTORS_TABLE = "sectors"
TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]


def _today_iso() -> str:
    return datetime.now().date().isoformat()


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _is_stage2(stage: str | None) -> bool:
    if not stage:
        return False
    s = stage.strip().lower().replace(" ", "")
    return s == "stage2"


def _get_company_ids_by_symbol() -> dict[str, str]:
    out: dict[str, str] = {}
    page = 5000
    start = 0
    while True:
        res = supabase.table("companies").select("id,symbol").range(start, start + page - 1).execute()
        data = getattr(res, "data", None) or []
        if not data:
            break
        for row in data:
            sym = str(row.get("symbol") or "").strip()
            cid = str(row.get("id") or "").strip()
            if sym and cid:
                out[sym] = cid
        if len(data) < page:
            break
        start += page
    return out


def _fetch_today_price_map(today: str) -> dict[str, dict[str, Any]]:
    res = (
        supabase.table("price_data")
        .select("*, companies(symbol)")
        .eq("date", today)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        company = r.get("companies")
        symbol = ""
        if isinstance(company, dict):
            symbol = str(company.get("symbol") or "")
        elif isinstance(company, list) and company:
            symbol = str((company[0] or {}).get("symbol") or "")
        symbol = symbol.strip()
        if symbol:
            out[symbol] = r
    return out


def _fetch_today_delivery_map(today: str) -> dict[str, dict[str, Any]]:
    res = (
        supabase.table("delivery_data")
        .select("*, companies(symbol)")
        .eq("date", today)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        company = r.get("companies")
        symbol = ""
        if isinstance(company, dict):
            symbol = str(company.get("symbol") or "")
        elif isinstance(company, list) and company:
            symbol = str((company[0] or {}).get("symbol") or "")
        symbol = symbol.strip()
        if symbol:
            out[symbol] = r
    return out


def _fetch_recent_price_rows(company_id: str, n: int = 30) -> list[dict[str, Any]]:
    res = (
        supabase.table("price_data")
        .select("date,stage,volume")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(n)
        .execute()
    )
    return getattr(res, "data", None) or []


def _volume_contracting_from_rows(recent_rows: list[dict[str, Any]]) -> bool:
    if len(recent_rows) < 30:
        return False
    vols = [_safe_float(r.get("volume")) for r in recent_rows]
    vols = [v for v in vols if v is not None]
    if len(vols) < 30:
        return False
    last_3_avg = sum(vols[:3]) / 3.0
    avg_30 = sum(vols[:30]) / 30.0
    if avg_30 <= 0:
        return False
    return last_3_avg < avg_30 * 0.75


def _stage2_new_this_week_from_rows(recent_rows: list[dict[str, Any]]) -> bool:
    # rows are newest-first; convert to oldest-first for transition checks.
    if not recent_rows:
        return False
    parsed: list[tuple[datetime, str | None]] = []
    for r in recent_rows:
        dt_txt = str(r.get("date") or "")
        try:
            dt = datetime.fromisoformat(dt_txt)
        except ValueError:
            continue
        parsed.append((dt, r.get("stage")))
    if len(parsed) < 2:
        return False
    parsed.sort(key=lambda x: x[0])

    cutoff = datetime.now() - timedelta(days=7)
    for i in range(1, len(parsed)):
        dt, stage_now = parsed[i]
        _, stage_prev = parsed[i - 1]
        if dt < cutoff:
            continue
        if _is_stage2(stage_now) and not _is_stage2(stage_prev):
            return True
    return False


def _sector_health_label(pct: float) -> str:
    if pct >= 60:
        return "strong"
    if pct >= 35:
        return "moderate"
    return "weak"


def main() -> None:
    today = _today_iso()
    log_event("calc_swing_conditions_started", {"trading_date": today, "test_mode": TEST_MODE})
    if TEST_MODE:
        print("TEST MODE enabled: processing symbols SYRMA, APTUS, TEJASNET")

    company_id_by_symbol = _get_company_ids_by_symbol()
    price_today = _fetch_today_price_map(today)
    delivery_today = _fetch_today_delivery_map(today)

    sector_totals: dict[str, int] = {}
    sector_stage2: dict[str, int] = {}
    processed = 0

    symbols = TEST_SYMBOLS if TEST_MODE else ALL_SYMBOLS
    for symbol in symbols:
        p = price_today.get(symbol)
        d = delivery_today.get(symbol)
        if not p or not d:
            continue
        company_id = company_id_by_symbol.get(symbol)
        if not company_id:
            continue

        close = _safe_float(p.get("close"))
        ma20 = _safe_float(p.get("ma20"))
        rsi = _safe_float(p.get("rsi14")) or _safe_float(p.get("rsi"))
        high_52w = _safe_float(p.get("high_52w"))
        vs_30d_avg = _safe_float(d.get("vs_30d_avg"))
        stage = p.get("stage")

        if close is None or ma20 in (None, 0) or rsi is None:
            continue

        recent_rows = _fetch_recent_price_rows(company_id, n=30)

        cond_stage2 = _is_stage2(stage)
        cond_delivery = vs_30d_avg is not None and vs_30d_avg > 1.3
        cond_near_ma20 = abs(close - ma20) / ma20 < 0.03
        cond_rsi = 40 <= rsi <= 65
        cond_volume_contracting = _volume_contracting_from_rows(recent_rows)

        breakout_52w = high_52w is not None and close >= high_52w * 0.99
        stage2_new_this_week = _stage2_new_this_week_from_rows(recent_rows)

        conditions_met = sum(
            [
                cond_stage2,
                cond_delivery,
                cond_near_ma20,
                cond_rsi,
                cond_volume_contracting,
            ],
        )

        row = {
            "symbol": symbol,
            "company_id": company_id,
            "trading_date": today,
            "condition_stage2": cond_stage2,
            "condition_delivery_above_avg": cond_delivery,
            "condition_near_ma20": cond_near_ma20,
            "condition_rsi_healthy": cond_rsi,
            "condition_volume_contracting": cond_volume_contracting,
            "conditions_met": conditions_met,
            "breakout_52w": breakout_52w,
            "stage2_new_this_week": stage2_new_this_week,
            "updated_at": datetime.utcnow().isoformat(),
        }
        upsert(SWING_TABLE, row, "symbol,trading_date")
        processed += 1

        sector = str(COMPANY_META.get(symbol, {}).get("sector") or "").strip() or "Unknown"
        sector_totals[sector] = sector_totals.get(sector, 0) + 1
        if cond_stage2:
            sector_stage2[sector] = sector_stage2.get(sector, 0) + 1

    # Sector health update
    for sector, total_count in sector_totals.items():
        stage2_count = sector_stage2.get(sector, 0)
        health_pct = (stage2_count / total_count * 100.0) if total_count else 0.0
        health_label = _sector_health_label(health_pct)
        sector_row = {
            "sector": sector,
            "trading_date": today,
            "stage2_count": stage2_count,
            "total_companies": total_count,
            "health_pct": health_pct,
            "health": health_label,
            "updated_at": datetime.utcnow().isoformat(),
        }
        upsert(SECTORS_TABLE, sector_row, "sector,trading_date")

    print(
        f"swing conditions done: processed={processed} sectors={len(sector_totals)} date={today}",
    )
    log_event(
        "calc_swing_conditions_finished",
        {
            "trading_date": today,
            "processed_symbols": processed,
            "sectors_updated": len(sector_totals),
        },
    )


if __name__ == "__main__":
    main()
