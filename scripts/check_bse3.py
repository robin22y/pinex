"""Minimal-header probe for the BSE announcements endpoint.

Confirms the smallest header set that still gets JSON back (vs. the marketing
HTML shell BSE returns to weak-fingerprint requests).

Run:
  python scripts/check_bse3.py
"""

from __future__ import annotations

from datetime import date, timedelta

import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Variant A: minimal (matches user's snippet) - homepage Referer, no Sec-Fetch.
HEADERS_MINIMAL = {
    "User-Agent": UA,
    "Referer": "https://www.bseindia.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.bseindia.com",
}

# Variant B: minimal + deep Referer (announcements page path).
HEADERS_DEEP_REFERER = {
    **HEADERS_MINIMAL,
    "Referer": "https://www.bseindia.com/corporates/ann.html",
}

# Variant C: deep Referer + Sec-Fetch trio (full browser fingerprint).
HEADERS_FULL = {
    **HEADERS_DEEP_REFERER,
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
}

VARIANTS = [
    ("minimal (homepage Referer)", HEADERS_MINIMAL),
    ("deep Referer only", HEADERS_DEEP_REFERER),
    ("deep Referer + Sec-Fetch", HEADERS_FULL),
]

TODAY = date.today().strftime("%Y%m%d")
WEEK_AGO = (date.today() - timedelta(days=7)).strftime("%Y%m%d")

URL = (
    "https://api.bseindia.com/BseIndiaAPI"
    "/api/AnnGetData/w?strCat=-1"
    f"&strPrevDate={WEEK_AGO}"
    "&strScrip=&strSearch=P"
    f"&strToDate={TODAY}"
    "&strType=C&subcategory=-1"
)


def _classify(content_type: str | None, body: str) -> str:
    ct = (content_type or "").lower()
    if "json" in ct:
        return "JSON"
    if body.lstrip().startswith("<"):
        return "HTML shell"
    return "other"


def main() -> None:
    for label, headers in VARIANTS:
        r = requests.get(URL, headers=headers, timeout=15)
        verdict = _classify(r.headers.get("Content-Type"), r.text)
        print(
            f"[{label:30}] status={r.status_code} "
            f"ct={r.headers.get('Content-Type'):<24} "
            f"len={len(r.content):>6}  -> {verdict}"
        )
        if verdict == "JSON":
            print(f"  preview: {r.text[:180]}")


if __name__ == "__main__":
    main()
