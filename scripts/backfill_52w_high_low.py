"""Backfill trailing-252-day high_52w / low_52w on every price_data row.

WHY: bhav pipeline (fetch_bhav_daily.py / calc_indicators) does NOT
write high_52w or low_52w per row — those are normally set by the
SQL function update_52w_high_low() which only updates the latest
row per company. So historical rows have NULL for both, which makes
the BreadthLab "New 52W Highs vs Lows" chart show mostly flat zero
with phantom spikes.

The pure-SQL window-function UPDATE on 1.57M rows timed out on
Supabase. This script does the same math one company at a time —
per-company rolling window is small (~1260 rows), no timeout risk.

Usage:
  python scripts/backfill_52w_high_low.py
  python scripts/backfill_52w_high_low.py --symbol=SBIN
  python scripts/backfill_52w_high_low.py --dry-run
  python scripts/backfill_52w_high_low.py --from=2024-01-01

After this finishes, re-run scripts/backfill_market_internals_history.py
so the per-date breadth aggregates pick up the correct 52W values.

Runtime: ~10-15 minutes for the full universe (~2125 companies).
"""
from __future__ import annotations
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

from db import bulk_upsert, log_event, supabase  # noqa: E402

WINDOW = 252  # trading days = ~52 weeks
DRY_RUN = "--dry-run" in sys.argv
SYMBOL_FILTER = None
FROM_DATE = None
for arg in sys.argv[1:]:
    if arg.startswith("--symbol="):
        SYMBOL_FILTER = arg.split("=", 1)[1].strip().upper()
    elif arg.startswith("--from="):
        FROM_DATE = arg.split("=", 1)[1]


def _f(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def fetch_companies() -> list[dict]:
    """Paginated companies list — PostgREST default caps at 1000."""
    companies: list[dict] = []
    if SYMBOL_FILTER:
        res = (
            supabase.table("companies")
            .select("id, symbol")
            .eq("symbol", SYMBOL_FILTER)
            .execute()
        )
        return list(res.data or [])
    offset = 0
    page = 1000
    while True:
        res = (
            supabase.table("companies")
            .select("id, symbol")
            .order("symbol")
            .range(offset, offset + page - 1)
            .execute()
        )
        batch = list(res.data or [])
        companies.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return companies


def fetch_company_rows(company_id: str) -> list[dict]:
    """All price_data rows for a company (paginated, ordered by date)."""
    rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        res = (
            supabase.table("price_data")
            .select("id, date, close, high_52w, low_52w")
            .eq("company_id", company_id)
            .order("date")
            .range(offset, offset + page - 1)
            .execute()
        )
        batch = list(res.data or [])
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def compute_for_company(company_id: str, symbol: str) -> dict:
    """Compute trailing 252-day high/low per row; bulk-upsert changes."""
    rows = fetch_company_rows(company_id)
    if not rows:
        return {"symbol": symbol, "scanned": 0, "updated": 0}

    df = pd.DataFrame(rows)
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df.dropna(subset=["close"])
    df = df.sort_values("date").reset_index(drop=True)

    if FROM_DATE:
        # Still need ALL rows to compute the window correctly, but
        # only WRITE updates from --from onwards. So compute first,
        # filter later.
        pass

    # Rolling 252-day high/low on close — min_periods=1 so even
    # the first row gets a value (its own close).
    df["h52_new"] = df["close"].rolling(window=WINDOW, min_periods=1).max()
    df["l52_new"] = df["close"].rolling(window=WINDOW, min_periods=1).min()

    updates: list[dict] = []
    for _, row in df.iterrows():
        if FROM_DATE and row["date"] < FROM_DATE:
            continue
        h_new = float(row["h52_new"])
        l_new = float(row["l52_new"])
        h_old = _f(row.get("high_52w"))
        l_old = _f(row.get("low_52w"))
        # Skip rows that already have the correct values (idempotent).
        if (h_old is not None and abs(h_old - h_new) < 0.001
                and l_old is not None and abs(l_old - l_new) < 0.001):
            continue
        updates.append({
            "id": row["id"],
            "company_id": company_id,
            "date": row["date"],
            "high_52w": round(h_new, 2),
            "low_52w": round(l_new, 2),
        })

    if DRY_RUN or not updates:
        return {
            "symbol": symbol, "scanned": len(df),
            "updated": 0, "would_update": len(updates),
        }

    # bulk_upsert now returns {"success": int, "failed": int, "errors":
    # [...]} — not the bare int it used to. Unwrap so callers that sum
    # `updated` across companies aren't doing `int += dict` (which
    # silently swallowed real progress here in the 2024-onwards backfill
    # run — every company errored at the totaliser even though writes
    # had already landed).
    result = bulk_upsert("price_data", updates, "id")
    written = result["success"] if isinstance(result, dict) else (result or 0)
    return {"symbol": symbol, "scanned": len(df), "updated": written}


def main() -> int:
    print(f"backfill_52w_high_low · window={WINDOW} days")
    if DRY_RUN:
        print("DRY RUN — no DB writes")
    if SYMBOL_FILTER:
        print(f"Filter: only {SYMBOL_FILTER}")
    if FROM_DATE:
        print(f"Only writing rows on/after {FROM_DATE}")

    companies = fetch_companies()
    if not companies:
        print("No companies found.")
        return 1
    print(f"Processing {len(companies)} compan{'y' if len(companies) == 1 else 'ies'}")

    started = time.time()
    totals = {"scanned": 0, "updated": 0, "errors": 0}
    for i, c in enumerate(companies, start=1):
        try:
            stats = compute_for_company(c["id"], c["symbol"])
            totals["scanned"] += stats["scanned"]
            totals["updated"] += stats.get("updated", 0)
            if i % 50 == 0 or i == len(companies):
                elapsed = time.time() - started
                pct = i / len(companies) * 100
                print(
                    f"  [{i}/{len(companies)}] {c['symbol']:<14} "
                    f"scanned={stats['scanned']:<5} "
                    f"updated={stats.get('updated', 0):<5} "
                    f"({elapsed:.0f}s · {pct:.0f}%)"
                )
        except Exception as exc:
            totals["errors"] += 1
            print(f"  ! {c['symbol']}: {exc}")

    elapsed = time.time() - started
    print()
    print("Done.")
    print(f"  rows scanned       : {totals['scanned']:>8}")
    print(f"  rows updated       : {totals['updated']:>8}")
    print(f"  companies errored  : {totals['errors']:>8}")
    print(f"  elapsed            : {elapsed:>8.0f}s")

    log_event("backfill_52w_high_low_finished", {
        "dry_run": DRY_RUN, "symbol_filter": SYMBOL_FILTER,
        "from_date": FROM_DATE, "window": WINDOW,
        "total_companies": len(companies),
        **totals, "elapsed_seconds": int(elapsed),
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
