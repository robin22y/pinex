"""Probe BSE AnnGetData/w to inspect subjects and test category filtering.

Two passes:
  1. Last 7 days, all categories - print every NEWSSUB to spot keyword patterns
     we'll use for classification.
  2. Last 30 days, strCat=Result - confirm category-based filtering works for
     earnings announcements.

Run:
  python scripts/check_bse4.py
"""

from __future__ import annotations

from datetime import date, timedelta

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    # Deep Referer is load-bearing - BSE's edge serves the homepage HTML
    # shell to any request whose Referer isn't a page that would legitimately
    # host this API call.
    "Referer": "https://www.bseindia.com/corporates/ann.html",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.bseindia.com",
}

TODAY = date.today().strftime("%Y%m%d")
WEEK_AGO = (date.today() - timedelta(days=7)).strftime("%Y%m%d")
MONTH_AGO = (date.today() - timedelta(days=30)).strftime("%Y%m%d")


def _build_url(cat: str, prev_date: str, to_date: str) -> str:
    return (
        "https://api.bseindia.com/BseIndiaAPI"
        f"/api/AnnGetData/w?strCat={cat}"
        f"&strPrevDate={prev_date}"
        "&strScrip=&strSearch=P"
        f"&strToDate={to_date}"
        "&strType=C&subcategory=-1"
    )


def _fetch(url: str) -> tuple[list[dict], int, int]:
    r = requests.get(url, headers=HEADERS, timeout=15)
    if r.status_code != 200:
        return [], 0, r.status_code
    data = r.json()
    records = data.get("Table") or []
    table1 = data.get("Table1") or [{}]
    total = (table1[0] if table1 else {}).get("ROWCNT", 0)
    return records, int(total or 0), r.status_code


def main() -> None:
    # Pass 1: all categories over last 7 days
    records, total, _ = _fetch(_build_url("-1", WEEK_AGO, TODAY))
    print(f"Total in DB (7d, all cats): {total}")
    print(f"Returned: {len(records)}\n")

    print("ALL SUBJECTS (page 1):")
    for rec in records:
        subj = (rec.get("NEWSSUB") or "")[:90]
        scrip = rec.get("SCRIP_CD", "")
        cat = (rec.get("CATEGORYNAME") or rec.get("AnnCategory") or "").strip()
        cat_label = f"[{cat}]" if cat else ""
        print(f"  {scrip}: {cat_label} {subj}")

    # Pass 2: Result-category filter over last 30 days
    print("\nCHECKING FOR RESULTS IN LAST 30 DAYS (strCat=Result):")
    recs2, total2, status2 = _fetch(_build_url("Result", MONTH_AGO, TODAY))
    if status2 != 200:
        print(f"  HTTP {status2}")
        return
    print(f"Results category: {total2} total, {len(recs2)} returned")
    for rec in recs2[:10]:
        print(f"  {rec.get('SCRIP_CD')}: {(rec.get('NEWSSUB') or '')[:70]}")


if __name__ == "__main__":
    main()
