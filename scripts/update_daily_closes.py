"""update_daily_closes.py — daily incremental for `daily_closes`.

The daily counterpart to the one-time scripts/backfill_daily_closes.py.
Appends the newest session's closes and trims history past the retention
window, so the table stays at a fixed depth instead of growing forever.

    python scripts/update_daily_closes.py
    python scripts/update_daily_closes.py --days 260
    python scripts/update_daily_closes.py --dry-run

── WHERE TODAY'S CLOSES COME FROM ───────────────────────────────────────
  price_data, NOT a fresh NSE download.

  fetch_bhav_daily runs earlier in the same pipeline and has already
  downloaded, parsed and symbol-matched today's bhav copy into
  price_data. Re-downloading it here would be a second HTTP round-trip
  to NSE for bytes already sitting in the database, and it would open
  the door to the two tables disagreeing about what today's close was.

  Reading from price_data makes daily_closes a strict projection of it:
  same numbers by construction, no reconciliation needed.

── RETENTION ────────────────────────────────────────────────────────────
  Keeps the last --days trading days (default 220) and deletes older
  rows. 220 is sized for the 200-day moving average plus ~20 sessions of
  slack so a few missing sessions can never starve rolling(200).

  The cutoff comes from _backfill_trading_days() in fetch_bhav_daily —
  the project's own weekday + NSE-holiday aware calendar — rather than
  from counting distinct dates in the table. Counting would mean
  scanning ~440k rows to find the 220th date; the calendar answers it
  with zero queries.

  CAVEAT: price_data contains carry-forward rows on NSE holidays (a
  session's close repeated on a closed day). Retention is therefore
  approximately, not exactly, 220 real sessions — it errs toward keeping
  a few extra rows, which is the safe direction for a moving average.

── SAFETY RAIL ON THE DELETE ────────────────────────────────────────────
  A bug in the cutoff calculation would silently empty the table and
  every long moving average with it. So the script counts what it is
  about to remove and refuses to proceed if that exceeds
  MAX_DELETE_FRACTION of the table, unless --force is passed.

  Deleting nothing is a normal outcome and is not an error.

── IDEMPOTENT ───────────────────────────────────────────────────────────
  Upserts on (company_id, date). Re-running the same day refreshes the
  same rows rather than duplicating them.

RATE LIMITING
  time.sleep(0.1) after every Supabase call. Non-negotiable on the free
  tier — a tight loop is what trips connection limits.
"""
from __future__ import annotations

import sys
import time
from datetime import date, timedelta

from loguru import logger

from db import supabase
from nse_holidays import is_nse_holiday

DEFAULT_DAYS = 220
SUPABASE_SLEEP = 0.1
READ_PAGE = 1000
WRITE_CHUNK = 500

# Refuse to delete more than this share of the table without --force.
MAX_DELETE_FRACTION = 0.25


def _flag(name: str) -> bool:
    return name in sys.argv


def _parse_days() -> int:
    for arg in sys.argv:
        if arg.startswith("--days="):
            try:
                return int(arg.split("=", 1)[-1])
            except ValueError:
                logger.warning(f"--days unreadable; using {DEFAULT_DAYS}")
                return DEFAULT_DAYS
    if "--days" in sys.argv:
        idx = sys.argv.index("--days")
        if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("-"):
            try:
                return int(sys.argv[idx + 1])
            except ValueError:
                logger.warning(f"--days unreadable; using {DEFAULT_DAYS}")
    return DEFAULT_DAYS


def latest_price_data_date() -> str | None:
    resp = (
        supabase.table("price_data")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    time.sleep(SUPABASE_SLEEP)
    if not resp.data:
        return None
    return str(resp.data[0]["date"])[:10]


def fetch_closes_for(target: str) -> list[dict]:
    """company_id + close for every price_data row on `target`."""
    rows: list[dict] = []
    start = 0
    while True:
        resp = (
            supabase.table("price_data")
            .select("company_id,close")
            .eq("date", target)
            .order("company_id")
            .range(start, start + READ_PAGE - 1)
            .execute()
        )
        time.sleep(SUPABASE_SLEEP)
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < READ_PAGE:
            break
        start += READ_PAGE
    return rows


def append_closes(target: str, dry_run: bool) -> tuple[int, int]:
    """Upsert `target`'s closes into daily_closes. Returns (written, skipped)."""
    rows = fetch_closes_for(target)
    payload: list[dict] = []
    skipped = 0
    for r in rows:
        raw = r.get("close")
        if raw is None or r.get("company_id") is None:
            skipped += 1
            continue
        try:
            close = float(raw)
        except (TypeError, ValueError):
            skipped += 1
            continue
        # daily_closes.close is NOT NULL and a non-positive close is not a
        # price. Drop rather than poison every average that reads it.
        if close != close or close <= 0:
            skipped += 1
            continue
        payload.append(
            {"company_id": r["company_id"], "date": target, "close": close}
        )

    logger.info(
        f"price_data[{target}]: {len(rows):,} rows -> {len(payload):,} usable, "
        f"{skipped:,} skipped"
    )

    if dry_run:
        logger.warning(f"DRY RUN - would upsert {len(payload):,} rows")
        return 0, skipped

    written = 0
    for i in range(0, len(payload), WRITE_CHUNK):
        chunk = payload[i : i + WRITE_CHUNK]
        supabase.table("daily_closes").upsert(
            chunk, on_conflict="company_id,date"
        ).execute()
        time.sleep(SUPABASE_SLEEP)
        written += len(chunk)
    logger.success(f"upserted {written:,} closes for {target}")
    return written, skipped


def retention_cutoff(latest: str, days: int) -> str | None:
    """Oldest date to KEEP: the earliest of the last `days` trading days,
    counting back from and including `latest`.

    Deliberately NOT fetch_bhav_daily._backfill_trading_days(): that helper
    anchors its window at date.today() - 1 day, which is not a parameter.
    Retention has to be measured from the newest session actually present in
    price_data, or the window silently slides by a session whenever the
    pipeline runs late, early, or on a backfill.

    Holidays come from nse_holidays.is_nse_holiday() — the canonical list its
    own docstring names as the single source for pipeline scripts.
    """
    try:
        cursor = date.fromisoformat(latest)
    except ValueError:
        return None
    if days < 1:
        return None

    counted = 0
    oldest = cursor
    # Bounded: 220 sessions is ~310 calendar days, so 3x that is ample
    # headroom and guarantees termination if the holiday list ever grows
    # pathologically.
    for _ in range(days * 3 + 40):
        if cursor.weekday() < 5 and not is_nse_holiday(cursor.isoformat()):
            counted += 1
            oldest = cursor
            if counted >= days:
                return oldest.isoformat()
        cursor -= timedelta(days=1)

    # Fewer trading days available than requested — keep everything from the
    # oldest date we reached. Trimming to a window we could not measure would
    # delete history the moving averages need.
    logger.warning(
        f"only found {counted} trading days walking back from {latest}; "
        f"using {oldest.isoformat()} as the cutoff"
    )
    return oldest.isoformat()


def trim_history(cutoff: str, dry_run: bool, force: bool) -> int:
    """Delete rows strictly older than `cutoff`. Returns rows removed."""
    total = (
        supabase.table("daily_closes")
        .select("company_id", count="exact")
        .limit(1)
        .execute()
        .count
        or 0
    )
    time.sleep(SUPABASE_SLEEP)
    doomed = (
        supabase.table("daily_closes")
        .select("company_id", count="exact")
        .lt("date", cutoff)
        .limit(1)
        .execute()
        .count
        or 0
    )
    time.sleep(SUPABASE_SLEEP)

    logger.info(
        f"retention: keep date >= {cutoff} | {total:,} rows total, "
        f"{doomed:,} older than cutoff"
    )

    if doomed == 0:
        logger.info("nothing to trim")
        return 0

    share = doomed / total if total else 1.0
    if share > MAX_DELETE_FRACTION and not force:
        logger.error(
            f"refusing to delete {doomed:,} rows ({share*100:.1f}% of the "
            f"table) - over the {MAX_DELETE_FRACTION*100:.0f}% rail. This "
            f"usually means the cutoff is wrong, not that the data is old. "
            f"Re-run with --force only if {cutoff} is genuinely correct."
        )
        raise SystemExit(1)

    if dry_run:
        logger.warning(f"DRY RUN - would delete {doomed:,} rows")
        return 0

    supabase.table("daily_closes").delete().lt("date", cutoff).execute()
    time.sleep(SUPABASE_SLEEP)
    logger.success(f"deleted {doomed:,} rows older than {cutoff}")
    return doomed


def main() -> int:
    days = _parse_days()
    dry_run = _flag("--dry-run")
    force = _flag("--force")

    if dry_run:
        logger.warning("DRY RUN - no writes, no deletes")

    latest = latest_price_data_date()
    if not latest:
        logger.error("price_data is empty - nothing to append")
        return 1

    written, skipped = append_closes(latest, dry_run)

    cutoff = retention_cutoff(latest, days)
    if not cutoff:
        logger.error(f"could not compute a {days}-session cutoff from {latest}")
        return 1
    removed = trim_history(cutoff, dry_run, force)

    logger.success("-" * 58)
    logger.success(f"  session appended      {latest}")
    logger.success(f"  closes upserted       {written:,}")
    logger.success(f"  rows skipped          {skipped:,}")
    logger.success(f"  retention window      {days} trading days (>= {cutoff})")
    logger.success(f"  rows trimmed          {removed:,}")
    logger.success("-" * 58)
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    sys.exit(main())
