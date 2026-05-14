"""Probe BSE public JSON endpoints for corporate announcements / board meetings.

Standalone discovery script - no DB writes. BSE's API is friendlier than NSE's:
no cookie priming required, basic User-Agent is enough.

Run:
  python scripts/check_bse_announcements.py
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import requests

HEADERS = {
    # BSE's edge serves the marketing homepage HTML (with status 200) to any
    # request whose User-Agent / headers look non-browser. A real Chrome UA
    # plus Origin + deep Referer is enough to make it return JSON.
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/corporates/ann.html",
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
}

TODAY = date.today().strftime("%Y%m%d")
WEEK_AGO = (date.today() - timedelta(days=7)).strftime("%Y%m%d")

URLS = [
    # Generic announcements feed (strType=C = company announcements).
    (
        "https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w"
        f"?strCat=-1&strPrevDate={WEEK_AGO}&strScrip=&strSearch=P"
        f"&strToDate={TODAY}&strType=C&subcategory=-1"
    ),
    # Forthcoming board meetings.
    "https://api.bseindia.com/BseIndiaAPI/api/BoardMeetings/w",
    # Result calendar (scheduled financial results).
    (
        "https://api.bseindia.com/BseIndiaAPI/api/ResultCalendar/w"
        f"?fromDate={WEEK_AGO}&toDate={TODAY}"
    ),
]


def _print_payload(data: object) -> None:
    if isinstance(data, list):
        print(f"  {len(data)} records")
        if data:
            print(f"  Sample: {json.dumps(data[0])[:400]}")
        return
    if isinstance(data, dict):
        # Top-level keys help identify wrappers like {'Table': [...]} or
        # {'Table1': [...], 'Table2': [...]}.
        print(f"  Keys: {list(data.keys())}")
        for k, v in data.items():
            if isinstance(v, list):
                print(f"  {k}: {len(v)} records")
                if v:
                    print(f"    Sample: {json.dumps(v[0])[:400]}")


def main() -> None:
    for url in URLS:
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
        except requests.RequestException as exc:
            print(f"ERR - {url[:80]}\n  {exc}\n")
            continue

        print(f"{r.status_code} - {url[:80]}")
        if r.status_code != 200:
            preview = (r.text or "").strip().replace("\n", " ")[:200]
            if preview:
                print(f"  Body: {preview}")
            print()
            continue

        try:
            _print_payload(r.json())
        except ValueError:
            print(f"  Raw: {r.text[:200]}")
        print()


if __name__ == "__main__":
    main()
