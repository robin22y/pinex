"""
fetch_vix.py
Fetches India VIX from NSE and updates
market_internals table.

NSE publishes VIX daily in the bhav copy.
URL: https://nsearchives.nseindia.com/
     content/indices/hist_ind_VIX_dd-mm-yyyy.csv

Usage:
  python fetch_vix.py
  python fetch_vix.py --days=30
"""

from __future__ import annotations

import io
import sys
import time
from datetime import date, timedelta

import pandas as pd
import requests

from db import supabase
from nse_holidays import NSE_HOLIDAYS_2026

DAYS = next(
    (int(a.split("=")[1]) for a in sys.argv if a.startswith("--days=")),
    1,
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 PineX/1.0",
    "Referer": "https://www.nseindia.com",
}


def get_trading_days(n: int) -> list[date]:
    days: list[date] = []
    d = date.today()
    while len(days) < n:
        if d.weekday() < 5 and d.isoformat() not in NSE_HOLIDAYS_2026:
            days.append(d)
        d -= timedelta(days=1)
    return days


def fetch_vix_for_date(dt: date) -> float | None:
    """Try multiple URL patterns for VIX."""
    ddmmyyyy = dt.strftime("%d-%m-%Y")

    urls = [
        "https://nsearchives.nseindia.com"
        f"/content/indices/hist_ind_VIX_{ddmmyyyy}.csv",
        "https://www1.nseindia.com"
        f"/content/indices/hist_ind_VIX_{ddmmyyyy}.csv",
    ]

    for url in urls:
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code != 200:
                continue
            df = pd.read_csv(io.StringIO(r.text))
            df.columns = [c.strip() for c in df.columns]
            close_col = next(
                (c for c in df.columns if "close" in c.lower()),
                None,
            )
            if close_col and len(df) > 0:
                return float(df[close_col].iloc[-1])
        except Exception:
            continue
    return None


def main() -> None:
    print(f"Fetching VIX for last {DAYS} days...")

    days = get_trading_days(DAYS)
    updated = 0

    for dt in days:
        iso = dt.isoformat()
        print(f"  {iso}...", end=" ", flush=True)

        vix = fetch_vix_for_date(dt)

        if vix is not None:
            supabase.table("market_internals").upsert(
                {"date": iso, "india_vix": vix},
                on_conflict="date",
            ).execute()
            print(f"VIX={vix:.2f} ✅")
            updated += 1
        else:
            print("no data")

        time.sleep(0.5)

    print(f"\nUpdated {updated} days")


if __name__ == "__main__":
    main()
