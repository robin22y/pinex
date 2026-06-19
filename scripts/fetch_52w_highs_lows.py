"""Fetch NSE's official 52-week-high / 52-week-low counts for today.

CANONICAL SOURCE
  https://www.nseindia.com/api/live-analysis-52weekhighstock
  Returns a tiny JSON object: {"high": <int>, "low": <int>}.
  No arrays, no per-stock detail — just the two counts NSE displays
  on the "52-Week High / Low" market-data page. Server-rendered live,
  so calling it during market hours returns the running count;
  calling it after close returns the EOD figure.

WHY THIS REPLACED THE ROLLING-MAX CALC
  Two days running (16-17 Jun 2026), the home-grown
  recompute_52w_highs_lows_from_history() in calc_market_internals.py
  was timing out (Supabase 30 s statement cap on ~530k row pulls) and
  silently falling through to the high_52w snapshot column — which
  had gone stale and produced new_52w_highs=3 on a day NSE counted
  132. Calling NSE directly: one HTTP request, ~200 ms, exact match
  with what users see on nseindia.com.

PUBLIC API
  fetch_52w_counts() -> tuple[int, int] | tuple[None, None]
      Library entry point. Used by calc_market_internals.py as its
      primary 52W source. Returns (None, None) on any failure so
      callers can fall through to a recompute path.

CLI
  python fetch_52w_highs_lows.py
      Prints the counts. If invoked with --update, UPDATEs
      market_internals for today's row in place.

PIPELINE WIRING
  calc_market_internals.py imports fetch_52w_counts() and calls it
  before the MW52 CSV / on-the-fly fallbacks. Running this script
  standalone is therefore optional — the inline call is the
  production path. Standalone mode exists for manual recovery
  (e.g. fixing yesterday's row in place).
"""
from __future__ import annotations

import os
import sys
import time
from datetime import date

import requests
from dotenv import load_dotenv
from loguru import logger

# Endpoint URLs and headers
NSE_HOMEPAGE = "https://www.nseindia.com"
NSE_52W_API = "https://www.nseindia.com/api/live-analysis-52weekhighstock"
NSE_52W_PAGE = "https://www.nseindia.com/market-data/52-week-high-equity-market"

# NSE's bot defence pattern: rejects requests that don't come from a
# browser-shaped session. The two things they enforce:
#   1) A homepage GET first so the session has the relevant cookies.
#   2) A User-Agent string that matches a real browser.
# The Mozilla/5.0 + Chrome string is what NSE's own docs recommend.
HEADERS_BASE = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "application/json, text/plain, */*",
}


def _nse_session() -> requests.Session:
    """Set up a requests.Session with NSE cookies. The homepage GET +
    short sleep is essential — going straight to /api/* on a cold
    session returns 401."""
    session = requests.Session()
    try:
        session.get(NSE_HOMEPAGE, headers=HEADERS_BASE, timeout=10)
    except Exception as e:
        logger.warning(f"  NSE homepage warm-up failed: {e}")
    # Cookies need a beat to settle before the api/* call.
    time.sleep(2)
    return session


def fetch_52w_counts() -> tuple[int, int] | tuple[None, None]:
    """Fetch (high, low) from NSE's live-analysis endpoint.

    Returns (None, None) on any failure so the caller can fall through
    to a recompute path. Never raises.

    Response shape (verified 18 Jun 2026):
      {"high": 132, "low": 24}

    The endpoint returns counts only — no per-stock arrays. For
    per-stock high_52w / low_52w updates use the MW52 CSV helpers in
    fetch_bhav_daily.py.
    """
    session = _nse_session()
    try:
        response = session.get(
            NSE_52W_API,
            headers={**HEADERS_BASE, "Referer": NSE_52W_PAGE},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as e:
        logger.warning(f"  NSE 52W API failed: {e}")
        return None, None

    high = payload.get("high")
    low = payload.get("low")
    if not isinstance(high, int) or not isinstance(low, int):
        logger.warning(
            f"  NSE 52W API returned non-int payload: high={high!r} low={low!r}"
        )
        return None, None
    return high, low


def _update_market_internals(high: int, low: int) -> bool:
    """UPDATE today's market_internals row with the NSE counts.
    Returns True on success, False otherwise. Caller-only — the
    inline path in calc_market_internals.py writes via its own upsert,
    so this is the standalone-CLI path for hand-fixing rows.
    """
    _script_dir = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_script_dir, ".env"))
    load_dotenv(os.path.join(_script_dir, os.pardir, ".env"))
    try:
        from supabase import create_client
    except ImportError:
        logger.error("supabase-py not installed; cannot UPDATE.")
        return False

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        logger.error("SUPABASE_URL or SUPABASE_SERVICE_KEY missing from env.")
        return False

    sb = create_client(url, key)
    today_iso = date.today().isoformat()
    try:
        res = (
            sb.table("market_internals")
            .update({
                "new_52w_highs": int(high),
                "new_52w_lows": int(low),
                "highs_minus_lows": int(high) - int(low),
            })
            .eq("date", today_iso)
            .execute()
        )
    except Exception as e:
        logger.error(f"market_internals UPDATE failed: {e}")
        return False
    affected = len(getattr(res, "data", []) or [])
    if affected == 0:
        logger.warning(
            f"market_internals: no row for {today_iso} (calc_market_internals "
            f"hasn't run today). Counts NOT written; re-run after the calc step."
        )
        return False
    logger.info(
        f"market_internals[{today_iso}] updated: "
        f"new_52w_highs={high} new_52w_lows={low} highs_minus_lows={high - low}"
    )
    return True


def main() -> int:
    high, low = fetch_52w_counts()
    if high is None or low is None:
        logger.error("NSE 52W fetch failed — see warnings above.")
        return 1
    # Reject NSE's silent-zero failure mode. On any real trading day at
    # least one side is non-zero; (0, 0) means the endpoint is degraded
    # and we should NOT overwrite the market_internals row with bogus
    # zeros (which would then mask the failure downstream).
    if high == 0 and low == 0:
        logger.error(
            "NSE 52W returned (0, 0) — degraded API response, refusing to "
            "write. Re-run later when NSE recovers."
        )
        return 1
    logger.info(f"NSE 52W counts: highs={high} lows={low}")
    if "--update" in sys.argv:
        if not _update_market_internals(high, low):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
