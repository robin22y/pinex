"""Probe NSE public JSON endpoints for corporate announcements / board meetings.

Standalone discovery script — no DB writes. Prints status, record counts and a
sample record per endpoint so we can confirm shapes before wiring an importer.

Run:
  python scripts/check_nse_board_meetings.py
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.nseindia.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def _date_window(days_back: int = 30) -> tuple[str, str]:
    """Return (from, to) as DD-MM-YYYY strings, NSE's expected format."""
    today = date.today()
    start = today - timedelta(days=days_back)
    fmt = "%d-%m-%Y"
    return start.strftime(fmt), today.strftime(fmt)


_from, _to = _date_window(30)

# Public NSE endpoints used by their own website. They require a prior visit to
# the homepage so the session picks up nseappid/nsit cookies.
URLS = [
    "https://www.nseindia.com/api/corporate-announcements?index=equities",
    # /api/board-meetings 404s; /api/upcoming-events is the live path that
    # surfaces scheduled board meetings + AGMs.
    "https://www.nseindia.com/api/upcoming-events?index=equities",
    "https://www.nseindia.com/api/corporates-financial-results?index=equities",
    (
        "https://www.nseindia.com/api/corporates-financial-results"
        f"?index=equities&from_date={_from}&to_date={_to}&period=Quarterly"
    ),
]


def main() -> None:
    session = requests.Session()
    session.headers.update(HEADERS)

    # Prime cookies — NSE rejects API calls without a homepage visit first.
    session.get("https://www.nseindia.com", timeout=15)

    for url in URLS:
        try:
            r = session.get(url, timeout=15)
        except requests.RequestException as exc:
            print(f"ERR - {url}\n  {exc}\n")
            continue

        print(f"{r.status_code} - {url}")
        if r.status_code != 200:
            preview = (r.text or "").strip().replace("\n", " ")[:200]
            if preview:
                print(f"  Body: {preview}")
            print()
            continue

        try:
            data = r.json()
        except ValueError:
            preview = (r.text or "").strip()[:200]
            print(f"  Non-JSON body: {preview}")
            print()
            continue

        if isinstance(data, list):
            print(f"  Records: {len(data)}")
            if data:
                print(f"  Sample: {json.dumps(data[0], indent=2)[:400]}")
        elif isinstance(data, dict):
            print(f"  Keys: {list(data.keys())}")
            # Some NSE endpoints wrap the list under a key like 'data' or 'rows'.
            for key in ("data", "rows", "result"):
                inner = data.get(key)
                if isinstance(inner, list):
                    print(f"  {key}: {len(inner)} records")
                    if inner:
                        print(f"  Sample: {json.dumps(inner[0], indent=2)[:400]}")
                    break
        print()


if __name__ == "__main__":
    main()
