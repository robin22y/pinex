"""
build_pattern_snapshots.py

Populates the pattern_snapshots table: one row per (company, trading
day) capturing the conditions on that day AND what actually happened
over the next 7 / 30 / 60 / 90 trading days.

────────────────────────────────────────────────────────────────────
WHY THE sleep(0.1) MATTERS — read before editing
────────────────────────────────────────────────────────────────────
On 14 May 2026 a backfill of swing_conditions saturated the Supabase
disk-IO budget (the Free tier shares storage with the writer) and
the production read path went to ~6-second tail latency for ~40
minutes. The cause was an unthrottled per-row upsert loop. After
that incident every long-running backfill in this repo throttles
itself with `time.sleep(0.1)` between writes.

If you think you don't need the sleep, you are wrong twice:
  1. The price_data row count is ~3 M+. Without the sleep this
     finishes in a few hours and crushes IO the whole time.
  2. The bottleneck isn't this script's wall time. It's everyone
     else's tail latency. Nothing pages, no alarms fire, you just
     ship a bad afternoon for every user.

The --sleep flag accepts a value but the default stays 0.1. A value
below 0.05 requires --i-understand-the-may-2026-incident as a
hand-typed sanity gate.

────────────────────────────────────────────────────────────────────
USAGE
────────────────────────────────────────────────────────────────────

  Backfill once (run on a quiet day, can take many hours):
      python scripts/backtest/build_pattern_snapshots.py --backfill

  Backfill from a specific date forward:
      python scripts/backtest/build_pattern_snapshots.py \\
          --backfill --start 2019-01-01

  Nightly — write today's freshly-eligible snapshot date
  (= today − 90 trading days):
      python scripts/backtest/build_pattern_snapshots.py --nightly

  Single symbol (debug):
      python scripts/backtest/build_pattern_snapshots.py \\
          --backfill --symbol NAVINFLUOR

────────────────────────────────────────────────────────────────────
WHAT GETS WRITTEN
────────────────────────────────────────────────────────────────────
For each price_data row at date D where today >= D + 90 trading days:

  snapshot conditions ─ from price_data row at D (and market_internals[D])
    stage, substage, rs_vs_nifty, vol_ratio
    above_ma30w_pct (market_internals.above_ma30w_pct on D)
    india_vix   (market_internals.india_vix   on D)

  forward returns ─ % change from close[D] to close[D+N trading days]
    forward_7d, forward_30d, forward_60d, forward_90d

  30-trading-day window event flags
    hit_52w_high_30d      any row D+1..D+30 with close >= max(high_52w)
    hit_52w_low_30d       any row D+1..D+30 with close <= min(low_52w)
    stage_upgraded_30d    any row D+1..D+30 with stage strictly > stage[D]
                          (Stage 1 < Stage 2 < Stage 3 < Stage 4)
    dropped_below_ma_30d  any row D+1..D+30 with close < ma30w

Rows with incomplete forward data (younger than ~90 trading days from
the latest price_data date) are SKIPPED entirely — the table holds
only complete snapshots so the query path never has to filter null
forward fields.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

# Make scripts/ importable so we can reuse the shared db client.
_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR.parent))

from loguru import logger  # noqa: E402

from db import supabase, fetch_companies_paginated  # noqa: E402


# ─────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────

# Lookforward windows in TRADING days, not calendar days.
LOOKFORWARD_DAYS = [7, 30, 60, 90]
EVENT_WINDOW = 30  # 30 trading days for hit_52w_high / drop / upgrade

# Page size for price_data fetch per symbol. price_data has at most
# ~2000 trading days per symbol since inception, so 1000 is plenty.
PAGE_SIZE = 1000

# Stage ordinal for the "stage_upgraded" check. Stage text values in
# price_data look like "Stage 1" / "Stage 2" / "Stage 3" / "Stage 4".
# Anything else maps to 0 (treated as not-comparable).
STAGE_ORDER = {
    "stage1": 1, "stage 1": 1, "1": 1,
    "stage2": 2, "stage 2": 2, "2": 2,
    "stage3": 3, "stage 3": 3, "3": 3,
    "stage4": 4, "stage 4": 4, "4": 4,
}


def stage_ord(s: Any) -> int:
    if not s:
        return 0
    return STAGE_ORDER.get(str(s).strip().lower(), 0)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def fetch_market_internals_by_date() -> dict[str, dict[str, Any]]:
    """All market_internals rows, indexed by date string.

    Small table (~1 row per trading day, < 2000 rows total). Loaded
    once and held in memory — saves one DB call per snapshot.
    """
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        res = (
            supabase.table("market_internals")
            .select("date, above_ma30w_pct, india_vix")
            .order("date", desc=False)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    indexed: dict[str, dict[str, Any]] = {}
    for r in rows:
        d = r.get("date")
        if d:
            indexed[str(d)] = r
    logger.info(f"Loaded {len(indexed)} market_internals dates")
    return indexed


def fetch_price_data_for_symbol(company_id: str) -> list[dict[str, Any]]:
    """All price_data rows for one company, oldest first."""
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        res = (
            supabase.table("price_data")
            .select(
                "date, stage, weinstein_substage, rs_vs_nifty, "
                "vol_ratio, close, ma30w, high_52w, low_52w"
            )
            .eq("company_id", company_id)
            .order("date", desc=False)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


def build_snapshot_for_row(
    i: int,
    rows: list[dict[str, Any]],
    market_by_date: dict[str, dict[str, Any]],
    company_id: str,
) -> dict[str, Any] | None:
    """Compose one pattern_snapshots row from rows[i] and the
    forward window rows[i+1..i+90]. Returns None if any required
    field is missing (snapshot is skipped, not written as null)."""

    snap = rows[i]
    snap_date = snap.get("date")
    snap_close = snap.get("close")
    if not snap_date or snap_close in (None, 0):
        return None

    # Need the full 90-trading-day forward window. If we don't have
    # 90 rows after i, this snapshot isn't eligible yet.
    last_idx = i + max(LOOKFORWARD_DAYS)
    if last_idx >= len(rows):
        return None

    snap_close_f = float(snap_close)

    # ── Forward returns ────────────────────────────────────────
    forwards: dict[str, float | None] = {}
    for n in LOOKFORWARD_DAYS:
        fwd = rows[i + n].get("close")
        if fwd in (None, 0):
            forwards[f"forward_{n}d"] = None
        else:
            forwards[f"forward_{n}d"] = round(
                ((float(fwd) - snap_close_f) / snap_close_f) * 100.0, 4
            )

    # ── 30-day event flags ─────────────────────────────────────
    window = rows[i + 1 : i + 1 + EVENT_WINDOW]
    snap_stage_ord = stage_ord(snap.get("stage"))
    snap_high_52w = snap.get("high_52w")
    snap_low_52w = snap.get("low_52w")

    hit_hi = False
    hit_lo = False
    upgraded = False
    dropped = False
    for r in window:
        c = r.get("close")
        if c in (None, 0):
            continue
        c_f = float(c)
        # 52w hit — "hit a NEW 52w high during the window" means the
        # window close >= the 52w high recorded AT the snapshot date.
        if snap_high_52w not in (None, 0) and c_f >= float(snap_high_52w):
            hit_hi = True
        if snap_low_52w not in (None, 0) and c_f <= float(snap_low_52w):
            hit_lo = True
        if snap_stage_ord and stage_ord(r.get("stage")) > snap_stage_ord:
            upgraded = True
        ma = r.get("ma30w")
        if ma not in (None, 0) and c_f < float(ma):
            dropped = True

    mi = market_by_date.get(str(snap_date), {})
    return {
        "company_id":            company_id,
        "date":                  str(snap_date),
        "stage":                 snap.get("stage"),
        "substage":              snap.get("weinstein_substage"),
        "rs_vs_nifty":           snap.get("rs_vs_nifty"),
        "vol_ratio":             snap.get("vol_ratio"),
        "above_ma30w_pct":           mi.get("above_ma30w_pct"),
        "india_vix":             mi.get("india_vix"),
        "forward_7d":            forwards["forward_7d"],
        "forward_30d":           forwards["forward_30d"],
        "forward_60d":           forwards["forward_60d"],
        "forward_90d":           forwards["forward_90d"],
        "hit_52w_high_30d":      hit_hi,
        "hit_52w_low_30d":       hit_lo,
        "stage_upgraded_30d":    upgraded,
        "dropped_below_ma_30d":  dropped,
    }


def write_snapshot(row: dict[str, Any]) -> bool:
    """Upsert one row. Returns True on success."""
    try:
        supabase.table("pattern_snapshots").upsert(
            row, on_conflict="company_id,date"
        ).execute()
        return True
    except Exception as exc:
        logger.error(
            f"upsert pattern_snapshots company={row.get('company_id')} "
            f"date={row.get('date')} error={exc}"
        )
        return False


# ─────────────────────────────────────────────────────────────────
# Modes
# ─────────────────────────────────────────────────────────────────

def existing_dates_for_company(company_id: str) -> set[str]:
    """Dates already snapshotted for this company. Lets nightly
    skip what's already written without re-computing the forward
    window."""
    out: set[str] = set()
    start = 0
    while True:
        res = (
            supabase.table("pattern_snapshots")
            .select("date")
            .eq("company_id", company_id)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = res.data or []
        out.update(str(r["date"]) for r in batch if r.get("date"))
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return out


def run(
    *,
    mode: str,
    sleep_seconds: float,
    start_date: str | None,
    symbol_filter: str | None,
    resume: bool,
) -> None:
    market_by_date = fetch_market_internals_by_date()

    companies = fetch_companies_paginated("id, symbol")
    if symbol_filter:
        sym_u = symbol_filter.upper()
        companies = [c for c in companies if str(c.get("symbol", "")).upper() == sym_u]
        if not companies:
            logger.error(f"--symbol {symbol_filter} not found in companies")
            return
    logger.info(f"Processing {len(companies)} companies, mode={mode}, sleep={sleep_seconds}s")

    total_written = 0
    total_skipped = 0
    started_at = time.time()

    for c_idx, comp in enumerate(companies, start=1):
        cid = comp.get("id")
        symbol = comp.get("symbol")
        if not cid:
            continue

        rows = fetch_price_data_for_symbol(cid)
        if len(rows) < max(LOOKFORWARD_DAYS) + 1:
            logger.info(f"  [{c_idx}/{len(companies)}] {symbol}: thin history ({len(rows)} rows) — skipped")
            continue

        # Date filter
        if start_date:
            rows_in_range = [r for r in rows if str(r.get("date")) >= start_date]
            # For each kept row we still need its forward window which
            # may extend beyond rows_in_range — pass the full `rows`
            # list to build_snapshot_for_row but iterate indices that
            # correspond to in-range dates.
            kept_dates = {str(r.get("date")) for r in rows_in_range}
            indices = [i for i, r in enumerate(rows) if str(r.get("date")) in kept_dates]
        else:
            indices = list(range(len(rows)))

        # Nightly mode: only write the most recent date that has full
        # forward data, i.e. the oldest date that doesn't yet have a
        # snapshot. In practice this is just one or a few rows.
        if mode == "nightly":
            existing = existing_dates_for_company(cid)
            indices = [
                i for i in indices
                if str(rows[i].get("date")) not in existing
            ]
        elif resume:
            existing = existing_dates_for_company(cid)
            indices = [
                i for i in indices
                if str(rows[i].get("date")) not in existing
            ]

        written = 0
        skipped = 0
        for i in indices:
            snap = build_snapshot_for_row(i, rows, market_by_date, cid)
            if snap is None:
                skipped += 1
                continue
            if write_snapshot(snap):
                written += 1
                total_written += 1
            else:
                skipped += 1
                total_skipped += 1
            # ── THROTTLE — read the file header. Do not remove. ──
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

        elapsed = time.time() - started_at
        rate = total_written / elapsed if elapsed > 0 else 0
        logger.info(
            f"  [{c_idx}/{len(companies)}] {symbol}: wrote {written}, skipped {skipped} "
            f"(running totals: {total_written}/{total_skipped}, "
            f"~{rate:.1f} writes/s)"
        )

    logger.info(
        f"DONE — wrote {total_written}, skipped {total_skipped} in "
        f"{(time.time() - started_at):.1f}s"
    )


# ─────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--backfill", action="store_true",
                      help="Walk every eligible (symbol, date) and write snapshots.")
    mode.add_argument("--nightly", action="store_true",
                      help="Write today's freshly-eligible snapshot dates only.")
    p.add_argument("--start", dest="start_date", default=None,
                   help="Earliest snapshot date to write (YYYY-MM-DD). Default: no lower bound.")
    p.add_argument("--symbol", default=None,
                   help="Debug only: process a single symbol.")
    p.add_argument("--sleep", type=float, default=0.1,
                   help="Seconds between row writes. Default 0.1. DO NOT lower without reading the file header.")
    p.add_argument("--resume", action="store_true",
                   help="Skip (symbol, date) pairs already written. Use after an interrupted backfill.")
    p.add_argument("--i-understand-the-may-2026-incident", dest="ack_incident",
                   action="store_true",
                   help="Required when --sleep < 0.05. Acknowledges the disk-IO incident.")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # Safety gate on the sleep override.
    if args.sleep < 0.05 and not args.ack_incident:
        sys.stderr.write(
            "ERROR: --sleep below 0.05 requires --i-understand-the-may-2026-incident.\n"
            "Read the file header before bypassing the throttle.\n"
        )
        sys.exit(2)
    if args.sleep < 0 :
        sys.stderr.write("ERROR: --sleep cannot be negative.\n")
        sys.exit(2)

    if args.start_date:
        try:
            datetime.strptime(args.start_date, "%Y-%m-%d")
        except ValueError:
            sys.stderr.write("ERROR: --start must be YYYY-MM-DD.\n")
            sys.exit(2)

    mode = "backfill" if args.backfill else "nightly"
    logger.info(
        f"build_pattern_snapshots — mode={mode} sleep={args.sleep}s "
        f"start={args.start_date or '(none)'} symbol={args.symbol or '(all)'}"
    )

    run(
        mode=mode,
        sleep_seconds=args.sleep,
        start_date=args.start_date,
        symbol_filter=args.symbol,
        resume=args.resume,
    )


if __name__ == "__main__":
    main()
