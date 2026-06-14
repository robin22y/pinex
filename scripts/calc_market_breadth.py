"""
calc_market_breadth.py
=======================
Daily Advance / Decline breadth and cumulative A-D line.

For every trading_date in the last 90 calendar days we read price_data
for that date, count advances / declines / unchanged from close vs
prev_close, then write a per-date row into market_breadth with:

  advances        — count(close > prev_close)
  declines        — count(close < prev_close)
  unchanged       — total - advances - declines
  ad_daily        — advances - declines
  ad_cumulative   — running sum of ad_daily across the 90-day window
                    (so today's value reads as "how many more advancers
                    than decliners over the last 90 trading days")

Why a separate script (not just calc_market_internals.py)?
  market_internals already writes today's advances + declines + ad_ratio
  for the CURRENT trading session. The Pulse page wants a 90-day series
  with a running cumulative — different shape, different cadence (this
  fills in any missing recent dates so the chart never has gaps).
  Keeping them separate also means a failure in this script never blocks
  the SwingX pipeline.

Idempotent — re-running rewrites the same rows with the same values.
prev_close NULL → that row contributes nothing; the date still gets
written (advances = 0, declines = 0) so the chart x-axis is contiguous.

Throttling:
  - One Supabase round-trip per date (paginated when stock count > 1000).
  - time.sleep(0.1) between dates so we don't hammer the API.
  - Whole run ≈ 90 dates × ~0.5s ≈ ~45 seconds on a clean run.

Usage:
  python scripts/calc_market_breadth.py
  python scripts/calc_market_breadth.py --days=180   # widen the window
  python scripts/calc_market_breadth.py --dry-run    # no DB writes
"""
from __future__ import annotations

import os
import sys
import time
from datetime import date, datetime, timedelta

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


WINDOW_DAYS = 90
DRY_RUN = "--dry-run" in sys.argv
for arg in sys.argv[1:]:
    if arg.startswith("--days="):
        try:
            WINDOW_DAYS = int(arg.split("=", 1)[1])
        except ValueError:
            print(f"Ignoring invalid --days value: {arg}")


def fetch_trading_dates(window_days: int) -> list[str]:
    """Distinct dates in price_data within the last window_days calendar days.

    Returned ascending so the running sum is calculated in chronological
    order without an extra sort pass downstream.
    """
    since = (date.today() - timedelta(days=window_days)).isoformat()
    dates: set[str] = set()
    page = 1000
    offset = 0
    while True:
        res = (
            supabase.table("price_data")
            .select("date")
            .gte("date", since)
            .order("date")
            .range(offset, offset + page - 1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        for r in rows:
            d = r.get("date")
            if d:
                dates.add(d)
        if len(rows) < page:
            break
        offset += page
    return sorted(dates)


def fetch_breadth_for_date(trading_date: str) -> dict[str, int]:
    """Page through price_data for a single date, count adv / dec / unc.

    Skips rows where close or prev_close is None — those contribute to
    neither column. This naturally handles freshly-listed stocks that
    don't yet have a prev_close.
    """
    advances = 0
    declines = 0
    unchanged = 0
    page = 1000
    offset = 0
    while True:
        res = (
            supabase.table("price_data")
            .select("close, prev_close")
            .eq("date", trading_date)
            .range(offset, offset + page - 1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        for r in rows:
            close = r.get("close")
            prev = r.get("prev_close")
            if close is None or prev is None:
                continue
            try:
                c = float(close)
                p = float(prev)
            except (TypeError, ValueError):
                continue
            if c > p:
                advances += 1
            elif c < p:
                declines += 1
            else:
                unchanged += 1
        if len(rows) < page:
            break
        offset += page
    return {
        "advances": advances,
        "declines": declines,
        "unchanged": unchanged,
        "ad_daily": advances - declines,
    }


def upsert_breadth(trading_date: str, payload: dict, ad_cumulative: int) -> None:
    """Upsert a single market_breadth row keyed on trading_date."""
    row = {
        "trading_date": trading_date,
        "advances": payload["advances"],
        "declines": payload["declines"],
        "unchanged": payload["unchanged"],
        "ad_daily": payload["ad_daily"],
        "ad_cumulative": ad_cumulative,
    }
    if DRY_RUN:
        return
    supabase.table("market_breadth").upsert(row, on_conflict="trading_date").execute()


def main() -> int:
    print(f"calc_market_breadth · window={WINDOW_DAYS} days")
    if DRY_RUN:
        print("DRY RUN — no DB writes")

    trading_dates = fetch_trading_dates(WINDOW_DAYS)
    if not trading_dates:
        print("No trading dates found in price_data for the window.")
        return 0

    print(f"Processing {len(trading_dates)} trading dates "
          f"(oldest first: {trading_dates[0]} → {trading_dates[-1]})")

    started = time.time()
    ad_cumulative = 0
    processed = 0
    skipped = 0

    for trading_date in trading_dates:
        try:
            payload = fetch_breadth_for_date(trading_date)
        except Exception as exc:
            print(f"  ! {trading_date}: fetch failed ({exc}) — skipping")
            skipped += 1
            time.sleep(0.1)
            continue

        # If this date saw zero comparable rows (every prev_close was
        # null — typical of the very first date in price_data), still
        # write the row with zeros so the chart x-axis stays contiguous.
        # ad_daily contributes 0 to the running sum so the line just
        # holds flat across that gap.
        ad_cumulative += payload["ad_daily"]

        try:
            upsert_breadth(trading_date, payload, ad_cumulative)
        except Exception as exc:
            print(f"  ! {trading_date}: upsert failed ({exc}) — skipping")
            skipped += 1
            time.sleep(0.1)
            continue

        processed += 1
        if processed % 10 == 0 or trading_date == trading_dates[-1]:
            print(
                f"  [{processed}/{len(trading_dates)}] {trading_date}  "
                f"adv={payload['advances']:<5} "
                f"dec={payload['declines']:<5} "
                f"unc={payload['unchanged']:<5} "
                f"ad_d={payload['ad_daily']:<+6} "
                f"ad_cum={ad_cumulative:<+8}"
            )
        time.sleep(0.1)

    elapsed = time.time() - started
    print()
    print("Done.")
    print(f"  dates processed  : {processed:>4}")
    print(f"  dates skipped    : {skipped:>4}")
    print(f"  final ad_cum     : {ad_cumulative:>+8}")
    print(f"  elapsed          : {elapsed:>6.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
