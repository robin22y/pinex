"""
fetch_nifty_sectors.py
Fetches NSE sector index data from yfinance daily.
"""

import os
import sys
from datetime import date, timedelta
import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"]
)

TODAY = date.today().isoformat()

# NSE sector indices (.NS suffix for indices that omit valid ^CNX Yahoo symbols)
SECTOR_INDICES = {
    "^NSEBANK":              "Nifty Bank",
    "^CNXIT":                "Nifty IT",
    "^CNXPHARMA":            "Nifty Pharma",
    "^CNXAUTO":              "Nifty Auto",
    "^CNXFMCG":              "Nifty FMCG",
    "^CNXMETAL":             "Nifty Metal",
    "^CNXREALTY":            "Nifty Realty",
    "^CNXENERGY":            "Nifty Energy",
    "^CNXINFRA":             "Nifty Infra",
    "^CNXMEDIA":             "Nifty Media",
    "^CNXPSUBANK":           "Nifty PSU Bank",
    "^NSEI":                 "Nifty 50",
    "NIFTY_FIN_SERVICE.NS":  "Nifty Financial Services",
    "NIFTY_CONSR_DURBL.NS":  "Nifty Consumer Durables",
    "NIFTY_OIL_AND_GAS.NS":  "Nifty Oil & Gas",
    "NIFTY_PVT_BANK.NS":     "Nifty Private Bank",
}

def pct_change(series, days):
    """Calculate % change over N trading days."""
    try:
        if len(series) > days:
            now = float(series.iloc[-1])
            old = float(series.iloc[-(days+1)])
            if old > 0:
                return round((now - old) / old * 100, 2)
    except Exception:
        pass
    return None


def moving_average(close, window):
    """Return rounded N-day moving average of the most recent day, or None if
    insufficient history."""
    try:
        if len(close) < window:
            return None
        return round(float(close.tail(window).mean()), 2)
    except Exception:
        return None


def _nf_change_1d(v):
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _changes_for_index_streaks(index_name: str, today_c1d: float | None) -> list[float]:
    """Prior trading days from DB (newest first), then prepend today's 1D change.

    Excludes any row dated ``TODAY`` so a same-day re-run does not double-count.
    """
    try:
        res = (
            supabase.table("nifty_sectors")
            .select("date,change_1d")
            .eq("index_name", index_name)
            .lt("date", TODAY)
            .order("date", desc=True)
            .limit(6)
            .execute()
        )
        hist = res.data or []
    except Exception:
        hist = []

    out: list[float] = []
    if today_c1d is not None:
        out.append(float(today_c1d))
    for r in hist:
        x = _nf_change_1d(r.get("change_1d"))
        if x is not None:
            out.append(x)
        if len(out) >= 6:
            break
    return out


def sector_trend_from_daily_streaks(up: int, down: int, change_1w: float | None) -> str:
    """Short sector index regime label (stored in ``trend_signal``)."""
    w = change_1w if change_1w is not None else 0.0
    if up >= 3 and w > 2:
        return "Strong"
    if up >= 3:
        return "Recovering"
    if up == 2 and w > 0:
        return "Bouncing"
    if down >= 3 and w < -2:
        return "Weak"
    if down >= 3:
        return "Under Pressure"
    if down == 2 and w < 0:
        return "Fading"
    return "Neutral"


def classify_sector_stage(change_1m, change_3m,
                           pct_from_52w_high):
    """Simple stage for sector index."""
    if change_1m is None or change_3m is None:
        return "Unknown"
    if change_1m > 2 and change_3m > 5:
        return "Stage 2"
    if change_1m < -2 and change_3m < -5:
        return "Stage 4"
    if abs(change_1m) < 3 and pct_from_52w_high < -10:
        return "Stage 1"
    if change_1m < 0 and change_3m > 0:
        return "Stage 3"
    return "Stage 1"

def main():
    print(f"\nFetching Nifty sector indices — {TODAY}")
    success = 0
    failed = 0

    for symbol, name in SECTOR_INDICES.items():
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="2y")

            if hist.empty:
                print(f"  [{name}] no data")
                failed += 1
                continue

            close = hist["Close"]
            current = float(close.iloc[-1])
            high_52w = float(close.tail(252).max())
            low_52w = float(close.tail(252).min())
            pct_from_high = round(
                (current - high_52w) / high_52w * 100, 2)
            pct_from_low = round(
                (current - low_52w) / low_52w * 100, 2)

            c1d = pct_change(close, 1)
            c3d = pct_change(close, 3)
            c1w = pct_change(close, 5)
            c1m = pct_change(close, 21)
            c3m = pct_change(close, 63)
            c6m = pct_change(close, 126)
            c1y = pct_change(close, 252)

            changes = _changes_for_index_streaks(name, c1d)

            consec_up = 0
            for c in changes:
                if c > 0:
                    consec_up += 1
                else:
                    break

            consec_down = 0
            for c in changes:
                if c < 0:
                    consec_down += 1
                else:
                    break

            change_3d_hist = round(sum(changes[:3]), 2) if len(changes) >= 3 else None
            change_3d = change_3d_hist if change_3d_hist is not None else c3d

            ma20 = moving_average(close, 20)
            ma50 = moving_average(close, 50)
            tsig = sector_trend_from_daily_streaks(consec_up, consec_down, c1w)

            stage = classify_sector_stage(
                c1m, c3m, pct_from_high)

            payload = {
                "date": TODAY,
                "index_name": name,
                "display_name": name,
                "yf_symbol": symbol,
                "current_value": round(current, 2),
                "change_1d": c1d,
                "change_3d": change_3d,
                "change_1w": c1w,
                "change_1m": c1m,
                "change_3m": c3m,
                "change_6m": c6m,
                "change_1y": c1y,
                "high_52w": round(high_52w, 2),
                "low_52w": round(low_52w, 2),
                "pct_from_52w_high": pct_from_high,
                "pct_from_52w_low": pct_from_low,
                "consecutive_up": consec_up,
                "consecutive_down": consec_down,
                "ma20": ma20,
                "ma50": ma50,
                "stage": stage,
                "trend_signal": tsig,
            }

            supabase.table("nifty_sectors")\
                .upsert(payload, on_conflict="index_name,date")\
                .execute()

            c1d_str = f"{c1d:+.1f}%" if c1d is not None else "N/A"
            c1w_str = f"{c1w:+.1f}%" if c1w is not None else "N/A"
            c1m_str = f"{c1m:+.1f}%" if c1m is not None else "N/A"
            print(f"  ✅ {name:<30} "
                  f"{current:>8.0f}  "
                  f"1D: {c1d_str}  "
                  f"1W: {c1w_str}  "
                  f"1M: {c1m_str}  "
                  f"{stage:<8}  "
                  f"{tsig}")
            success += 1

        except Exception as e:
            print(f"  ❌ {name}: {e}")
            failed += 1

    print(f"\nDone. success={success} failed={failed}")

if __name__ == "__main__":
    main()