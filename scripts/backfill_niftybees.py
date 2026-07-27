"""backfill_niftybees.py — seed NIFTYBEES OHLCV so the Distribution Days
card has history on day one.

WHY THIS EXISTS
  The Distribution Days gauge needs a 25-trading-day rolling window plus
  enough trailing history for the 5% rally-expiry rule — call it ~60
  sessions. The daily bhav pipeline only accumulates one session per run,
  so without a backfill the card would sit empty for ~3 months.

  NIFTYBEES is the Nifty 50 ETF. NSE doesn't publish reliable index-level
  volume, so the ETF's volume is the standard proxy for institutional
  participation in the index. Price tracks the index closely enough that
  we use the ETF for BOTH price and volume here — simpler than stitching
  index price to ETF volume, and the distribution-day test only cares
  about direction + relative volume, both of which the ETF preserves.

SOURCE
  yfinance (already in scripts/requirements.txt). Symbol NIFTYBEES.NS.

IDEMPOTENT
  Upserts on (company_id, date). Re-running refreshes the same rows
  rather than duplicating. Safe to run repeatedly.

USAGE
  python scripts/backfill_niftybees.py            # 120 calendar days
  python scripts/backfill_niftybees.py --days 400 # longer history
"""
from __future__ import annotations

import sys
from datetime import date, timedelta

from loguru import logger

from db import supabase

SYMBOL = "NIFTYBEES"
YF_TICKER = "NIFTYBEES.NS"
DEFAULT_DAYS = 120


def ensure_company() -> str | None:
    """Return NIFTYBEES's companies.id, creating the row if absent."""
    # Plain select + limit(1) rather than maybe_single(): the Python
    # client returns None (not a response object) from maybe_single when
    # zero rows match, so `.data` would blow up on the miss path.
    existing = (
        supabase.table("companies")
        .select("id,symbol,name")
        .eq("symbol", SYMBOL)
        .limit(1)
        .execute()
    )
    rows = getattr(existing, "data", None) or []
    if rows:
        logger.info(f"  companies: {SYMBOL} exists (id={rows[0]['id']})")
        return rows[0]["id"]

    logger.info(f"  companies: {SYMBOL} missing — inserting")
    created = (
        supabase.table("companies")
        .insert({
            "symbol": SYMBOL,
            "name": "Nippon India ETF Nifty 50 BeES",
            "sector": "ETF",
            "is_suspended": False,
        })
        .execute()
    )
    if not created.data:
        logger.error("  companies insert returned no row")
        return None
    cid = created.data[0]["id"]
    logger.info(f"  companies: inserted {SYMBOL} (id={cid})")
    return cid


def fetch_history(days: int):
    """Daily OHLCV for NIFTYBEES, oldest-first. Returns list of dicts."""
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance not installed — pip install -r scripts/requirements.txt")
        return []

    start = (date.today() - timedelta(days=days)).isoformat()
    logger.info(f"  yfinance: {YF_TICKER} from {start}")

    try:
        frame = yf.download(
            YF_TICKER,
            start=start,
            progress=False,
            auto_adjust=False,
        )
    except Exception as e:
        logger.error(f"  yfinance download failed: {e}")
        return []

    if frame is None or frame.empty:
        logger.error("  yfinance returned an empty frame")
        return []

    # yfinance returns a MultiIndex on the columns when a single ticker is
    # passed as a string in newer versions. Flatten so ["Close"] works
    # regardless of which shape we got.
    if hasattr(frame.columns, "nlevels") and frame.columns.nlevels > 1:
        frame.columns = frame.columns.get_level_values(0)

    rows = []
    for idx, r in frame.iterrows():
        try:
            d = idx.date().isoformat()
        except AttributeError:
            d = str(idx)[:10]

        def val(key):
            v = r.get(key)
            if v is None:
                return None
            try:
                f = float(v)
            except (TypeError, ValueError):
                return None
            # yfinance emits NaN for holidays that slipped into the index
            return None if f != f else f

        close = val("Close")
        volume = val("Volume")
        # A row without close or volume can't participate in the calc.
        if close is None or volume is None:
            continue

        rows.append({
            "date":   d,
            "open":   val("Open"),
            "high":   val("High"),
            "low":    val("Low"),
            "close":  close,
            "volume": int(volume),
        })

    rows.sort(key=lambda x: x["date"])
    logger.info(f"  yfinance: {len(rows)} usable sessions")
    return rows


def write_rows(company_id: str, rows: list[dict]) -> int:
    """Upsert into price_data on (company_id, date). Returns rows written."""
    if not rows:
        return 0

    payload = []
    for i, r in enumerate(rows):
        prev_close = rows[i - 1]["close"] if i > 0 else None
        pct = None
        if prev_close and prev_close > 0:
            pct = round(((r["close"] - prev_close) / prev_close) * 100, 4)

        payload.append({
            "company_id":       company_id,
            "date":             r["date"],
            "open":             r["open"],
            "high":             r["high"],
            "low":              r["low"],
            "close":            r["close"],
            "volume":           r["volume"],
            "prev_close":       prev_close,
            "price_change_1d":  pct,
            # is_latest is owned by the daily pipeline's repair step.
            # Backfilled history is explicitly NOT latest; the newest row
            # gets flipped below only if nothing newer already holds it.
            "is_latest":        False,
            "data_source":      "yfinance_backfill",
        })

    written = 0
    CHUNK = 200
    for i in range(0, len(payload), CHUNK):
        chunk = payload[i:i + CHUNK]
        try:
            supabase.table("price_data").upsert(
                chunk, on_conflict="company_id,date"
            ).execute()
            written += len(chunk)
            logger.info(f"  wrote {written}/{len(payload)}")
        except Exception as e:
            logger.error(f"  chunk {i}-{i + len(chunk)} failed: {e}")

    return written


def main() -> int:
    days = DEFAULT_DAYS
    if "--days" in sys.argv:
        try:
            days = int(sys.argv[sys.argv.index("--days") + 1])
        except (IndexError, ValueError):
            logger.warning(f"--days needs an integer; using {DEFAULT_DAYS}")

    logger.info(f"backfill_niftybees — {days} calendar days of {SYMBOL}")

    company_id = ensure_company()
    if not company_id:
        return 1

    rows = fetch_history(days)
    if not rows:
        logger.error("No history fetched — aborting before write.")
        return 1

    written = write_rows(company_id, rows)
    if written == 0:
        logger.error("Nothing written.")
        return 1

    logger.info(
        f"DONE — {written} sessions for {SYMBOL} "
        f"({rows[0]['date']} .. {rows[-1]['date']})"
    )
    logger.info("The Distribution Days card can now compute a real count.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
