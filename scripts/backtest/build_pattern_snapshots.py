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

This script now uses PER-COMPANY BULK upserts. For each company we
build the FULL list of snapshots first, then call
process_company_batch() which splits the list into 1000-row chunks
and bulk-upserts each chunk with a `time.sleep(0.5)` pause between
them. That gives the WAL half a second of idle to flush before the
next 1000-row burst — empirically keeps the disk-IO headroom above
the danger line on the Free tier.

It's roughly two orders of magnitude faster than the old per-row
throttle because most of the wall time used to be sleeps, not
writes. Expected sustained rate: ~1000-2000 rows/s.

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
one. Writes stay serial (one company at a time through
process_company_batch) — only READS are parallel. That keeps the
disk-write profile identical to the single-threaded version.

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
from supabase import create_client  # noqa: E402

from db import supabase, fetch_companies_paginated  # noqa: E402


# ─────────────────────────────────────────────────────────────────
# Per-company supabase client
# ─────────────────────────────────────────────────────────────────
#
# RemoteProtocolError manifested after ~200 companies in production:
# the long-lived supabase httpx client kept accumulating HTTP/2
# streams (Supabase caps each connection at ~20 k streams) until it
# refused to multiplex any more and started dropping. The fix is to
# discard the connection on a regular cadence — once per company is
# the natural rhythm because companies are the unit of work and
# there's a natural seam between them.
#
# We KEEP the `supabase` name as a module-level variable so every
# helper in this file just sees "the current client" without
# threading the value through. The global is re-bound at the top of
# every company iteration in run(), and re-bound again on demand
# when _upsert_chunk catches a connection drop.
#
# db.py's client is the one used for fetch_companies_paginated()
# (called once at startup, well below the stream limit) — we don't
# touch it because db.py is out-of-scope for this PR.

def create_supabase_client() -> Any:
    """Spawn a fresh supabase client. Reads the same env vars
    db.py reads so the credentials story stays a single source of
    truth."""
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("VITE_SUPABASE_URL")
        or ""
    )
    key = (
        os.environ.get("SUPABASE_SERVICE_KEY")
        or os.environ.get("SUPABASE_KEY")
        or ""
    )
    if not url or not key:
        # Fall back to the global rather than raise — we want this
        # function to be a drop-in even if a test harness ran us
        # without setting the env. The caller will surface real
        # auth errors at execute() time.
        logger.warning(
            "create_supabase_client: SUPABASE_URL or SERVICE_KEY missing "
            "from environment — falling back to db.py's global client"
        )
        from db import supabase as fallback
        return fallback
    return create_client(url, key)


# ─────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────

# Lookforward windows in TRADING days, not calendar days.
LOOKFORWARD_DAYS = [7, 30, 60, 90]
EVENT_WINDOW = 30  # 30 trading days for hit_52w_high / drop / upgrade

# Page size for price_data fetch per symbol. price_data has at most
# ~2000 trading days per symbol since inception, so 1000 is plenty.
PAGE_SIZE = 1000

# Legacy alias preserved so the startup banner / unit tests can still
# print a single number. The actual chunking constant is
# PROCESS_CHUNK_SIZE defined alongside process_company_batch().
SNAPSHOT_BATCH_SIZE = 1000

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


# Hard cap for the single-shot price_data fetch. Most companies have
# < 2500 trading days even with 10 years of history; 2500 keeps a
# safety margin without raising the per-request payload too far. The
# old per-year × per-page loop was the source of the HTTP/2 stream
# pressure (~11+ requests per company × 2 k companies = stream cap
# blown). One request per company keeps the connection healthy
# across the run.
MAX_ROWS_PER_FETCH = 2500


def fetch_price_data_for_symbol(company_id: str) -> list[dict[str, Any]]:
    """All price_data rows for one company, oldest first.

    Single non-paginated query. The previous per-year × per-page
    pagination was the dominant source of HTTP/2 stream accumulation
    on the supabase client — ~11+ requests per company across
    ~2 k companies blew past the ~20 k per-connection stream cap and
    triggered RemoteProtocolError after a few hundred companies.

    The trade-off is that any company with > MAX_ROWS_PER_FETCH
    trading days of history loses its oldest tail. That's fine:
    the snapshot writer just generates fewer (older) snapshots for
    those rare companies, not bad data. We log when truncation hits
    the cap so the operator notices.

    volume + avg_volume_30d are pulled so the vol_ratio backfill
    pass can compute the missing 30-day rolling average. Both
    columns are needed even when vol_ratio is already populated —
    the backfill skips rows where it's set.
    """
    # Excludes the is_latest=true row — the bhav pipeline writes a
    # duplicate copy of "today" with is_latest=true so the live
    # frontend can do a fast point-read. For backtest purposes that
    # row is a dupe of yesterday's regular row and would double-count
    # the snapshot date, so we drop it here.
    try:
        res = (
            supabase.table("price_data")
            .select(
                "date, stage, weinstein_substage, rs_vs_nifty, "
                "vol_ratio, volume, avg_volume_30d, "
                "close, ma30w, high_52w, low_52w"
            )
            .eq("company_id", company_id)
            .eq("is_latest", False)
            .order("date", desc=False)
            .limit(MAX_ROWS_PER_FETCH)
            .execute()
        )
    except Exception as exc:
        logger.warning(
            f"price_data fetch failed for company={company_id}: {exc!r} — "
            f"reconnect + retry once"
        )
        # Reconnect and retry once. If the second attempt also fails
        # the company is skipped at the caller (run() catches the
        # empty list / exception there).
        try:
            global supabase
            supabase = create_supabase_client()
            time.sleep(3)
            res = (
                supabase.table("price_data")
                .select(
                    "date, stage, weinstein_substage, rs_vs_nifty, "
                    "vol_ratio, volume, avg_volume_30d, "
                    "close, ma30w, high_52w, low_52w"
                )
                .eq("company_id", company_id)
                .eq("is_latest", False)
                .order("date", desc=False)
                .limit(MAX_ROWS_PER_FETCH)
                .execute()
            )
        except Exception as exc2:
            logger.warning(
                f"price_data fetch retry ALSO failed for company={company_id}: "
                f"{exc2!r} — skipping"
            )
            return []
    rows = res.data or []
    if len(rows) >= MAX_ROWS_PER_FETCH:
        logger.warning(
            f"price_data fetch hit MAX_ROWS_PER_FETCH={MAX_ROWS_PER_FETCH} "
            f"for company={company_id} — oldest history truncated"
        )
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


def count_vol_ratio_nulls(company_id: str) -> int:
    """How many price_data rows for this company are still missing
    vol_ratio? Cheap COUNT, no row payload.

    Used as a per-company fast-skip in front of
    backfill_vol_ratio_for_company: when this returns 0, the
    snapshot writer can skip the whole row-by-row UPDATE storm
    (which costs ~1,400 UPDATEs per fully-historical company).

    Returns -1 on any error so the caller falls through to the
    backfill rather than silently skipping work."""
    try:
        res = (
            supabase.table("price_data")
            .select("date", count="exact")
            .eq("company_id", company_id)
            .is_("vol_ratio", "null")
            .limit(1)
            .execute()
        )
        n = getattr(res, "count", None)
        return int(n) if n is not None else 0
    except Exception as exc:
        logger.warning(
            f"vol_ratio null-count probe failed for company={company_id}: {exc!r}"
        )
        return -1


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


# ─────────────────────────────────────────────────────────────────
# Per-company bulk upsert
# ─────────────────────────────────────────────────────────────────
#
# Earlier shape was a cross-company BatchWriter that buffered rows
# until it hit SNAPSHOT_BATCH_SIZE. Two problems showed up under load:
#
#   1. A buffer that spans companies couples the writer to the
#      prefetcher's pacing — if the prefetcher hung, the writer also
#      sat on a half-full buffer instead of flushing what it had.
#   2. Counting "wrote per company" required diffing the writer's
#      running totals around each iteration, which is approximate and
#      muddies the ETA output.
#
# Replaced with a flat per-company contract: build the FULL list of
# snapshots for one company, then call process_company_batch() which
# splits into PROCESS_CHUNK_SIZE-row chunks and uploads them serially.
# That keeps the writes deterministic per-company AND removes the
# coupling — each company stands on its own.

# 500 rows / chunk + 0.5 s sleep ≈ 1k rows/s sustained. Dropped from
# 1000 → 500 because Supabase appeared to mishandle 1000-row upserts
# under sustained load — failures clustered on the larger size while
# 500-row batches went through cleanly. Smaller chunks also mean a
# salvage-after-failure path loses less work per bad chunk.
PROCESS_CHUNK_SIZE         = 500
PROCESS_CHUNK_SLEEP_OK     = 0.5  # success path
PROCESS_CHUNK_SLEEP_ERROR  = 2.0  # cool-off after a chunk failure
RETRY_CONNECTION_SLEEP     = 5.0  # extra wait before the single retry


def _upsert_chunk(chunk: list[dict[str, Any]]) -> bool:
    """Try a single pattern_snapshots bulk upsert.

    On RemoteProtocolError / connection-drop classes, RECONNECT the
    supabase client (replaces the stale HTTP/2 connection that
    accumulated too many streams), wait RETRY_CONNECTION_SLEEP s,
    then retry ONCE. Anything still failing (or any non-connection
    error) returns False and the caller treats the whole chunk as
    failed. The caller will sleep PROCESS_CHUNK_SLEEP_ERROR s after
    a failure before moving on.

    Logs `len(chunk)` + wall-clock + rows/s per call. If you see
    `chunk_size=1`, the batch path is being bypassed upstream."""
    global supabase
    last_exc: BaseException | None = None
    for attempt in range(2):
        try:
            t0 = time.time()
            supabase.table("pattern_snapshots").upsert(
                chunk, on_conflict="company_id,date"
            ).execute()
            elapsed = time.time() - t0
            rate = len(chunk) / elapsed if elapsed > 0 else float("inf")
            logger.info(
                f"  upsert chunk_size={len(chunk)} "
                f"elapsed={elapsed:.2f}s rate={rate:.0f} rows/s"
            )
            if attempt > 0:
                logger.info(
                    f"  chunk upsert recovered after reconnect+retry "
                    f"(size={len(chunk)})"
                )
            return True
        except Exception as exc:
            last_exc = exc
            if _is_retryable(exc) and attempt == 0:
                logger.warning(
                    f"  chunk connection drop "
                    f"({type(exc).__name__}, size={len(chunk)}) — "
                    f"reconnect + retry in {RETRY_CONNECTION_SLEEP}s"
                )
                # Replace the stale client BEFORE the sleep so the
                # next attempt uses a fresh HTTP/2 connection. If
                # the reconnect itself fails, fall through to the
                # retry anyway — the next upsert will surface the
                # real error.
                try:
                    supabase = create_supabase_client()
                    logger.info("  supabase client reconnected")
                except Exception as conn_exc:
                    logger.error(
                        f"  reconnect failed (continuing with stale client): "
                        f"{conn_exc!r}"
                    )
                time.sleep(RETRY_CONNECTION_SLEEP)
                continue
            break

    logger.error(
        f"  chunk upsert pattern_snapshots FAILED "
        f"(size={len(chunk)}): {type(last_exc).__name__} {last_exc!r}"
    )
    return False


def process_company_batch(
    company_rows: list[dict[str, Any]],
    sleep_between_chunks: float,
) -> tuple[int, int]:
    """Bulk-upsert all snapshots for ONE company.

    Splits the list into PROCESS_CHUNK_SIZE-row chunks, sleeps
    sleep_between_chunks seconds between successful chunks, sleeps
    PROCESS_CHUNK_SLEEP_ERROR seconds after a failing chunk before
    moving on to the next one. Connection-drop retries live inside
    _upsert_chunk.

    Returns (wrote, failed).
    """
    if not company_rows:
        return 0, 0

    wrote  = 0
    failed = 0
    for i in range(0, len(company_rows), PROCESS_CHUNK_SIZE):
        chunk = company_rows[i : i + PROCESS_CHUNK_SIZE]
        if _upsert_chunk(chunk):
            wrote += len(chunk)
            if sleep_between_chunks > 0:
                time.sleep(sleep_between_chunks)
        else:
            failed += len(chunk)
            # Slightly longer cool-off after a failure. Lets the
            # connection pool recycle if it got into a bad state.
            time.sleep(PROCESS_CHUNK_SLEEP_ERROR)

    return wrote, failed


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
        f"sleep_between_chunks={sleep_seconds}s, chunk_size={PROCESS_CHUNK_SIZE}, "
        f"prefetch_depth={PREFETCH_DEPTH}, "
        f"skip_vol_backfill={skip_vol_backfill}, resume={resume}"
    )
    # Loud one-liner just below the banner so the operator can grep
    # for it in GHA output. If you ever see this print False for
    # skip_vol_backfill when you passed the flag, the wiring broke —
    # don't trust it from the per-company log lines alone.
    logger.info(
        f"[FLAGS-ACTIVE] --skip-vol-backfill={'YES' if skip_vol_backfill else 'no'}  "
        f"--resume={'YES' if resume else 'no'}  "
        f"chunk={PROCESS_CHUNK_SIZE}  sleep={sleep_seconds}s"
    )

    total_written = 0   # rows successfully bulk-upserted
    total_failed  = 0   # rows in a chunk that failed both retries
    total_skipped = 0   # rows the gate rejected (build_snapshot_for_row -> None)
    total_vol_avg_filled   = 0  # price_data.avg_volume_30d rows backfilled
    total_vol_ratio_filled = 0  # price_data.vol_ratio rows backfilled
    started_at = time.time()

    # ── Prefetch pool — see PREFETCH_DEPTH comment. ─────────────
    # Submits fetch_price_data_for_symbol for the NEXT few companies
    # while the main thread is busy with the current one. Block-on-
    # result() right before we need the rows; queue the next prefetch
    # right after.
    #
    # PREFETCH_FETCH_TIMEOUT_S guards against a hung HTTP call (no
    # easy way to set httpx timeout on the supabase-py client without
    # touching db.py — which this refactor explicitly leaves alone).
    # If the fetch hasn't returned in 5 min we discard it and fall
    # back to a synchronous call inline, which surfaces the underlying
    # error in the foreground instead of wedging the loop forever.
    PREFETCH_FETCH_TIMEOUT_S = 300

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

    global supabase
    for c_idx_zero, comp in enumerate(companies):
        c_idx = c_idx_zero + 1  # 1-based for log lines
        cid = comp.get("id")
        symbol = comp.get("symbol")
        if not cid:
            continue

        # Fresh supabase client per company. Keeps the HTTP/2 stream
        # counter low — long-lived clients hit the ~20 k stream cap
        # after a few hundred companies and start dropping with
        # RemoteProtocolError. One reconnect per company is the
        # natural rhythm (lightweight: just a new httpx client) and
        # the global re-bind means every helper in this file picks
        # up the new client without parameter threading.
        try:
            supabase = create_supabase_client()
        except Exception as conn_exc:
            logger.error(
                f"  [{c_idx}/{len(companies)}] {symbol}: "
                f"reconnect failed: {conn_exc!r} — continuing with stale client"
            )

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

        # Pull this company's rows from the prefetch (block, but
        # WITH A TIMEOUT, so a hung HTTP call surfaces as a foreground
        # error instead of wedging the loop). If the future times out
        # or we never queued one, fall back to a synchronous fetch
        # here — that path is what the original single-threaded code
        # always did.
        rows: list[dict[str, Any]] = []
        prefetched = fetch_futures.pop(c_idx_zero, None)
        if prefetched is not None:
            try:
                rows = prefetched.result(timeout=PREFETCH_FETCH_TIMEOUT_S)
            except Exception as exc:
                logger.warning(
                    f"  [{c_idx}/{len(companies)}] {symbol}: "
                    f"prefetch hung/failed ({type(exc).__name__}) — "
                    f"falling back to synchronous fetch"
                )
                try:
                    rows = fetch_price_data_for_symbol(cid)
                except Exception as exc2:
                    logger.error(
                        f"  [{c_idx}/{len(companies)}] {symbol}: "
                        f"synchronous fetch ALSO failed: {exc2!r} — "
                        f"skipping company"
                    )
                    submit_prefetch(c_idx_zero + PREFETCH_DEPTH)
                    continue
        else:
            try:
                rows = fetch_price_data_for_symbol(cid)
            except Exception as exc:
                logger.error(
                    f"  [{c_idx}/{len(companies)}] {symbol}: "
                    f"fetch failed: {exc!r} — skipping company"
                )
                submit_prefetch(c_idx_zero + PREFETCH_DEPTH)
                continue

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
        #
        # FAST SKIP — first BIRLAMONEY run showed the backfill
        # firing ~1,457 single-row UPDATEs (one per missing
        # vol_ratio cell) before any snapshot work began. On a
        # --resume run where vol_ratio is already populated, those
        # UPDATEs all turn into "value already set, skip" branches
        # that still cost a round-trip each. A single COUNT probe
        # in front of the loop turns 1,457 round-trips into ONE.
        # Companies whose vol_ratio column is fully populated skip
        # the loop entirely; companies with any nulls fall through
        # to the existing backfill.
        if not skip_vol_backfill:
            null_count = count_vol_ratio_nulls(cid)
            if null_count == 0:
                logger.info(
                    f"  [{c_idx}/{len(companies)}] {symbol}: "
                    f"vol_ratio already populated — skipping backfill"
                )
            else:
                avg_n, vr_n = backfill_vol_ratio_for_company(
                    cid, rows, sleep_seconds
                )
                total_vol_avg_filled   += avg_n
                total_vol_ratio_filled += vr_n
                if avg_n or vr_n:
                    logger.info(
                        f"  [{c_idx}/{len(companies)}] {symbol}: "
                        f"backfilled avg_volume_30d={avg_n}, vol_ratio={vr_n} "
                        f"on price_data (null_count was {null_count})"
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

        # Build the FULL list of snapshots for this company FIRST,
        # then hand the whole list to process_company_batch which
        # splits it into PROCESS_CHUNK_SIZE-row chunks and bulk
        # upserts each one. Per-company self-containment — no
        # cross-company buffer, no coupling with the prefetcher.
        company_snaps: list[dict[str, Any]] = []
        skipped = 0
        for i in indices:
            snap = build_snapshot_for_row(i, rows, market_by_date, cid)
            if snap is None:
                # Gate rejected: stage / substage / rs_vs_nifty /
                # vol_ratio missing, snapshot too close to today to
                # have a full forward window, or close price unusable.
                skipped += 1
                total_skipped += 1
                continue
            company_snaps.append(snap)

        wrote, failed = process_company_batch(
            company_snaps, sleep_between_chunks=sleep_seconds
        )
        total_written += wrote
        total_failed  += failed

        # ── ETA telemetry ──────────────────────────────────────
        # Average wall-clock per company over the run so far,
        # extrapolated against the remaining-companies count. The
        # backfill is long-running enough that operators want a
        # rough finish time without computing it by hand.
        elapsed = time.time() - started_at
        rate = total_written / elapsed if elapsed > 0 else 0
        companies_done = c_idx
        companies_remaining = len(companies) - companies_done
        avg_company_seconds = elapsed / companies_done if companies_done else 0
        eta_seconds = avg_company_seconds * companies_remaining
        logger.info(
            f"  [{c_idx}/{len(companies)}] {symbol}: "
            f"queued {len(company_snaps)}, skipped {skipped}, "
            f"wrote +{wrote}, failed +{failed} "
            f"(totals wrote={total_written}, skipped={total_skipped}, "
            f"failed={total_failed}, ~{rate:.0f} rows/s, "
            f"ETA ~{eta_seconds / 60:.0f}m for {companies_remaining} more)"
        )

    fetch_pool.shutdown(wait=True)

    elapsed = time.time() - started_at
    logger.info(
        f"DONE — wrote {total_written}, skipped {total_skipped}, "
        f"failed {total_failed} in {elapsed:.1f}s"
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
                   help="Seconds between CHUNK upserts (default 0.5). "
                        "Throttle is per-chunk (PROCESS_CHUNK_SIZE rows), "
                        "not per-row. DO NOT lower below 0.5 without "
                        "reading the file header.")
    p.add_argument("--resume", action="store_true",
                   help="Skip (symbol, date) pairs already written. Use after an interrupted backfill.")
    p.add_argument("--no-vol-backfill", "--skip-vol-backfill",
                   dest="skip_vol_backfill", action="store_true",
                   help="Skip the per-company price_data.vol_ratio + avg_volume_30d backfill pass "
                        "(both flag names accepted). Only safe when both columns are already known "
                        "to be populated; otherwise the snapshot gate will reject every row.")
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
        f"build_pattern_snapshots — mode={mode} chunk_size={PROCESS_CHUNK_SIZE} "
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
