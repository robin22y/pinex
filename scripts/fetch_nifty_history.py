"""Fetch 5 years of Nifty 50 daily closes from yfinance into nifty_history.

Used as the Nifty time series for the Mansfield RS computation in
scripts/compute_mansfield_rs.py. The NSE bhav copy does not include
indices, so yfinance (^NSEI) is the data source here.

This script is idempotent: re-running upserts on the date PK so
existing rows get refreshed with the latest yfinance value. It
covers 5 years by default; pass --period=2y / 3y / max etc. if you
want a different window.

Usage:
  python scripts/fetch_nifty_history.py
  python scripts/fetch_nifty_history.py --period=10y
  python scripts/fetch_nifty_history.py --dry-run
"""
from __future__ import annotations
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

from db import bulk_upsert, log_event, supabase  # noqa: E402

PERIOD = "5y"
DRY_RUN = "--dry-run" in sys.argv
for arg in sys.argv[1:]:
    if arg.startswith("--period="):
        PERIOD = arg.split("=", 1)[1]


def main() -> int:
    print(f"Fetching Nifty 50 history from yfinance · period={PERIOD}")
    if DRY_RUN:
        print("DRY RUN — no DB writes")

    ticker = yf.Ticker("^NSEI")
    hist = ticker.history(period=PERIOD)

    if hist is None or hist.empty or "Close" not in hist.columns:
        print("ERROR: yfinance returned no data for ^NSEI")
        log_event("fetch_nifty_history_failed", {"period": PERIOD, "reason": "empty_yf_response"})
        return 1

    # Normalise the index to date-only strings (yfinance returns
    # timezone-aware datetimes; we want plain dates for the PK).
    idx = pd.DatetimeIndex(hist.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    hist = hist.copy()
    hist.index = idx.normalize()
    closes = hist["Close"].dropna()

    rows = []
    for ts, value in closes.items():
        rows.append({
            "date": ts.date().isoformat(),
            "close": float(value),
            "updated_at": datetime.utcnow().isoformat(),
        })

    print(
        f"Parsed {len(rows)} daily rows "
        f"({rows[0]['date']} -> {rows[-1]['date']})"
    )
    print(f"Latest Nifty close: {rows[-1]['close']:.2f}")

    if DRY_RUN:
        print("(dry run — skipping upsert)")
        return 0

    written = bulk_upsert("nifty_history", rows, "date")
    print(f"Upserted {written} rows into nifty_history")

    log_event("fetch_nifty_history_finished", {
        "period": PERIOD,
        "rows_written": written,
        "from_date": rows[0]["date"],
        "to_date": rows[-1]["date"],
        "latest_close": rows[-1]["close"],
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
