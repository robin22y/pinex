"""
repair_is_latest_and_refresh_view.py

Runs at the END of every nightly pipeline as a self-healing pass.

Why this exists: fetch_bhav_daily.py does a non-transactional
sequence per company —
   1. UPDATE price_data SET is_latest = false WHERE
      company_id = X AND is_latest = true
   2. INSERT new bhav row with is_latest = true
A network blip / timeout / rate-limit failure between steps 1 and 2
wipes the flag with nothing replacing it. The screener (which
INNER JOINs on is_latest = true via mv_home_stocks) then shows
empty cells for that company until someone notices and runs a
manual repair.

This script eliminates that window. It runs SQL equivalent to:

    UPDATE price_data p
    SET is_latest = (p.date = m.max_date)
    FROM (
      SELECT company_id, MAX(date) AS max_date
      FROM price_data
      GROUP BY company_id
    ) m
    WHERE p.company_id = m.company_id
      AND (p.date = m.max_date OR p.is_latest = true);

…then calls refresh_home_stocks() so mv_home_stocks reflects the
freshly-marked rows. Idempotent — running it when nothing's broken
is a ~2 second no-op (the WHERE clause only touches rows that
need flipping).

PostgREST doesn't allow raw SQL through the REST API. We use the
`exec_sql` RPC pattern if available, OR fall back to per-company
update via the Python client (slower but works without any
server-side function). The fast path uses a Postgres function
we ship in the SQL migration alongside this script.

Usage:
  python scripts/repair_is_latest_and_refresh_view.py
  python scripts/repair_is_latest_and_refresh_view.py --dry-run
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

sys.path.insert(0, str(_script_dir))
from db import log_event, supabase  # noqa: E402


PAGE_SIZE = 1000


def call_repair_rpc() -> tuple[bool, str]:
    """Fast path: call the server-side Postgres function
    `repair_is_latest_flag()` defined in
    scripts/sql/create_repair_is_latest_function.sql. Runs the
    whole UPDATE in one transaction, ~1-2 seconds for ~1.5M rows.

    Returns (ok, detail). On `Could not find the function` (i.e.
    the SQL function isn't installed yet), returns (False, ...)
    and the caller falls back to per-company repair.
    """
    try:
        supabase.rpc("repair_is_latest_flag").execute()
        return True, ""
    except Exception as exc:
        return False, str(exc)


def fetch_all_companies() -> list[str]:
    """Paginated list of distinct company_ids that have ANY price
    history. Used by the slow-path fallback."""
    company_ids: set[str] = set()
    offset = 0
    while True:
        try:
            res = (
                supabase.table("price_data")
                .select("company_id")
                .order("company_id")
                .range(offset, offset + PAGE_SIZE - 1)
                .execute()
            )
        except Exception as exc:
            print(f"  ! company_id page fetch failed at offset {offset}: {exc}")
            break
        batch = res.data or []
        for r in batch:
            if r.get("company_id"):
                company_ids.add(r["company_id"])
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return sorted(company_ids)


def slow_repair_per_company(dry_run: bool = False) -> dict:
    """Fallback when the RPC isn't installed yet. Per-company:
    find max(date), mark that row is_latest=true. ~3-5 minutes
    for 2000 companies — slower but doesn't require the SQL
    function. Use the RPC for production speed."""
    company_ids = fetch_all_companies()
    print(f"  slow-path: {len(company_ids)} companies to check")

    flipped = 0
    for i, cid in enumerate(company_ids, start=1):
        try:
            # Most recent row for this company.
            res = (
                supabase.table("price_data")
                .select("id, date, is_latest")
                .eq("company_id", cid)
                .order("date", desc=True)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            if not rows:
                continue
            latest = rows[0]
            if latest.get("is_latest") is True:
                continue  # already correct
            if dry_run:
                flipped += 1
            else:
                supabase.table("price_data").update(
                    {"is_latest": True}
                ).eq("id", latest["id"]).execute()
                flipped += 1
            if i % 200 == 0:
                print(f"    [{i}/{len(company_ids)}] flipped so far: {flipped}")
        except Exception as exc:
            print(f"  ! company {cid}: {exc}")
    return {"flipped": flipped, "companies_checked": len(company_ids)}


def refresh_view() -> tuple[bool, str]:
    """Trigger refresh_home_stocks(). Skipped on dry-run."""
    try:
        supabase.rpc("refresh_home_stocks").execute()
        return True, ""
    except Exception as exc:
        return False, str(exc)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--dry-run", action="store_true",
                        help="Don't write; just report what would happen.")
    args = parser.parse_args()

    started = time.time()
    print(f"[repair_is_latest] start {datetime.utcnow().isoformat()} "
          f"{'(DRY RUN)' if args.dry_run else '(LIVE)'}")

    # Try the fast RPC path first.
    if not args.dry_run:
        ok, detail = call_repair_rpc()
        if ok:
            print("  fast path: repair_is_latest_flag() executed")
            # Refresh the view so mv_home_stocks reflects the new flags.
            view_ok, view_detail = refresh_view()
            if view_ok:
                print("  refresh_home_stocks() executed")
            else:
                print(f"  WARN: refresh_home_stocks failed: {view_detail}")
            elapsed = round(time.time() - started, 1)
            print(f"[repair_is_latest] done — fast path · elapsed={elapsed}s")
            log_event("repair_is_latest_finished", {
                "path": "fast", "elapsed_sec": elapsed,
                "view_refreshed": view_ok,
            })
            return 0
        else:
            print(f"  fast path failed ({detail[:120]}) — falling back to slow per-company repair")

    # Slow fallback (also used by --dry-run).
    stats = slow_repair_per_company(dry_run=args.dry_run)

    if not args.dry_run:
        view_ok, view_detail = refresh_view()
        if view_ok:
            print("  refresh_home_stocks() executed")
        else:
            print(f"  WARN: refresh_home_stocks failed: {view_detail}")
    else:
        view_ok = None

    elapsed = round(time.time() - started, 1)
    print(
        f"[repair_is_latest] done — slow path · "
        f"checked={stats['companies_checked']} flipped={stats['flipped']} "
        f"elapsed={elapsed}s"
    )
    log_event("repair_is_latest_finished", {
        "path": "slow",
        "checked": stats["companies_checked"],
        "flipped": stats["flipped"],
        "view_refreshed": view_ok,
        "dry_run": args.dry_run,
        "elapsed_sec": elapsed,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
