"""
Backfill sector and sector_health_pct on all existing swing_conditions rows.

For each date in swing_conditions, finds the matching (or nearest prior)
sector health from the sectors table and updates every row for that date.

Run once:
    cd scripts
    python backfill_swing_sector_health.py

Safe to re-run.
"""

from __future__ import annotations

import time
from datetime import datetime, UTC
from typing import Any

from db import log_event, supabase

SWING_TABLE = "swing_conditions"
SECTORS_TABLE = "sectors"
BATCH_SIZE = 200
SLEEP_BETWEEN_BATCHES = 0.3


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fetch_company_sector_map() -> dict[str, str]:
    """Returns {company_id: sector_name} from companies table."""
    out: dict[str, str] = {}
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table("companies")
            .select("id,sector")
            .range(start, start + page - 1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if not rows:
            break
        for r in rows:
            cid = str(r.get("id") or "").strip()
            sec = str(r.get("sector") or "").strip()
            if cid and sec:
                out[cid] = sec
        if len(rows) < page:
            break
        start += page
    print(f"[company_map] loaded {len(out)} companies")
    return out


def _fetch_all_sector_health() -> dict[str, dict[str, float]]:
    """
    Returns {date: {sector_name: stage2_pct}}.
    Loads all historical sector rows in one query.
    """
    res = (
        supabase.table(SECTORS_TABLE)
        .select("date,name,stage2_pct")
        .order("date", desc=False)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    out: dict[str, dict[str, float]] = {}
    for r in rows:
        d = str(r.get("date") or "").strip()
        sector = str(r.get("name") or "").strip()
        pct = _safe_float(r.get("stage2_pct"))
        if d and sector and pct is not None:
            if d not in out:
                out[d] = {}
            out[d][sector] = pct
    print(f"[sector_health] loaded {len(out)} dates")
    return out


def _nearest_sector_map(
    target_date: str,
    all_sector_health: dict[str, dict[str, float]],
) -> dict[str, float]:
    """Exact match or nearest prior date."""
    if target_date in all_sector_health:
        return all_sector_health[target_date]
    prior_dates = sorted(d for d in all_sector_health if d < target_date)
    if not prior_dates:
        return {}
    return all_sector_health[prior_dates[-1]]


def _fetch_all_swing_dates() -> list[str]:
    """All distinct dates in swing_conditions, oldest first."""
    res = (
        supabase.table(SWING_TABLE)
        .select("date")
        .order("date", desc=False)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    seen: set[str] = set()
    dates: list[str] = []
    for r in rows:
        d = str(r.get("date") or "").strip()
        if d and d not in seen:
            seen.add(d)
            dates.append(d)
    return dates


def _fetch_swing_rows_for_date(date: str) -> list[dict[str, Any]]:
    """Fetch all swing_conditions rows for a given date."""
    res = (
        supabase.table(SWING_TABLE)
        .select("id,company_id,date,sector,sector_health_pct")
        .eq("date", date)
        .execute()
    )
    return getattr(res, "data", None) or []


def _batch_update(updates: list[dict[str, Any]]) -> int:
    """Update rows by id. Returns count updated."""
    if not updates:
        return 0
    try:
        supabase.table(SWING_TABLE).upsert(updates, on_conflict="id").execute()
        return len(updates)
    except Exception as e:
        print(f"  [error] batch upsert failed: {e}")
        return 0


def main() -> None:
    started = time.time()
    print("=== backfill_swing_sector_health ===")
    log_event("backfill_swing_sector_health_started", {"time": datetime.now(UTC).isoformat()})

    print("Loading company → sector map...")
    company_sector_map = _fetch_company_sector_map()

    print("Loading sector health history...")
    all_sector_health = _fetch_all_sector_health()

    if not all_sector_health:
        print("ERROR: No sector health data found in sectors table.")
        return

    print("Loading distinct dates from swing_conditions...")
    swing_dates = _fetch_all_swing_dates()
    print(f"Found {len(swing_dates)} distinct dates to process")

    total_updated = 0
    total_skipped = 0

    for date_idx, date in enumerate(swing_dates, 1):
        sector_map = _nearest_sector_map(date, all_sector_health)
        if not sector_map:
            print(f"[{date_idx}/{len(swing_dates)}] {date} — no sector data, skipping")
            total_skipped += 1
            continue

        swing_rows = _fetch_swing_rows_for_date(date)
        if not swing_rows:
            continue

        updates: list[dict[str, Any]] = []
        for row in swing_rows:
            row_id = row.get("id")
            company_id = str(row.get("company_id") or "").strip()
            if not row_id or not company_id:
                continue

            sector = company_sector_map.get(company_id, "Unknown")
            health_pct = sector_map.get(sector)

            # Skip if already correct
            if row.get("sector") == sector and row.get("sector_health_pct") == health_pct:
                continue

            updates.append({
                "id": row_id,
                "sector": sector,
                "sector_health_pct": health_pct,
            })

        if not updates:
            print(f"[{date_idx}/{len(swing_dates)}] {date} — already up to date")
            continue

        for i in range(0, len(updates), BATCH_SIZE):
            batch = updates[i: i + BATCH_SIZE]
            total_updated += _batch_update(batch)
            time.sleep(SLEEP_BETWEEN_BATCHES)

        print(f"[{date_idx}/{len(swing_dates)}] {date} — updated {len(updates)} rows")

    elapsed = round(time.time() - started, 2)
    print(f"\nDone. total_updated={total_updated} skipped_dates={total_skipped} elapsed={elapsed}s")
    log_event(
        "backfill_swing_sector_health_finished",
        {
            "total_updated": total_updated,
            "skipped_dates": total_skipped,
            "elapsed_sec": elapsed,
        },
    )


if __name__ == "__main__":
    main()
