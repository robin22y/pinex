"""Fetch NSE's official 52-week-high / 52-week-low counts for today.

CANONICAL SOURCE
  https://www.nseindia.com/api/live-analysis-52weekhighstock
  Returns a tiny JSON object: {"high": <int>, "low": <int>}.
  No arrays, no per-stock detail — just the two counts NSE displays
  on the "52-Week High / Low" market-data page. Server-rendered live,
  so calling it during market hours returns the running count;
  calling it after close returns the EOD figure.

  CONFIRMED PRIMARY BY ROBIN (19 Jun 2026):
    "this is the correct link to get 52 week high and low numbers"

  FALLBACK PAIR (only used if the primary fails):
    /api/live-analysis-data-52weekhighstock  -> {"high": int, "data": [N rows]}
    /api/live-analysis-data-52weeklowstock   -> {"low":  int, "data": [N rows]}
    These are NSE's newer split endpoints. Useful as a backup because
    each one cross-verifies its count against len(data), so a silent-
    zero can be caught without trusting the bare number. Wired in
    after the 19 Jun broadcast shipped (0, 2) when reality was
    (126, 44) — defense in depth against a flaky primary.

  HARD RULE for any of the three sources: reject (0, 0). On any real
  trading day at least one side is non-zero; dual-zero means the
  endpoint is degraded and the count is wrong.

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
# PRIMARY — combined endpoint, returns {"high": int, "low": int} in
# one round trip. Robin confirmed this as the canonical source.
NSE_52W_COMBINED_URL = "https://www.nseindia.com/api/live-analysis-52weekhighstock"
# FALLBACK — split endpoints, each returns its count plus a per-stock
# detail array of the same length. Used only when the combined call
# fails or returns silent (0, 0). The cross-verification (count ==
# len(data) ±1) catches degraded responses the bare count can't.
NSE_52W_HIGHS_URL = "https://www.nseindia.com/api/live-analysis-data-52weekhighstock"
NSE_52W_LOWS_URL  = "https://www.nseindia.com/api/live-analysis-data-52weeklowstock"
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
    """Fetch (high, low) from NSE.

    PRIMARY — combined endpoint (one round trip):
      /api/live-analysis-52weekhighstock -> {"high": int, "low": int}

    FALLBACK — split endpoints, each cross-verified by len(data):
      /api/live-analysis-data-52weekhighstock -> {"high": int, "data": [N rows]}
      /api/live-analysis-data-52weeklowstock  -> {"low":  int, "data": [N rows]}

    The fallback only fires when the primary failed (network /
    parse / silent-zero). Both paths reject (0, 0): on any real
    trading day at least one side is non-zero.

    Returns (None, None) on total failure so the caller can abort.
    Never raises.
    """
    session = _nse_session()

    # ── Primary: combined endpoint ───────────────────────────────
    try:
        response = session.get(
            NSE_52W_COMBINED_URL,
            headers={**HEADERS_BASE, "Referer": NSE_52W_PAGE},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        c_high = payload.get("high")
        c_low  = payload.get("low")
        if (
            isinstance(c_high, int) and isinstance(c_low, int)
            and not (c_high == 0 and c_low == 0)
        ):
            logger.info(
                f"  NSE 52W combined: highs={c_high} lows={c_low} "
                f"({NSE_52W_COMBINED_URL})"
            )
            return c_high, c_low
        # (0, 0) or non-int -> log + fall through to split fallback.
        if c_high == 0 and c_low == 0:
            logger.warning(
                f"  NSE 52W combined: returned (0, 0) silent-zero "
                f"({NSE_52W_COMBINED_URL}). Falling through to split endpoints."
            )
        else:
            logger.warning(
                f"  NSE 52W combined: unusable payload high={c_high!r} "
                f"low={c_low!r}. Falling through to split endpoints."
            )
    except Exception as e:
        logger.warning(
            f"  NSE 52W combined: failed ({e}). Falling through to split endpoints."
        )

    # ── Fallback: split endpoints with cross-verified counts ─────
    high = _fetch_split_count(session, NSE_52W_HIGHS_URL, "high")
    low  = _fetch_split_count(session, NSE_52W_LOWS_URL,  "low")
    if high is not None and low is not None:
        return high, low

    logger.error(
        f"  NSE 52W: ALL endpoints failed. "
        f"split_high={high} split_low={low}"
    )
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
