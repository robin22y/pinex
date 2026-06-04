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
TEST_SYMBOLS = [
    "RELIANCE",
    "HDFCBANK",
    "INFY",
    "TATAMOTORS",
    "SUNPHARMA",
    "WIPRO",
    "AXISBANK",
    "NESTLEIND",
    "BAJFINANCE",
    "MARUTI",
]  # Nifty 50 — guaranteed daily price/delivery rows for --test runs.


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
    # page=1000 matches PostgREST's hard max-rows cap. The previous
    # 5000 silently returned only the first 1000 then the
    # len(data) < page guard exited — so only ~1000 of the ~2125
    # companies ever made it into the map.
    out: dict[str, str] = {}
    page = 1000
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


def _paginated_fetch_for_date(
    table: str,
    today: str,
    columns: str = "*, companies(symbol)",
) -> list[dict[str, Any]]:
    """Fetch every row for one date from `table`, with PostgREST 1000-row pagination.

    Without .range() these queries silently returned only the first ~1000 of
    ~2125 stocks, so the swing-condition map was missing nearly half the
    universe and many stocks were silently skipped.
    """
    out: list[dict[str, Any]] = []
    start = 0
    page = 1000
    while True:
        res = (
            supabase.table(table)
            .select(columns)
            .eq("date", today)
            .range(start, start + page - 1)
            .execute()
        )
        batch = getattr(res, "data", None) or []
        out.extend(batch)
        if len(batch) < page:
            break
        start += page
    return out


def _rows_to_symbol_map(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
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


def _fetch_today_price_map(today: str) -> dict[str, dict[str, Any]]:
    return _rows_to_symbol_map(_paginated_fetch_for_date("price_data", today))


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
    # Delivery dropped from SwingX criteria. The condition_delivery_above_avg
    # column is still written (as False) to keep downstream readers happy,
    # but no delivery_data / delivery_signals fetch happens here any more.

    sector_totals: dict[str, int] = {}
    sector_stage2: dict[str, int] = {}
    processed = 0

    # ALL_SYMBOLS (from symbols.py) is a static ~375-entry seed list
    # — too narrow for today's universe. Iterate the live companies
    # table instead so processed≈2125 (matches bhav scope).
    symbols = TEST_SYMBOLS if TEST_MODE else sorted(company_id_by_symbol.keys())
    for symbol in symbols:
        p = price_today.get(symbol)
        if not p:
            continue
        company_id = company_id_by_symbol.get(symbol)
        if not company_id:
            continue

        close = _safe_float(p.get("close"))
        ma20 = _safe_float(p.get("ma20"))
        rsi = _safe_float(p.get("rsi14")) or _safe_float(p.get("rsi"))
        high_52w = _safe_float(p.get("high_52w"))
        stage = p.get("stage")

        if close is None or ma20 in (None, 0) or rsi is None:
            continue

        recent_rows = _fetch_recent_price_rows(company_id, n=30)

        cond_stage2 = _is_stage2(stage)
        # Delivery condition deliberately dropped from SwingX criteria.
        # We persist the column as False (not None — Postgres boolean
        # column likely NOT NULL) so other readers don't break.
        cond_delivery = False
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
            # Schema-aligned: swing_conditions has company_id + date
            # (NOT symbol + trading_date). Writing the wrong names
            # silently failed every nightly run because db.upsert()
            # swallowed exceptions to None. Now using the real schema.
            "company_id": company_id,
            "date": today,
            "condition_stage2": cond_stage2,
            "condition_delivery_above_avg": cond_delivery,
            "condition_near_ma20": cond_near_ma20,
            "condition_rsi_healthy": cond_rsi,
            "condition_volume_contracting": cond_volume_contracting,
            "conditions_met": conditions_met,
            "breakout_52w": breakout_52w,
            "stage2_new_this_week": stage2_new_this_week,
            # updated_at column doesn't exist on the live swing_conditions
            # table — Supabase has only `created_at` (set by DEFAULT now()).
            # Writing updated_at = PGRST204 silently fails every row.
        }
        upsert(SWING_TABLE, row, "company_id,date")
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
        # Schema-aligned. The live sectors table uses `name` + `date`
        # (not `sector` + `trading_date`) and `stage2_pct` (not
        # `health_pct`). The UNIQUE constraint is on `name` alone
        # (sectors_name_key) — table is a single-row-per-sector
        # snapshot, not a per-day history. ON CONFLICT name does the
        # right thing: the `date` field acts as a last-updated marker
        # within the same row.
        sector_row = {
            "name": sector,
            "date": today,
            "stage2_count": stage2_count,
            "total_companies": total_count,
            "stage2_pct": health_pct,
            "health": health_label,
            "updated_at": datetime.utcnow().isoformat(),
        }
        upsert(SECTORS_TABLE, sector_row, "name")

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
