"""backfill_daily_closes.py — one-time fill of `daily_closes` from the NSE
bhav copy archive.

PURPOSE
  Give long moving averages (150-day, 200-day) enough history to compute.
  price_data currently holds ~130 sessions per company, so rolling(150) and
  rolling(200) produce NULL for effectively the whole universe. Rather than
  deepen price_data — ~40 columns per row — this fills a three-column table
  with just the closes those averages consume.

SOURCE
  The same NSE bhav copy this project already ingests. Download, parsing and
  symbol matching are IMPORTED from fetch_bhav_daily rather than
  reimplemented, so the two stay consistent by construction: this script
  cannot drift from the primary pipeline's idea of what a bhav row means.

  Reused, unmodified:
    download_nse_bhav()       UDiFF zip, falling back to sec_bhavdata_full
    parse_nse_bhav()          frame -> {SYMBOL: {close, ...}}
    _backfill_trading_days()  weekday + NSE-holiday aware date list
    fetch_companies_paginated()  symbol -> company_id, past the 1000-row cap

WHAT THIS SCRIPT DOES NOT TOUCH
  price_data, delivery_data, fetch_bhav_daily.py, and every pipeline step.
  It reads companies and writes daily_closes. Nothing else.

RATE LIMITING
  time.sleep(SUPABASE_SLEEP) after every Supabase call, and a separate pause
  between NSE downloads. On a free-tier instance a tight loop over ~220 dates
  is what trips connection limits, so the sleeps are not optional.

IDEMPOTENT
  Upserts on (company_id, date). Re-running refreshes the same rows instead
  of duplicating, so an interrupted run is resumed by simply running again.

USAGE
  python scripts/backfill_daily_closes.py              # 220 trading days
  python scripts/backfill_daily_closes.py --days 260
"""
from __future__ import annotations

import sys
import time

from loguru import logger

# fetch_bhav_daily parses sys.argv at import time (DATE_ARG / NSE_FILE_ARG /
# DAYS_ARG at module level). Our --days would be read by its _parse_days_arg
# and bound to a module constant we never use — harmless, but importing under
# a cleared argv keeps that coupling explicit and stops any future arg it
# adds from silently reacting to our flags.
_argv_backup = sys.argv[:]
sys.argv = [sys.argv[0]]
try:
    from fetch_bhav_daily import (
        _backfill_trading_days,
        download_nse_bhav,
        parse_nse_bhav,
    )
finally:
    sys.argv = _argv_backup

from db import fetch_companies_paginated, supabase

DEFAULT_DAYS = 220

# Pause after every Supabase call.
SUPABASE_SLEEP = 0.1

# Pause between NSE downloads — separate from the Supabase throttle. NSE
# rate-limits aggressively and a ~220-request archive walk is exactly the
# shape of traffic it drops.
NSE_SLEEP = 0.4

# Rows per upsert. 500 keeps each request comfortably under PostgREST's
# payload ceiling while cutting round-trips ~500x versus row-by-row.
CHUNK = 500

# Progress cadence, in dates.
PROGRESS_EVERY = 10


def _parse_days() -> int:
    """Read --days=N or --days N. Falls back to DEFAULT_DAYS."""
    for arg in sys.argv:
        if arg.startswith("--days="):
            try:
                return int(arg.split("=", 1)[-1])
            except ValueError:
                logger.warning(f"--days value unreadable; using {DEFAULT_DAYS}")
                return DEFAULT_DAYS
    if "--days" in sys.argv:
        idx = sys.argv.index("--days")
        if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("-"):
            try:
                return int(sys.argv[idx + 1])
            except ValueError:
                logger.warning(f"--days value unreadable; using {DEFAULT_DAYS}")
                return DEFAULT_DAYS
    return DEFAULT_DAYS


def load_symbol_map() -> dict[str, str]:
    """symbol -> company_id for every active company.

    Paginated because PostgREST caps a single request at 1000 rows and the
    universe is ~2,125 — a plain select would silently return a third of it.
    """
    companies = fetch_companies_paginated("id,symbol")
    time.sleep(SUPABASE_SLEEP)
    out: dict[str, str] = {}
    for c in companies:
        sym = str(c.get("symbol") or "").strip().upper()
        if sym and c.get("id"):
            out[sym] = c["id"]
    return out


def write_chunk(rows: list[dict]) -> int:
    """Upsert one batch. Returns rows written, 0 on failure.

    A failed batch is logged and skipped rather than raised: one bad date
    should not discard the ~220 that come after it, and the run is
    re-runnable to fill any gap.
    """
    if not rows:
        return 0
    try:
        supabase.table("daily_closes").upsert(
            rows, on_conflict="company_id,date"
        ).execute()
        return len(rows)
    except Exception as exc:
        logger.error(f"    upsert failed ({len(rows)} rows): {exc}")
        return 0
    finally:
        time.sleep(SUPABASE_SLEEP)


def process_date(
    ddmmyyyy: str,
    yyyymmdd: str,
    iso_date: str,
    sym_map: dict[str, str],
) -> int:
    """Download one session, write its closes. Returns rows written.

    Returns 0 for a market holiday (bhav 404s) — logged, never raised, so
    the walk continues. _backfill_trading_days already skips weekends and
    known 2026 holidays; older or unlisted holidays cost one wasted request
    and land here.
    """
    try:
        frame = download_nse_bhav(ddmmyyyy, yyyymmdd)
    except Exception as exc:
        logger.warning(f"  {iso_date}: download error ({exc}) — skipping")
        return 0
    finally:
        time.sleep(NSE_SLEEP)

    if frame is None or frame.empty:
        logger.info(f"  {iso_date}: no bhav (holiday or not published) — skipping")
        return 0

    parsed = parse_nse_bhav(frame)
    if not parsed:
        logger.warning(f"  {iso_date}: bhav parsed to zero rows — skipping")
        return 0

    batch: list[dict] = []
    written = 0
    for symbol, rec in parsed.items():
        company_id = sym_map.get(str(symbol).strip().upper())
        if not company_id:
            # Symbol not in `companies` — an index, a symbol we don't track,
            # or a listing added since the last companies sync. Skipping is
            # correct: daily_closes has an FK to companies.
            continue
        close = rec.get("close")
        if close is None:
            continue

        batch.append({
            "company_id": company_id,
            "date": iso_date,
            "close": close,
        })
        if len(batch) >= CHUNK:
            written += write_chunk(batch)
            batch = []

    written += write_chunk(batch)
    return written


def main() -> int:
    days = _parse_days()
    logger.info(f"backfill_daily_closes — {days} trading days")

    sym_map = load_symbol_map()
    if not sym_map:
        logger.error("No companies loaded — aborting before any write.")
        return 1
    logger.info(f"  symbol map: {len(sym_map):,} companies")

    # Oldest first, per spec: a partial run then leaves a contiguous block of
    # history ending at a known date rather than scattered gaps.
    trading_days = _backfill_trading_days(days)
    logger.info(
        f"  date range: {trading_days[0][2]} -> {trading_days[-1][2]} "
        f"({len(trading_days)} sessions)"
    )

    total_rows = 0
    dates_with_data = 0
    dates_skipped = 0

    for i, (ddmmyyyy, yyyymmdd, iso_date) in enumerate(trading_days, start=1):
        rows = process_date(ddmmyyyy, yyyymmdd, iso_date, sym_map)
        total_rows += rows
        if rows:
            dates_with_data += 1
        else:
            dates_skipped += 1

        if i % PROGRESS_EVERY == 0 or i == len(trading_days):
            logger.info(
                f"[{i}/{len(trading_days)}] {iso_date} — "
                f"rows this date: {rows:,} | cumulative: {total_rows:,}"
            )

    # Final counts read back from the table rather than trusted from the
    # loop: the loop counts rows SENT, this counts rows that actually landed.
    distinct_companies = None
    table_rows = None
    try:
        table_rows = (
            supabase.table("daily_closes")
            .select("company_id", count="exact", head=True)
            .execute()
            .count
        )
        time.sleep(SUPABASE_SLEEP)
    except Exception as exc:
        logger.warning(f"  final row count unavailable: {exc}")

    try:
        # No DISTINCT through PostgREST, so page the ids and count locally.
        seen: set[str] = set()
        start = 0
        while True:
            page = (
                supabase.table("daily_closes")
                .select("company_id")
                .range(start, start + 999)
                .execute()
                .data
                or []
            )
            time.sleep(SUPABASE_SLEEP)
            if not page:
                break
            for r in page:
                if r.get("company_id"):
                    seen.add(r["company_id"])
            if len(page) < 1000:
                break
            start += 1000
        distinct_companies = len(seen)
    except Exception as exc:
        logger.warning(f"  distinct company count unavailable: {exc}")

    logger.info("")
    logger.info("─" * 52)
    logger.info(f"  dates processed      : {len(trading_days)}")
    logger.info(f"    with data          : {dates_with_data}")
    logger.info(f"    skipped (no bhav)  : {dates_skipped}")
    logger.info(f"  rows written         : {total_rows:,}")
    if table_rows is not None:
        logger.info(f"  rows now in table    : {table_rows:,}")
    if distinct_companies is not None:
        logger.info(f"  distinct companies   : {distinct_companies:,}")
    logger.info("─" * 52)

    if total_rows == 0:
        logger.error("Nothing written — check the log above for download failures.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
