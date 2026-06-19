"""Fetch NSE's official 52-week-high / 52-week-low counts for today.

CANONICAL SOURCE
  https://www.nseindia.com/api/live-analysis-data-52weekhighstock
  Returns a tiny JSON object with the running 52W high + low counts
  NSE displays on the "52-Week High / Low" market-data page.
  Server-rendered live, so calling it during market hours returns the
  running count; calling it after close returns the EOD figure.

  ENDPOINT MIGRATION HISTORY
    The original path was /api/live-analysis-52weekhighstock (no
    `-data-`). NSE silently moved it to .../live-analysis-data-... in
    mid-2026 and started returning {"high": 0, "low": 0} or 404 on
    the old path. That was the root cause of the 19 Jun 2026 wrong
    broadcast (0 highs / 2 lows shipped when reality was 126 / 44).
    We now hit the new path and keep the old path as a fallback in
    case NSE swaps back.

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
# Primary strategy: hit NSE's two SPLIT endpoints (highs + lows
# separately). Each returns `{"<count>": int, "data": [...detail...]}`
# where len(data) == count, giving us a cross-verifiable count.
#
# Verified live 19 Jun 2026 16:00 IST:
#   /api/live-analysis-data-52weekhighstock -> {"high": 126, "data": [126 rows]}
#   /api/live-analysis-data-52weeklowstock  -> {"low":   44, "data": [44 rows]}
NSE_52W_HIGHS_URL = "https://www.nseindia.com/api/live-analysis-data-52weekhighstock"
NSE_52W_LOWS_URL  = "https://www.nseindia.com/api/live-analysis-data-52weeklowstock"
# Fallback: the legacy combined endpoint. Still live but periodically
# returns `{"high": 0, "low": 0}` (the silent-zero failure mode that
# shipped the 19 Jun 2026 wrong broadcast). We try it last and only
# trust it when the split endpoints both fail.
NSE_52W_LEGACY_URL = "https://www.nseindia.com/api/live-analysis-52weekhighstock"
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


def _fetch_split_count(
    session: requests.Session,
    url: str,
    key: str,
) -> int | None:
    """Hit one of the NSE split endpoints (highs OR lows) and return
    the count. `key` is "high" or "low" — also used to cross-check
    len(data) which should equal payload[key].

    Returns None on any failure (network, JSON, shape mismatch, or
    a count of 0 — NSE's silent-zero failure mode). Never raises."""
    try:
        response = session.get(
            url,
            headers={**HEADERS_BASE, "Referer": NSE_52W_PAGE},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as e:
        logger.warning(f"  NSE 52W {key} fetch failed: {url} ({e})")
        return None

    if not isinstance(payload, dict):
        logger.warning(
            f"  NSE 52W {key} ({url}): payload not a dict "
            f"(type={type(payload).__name__})"
        )
        return None

    count = payload.get(key)
    data = payload.get("data")
    data_len = len(data) if isinstance(data, list) else None

    if not isinstance(count, int):
        logger.warning(
            f"  NSE 52W {key} ({url}): no int '{key}' field. "
            f"Top-level keys: {sorted(payload.keys())}, "
            f"data_len={data_len}"
        )
        return None

    # Cross-verify with the detail array length. NSE has shown this
    # always matches — a mismatch would indicate a parser bug on
    # their end or a malformed response, both reasons to distrust
    # the number. Tolerate ±1 in case of edge cases around the open/
    # close transition.
    if data_len is not None and abs(count - data_len) > 1:
        logger.warning(
            f"  NSE 52W {key} ({url}): count={count} but data_len={data_len} "
            f"(>1 mismatch). Refusing to trust the count."
        )
        return None

    if count == 0:
        logger.warning(
            f"  NSE 52W {key} ({url}): returned 0 — likely silent-zero "
            f"failure mode (degraded endpoint). Treating as unavailable."
        )
        return None

    logger.info(
        f"  NSE 52W {key}: {count} (verified by data_len={data_len}, {url})"
    )
    return count


def fetch_52w_counts() -> tuple[int, int] | tuple[None, None]:
    """Fetch (high, low) from NSE's live-analysis split endpoints.

    Hits the two NEW `-data-` endpoints in parallel-ish (single
    session, sequential calls — async would need refactoring the
    caller, not worth it for 2 requests):
      highs: /api/live-analysis-data-52weekhighstock
      lows:  /api/live-analysis-data-52weeklowstock
    Each returns its count + a detail array; we cross-verify
    count == len(data) before trusting the number.

    If EITHER split endpoint fails, falls through to the legacy
    combined endpoint as a last resort.

    Returns (None, None) on total failure so the caller can abort.
    Never raises.
    """
    session = _nse_session()

    high = _fetch_split_count(session, NSE_52W_HIGHS_URL, "high")
    low  = _fetch_split_count(session, NSE_52W_LOWS_URL,  "low")

    if high is not None and low is not None:
        return high, low

    # ── Fallback: legacy combined endpoint ────────────────────────
    # Old `{"high": int, "low": int}` shape. Still live but known to
    # return (0, 0) under load — accept it only if both halves are
    # non-zero, otherwise we'd just be silently propagating the bug
    # the split endpoints were meant to fix.
    logger.warning(
        f"  NSE 52W: split endpoints incomplete (high={high} low={low}); "
        f"trying legacy combined URL as last resort."
    )
    try:
        response = session.get(
            NSE_52W_LEGACY_URL,
            headers={**HEADERS_BASE, "Referer": NSE_52W_PAGE},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        leg_h = payload.get("high")
        leg_l = payload.get("low")
        if (
            isinstance(leg_h, int) and isinstance(leg_l, int)
            and not (leg_h == 0 and leg_l == 0)
        ):
            logger.info(
                f"  NSE 52W legacy: highs={leg_h} lows={leg_l} ({NSE_52W_LEGACY_URL})"
            )
            return leg_h, leg_l
        logger.warning(
            f"  NSE 52W legacy: unusable payload high={leg_h!r} low={leg_l!r}"
        )
    except Exception as e:
        logger.warning(f"  NSE 52W legacy: failed ({e})")

    logger.error("  NSE 52W: all endpoints failed.")
    return None, None


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
