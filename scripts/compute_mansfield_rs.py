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

from db import log_event, supabase  # noqa: E402

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
    # Pull all rows for this company. price_data may have up to
    # 1260 rows after the 5y backfill — well within one page.
    q = (
        supabase.table("price_data")
        .select("id, date, close, mansfield_rs")
        .eq("company_id", company_id)
        .order("date")
        .execute()
    )
    rows = getattr(q, "data", None) or []
    if not rows:
        return {"symbol": symbol, "scanned": 0, "updated": 0, "skipped_warmup": 0, "no_nifty_match": 0}

    df = pd.DataFrame(rows)
    df["date_norm"] = pd.DatetimeIndex(df["date"]).normalize()
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df.dropna(subset=["close"])
    df = df.sort_values("date_norm").reset_index(drop=True)

    # Align Nifty to the same dates the stock traded.
    nifty_aligned = nifty.reindex(df["date_norm"])
    mask_has_nifty = nifty_aligned.notna()
    no_nifty_count = int((~mask_has_nifty).sum())

    # RP = stock / nifty (where both exist).
    rp = (df["close"].values / nifty_aligned.values).astype(float)
    rp_series = pd.Series(rp, index=df["date_norm"])

    # SMA of RP over WINDOW. Use the FULL series so warm-up uses
    # all prior history — NaN for first (WINDOW - 1) rows.
    rp_smoothed = rp_series.rolling(window=WINDOW, min_periods=WINDOW).mean()

    # Mansfield RS as percent deviation.
    mansfield = (rp_series / rp_smoothed - 1.0) * 100.0
    # Round to 2 decimals for storage; matches rs_vs_nifty style.
    mansfield = mansfield.round(2)

    # Build the update payload — only rows where we have a real
    # Mansfield value (after warm-up + with Nifty data).
    updates = []
    skipped_warmup = 0
    for i, row in df.iterrows():
        val = mansfield.iloc[i]
        if pd.isna(val):
            # Either warm-up insufficient or Nifty missing for that date
            skipped_warmup += 1
            continue
        existing = pd.to_numeric(row.get("mansfield_rs"), errors="coerce")
        if not pd.isna(existing) and abs(existing - float(val)) < 0.01:
            continue  # already correct, skip
        updates.append({
            "id": row["id"],
            "mansfield_rs": float(val),
        })

    if DRY_RUN or not updates:
        return {
            "symbol": symbol, "scanned": len(df), "updated": 0,
            "skipped_warmup": skipped_warmup, "no_nifty_match": no_nifty_count,
            "would_update": len(updates),
        }

    # Bulk-update by id. Supabase update() doesn't natively support
    # bulk-by-pk, so we run one upsert with the (id, mansfield_rs)
    # subset. The `id` PK conflicts → existing row updated.
    BATCH = 500
    written = 0
    for i in range(0, len(updates), BATCH):
        chunk = updates[i:i + BATCH]
        # Need to include all NOT NULL columns OR use update().
        # Use parallel update calls — simpler than re-fetching schema.
        # For ~1.2k rows × 1k stocks = 1.2M updates total, batching
        # is important. Use rpc or just loop.
        for u in chunk:
            try:
                supabase.table("price_data") \
                    .update({"mansfield_rs": u["mansfield_rs"]}) \
                    .eq("id", u["id"]) \
                    .execute()
                written += 1
            except Exception as exc:
                print(f"  ! update id={u['id']} failed: {exc}")
                continue

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

    # 2. List companies
    q = supabase.table("companies").select("id, symbol")
    if SYMBOL_FILTER:
        q = q.eq("symbol", SYMBOL_FILTER)
    res = q.execute()
    companies = getattr(res, "data", None) or []
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
