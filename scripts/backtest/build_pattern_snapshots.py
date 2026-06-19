"""
build_pattern_snapshots.py

Populates the pattern_snapshots table: one row per (company, trading
day) capturing the conditions on that day AND what actually happened
over the next 7 / 30 / 60 / 90 trading days.

────────────────────────────────────────────────────────────────────
WHY THE sleep BETWEEN BATCHES MATTERS — read before editing
────────────────────────────────────────────────────────────────────
On 14 May 2026 a backfill of swing_conditions saturated the Supabase
disk-IO budget (the Free tier shares storage with the writer) and
the production read path went to ~6-second tail latency for ~40
minutes. The cause was an unthrottled upsert loop with no pause for
the WAL to drain. After that incident every long-running backfill
in this repo throttles itself with a mandatory pause between IO
bursts.

This script now uses BATCHED upserts (500 rows per call) with a
`time.sleep(0.5)` pause between batches. That gives the WAL roughly
half a second of idle to flush before the next 500-row burst, which
empirically keeps the disk-IO headroom above the danger line even
on the Free tier. It's also ~50x faster than the old per-row throttle
because most of the wall time used to be sleeps, not writes.

The --sleep flag accepts a value but the default stays 0.5. A value
below 0.5 requires --i-understand-the-may-2026-incident as a
hand-typed sanity gate.

If you think you don't need the sleep, you are wrong twice:
  1. The price_data row count is ~3 M+. Without ANY pause this
     saturates IO the whole time the script runs.
  2. The bottleneck isn't this script's wall time. It's everyone
     else's tail latency. Nothing pages, no alarms fire, you just
     ship a bad afternoon for every user.

PARALLEL FETCH — price_data fetches are I/O-bound and most of the
per-company wall time is the supabase round-trip. We use a small
ThreadPoolExecutor(max_workers=3) to PREFETCH the next companies'
price_data while the main thread processes / writes the current
one. Writes stay serial through one BatchWriter — only READS are
parallel. That keeps the disk-write profile identical to the
single-threaded version.

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
from concurrent.futures import Future, ThreadPoolExecutor
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

# pattern_snapshots upsert batch size. 500 rows is a sweet spot:
# small enough that one bad row's failure is a tolerable salvage,
# large enough that the 0.5 s post-batch sleep amortises down to
# ~0.001 s per row (vs the old 0.1 s per-row throttle).
SNAPSHOT_BATCH_SIZE = 500

# How many companies' price_data to prefetch in parallel ahead of
# the writer. 3 workers is the cap the user gave — it's a balance
# between cutting fetch latency off the critical path and not
# stampeding the supabase HTTP pool. Writes stay serial through
# the single BatchWriter, so disk-write IO is identical to the
# single-threaded version.
PREFETCH_DEPTH = 3

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
    """All price_data rows for one company, oldest first.

    volume + avg_volume_30d are pulled so the vol_ratio backfill
    pass can compute the missing 30-day rolling average. Both
    columns are needed even when vol_ratio is already populated —
    the backfill skips rows where it's set.

    TIMEOUT GUARD — fetched in 1-year date-range chunks rather
    than one open-ended ORDER BY across all history. On large
    companies (10+ years × daily) the unbounded query was hitting
    Supabase's statement_timeout; per-year ranges keep the planner
    on a fast date-index path and recover gracefully even if any
    one year errors out.
    """
    rows: list[dict[str, Any]] = []
    # Conservative start year — price_data history in this DB goes
    # back to ~2019; using 2015 is cheap insurance for any company
    # whose listing predates that.
    earliest_year = 2015
    current_year = datetime.utcnow().year
    for year in range(earliest_year, current_year + 1):
        year_start = f"{year}-01-01"
        year_end   = f"{year + 1}-01-01"
        chunk_start = 0
        while True:
            try:
                res = (
                    supabase.table("price_data")
                    .select(
                        "date, stage, weinstein_substage, rs_vs_nifty, "
                        "vol_ratio, volume, avg_volume_30d, "
                        "close, ma30w, high_52w, low_52w"
                    )
                    .eq("company_id", company_id)
                    .gte("date", year_start)
                    .lt("date",  year_end)
                    .order("date", desc=False)
                    .range(chunk_start, chunk_start + PAGE_SIZE - 1)
                    .execute()
                )
            except Exception as exc:
                # Per-year isolation — log + skip this year, keep
                # marching. The snapshot loop tolerates gaps in
                # the forward window.
                logger.warning(
                    f"price_data fetch failed for company={company_id} "
                    f"year={year}: {exc!r}"
                )
                break
            batch = res.data or []
            rows.extend(batch)
            if len(batch) < PAGE_SIZE:
                break
            chunk_start += PAGE_SIZE
    return rows


# ─────────────────────────────────────────────────────────────────
# vol_ratio backfill — fill in the gap left by the bhav pipeline.
# ─────────────────────────────────────────────────────────────────

# Rolling window length, in trading days, used for both the
# avg_volume_30d compute and the resulting vol_ratio. Matches the
# column name + the StockDetail page's "Volume above average"
# definition.
VOL_WINDOW = 30

# Minimum non-null prior days required before we'll emit a rolling
# average. Half-window: avoids emitting noisy ratios when a company
# just listed and only has a handful of prior bars.
VOL_MIN_SAMPLES = 15


def backfill_vol_ratio_for_company(
    company_id: str,
    rows: list[dict[str, Any]],
    sleep_seconds: float,
) -> tuple[int, int]:
    """Compute the rolling 30-trading-day volume average and the
    derived vol_ratio for any row that's missing either, then
    persist back to price_data AND mutate the in-memory rows so
    the downstream snapshot pass sees the new values.

    Returns (avg_updated, ratio_updated). Both counts are number
    of rows where the persist UPDATE was attempted (and accepted).

    The bhav pipeline started populating these columns recently
    and never backfilled history — every stock in the live DB
    only has the last ~8 trading days set. This function closes
    that gap before the snapshot writer runs.

    rows MUST be sorted oldest-first (caller responsibility —
    fetch_price_data_for_symbol returns them that way).
    """
    avg_updated = 0
    ratio_updated = 0

    # Pre-extract volume as floats so the rolling sum is O(N) instead
    # of O(N * window). None slots stay None — they're excluded from
    # the window sum.
    volumes: list[float | None] = []
    for r in rows:
        v = r.get("volume")
        if v is None:
            volumes.append(None)
            continue
        try:
            volumes.append(float(v))
        except (TypeError, ValueError):
            volumes.append(None)

    for i, r in enumerate(rows):
        if i < VOL_WINDOW:
            # Not enough prior days for a real rolling average.
            continue

        current_v = volumes[i]
        if current_v is None:
            continue

        # Build the window from the 30 prior trading days.
        window = [v for v in volumes[i - VOL_WINDOW : i] if v is not None]
        if len(window) < VOL_MIN_SAMPLES:
            continue
        rolling_avg = sum(window) / len(window)
        if rolling_avg <= 0:
            continue

        update_payload: dict[str, Any] = {}

        # Existing values win — never overwrite a populated cell.
        new_avg = r.get("avg_volume_30d")
        if new_avg is None:
            new_avg = round(rolling_avg, 2)
            update_payload["avg_volume_30d"] = new_avg

        new_vr = r.get("vol_ratio")
        if new_vr is None and new_avg:
            try:
                new_vr = round(current_v / float(new_avg), 4)
                update_payload["vol_ratio"] = new_vr
            except (TypeError, ValueError, ZeroDivisionError):
                new_vr = None

        # Always mutate in-memory rows so the snapshot writer sees
        # the freshly-computed values even when the DB persist below
        # fails (the snapshot can still be written from in-memory).
        if new_avg is not None:
            r["avg_volume_30d"] = new_avg
        if new_vr is not None:
            r["vol_ratio"] = new_vr

        if not update_payload:
            continue

        try:
            supabase.table("price_data").update(update_payload).eq(
                "company_id", company_id
            ).eq("date", r.get("date")).execute()
            if "avg_volume_30d" in update_payload:
                avg_updated += 1
            if "vol_ratio" in update_payload:
                ratio_updated += 1
        except Exception as exc:
            logger.error(
                f"vol_ratio backfill UPDATE failed "
                f"company={company_id} date={r.get('date')} "
                f"payload={update_payload} error={exc}"
            )

        # Same throttle as the snapshot write loop. The May 2026
        # disk-IO incident applies here too.
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)

    return avg_updated, ratio_updated


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

    # ── Match-dimension gate (REQUIRED fields) ─────────────────
    # The matcher filters on three required dimensions:
    #   stage         (exact match)
    #   rs_vs_nifty   (± 10 range)
    #   vol_ratio     (± 0.5 range)
    # A snapshot missing any of these three is unmatchable, so we
    # skip the row entirely rather than write a null and let it
    # poison the aggregate.
    #
    # weinstein_substage USED to be required here, but the upstream
    # swing pipeline never backfilled it across history so only
    # ~20 rows per stock carry the value. We now treat it as
    # OPTIONAL — written to the snapshot when present, and the
    # matcher only adds the substage equality filter when the
    # caller passes one. above_ma30w_pct + india_vix are also
    # written as-found; both are optional inputs to the similarity
    # score, not gating fields.
    if (
        not snap.get("stage")
        or snap.get("rs_vs_nifty") is None
        or snap.get("vol_ratio") is None
    ):
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


# Connection-drop classes we want to retry on. Detected by class
# name string so the script doesn't have to import httpx at module
# load time (the supabase client wraps several transports and the
# concrete class can shift across versions). RemoteProtocolError
# is the one observed in the field after ~20k upserts.
_RETRYABLE_EXC_NAMES = {
    "RemoteProtocolError",
    "RemoteDisconnected",
    "ConnectionError",
    "ConnectError",
    "ReadError",
    "WriteError",
    "ReadTimeout",
    "WriteTimeout",
}


def _is_retryable(exc: BaseException) -> bool:
    """True if the exception is a connection-drop we should retry."""
    name = type(exc).__name__
    if name in _RETRYABLE_EXC_NAMES:
        return True
    # Some clients re-wrap the inner cause one or two levels deep.
    cause = exc.__cause__ or exc.__context__
    if cause is not None and type(cause).__name__ in _RETRYABLE_EXC_NAMES:
        return True
    return False


class BatchWriter:
    """Buffer-and-flush writer for pattern_snapshots upserts.

    Replaces the legacy per-row write+sleep loop. The previous
    behaviour was `upsert(1 row); sleep(0.1)` for every row — at
    ~2 k rows per company × ~2 k companies that's ~110 hours of
    PURE SLEEP. Now we buffer up to SNAPSHOT_BATCH_SIZE rows,
    issue ONE upsert with all of them, and sleep ONCE between
    batches. The 0.5 s pause keeps the disk-IO profile within
    the same safety envelope as the old throttle (see the
    file header for the May 2026 incident write-up).

    Writes stay serial — `add()` is NOT thread-safe. The
    prefetcher only parallelises READS.

    Failure mode: if the bulk upsert fails (network / type /
    constraint), we fall back to per-row upserts via the
    existing `write_snapshot` helper so one bad row doesn't lose
    the other 499 good ones in the batch.
    """

    def __init__(self, sleep_between_batches: float) -> None:
        self.buffer: list[dict[str, Any]] = []
        self.sleep_between_batches = max(0.0, sleep_between_batches)
        self.written = 0
        self.failed  = 0
        self.batches = 0

    def add(self, row: dict[str, Any]) -> None:
        self.buffer.append(row)
        if len(self.buffer) >= SNAPSHOT_BATCH_SIZE:
            self.flush()

    def flush(self) -> None:
        if not self.buffer:
            return
        rows, self.buffer = self.buffer, []
        ok = self._upsert_batch(rows)
        if ok:
            self.written += len(rows)
        else:
            # Bulk failed — salvage row-by-row. write_snapshot()
            # logs its own per-row failure detail.
            salvaged = 0
            for row in rows:
                if write_snapshot(row):
                    salvaged += 1
            self.written += salvaged
            self.failed  += len(rows) - salvaged
            if salvaged:
                logger.warning(
                    f"  batch salvage recovered {salvaged}/{len(rows)} rows"
                )
        self.batches += 1
        if self.sleep_between_batches > 0:
            time.sleep(self.sleep_between_batches)

    def _upsert_batch(self, rows: list[dict[str, Any]]) -> bool:
        """Bulk upsert with the same connection-drop retry shape
        write_snapshot() uses. Return True on success."""
        max_retries = 3
        last_exc: BaseException | None = None
        for attempt in range(max_retries):
            try:
                supabase.table("pattern_snapshots").upsert(
                    rows, on_conflict="company_id,date"
                ).execute()
                if attempt > 0:
                    logger.info(
                        f"  batch upsert recovered on retry {attempt + 1}/"
                        f"{max_retries} (size={len(rows)})"
                    )
                return True
            except Exception as exc:
                last_exc = exc
                if _is_retryable(exc) and attempt < max_retries - 1:
                    wait = 2 ** attempt
                    logger.warning(
                        f"  batch upsert connection drop "
                        f"({type(exc).__name__}, size={len(rows)}) — "
                        f"retry {attempt + 1}/{max_retries - 1} in {wait}s"
                    )
                    time.sleep(wait)
                    continue
                break
        logger.error(
            f"batch upsert pattern_snapshots FAILED "
            f"(size={len(rows)}): {type(last_exc).__name__} {last_exc!r}"
        )
        return False


def write_snapshot(row: dict[str, Any]) -> bool:
    """Upsert one row. Returns True on success.

    Retries up to 3 times on connection-drop errors
    (RemoteProtocolError and friends) with exponential back-off
    1s → 2s → 4s. On the final failure, or on any non-retryable
    error (schema, type, validation), logs the full exception +
    full row payload and returns False — same shape the run loop
    has always consumed.
    """
    import json

    max_retries = 3
    last_exc: BaseException | None = None
    for attempt in range(max_retries):
        try:
            supabase.table("pattern_snapshots").upsert(
                row, on_conflict="company_id,date"
            ).execute()
            if attempt > 0:
                logger.info(
                    f"  upsert recovered on retry {attempt + 1}/{max_retries} "
                    f"company={row.get('company_id')} date={row.get('date')}"
                )
            return True
        except Exception as exc:
            last_exc = exc
            if _is_retryable(exc) and attempt < max_retries - 1:
                # 1s on first retry (attempt=0), 2s, 4s.
                wait = 2 ** attempt
                logger.warning(
                    f"  upsert connection drop ({type(exc).__name__}) — "
                    f"retry {attempt + 1}/{max_retries - 1} in {wait}s "
                    f"company={row.get('company_id')} date={row.get('date')}"
                )
                time.sleep(wait)
                continue
            break

    # Either non-retryable or exhausted retries.
    exc = last_exc
    logger.error(
        "upsert pattern_snapshots FAILED "
        f"company={row.get('company_id')} date={row.get('date')}"
    )
    logger.error(f"  exception type   : {type(exc).__name__}")
    logger.error(f"  exception repr   : {exc!r}")
    logger.error(f"  exception str    : {exc}")
    try:
        payload_str = json.dumps(row, indent=2, default=str, sort_keys=True)
    except Exception:
        payload_str = repr(row)
    logger.error(f"  failed row payload:\n{payload_str}")
    return False


def fetch_completed_companies() -> set[str]:
    """Distinct company_id set of every company already in
    pattern_snapshots. Used by the --resume flag to skip
    work an earlier crashed run already did.

    Paged through with a plain SELECT — DISTINCT in PostgREST
    needs an RPC, and the de-dup is cheap in Python.
    """
    out: set[str] = set()
    start = 0
    while True:
        try:
            res = (
                supabase.table("pattern_snapshots")
                .select("company_id")
                .range(start, start + PAGE_SIZE - 1)
                .execute()
            )
        except Exception as exc:
            logger.warning(f"fetch_completed_companies page failed: {exc!r}")
            break
        batch = res.data or []
        out.update(str(r["company_id"]) for r in batch if r.get("company_id"))
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return out


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
    skip_vol_backfill: bool = False,
) -> None:
    market_by_date = fetch_market_internals_by_date()

    companies = fetch_companies_paginated("id, symbol")
    if symbol_filter:
        sym_u = symbol_filter.upper()
        companies = [c for c in companies if str(c.get("symbol", "")).upper() == sym_u]
        if not companies:
            logger.error(f"--symbol {symbol_filter} not found in companies")
            return

    # ── --resume: skip companies already in pattern_snapshots ──
    # Whole-company skip — much cheaper than the previous per-date
    # check (no price_data fetch, no vol_ratio walk for completed
    # companies). Use this after a crash to pick up where the
    # earlier run left off.
    completed_companies: set[str] = set()
    if resume:
        completed_companies = fetch_completed_companies()
        logger.info(
            f"--resume: {len(completed_companies)} companies already in "
            f"pattern_snapshots will be skipped"
        )

    logger.info(
        f"Processing {len(companies)} companies, mode={mode}, "
        f"sleep_between_batches={sleep_seconds}s, batch_size={SNAPSHOT_BATCH_SIZE}, "
        f"prefetch_depth={PREFETCH_DEPTH}"
    )

    total_skipped = 0   # rows the gate rejected (build_snapshot_for_row -> None)
    total_vol_avg_filled   = 0  # price_data.avg_volume_30d rows backfilled
    total_vol_ratio_filled = 0  # price_data.vol_ratio rows backfilled
    started_at = time.time()

    # ── Batched writer — see BatchWriter docstring. ─────────────
    writer = BatchWriter(sleep_between_batches=sleep_seconds)

    # ── Prefetch pool — see PREFETCH_DEPTH comment. ─────────────
    # Submits fetch_price_data_for_symbol for the NEXT few companies
    # while the main thread is busy with the current one. Block-on-
    # result() right before we need the rows; queue the next prefetch
    # right after. Net effect: the main thread almost never waits on
    # a price_data fetch — the cost is hidden behind compute + writes.
    fetch_pool = ThreadPoolExecutor(
        max_workers=PREFETCH_DEPTH,
        thread_name_prefix="pd_prefetch",
    )
    fetch_futures: dict[int, Future] = {}  # company-index -> future

    def submit_prefetch(idx: int) -> None:
        if idx >= len(companies) or idx in fetch_futures:
            return
        cid_to_fetch = companies[idx].get("id")
        if not cid_to_fetch:
            return
        # Skip prefetching companies we'll skip in the main loop;
        # otherwise we waste a HTTP round-trip per resume-skipped
        # company.
        if (
            resume
            and mode == "backfill"
            and str(cid_to_fetch) in completed_companies
        ):
            return
        fetch_futures[idx] = fetch_pool.submit(
            fetch_price_data_for_symbol, cid_to_fetch
        )

    # Seed the prefetch window.
    for i in range(min(PREFETCH_DEPTH, len(companies))):
        submit_prefetch(i)

    for c_idx_zero, comp in enumerate(companies):
        c_idx = c_idx_zero + 1  # 1-based for log lines
        cid = comp.get("id")
        symbol = comp.get("symbol")
        if not cid:
            continue

        # Whole-company resume — applies to backfill mode only;
        # nightly still wants to write today-90 even on
        # already-snapshotted companies.
        if resume and mode == "backfill" and str(cid) in completed_companies:
            logger.info(
                f"  [{c_idx}/{len(companies)}] {symbol}: already snapshotted, skipping"
            )
            # Keep the prefetch window full — the skip didn't consume
            # a slot we'd queued, but we should slide it forward.
            submit_prefetch(c_idx_zero + PREFETCH_DEPTH)
            continue

        # Pull this company's rows from the prefetch (block if the
        # background fetch isn't done yet); if for any reason we
        # didn't queue one, fall back to a synchronous fetch.
        prefetched = fetch_futures.pop(c_idx_zero, None)
        rows = prefetched.result() if prefetched is not None else fetch_price_data_for_symbol(cid)

        # Keep the prefetch pipeline full as we consume.
        submit_prefetch(c_idx_zero + PREFETCH_DEPTH)
        if len(rows) < max(LOOKFORWARD_DAYS) + 1:
            logger.info(f"  [{c_idx}/{len(companies)}] {symbol}: thin history ({len(rows)} rows) — skipped")
            continue

        # ── vol_ratio backfill (per company) ────────────────────
        # Has to run BEFORE the snapshot loop because the gate
        # rejects rows missing vol_ratio, and at the moment the
        # bhav pipeline only writes that column for the last ~8
        # trading days. Mutates `rows` in place so build_snapshot
        # sees the freshly-computed values.
        if not skip_vol_backfill:
            avg_n, vr_n = backfill_vol_ratio_for_company(
                cid, rows, sleep_seconds
            )
            total_vol_avg_filled   += avg_n
            total_vol_ratio_filled += vr_n
            if avg_n or vr_n:
                logger.info(
                    f"  [{c_idx}/{len(companies)}] {symbol}: "
                    f"backfilled avg_volume_30d={avg_n}, vol_ratio={vr_n} "
                    f"on price_data"
                )

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

        # Track per-company gate stats. The write-side stats come
        # from the writer (which counts at batch-flush time across
        # all companies).
        company_added = 0
        skipped = 0
        written_before = writer.written
        failed_before  = writer.failed
        for i in indices:
            snap = build_snapshot_for_row(i, rows, market_by_date, cid)
            if snap is None:
                # Gate rejected: stage / substage / rs_vs_nifty /
                # vol_ratio missing, snapshot too close to today to
                # have a full forward window, or close price unusable.
                skipped += 1
                total_skipped += 1
                continue
            # Queue this row. The BatchWriter flushes a batch + sleeps
            # 0.5 s every SNAPSHOT_BATCH_SIZE rows; per-row sleeps are
            # gone (see file header).
            writer.add(snap)
            company_added += 1

        # ── ETA telemetry ──────────────────────────────────────
        # Average wall-clock per company over the run so far,
        # extrapolated against the remaining-companies count. The
        # backfill is long-running enough that operators want a
        # rough finish time without computing it by hand.
        elapsed = time.time() - started_at
        rate = writer.written / elapsed if elapsed > 0 else 0
        companies_done = c_idx
        companies_remaining = len(companies) - companies_done
        avg_company_seconds = elapsed / companies_done if companies_done else 0
        eta_seconds = avg_company_seconds * companies_remaining
        # Per-company write/fail delta — diff against the running
        # writer counters captured at the top of this company's
        # iteration. Batch flushes may have crossed company
        # boundaries so this delta is approximate (a flush from
        # buffered rows of the previous company can land on this
        # company's tick) — it's a useful pulse, not a strict
        # per-company audit.
        written_delta = writer.written - written_before
        failed_delta  = writer.failed  - failed_before
        logger.info(
            f"  [{c_idx}/{len(companies)}] {symbol}: "
            f"queued {company_added}, skipped {skipped}, "
            f"batch-wrote +{written_delta}, batch-failed +{failed_delta} "
            f"(totals wrote={writer.written}, skipped={total_skipped}, "
            f"failed={writer.failed}, ~{rate:.0f} rows/s, "
            f"ETA ~{eta_seconds / 60:.0f}m for {companies_remaining} more)"
        )

    # ── Final flush — drain whatever's still buffered. ─────────
    writer.flush()
    fetch_pool.shutdown(wait=True)

    total_written = writer.written
    total_failed  = writer.failed

    elapsed = time.time() - started_at
    logger.info(
        f"DONE — wrote {total_written}, skipped {total_skipped}, "
        f"failed {total_failed} "
        f"({writer.batches} batches) in {elapsed:.1f}s"
    )
    if not skip_vol_backfill:
        logger.info(
            f"vol_ratio backfill — filled avg_volume_30d on "
            f"{total_vol_avg_filled} price_data rows, vol_ratio on "
            f"{total_vol_ratio_filled} rows"
        )
    # Explicit single-line summary the operator can grep for.
    logger.info(
        f"Final: wrote {total_written} rows, failed {total_failed} rows"
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
    p.add_argument("--sleep", type=float, default=0.5,
                   help="Seconds between BATCH writes (default 0.5). "
                        "Throttle is now per-batch, not per-row. "
                        "DO NOT lower below 0.5 without reading the file header.")
    p.add_argument("--resume", action="store_true",
                   help="Skip (symbol, date) pairs already written. Use after an interrupted backfill.")
    p.add_argument("--no-vol-backfill", dest="skip_vol_backfill", action="store_true",
                   help="Skip the per-company price_data.vol_ratio + avg_volume_30d backfill pass. "
                        "Only safe when both columns are already known to be populated; otherwise the "
                        "snapshot gate will reject every row.")
    p.add_argument("--i-understand-the-may-2026-incident", dest="ack_incident",
                   action="store_true",
                   help="Required when --sleep < 0.5. Acknowledges the disk-IO incident.")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # Safety gate on the sleep override. The default — and the
    # value the May 2026 post-incident review settled on — is 0.5 s
    # between batches. Going below that requires the hand-typed flag.
    if args.sleep < 0.5 and not args.ack_incident:
        sys.stderr.write(
            "ERROR: --sleep below 0.5 requires --i-understand-the-may-2026-incident.\n"
            "Read the file header before bypassing the throttle.\n"
        )
        sys.exit(2)
    if args.sleep < 0:
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
        f"build_pattern_snapshots — mode={mode} batch_size={SNAPSHOT_BATCH_SIZE} "
        f"sleep_between_batches={args.sleep}s prefetch_depth={PREFETCH_DEPTH} "
        f"start={args.start_date or '(none)'} symbol={args.symbol or '(all)'}"
    )

    run(
        mode=mode,
        sleep_seconds=args.sleep,
        start_date=args.start_date,
        symbol_filter=args.symbol,
        resume=args.resume,
        skip_vol_backfill=args.skip_vol_backfill,
    )


if __name__ == "__main__":
    main()
