"""calc_moving_averages.py — compute 50 / 150 / 200 day simple moving
averages from `daily_closes` and store them on price_data.

STANDALONE. Not wired into the pipeline. Run it by hand:

    python scripts/calc_moving_averages.py            # compute and write
    python scripts/calc_moving_averages.py --dry-run  # compute, write nothing
    python scripts/calc_moving_averages.py --dry-run --show RELIANCE,TCS,INFY

WHAT IT READS / WRITES
  reads   daily_closes  (company_id, date, close)
          price_data    (id, company_id, date) WHERE is_latest = true
  writes  price_data.dma_50 / dma_150 / dma_200 on those latest rows only

  Nothing else is read or written. No pipeline script is modified, no
  existing column is overwritten, and `daily_closes` is never written to.
  Apply scripts/sql/add_dma_columns.sql before the first run.

NEVER A PARTIAL WINDOW
  A 200 DMA computed from 80 closes is not a 200 DMA — it is an 80 DMA
  wearing the wrong label, and it reads as a normal number to anything
  downstream. So each average is written only when the company has at
  least that many closes; otherwise the column gets NULL. The three
  windows are decided independently: a company with 160 closes gets a
  real dma_50 and dma_150, and NULL for dma_200.

  NULL is written explicitly rather than skipped, so a company that
  loses history (or a stale value from an earlier run) is cleared rather
  than left showing a number that no longer has data behind it.

READ STRATEGY — WHY A FULL SCAN
  The obvious shape is one query per company: 200 closes, ordered date
  DESC, 2,123 times. That is 2,123 round-trips, and at the mandatory
  0.1s throttle it is ~4 minutes of pure sleeping before any work.

  Instead this pages the whole table once, ordered by (company_id, date).
  That is the PRIMARY KEY, so it is a total order and `.range()`
  pagination cannot skip or repeat a row as it advances — the failure
  mode that makes paginating on a non-unique sort key silently lossy.
  ~444 pages instead of 2,123 queries.

  Because rows arrive grouped by company and ascending by date, each
  company's closes land in a deque(maxlen=200): the most recent 200
  survive and older ones fall off the left automatically. Memory stays
  bounded at ~2,123 x 200 floats regardless of how deep daily_closes
  grows.

WRITE STRATEGY
  Batched upsert on the primary key `id`, 500 rows per request — 5
  requests rather than 2,123 UPDATEs. Every id comes from a SELECT on
  price_data in this same run, so the conflict branch always fires and
  this behaves as an UPDATE. company_id and date ride along in the
  payload so that even a hypothetical insert would be a well-formed row
  rather than a NOT NULL violation.

RATE LIMITING
  time.sleep(0.1) after every Supabase call, reads and writes alike.
  Non-negotiable on a free-tier instance: a tight loop over hundreds of
  pages is exactly the traffic shape that trips connection limits.
"""
from __future__ import annotations

import sys
import time
from collections import deque

from loguru import logger

from db import supabase

# The three windows, in the order they are reported. Column name -> the
# number of closes that window requires. Adding a window here is enough;
# nothing below hardcodes 50/150/200.
WINDOWS: dict[str, int] = {
    "dma_50": 50,
    "dma_150": 150,
    "dma_200": 200,
}

# Pause after every Supabase call.
SUPABASE_SLEEP = 0.1

# Rows per read page. 1000 is PostgREST's server-side ceiling — asking
# for more silently returns 1000, which is what makes a naive .limit(5000)
# look like it worked while dropping everything past the cap.
READ_PAGE = 1000

# Rows per upsert. Comfortably under the payload ceiling for a 6-key row.
WRITE_CHUNK = 500

# Progress cadence, in pages.
PROGRESS_EVERY = 50

# Longest window we need, so the per-company buffer never holds more.
MAX_WINDOW = max(WINDOWS.values())


def _flag(name: str) -> bool:
    return name in sys.argv


def _opt(name: str) -> str | None:
    """Read `--name value` or `--name=value`."""
    for arg in sys.argv:
        if arg.startswith(f"{name}="):
            return arg.split("=", 1)[-1]
    if name in sys.argv:
        idx = sys.argv.index(name)
        if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("-"):
            return sys.argv[idx + 1]
    return None


def max_date(table: str) -> str | None:
    """Newest date in a table, or None when it is empty."""
    resp = (
        supabase.table(table).select("date")
        .order("date", desc=True).limit(1).execute()
    )
    time.sleep(SUPABASE_SLEEP)
    rows = resp.data or []
    return rows[0]["date"] if rows else None


def fetch_target_rows(target_date: str) -> list[dict]:
    """The price_data rows FOR A GIVEN DATE: id, company_id, date.

    KEYED ON (company_id, date), NOT ON is_latest — and resolved AFTER the
    averages are computed, not before.

    The previous version captured the is_latest row up front and upserted
    back on that id minutes later. is_latest is a MOVING flag: the next
    fetch_bhav_daily insert relocates it to the new day's row, orphaning
    everything written to the old one. That is not hypothetical — 4,211
    rows in price_data carry a dma_50 today and only 28 of them are still
    is_latest, all of them companies that never received a newer row.

    Selecting by date makes the target stable: the row for a given trading
    day does not move, whatever happens to the flag afterwards.
    """
    rows: list[dict] = []
    start = 0
    while True:
        resp = (
            supabase.table("price_data")
            .select("id,company_id,date")
            .eq("date", target_date)
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
    logger.info(f"price_data rows dated {target_date}: {len(rows):,}")
    return rows


def fetch_closes() -> tuple[dict[str, deque], dict[str, int]]:
    """Every close in daily_closes, grouped by company.

    Returns (recent_closes, total_counts):
      recent_closes  company_id -> deque of up to MAX_WINDOW closes,
                     oldest first, most recent last
      total_counts   company_id -> how many closes that company has in
                     total, which is what the NULL-reason breakdown
                     reports on

    Ordered by (company_id, date) — the primary key, hence a total order,
    hence safe to paginate. Ascending date means appending to a bounded
    deque keeps exactly the most recent MAX_WINDOW closes.
    """
    recent: dict[str, deque] = {}
    totals: dict[str, int] = {}
    start = 0
    page = 0

    while True:
        resp = (
            supabase.table("daily_closes")
            .select("company_id,close")
            .order("company_id")
            .order("date")
            .range(start, start + READ_PAGE - 1)
            .execute()
        )
        time.sleep(SUPABASE_SLEEP)
        batch = resp.data or []

        for row in batch:
            cid = row["company_id"]
            try:
                close = float(row["close"])
            except (TypeError, ValueError):
                # daily_closes.close is NOT NULL numeric, so this should
                # not fire. If it ever does, drop the row rather than let
                # a NaN poison the whole company's average.
                continue
            if close != close:  # NaN
                continue
            if cid not in recent:
                recent[cid] = deque(maxlen=MAX_WINDOW)
                totals[cid] = 0
            recent[cid].append(close)
            totals[cid] += 1

        page += 1
        if page % PROGRESS_EVERY == 0:
            logger.info(f"  read page {page} - {sum(totals.values()):,} closes so far")

        if len(batch) < READ_PAGE:
            break
        start += READ_PAGE

    logger.info(
        f"daily_closes: {sum(totals.values()):,} closes across "
        f"{len(totals):,} companies ({page} pages)"
    )
    return recent, totals


def compute(closes: deque) -> dict[str, float | None]:
    """SMA for each window, or None when there is not enough history.

    `closes` is oldest-first, so the most recent N are the LAST N.
    """
    out: dict[str, float | None] = {}
    n = len(closes)
    if n == 0:
        return {col: None for col in WINDOWS}

    series = list(closes)
    for col, window in WINDOWS.items():
        if n < window:
            out[col] = None  # never a partial window
            continue
        out[col] = round(sum(series[-window:]) / window, 2)
    return out


def null_reason(total: int) -> str | None:
    """Why a company is missing at least one average. None = has all three."""
    if total == 0:
        return "no rows in daily_closes"
    ordered = sorted(WINDOWS.values())
    for window in ordered:
        if total < window:
            return f"fewer than {window} closes"
    return None


def write(payload: list[dict]) -> int:
    """Upsert the computed averages in batches. Returns rows written."""
    written = 0
    for i in range(0, len(payload), WRITE_CHUNK):
        chunk = payload[i : i + WRITE_CHUNK]
        supabase.table("price_data").upsert(chunk, on_conflict="id").execute()
        time.sleep(SUPABASE_SLEEP)
        written += len(chunk)
        logger.info(f"  wrote {written:,}/{len(payload):,}")
    return written


def main() -> None:
    dry_run = _flag("--dry-run")
    show = _opt("--show")

    # The Windows console is cp1252 by default, which mangles em-dashes and
    # box-drawing characters in log output. Keep runtime logging ASCII.
    if dry_run:
        logger.warning("DRY RUN - computing only, nothing will be written")

    # ── STALENESS GATE ──────────────────────────────────────────────
    # The averages come from daily_closes; they are written onto
    # price_data. If daily_closes is behind, the run computes yesterday's
    # average and stamps it on today's row — silently, and indistinguishable
    # from a correct run. That exact class of invisible failure is what hid
    # the orphaned-write bug for two days, so it exits non-zero instead.
    price_date = max_date("price_data")
    closes_date = max_date("daily_closes")
    if not price_date:
        logger.error("price_data is empty - nothing to write to")
        sys.exit(1)
    if closes_date != price_date:
        logger.error(
            f"STALE: daily_closes ends {closes_date}, price_data ends "
            f"{price_date}. Run update_daily_closes.py first. "
            f"Refusing to write a {closes_date} average onto a "
            f"{price_date} row."
        )
        sys.exit(1)
    logger.info(f"both tables current at {price_date}")

    recent, totals = fetch_closes()

    # Resolved AFTER the compute, so nothing can move underneath it.
    latest_rows = fetch_target_rows(price_date)
    if not latest_rows:
        logger.error(f"no price_data rows dated {price_date}")
        sys.exit(1)

    payload: list[dict] = []
    all_three = 0
    any_null = 0
    reasons: dict[str, int] = {}

    for row in latest_rows:
        cid = row["company_id"]
        closes = recent.get(cid, deque())
        total = totals.get(cid, 0)
        mas = compute(closes)

        if all(mas[col] is not None for col in WINDOWS):
            all_three += 1
        else:
            any_null += 1
            reason = null_reason(total) or "unknown"
            reasons[reason] = reasons.get(reason, 0) + 1

        payload.append(
            {
                "id": row["id"],
                "company_id": cid,
                "date": row["date"],
                **mas,
            }
        )

    # Optional spot-check: print the inputs and the result for named
    # symbols so the arithmetic can be checked against the source rows.
    if show:
        _show_symbols(show, recent, totals)

    if dry_run:
        logger.warning(f"DRY RUN - {len(payload):,} rows computed, none written")
    else:
        written = write(payload)
        # write() upserts on the primary key; a short count means rows were
        # dropped, which must not pass silently.
        if written != len(payload):
            logger.error(f"wrote {written:,} of {len(payload):,} - aborting")
            sys.exit(1)

    logger.success("-" * 58)
    logger.success(f"  companies processed        {len(payload):,}")
    logger.success(f"  all three MAs populated    {all_three:,}")
    logger.success(f"  at least one NULL          {any_null:,}")
    if reasons:
        logger.success("  NULL reasons:")
        for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1]):
            logger.success(f"    {reason:<28} {count:,}")
    logger.success("-" * 58)


def _show_symbols(csv: str, recent: dict[str, deque], totals: dict[str, int]) -> None:
    """Print window inputs for named symbols, for manual verification."""
    symbols = [s.strip().upper() for s in csv.split(",") if s.strip()]
    if not symbols:
        return
    resp = (
        supabase.table("companies")
        .select("id,symbol")
        .in_("symbol", symbols)
        .execute()
    )
    time.sleep(SUPABASE_SLEEP)
    for company in resp.data or []:
        cid, symbol = company["id"], company["symbol"]
        closes = list(recent.get(cid, deque()))
        total = totals.get(cid, 0)
        mas = compute(recent.get(cid, deque()))
        logger.info(f"{symbol}: {total} closes total, {len(closes)} buffered")
        for col, window in WINDOWS.items():
            if len(closes) < window:
                logger.info(f"  {col:<8} NULL - needs {window}")
                continue
            window_closes = closes[-window:]
            logger.info(
                f"  {col:<8} {mas[col]}  "
                f"(sum {sum(window_closes):.4f} / {window}, "
                f"first {window_closes[0]}, last {window_closes[-1]})"
            )


if __name__ == "__main__":
    main()
