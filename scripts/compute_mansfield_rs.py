"""Compute textbook Mansfield Relative Strength for every stock × date.

Formula:
  RP_raw[t]      = stock_close[t] / nifty_close[t]
  RP_smoothed[t] = SMA(RP_raw, 252)[t]
  mansfield_rs   = (RP_raw[t] / RP_smoothed[t] - 1) × 100

Reads from cached tables — DOES NOT hit yfinance / NSE. Run after
both data sources are populated:
  1. fetch_bhav_daily.py --backfill --days=1825   (5y price_data)
  2. fetch_nifty_history.py                        (5y nifty_history)

Usage:
  python scripts/compute_mansfield_rs.py
  python scripts/compute_mansfield_rs.py --symbol AMARAJABAT
  python scripts/compute_mansfield_rs.py --dry-run
  python scripts/compute_mansfield_rs.py --symbol SBIN --dry-run

Output: bulk UPDATE on price_data.mansfield_rs. Logs per-symbol
counts of (rows scanned, rows updated, rows still-null because
warm-up insufficient). Total runtime ~5-10 minutes for ~1000 stocks.
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

# 252 trading days ≈ 52 weeks; the textbook Mansfield smoothing
# window. Tighten via CLI if needed (e.g. --window=200).
WINDOW = 252
DRY_RUN = "--dry-run" in sys.argv
SYMBOL_FILTER = None
for arg in sys.argv[1:]:
    if arg.startswith("--symbol="):
        SYMBOL_FILTER = arg.split("=", 1)[1].strip().upper()
    elif arg.startswith("--symbol"):
        # supports --symbol AMARAJABAT (next arg)
        try:
            idx = sys.argv.index(arg)
            SYMBOL_FILTER = sys.argv[idx + 1].strip().upper()
        except (ValueError, IndexError):
            pass
    elif arg.startswith("--window="):
        WINDOW = int(arg.split("=", 1)[1])


def load_nifty_history() -> pd.Series:
    """Pull all nifty_history rows into a date-indexed pd.Series."""
    rows = []
    offset = 0
    page = 1000
    while True:
        q = (
            supabase.table("nifty_history")
            .select("date, close")
            .order("date")
            .range(offset, offset + page - 1)
            .execute()
        )
        data = getattr(q, "data", None) or []
        if not data:
            break
        rows.extend(data)
        if len(data) < page:
            break
        offset += page

    if not rows:
        raise RuntimeError(
            "nifty_history is empty. Run scripts/fetch_nifty_history.py first."
        )

    s = pd.Series(
        [float(r["close"]) for r in rows],
        index=pd.DatetimeIndex([r["date"] for r in rows]).normalize(),
        name="nifty_close",
    )
    s = s.sort_index()
    s = s[~s.index.duplicated(keep="last")]
    return s


def compute_for_symbol(
    company_id: str,
    symbol: str,
    nifty: pd.Series,
) -> dict:
    """Return per-symbol stats dict. Writes to price_data unless DRY_RUN."""
    # FIX 1: Paginate. PostgREST silently caps at 1000 rows per
    # request — a stock with 5y of history (~1260 rows) previously
    # had its 260 most-recent rows DROPPED on the floor here.
    # Also fetch company_id so it can be included in the upsert
    # payload (NOT NULL constraint — see FIX 5 below).
    rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        res = (
            supabase.table("price_data")
            .select("id, date, close, mansfield_rs, company_id")
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

    if not rows:
        return {"symbol": symbol, "scanned": 0, "updated": 0, "skipped_warmup": 0, "no_nifty_match": 0}

    df = pd.DataFrame(rows)
    df["date_norm"] = pd.to_datetime(df["date"]).dt.normalize()
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df.dropna(subset=["close"])
    df = df.sort_values("date_norm").reset_index(drop=True)

    # FIX 3: Robust Nifty alignment.
    # Previous implementation used Series.reindex() with a Series-of-
    # Timestamps argument, which silently produced NaN for ~33% of
    # rows (Series-as-index interpretation pitfall). The cumulative
    # effect: every 252-day rolling window contained at least one
    # NaN → rolling mean was NaN everywhere → ALL Mansfield values
    # were NaN → all rows skipped as "warmup_null".
    #
    # The fix is two-fold:
    #   1. Map dates explicitly using .map() (unambiguous).
    #   2. Forward-fill any remaining Nifty gaps (NSE trading days
    #      where yfinance was missing a value). Reasonable
    #      approximation: Nifty doesn't move much day-to-day, so
    #      using yesterday's close for a 1-2 day gap is fine.
    nifty_map = nifty.to_dict()
    df["nifty_close"] = df["date_norm"].map(nifty_map)
    no_nifty_count = int(df["nifty_close"].isna().sum())
    # Forward-fill then back-fill so the very first rows aren't NaN
    # if Nifty's first date is later than the stock's first date.
    df["nifty_close"] = df["nifty_close"].ffill().bfill()

    if df["nifty_close"].isna().all():
        # No Nifty overlap at all for this stock (very rare —
        # delisted stock or pre-Nifty data only).
        return {"symbol": symbol, "scanned": len(df), "updated": 0,
                "skipped_warmup": len(df), "no_nifty_match": no_nifty_count}

    # RP = stock / nifty, with NaN-tolerant rolling SMA.
    rp = df["close"].astype(float) / df["nifty_close"].astype(float)

    # min_periods is now lower than window so the rolling mean
    # tolerates a few sparse NaNs (which shouldn't exist after
    # ffill but defence-in-depth). After the first WINDOW rows
    # are accumulated, every subsequent row gets a real value.
    rp_smoothed = rp.rolling(window=WINDOW, min_periods=max(200, WINDOW - 30)).mean()

    mansfield = ((rp / rp_smoothed) - 1.0) * 100.0
    mansfield = mansfield.round(2)

    # Build the update payload — only rows where we have a real
    # Mansfield value (after warm-up + with Nifty data).
    updates: list[dict] = []
    skipped_warmup = 0
    for i, row in df.iterrows():
        val = mansfield.iloc[i]
        if pd.isna(val):
            skipped_warmup += 1
            continue
        existing = pd.to_numeric(row.get("mansfield_rs"), errors="coerce")
        if not pd.isna(existing) and abs(existing - float(val)) < 0.01:
            continue  # already correct, skip
        # FIX 5: include id + company_id + date so the INSERT path
        # of upsert (always attempted before ON CONFLICT fires)
        # doesn't fail the NOT NULL checks on date / company_id.
        # ON CONFLICT (id) DO UPDATE then sets mansfield_rs +
        # no-op on the existing date/company_id (same values).
        updates.append({
            "id": row["id"],
            "company_id": company_id,
            "date": row["date"],
            "mansfield_rs": float(val),
        })

    if DRY_RUN or not updates:
        return {
            "symbol": symbol, "scanned": len(df), "updated": 0,
            "skipped_warmup": skipped_warmup, "no_nifty_match": no_nifty_count,
            "would_update": len(updates),
        }

    # FIX 4: Bulk upsert by id PK. The old code did one HTTP request
    # per row update — for ~1.2M rows that's ~hours of network round-
    # trips. bulk_upsert batches the writes server-side; ON CONFLICT
    # (id) DO UPDATE only touches mansfield_rs (the only column in
    # the payload), preserving every other column on the row.
    written = bulk_upsert("price_data", updates, "id")

    return {
        "symbol": symbol, "scanned": len(df), "updated": written,
        "skipped_warmup": skipped_warmup, "no_nifty_match": no_nifty_count,
    }


def main() -> int:
    print(f"Mansfield RS compute · window={WINDOW} days")
    if DRY_RUN:
        print("DRY RUN — no DB writes")
    if SYMBOL_FILTER:
        print(f"Filter: only symbol {SYMBOL_FILTER}")

    # 1. Load Nifty once
    print("Loading nifty_history...")
    nifty = load_nifty_history()
    print(f"  {len(nifty)} Nifty daily rows ({nifty.index.min().date()} -> {nifty.index.max().date()})")

    # 2. List companies — FIX 2: paginate. PostgREST silently caps
    # at 1000 rows per request. The previous version processed
    # only the first 1000 of ~2125 companies, dropping over half
    # of the universe on the floor without any error.
    companies: list[dict] = []
    if SYMBOL_FILTER:
        res = (
            supabase.table("companies")
            .select("id, symbol")
            .eq("symbol", SYMBOL_FILTER)
            .execute()
        )
        companies = list(res.data or [])
    else:
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

    if not companies:
        print("No companies to process.")
        return 1
    print(f"Processing {len(companies)} compan{'y' if len(companies) == 1 else 'ies'}")

    # 3. Per-symbol compute + update
    started = time.time()
    totals = {"scanned": 0, "updated": 0, "skipped_warmup": 0, "no_nifty_match": 0, "errors": 0}
    for i, c in enumerate(companies, start=1):
        try:
            stats = compute_for_symbol(c["id"], c["symbol"], nifty)
            totals["scanned"] += stats["scanned"]
            totals["updated"] += stats.get("updated", 0)
            totals["skipped_warmup"] += stats["skipped_warmup"]
            totals["no_nifty_match"] += stats.get("no_nifty_match", 0)
            if i % 50 == 0 or i == len(companies):
                elapsed = time.time() - started
                print(
                    f"  [{i}/{len(companies)}] {c['symbol']:<14} "
                    f"scanned={stats['scanned']:<4} "
                    f"updated={stats.get('updated', 0):<4} "
                    f"warmup_null={stats['skipped_warmup']:<4} "
                    f"({elapsed:.0f}s elapsed)"
                )
        except Exception as exc:
            totals["errors"] += 1
            print(f"  ! {c['symbol']}: {exc}")

    elapsed = time.time() - started
    print()
    print("Done.")
    print(f"  rows scanned       : {totals['scanned']:>8}")
    print(f"  rows updated       : {totals['updated']:>8}")
    print(f"  rows null (warm-up): {totals['skipped_warmup']:>8}")
    print(f"  rows w/o nifty     : {totals['no_nifty_match']:>8}")
    print(f"  symbols errored    : {totals['errors']:>8}")
    print(f"  elapsed            : {elapsed:>8.0f}s")

    log_event("compute_mansfield_rs_finished", {
        "window": WINDOW,
        "dry_run": DRY_RUN,
        "symbol_filter": SYMBOL_FILTER,
        "total_companies": len(companies),
        **totals,
        "elapsed_seconds": int(elapsed),
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
