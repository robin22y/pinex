"""Download and process NSE + BSE bhav copies for price and delivery.

Replaces fetch_price_data.py and fetch_delivery.py for the daily pipeline.

Usage:
  python fetch_bhav_daily.py
  python fetch_bhav_daily.py --force
  python fetch_bhav_daily.py --date 12052026
  python fetch_bhav_daily.py --test
  python fetch_bhav_daily.py --backfill --days=500
  python fetch_bhav_daily.py --backfill --days=5 --dry-run
"""

from __future__ import annotations

import io
import math
import sys
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv

from db import bulk_upsert, fetch_companies_paginated, log_event, supabase
from nse_holidays import NSE_HOLIDAYS_2026, is_nse_holiday

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

FORCE = "--force" in sys.argv
TEST = "--test" in sys.argv
BACKFILL = "--backfill" in sys.argv
DRY_RUN = "--dry-run" in sys.argv
TEST_SYMBOLS = {"SYRMA", "APTUS", "TEJASNET"}

HEADERS_NSE = {
    "User-Agent": "Mozilla/5.0 PineX/1.0",
    "Referer": "https://www.nseindia.com",
    "Accept-Language": "en-US,en;q=0.5",
}
HEADERS_BSE = {
    "User-Agent": "Mozilla/5.0 PineX/1.0",
    "Referer": "https://www.bseindia.com",
}


def _parse_date_arg() -> str | None:
    if "--date" in sys.argv:
        idx = sys.argv.index("--date")
        if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("-"):
            return sys.argv[idx + 1]
    for arg in sys.argv:
        if arg.startswith("--date="):
            return arg.split("=", 1)[-1]
    return None


def _parse_nse_file_arg() -> str | None:
    if "--nse-file" in sys.argv:
        idx = sys.argv.index("--nse-file")
        if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("-"):
            return sys.argv[idx + 1]
    for arg in sys.argv:
        if arg.startswith("--nse-file="):
            return arg.split("=", 1)[-1]
    return None


def _parse_days_arg(default: int = 500) -> int:
    """Read --days=N (or --days N) for the backfill loop. Defaults to 500."""
    for arg in sys.argv:
        if arg.startswith("--days="):
            try:
                return int(arg.split("=", 1)[-1])
            except ValueError:
                return default
    if "--days" in sys.argv:
        idx = sys.argv.index("--days")
        if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("-"):
            try:
                return int(sys.argv[idx + 1])
            except ValueError:
                return default
    return default


DATE_ARG = _parse_date_arg()
NSE_FILE_ARG = _parse_nse_file_arg()
DAYS_ARG = _parse_days_arg()


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        parsed = float(str(v).replace(",", "").strip())
        if math.isnan(parsed) or math.isinf(parsed):
            return None
        return parsed
    except (TypeError, ValueError):
        return None


def should_skip() -> str | None:
    if FORCE or TEST or DATE_ARG:
        return None
    today = date.today()
    if today.weekday() >= 5:
        return "Weekend — market closed"
    if today.isoformat() in NSE_HOLIDAYS_2026:
        return "NSE holiday — skipping"
    return None


def _previous_trading_day(start: date) -> date:
    cursor = start
    while cursor.weekday() >= 5 or cursor.isoformat() in NSE_HOLIDAYS_2026:
        cursor -= timedelta(days=1)
    return cursor


def get_date_str() -> tuple[str, str, str, str]:
    """Return (DDMMYYYY, ddmmyy, YYYYMMDD, ISO)."""
    if DATE_ARG:
        target = datetime.strptime(DATE_ARG, "%d%m%Y").date()
    else:
        target = _previous_trading_day(date.today())
    return (
        target.strftime("%d%m%Y"),
        target.strftime("%d%m%y"),
        target.strftime("%Y%m%d"),
        target.isoformat(),
    )


def _read_nse_bhav_csv(text_or_bytes, source_label: str) -> pd.DataFrame | None:
    """Parse NSE bhav CSV from text or bytes. Handles sec_bhavdata_full and SME/CM formats."""
    try:
        if isinstance(text_or_bytes, bytes):
            text_or_bytes = text_or_bytes.decode("utf-8", errors="ignore")
        frame = pd.read_csv(io.StringIO(text_or_bytes))
        frame.columns = [str(c).strip() for c in frame.columns]
        # Filter to EQ series when the column is present
        if "SERIES" in frame.columns:
            frame = frame[frame["SERIES"].astype(str).str.strip() == "EQ"].copy()
        if "SYMBOL" in frame.columns:
            frame["SYMBOL"] = frame["SYMBOL"].astype(str).str.strip()
        # Normalise alternate column names so parse_nse_bhav works on both formats
        renames = {}
        if "NET_TRDQTY" in frame.columns and "TTL_TRD_QNTY" not in frame.columns:
            renames["NET_TRDQTY"] = "TTL_TRD_QNTY"
        if "PREV_CL_PR" in frame.columns and "PREV_CLOSE" not in frame.columns:
            renames["PREV_CL_PR"] = "PREV_CLOSE"
        if renames:
            frame = frame.rename(columns=renames)
        print(f"  {source_label}: {len(frame)} EQ stocks")
        return frame if not frame.empty else None
    except Exception as exc:
        print(f"  {source_label} parse error: {exc}")
        return None


_UDIFF_RENAMES = {
    # UDiFF (new format) → internal names used by parse_nse_bhav
    "TckrSymb":       "SYMBOL",
    "SctySrs":        "SERIES",
    "OpnPric":        "OPEN_PRICE",
    "HghPric":        "HIGH_PRICE",
    "LwPric":         "LOW_PRICE",
    "ClsPric":        "CLOSE_PRICE",
    "PrvsClsgPric":   "PREV_CLOSE",
    "TtlTradgVol":    "TTL_TRD_QNTY",
    "TtlNbOfTxsExctd": "NO_OF_TRADES",
    "52WkHigh":       "HI_52_WK",
    "52WkLow":        "LO_52_WK",
    "ISIN":           "ISIN",
}


def _parse_udiff_zip(content: bytes, label: str) -> pd.DataFrame | None:
    """Unzip and parse an NSE UDiFF BhavCopy zip into normalised DataFrame."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        csv_names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            print(f"  {label}: no CSV inside zip")
            return None
        raw = archive.open(csv_names[0]).read()
        frame = pd.read_csv(io.BytesIO(raw))
        frame.columns = [str(c).strip() for c in frame.columns]
        frame = frame.rename(columns={k: v for k, v in _UDIFF_RENAMES.items() if k in frame.columns})
        if "SERIES" in frame.columns:
            frame = frame[frame["SERIES"].astype(str).str.strip() == "EQ"].copy()
        if "SYMBOL" in frame.columns:
            frame["SYMBOL"] = frame["SYMBOL"].astype(str).str.strip()
        print(f"  {label}: {len(frame)} EQ stocks")
        return frame if not frame.empty else None
    except Exception as exc:
        print(f"  {label} parse error: {exc}")
        return None


def _udiff_url(yyyymmdd: str) -> str:
    return (
        "https://nsearchives.nseindia.com/content/cm/"
        f"BhavCopy_NSE_CM_0_0_0_{yyyymmdd}_F_0000.csv.zip"
    )


def download_nse_bhav(ddmmyyyy: str, yyyymmdd: str) -> pd.DataFrame | None:
    # Source 1 — new UDiFF BhavCopy zip (primary, published ~3:45 PM IST)
    url1 = _udiff_url(yyyymmdd)
    print(f"  GET {url1}")
    try:
        r = requests.get(url1, headers=HEADERS_NSE, timeout=30)
        if r.status_code == 200:
            result = _parse_udiff_zip(r.content, "NSE UDiFF bhav")
            if result is not None:
                return result
        else:
            print(f"  NSE UDiFF bhav HTTP {r.status_code}")
    except Exception as exc:
        print(f"  NSE UDiFF bhav error: {exc}")

    # Source 2 — legacy sec_bhavdata_full (has delivery data; published later ~5:30 PM)
    url2 = (
        "https://nsearchives.nseindia.com/products/content/"
        f"sec_bhavdata_full_{ddmmyyyy}.csv"
    )
    print(f"  GET {url2}")
    try:
        r2 = requests.get(url2, headers=HEADERS_NSE, timeout=30)
        if r2.status_code == 200:
            return _read_nse_bhav_csv(r2.text, "NSE sec_bhavdata_full")
        print(f"  NSE sec_bhavdata_full HTTP {r2.status_code}")
    except Exception as exc:
        print(f"  NSE sec_bhavdata_full error: {exc}")

    return None


def _parse_nse_dat_file(path: str) -> pd.DataFrame | None:
    """
    Parse NSE CM bhav DAT files (FCM_INTRM_BC or FCM_BC format).

    Fixed 17-column comma-delimited layout (all fields space-padded):
      0  company_name  1  symbol  2  series  3  settl_type
      4  prev_close    5  open    6  high    7  low
      8  ltp           9  trdval  10 volume  11 corp_ind
      12 deliv_qty     13 deliv_pct  14 date  15 blank
      16 official_close  ← NSE call-auction close (use this as CLOSE_PRICE)
    """
    try:
        rows = []
        fname = Path(path).name
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for raw_line in fh:
                line = raw_line.rstrip("\n")
                if not line.strip():
                    continue
                parts = line.split(",")
                if len(parts) < 17:
                    continue
                series = parts[2].strip()
                if series != "EQ":
                    continue
                symbol = parts[1].strip()
                if not symbol:
                    continue

                def _fp(s: str) -> float | None:
                    s = s.strip()
                    if not s:
                        return None
                    try:
                        v = float(s)
                        return None if (v == 0.0) else v
                    except ValueError:
                        return None

                # Volume and delivery: 0 in interim files — store as None so
                # the pipeline skips delivery upsert rather than writing zeros.
                volume_raw = _fp(parts[10])
                deliv_qty_raw = _fp(parts[12])
                deliv_pct_raw = _fp(parts[13])

                rows.append({
                    "SYMBOL": symbol,
                    "SERIES": series,
                    "PREV_CLOSE": _fp(parts[4]),
                    "OPEN_PRICE": _fp(parts[5]),
                    "HIGH_PRICE": _fp(parts[6]),
                    "LOW_PRICE": _fp(parts[7]),
                    # col 16 = official NSE closing price (call-auction VWAP)
                    # col 8  = last traded price (LTP) — fallback if col 16 missing
                    "CLOSE_PRICE": _fp(parts[16]) or _fp(parts[8]),
                    "TTL_TRD_QNTY": volume_raw,
                    "DELIV_QTY": deliv_qty_raw,
                    "DELIV_PER": deliv_pct_raw,
                    "NO_OF_TRADES": None,
                })

        if not rows:
            print(f"  {fname}: no EQ rows found")
            return None

        frame = pd.DataFrame(rows)
        print(f"  {fname}: {len(frame)} EQ stocks (DAT format)")
        return frame
    except Exception as exc:
        print(f"  DAT parse error: {exc}")
        return None


def load_nse_bhav_from_file(path: str) -> pd.DataFrame | None:
    """Load NSE bhav from a manually-downloaded local file.

    Supports:
      * .DAT  — NSE CM bhav copy (FCM_INTRM_BC or FCM_BC), 17-column comma-delimited
      * .csv  — sec_bhavdata_full, SME, or new CM CSV format
    """
    suffix = Path(path).suffix.lower()
    if suffix == ".dat":
        return _parse_nse_dat_file(path)
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return _read_nse_bhav_csv(fh.read(), f"local file {Path(path).name}")
    except Exception as exc:
        print(f"  Local NSE file error: {exc}")
        return None


def parse_nse_bhav(frame: pd.DataFrame) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for _, row in frame.iterrows():
        symbol = str(row.get("SYMBOL", "")).strip()
        if not symbol:
            continue
        volume = _f(row.get("TTL_TRD_QNTY"))
        delivery_qty = _f(row.get("DELIV_QTY"))
        delivery_pct = _f(row.get("DELIV_PER"))
        if delivery_pct is None and delivery_qty is not None and volume not in (None, 0):
            delivery_pct = (delivery_qty / volume) * 100.0
        out[symbol] = {
            "open": _f(row.get("OPEN_PRICE")),
            "high": _f(row.get("HIGH_PRICE")),
            "low": _f(row.get("LOW_PRICE")),
            "close": _f(row.get("CLOSE_PRICE")),
            "volume": volume,
            "prev_close": _f(row.get("PREV_CLOSE")),
            "delivery_qty": delivery_qty,
            "delivery_pct": delivery_pct,
            "no_of_trades": _f(row.get("NO_OF_TRADES")),
        }
    return out


def download_pr_zip(ddmmyy: str, yyyy: str, month_name: str, yyyymmdd: str) -> dict[str, Any] | None:
    # Old PR zip path (/historical/EQUITIES/YYYY/MON/PR{DDMMYY}.zip) is dead.
    # New UDiFF BhavCopy zip contains a single CSV — 52W columns available when
    # NSE includes them ("52WkHigh"/"52WkLow"); no sub-files for announcements,
    # corporate actions, or market caps in the new format.
    url = _udiff_url(yyyymmdd)
    print(f"  GET {url}")
    try:
        response = requests.get(url, headers=HEADERS_NSE, timeout=60)
        if response.status_code != 200:
            print(f"  BhavCopy zip HTTP {response.status_code}")
            return None
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        csv_names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            return None

        raw_frame = pd.read_csv(io.BytesIO(archive.open(csv_names[0]).read()))
        raw_frame.columns = [str(c).strip() for c in raw_frame.columns]

        result: dict[str, Any] = {}

        # 52W high/low — present in UDiFF format as "52WkHigh" / "52WkLow"
        if "52WkHigh" in raw_frame.columns or "52WkLow" in raw_frame.columns:
            renamed = raw_frame.rename(columns={"TckrSymb": "SYMBOL", "52WkHigh": "HI_52_WK", "52WkLow": "LO_52_WK"})
            result["pd"] = renamed
            print(f"  BhavCopy/52W: {len(renamed)} rows")
        else:
            print(f"  BhavCopy zip: {csv_names[0]} (no 52W columns)")

        # Announcements, corporate actions, mcap are NOT in the new UDiFF zip.
        # Those remain empty — the pipeline handles missing data gracefully.
        return result
    except Exception as exc:
        print(f"  BhavCopy zip error: {exc}")
        return None


def parse_52w_from_pd(price_frame: pd.DataFrame) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for _, row in price_frame.iterrows():
        symbol = str(row.get("SYMBOL", "")).strip()
        if not symbol:
            continue
        high_52w = _f(row.get("HI_52_WK"))
        low_52w = _f(row.get("LO_52_WK"))
        if high_52w or low_52w:
            out[symbol] = {"high_52w": high_52w, "low_52w": low_52w}
    return out


def parse_mcap(market_cap_frame: pd.DataFrame) -> dict[str, float]:
    out: dict[str, float] = {}
    for _, row in market_cap_frame.iterrows():
        symbol = str(row.get("Symbol", "")).strip()
        market_cap = _f(row.get("Market Cap(Rs.)"))
        if symbol and market_cap is not None:
            out[symbol] = market_cap
    return out


def parse_announcements(an_text: str, nifty50_symbols: set[str]) -> dict[str, list[str]]:
    announcements: dict[str, list[str]] = {}
    for line in an_text.split("\n"):
        line = line.strip()
        if not line or ":" not in line:
            continue
        try:
            before_colon = line.split(":", 1)[0].strip()
            words = before_colon.split()
            if not words:
                continue
            symbol = words[-1].strip()
            if symbol not in nifty50_symbols:
                continue
            text = line.split(":", 1)[1].strip()
            announcements.setdefault(symbol, []).append(text)
        except Exception:
            continue
    return announcements


def parse_corporate_actions(bc_frame: pd.DataFrame, iso_date: str) -> list[dict]:
    actions: list[dict] = []
    for _, row in bc_frame.iterrows():
        symbol = str(row.get("SYMBOL", "")).strip()
        if not symbol:
            continue
        actions.append(
            {
                "symbol": symbol,
                "action_type": str(row.get("PURPOSE", "")).strip(),
                "ex_date": str(row.get("EX_DT", "")).strip(),
                "record_date": str(row.get("RECORD_DT", "")).strip(),
                "data_source": "nse_bhav",
            }
        )
    return actions


def download_bse_bhav(yyyymmdd: str) -> pd.DataFrame | None:
    url = (
        "https://www.bseindia.com/download/BhavCopy/Equity/"
        f"BhavCopy_BSE_CM_0_0_0_{yyyymmdd}_F_0000.CSV"
    )
    print(f"  GET {url}")
    try:
        response = requests.get(url, headers=HEADERS_BSE, timeout=30)
        if response.status_code != 200:
            print(f"  BSE bhav HTTP {response.status_code}")
            return None
        frame = pd.read_csv(io.StringIO(response.content.decode("utf-8", errors="ignore")))
        if "SctySrs" in frame.columns:
            frame = frame[frame["SctySrs"].isin(["A", "B", "E", "T"])].copy()
        print(f"  BSE bhav: {len(frame)} equity stocks")
        return frame
    except Exception as exc:
        print(f"  BSE bhav error: {exc}")
        return None


def parse_bse_bhav(frame: pd.DataFrame) -> tuple[dict[str, dict], dict[str, dict]]:
    by_code: dict[str, dict] = {}
    by_isin: dict[str, dict] = {}

    for _, row in frame.iterrows():
        code = str(row.get("FinInstrmId", "")).strip()
        isin = str(row.get("ISIN", "")).strip()
        ticker = str(row.get("TckrSymb", "")).strip()
        data = {
            "open": _f(row.get("OpnPric")),
            "high": _f(row.get("HghPric")),
            "low": _f(row.get("LwPric")),
            "close": _f(row.get("ClsPric")),
            "volume": _f(row.get("TtlTradgVol")),
            "prev_close": _f(row.get("PrvsClsgPric")),
            "delivery_qty": None,
            "delivery_pct": None,
            "bse_ticker": ticker,
        }
        if code:
            by_code[code] = data
        if isin and isin != "nan":
            by_isin[isin] = data

    return by_code, by_isin


def get_price_history(company_id: str) -> pd.DataFrame:
    # CRITICAL: order DESC + limit picks the most RECENT 300 sessions. With the
    # 2-year retention (~500 daily rows), ASC + limit returned the OLDEST 300 —
    # so the weekly 30-period MA was computed off a window ending months ago and
    # today's close was appended into a near-empty recent weekly series. That
    # produced the wildly corrupted latest-row ma30w (jumps of +50% to +138%
    # day-over-day). sort_index() below restores ascending order for rolling.
    response = (
        supabase.table("price_data")
        .select("date,close,volume")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(300)
        .execute()
    )
    if not response.data:
        return pd.DataFrame()
    frame = pd.DataFrame(response.data)
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.set_index("date").sort_index()
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame["volume"] = pd.to_numeric(frame["volume"], errors="coerce")
    return frame


def get_nifty_return(days: int = 252) -> float | None:
    """Fetch Nifty N-day return from market_internals for RS calculation.

    Default lookback is 252 trading days (≈ 52 weeks / 1 year), matching
    the RS window used by fetch_price_data.calc_rs() and the classifier's
    rs_vs_nifty input. Docstring previously said "180-day" — that was
    stale from an earlier version of the script; the default has been
    252 for some time. Pass days= explicitly to override.
    """
    try:
        res = (
            supabase.table("market_internals")
            .select("date,nifty_close")
            .not_.is_("nifty_close", "null")
            .order("date", desc=True)
            .limit(days + 10)
            .execute()
        )
        rows = sorted(
            [r for r in (res.data or []) if r.get("nifty_close")],
            key=lambda r: r["date"],
        )
        if len(rows) < 10:
            return None
        nifty_now = float(rows[-1]["nifty_close"])
        nifty_past = float(rows[max(0, len(rows) - days)]["nifty_close"])
        if nifty_past == 0:
            return None
        return (nifty_now - nifty_past) / nifty_past * 100
    except Exception:
        return None


def classify_stage(close: float, ma30w: float | None, slope: float, obv_sl: float, h52: float | None, l52: float | None) -> str:
    # WHY: Weinstein only defines 4 stages but real
    # charts straddle boundaries. This function
    # combines price-vs-30W-MA, MA slope, OBV
    # slope, and 52W position to disambiguate
    # the grey zones (e.g. price above MA but MA
    # flat → Stage 3 not Stage 2; below MA but
    # slope rising → still Stage 2 pullback).
    # Thresholds (slope>0.3, slope≤-1.5, pos>60)
    # were tuned against ~50 hand-labelled stocks.
    if not ma30w or ma30w == 0:
        return "Unclassified"
    pct = (close - ma30w) / ma30w * 100
    above = close > ma30w
    pos = ((close - l52) / (h52 - l52) * 100 if h52 and l52 and h52 > l52 else 50)
    rising = slope > 0.3
    falling = slope <= -1.5
    # obv_sl is now in % (×100 fix). Old threshold 0.01 was 1% fractional → 1.0%.
    obv_up = obv_sl > 1.0

    if above and pct > 5:
        return "Stage 2"
    if above and rising:
        return "Stage 2"
    if not above and pct > -3 and rising:
        return "Stage 2"
    if above and not rising:
        if pos > 60:
            return "Stage 3"
        if falling:
            return "Stage 3"
    if not above and pct > -5:
        if pos > 65:
            return "Stage 3"
    if -1.5 < slope <= 0.3 and not (obv_sl < -1.0):
        return "Stage 1" if pos < 50 else "Stage 3"
    if not above and pct > -10 and not falling:
        return "Stage 1" if pos < 55 else "Stage 3"
    if not above and falling and pct < -5 and not obv_up:
        return "Stage 4"
    return "Stage 2" if above else "Stage 1"


def calc_indicators(hist: pd.DataFrame, close: float, volume: float, nifty_return: float | None = None) -> dict[str, Any]:
    # ─────────────────────────────────────────
    # HOW INDICATORS ARE DERIVED
    #
    # `hist` = up to 365 daily rows of (close,
    # volume) for one stock. Today's row is
    # appended before any rolling calc so the
    # latest values reflect end-of-day prices.
    #
    #   ma20/50/150  = simple rolling mean of
    #                  the last N daily closes.
    #   ma30w        = resample to W-FRI weekly
    #                  closes, then 30-week
    #                  rolling mean (min 20 wks).
    #   ma30w_slope  = % change of the MA30W
    #                  over the last 5 weeks.
    #                  Positive = rising (Stage 2
    #                  candidate); ≤ ‑1.5 = falling
    #                  hard (Stage 4 candidate).
    #   rsi          = Wilder 14-period RSI on
    #                  daily closes.
    #                  gains = up-day mean, losses
    #                  = down-day mean, then
    #                  100 − 100/(1 + gains/losses)
    #   obv          = cumulative signed volume.
    #                  obv_slope = % change of OBV
    #                  over the last 10 sessions
    #                  → rising OBV with rising
    #                  price = real accumulation.
    #   high_52w     = max close over the last
    #                  252 trading days.
    #   low_52w      = min close over the same.
    #                  (recomputed again at end of
    #                  main() — see WHY there.)
    #   rs_vs_nifty  = (stock % return − Nifty %
    #                  return) over a 180-trading-
    #                  day lookback (or full
    #                  history if shorter, min 10
    #                  bars). Positive = stock
    #                  outperforming the index.
    #   stage        = classify_stage(close,
    #                  ma30w, slope, obv_slope,
    #                  h52, l52) — see that
    #                  function for boundary rules.
    # ─────────────────────────────────────────
    today = pd.DataFrame(
        {"close": [close], "volume": [volume or 0]},
        index=[pd.Timestamp.today().normalize()],
    )
    frame = pd.concat([hist[["close", "volume"]], today] if not hist.empty else [today])
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()

    closes = frame["close"].dropna()
    volumes = frame["volume"].fillna(0)
    count = len(closes)
    if count < 2:
        return {}

    def ma(window: int) -> float | None:
        return _f(closes.rolling(window).mean().iloc[-1])

    ma20 = ma(20)
    ma50 = ma(50)
    ma150 = ma(150)

    # ─ MA30W (weekly 30-period SMA) ─
    # Daily closes are first resampled to weekly
    # (W-FRI) so the MA matches Weinstein's chart
    # exactly — same value whether you look on a
    # Monday or a Friday during the week.
    weekly = closes.resample("W-FRI").last().dropna()
    ma30w_series = weekly.rolling(30, min_periods=20).mean()
    ma30w = _f(ma30w_series.iloc[-1]) if len(ma30w_series) else None

    # ─ MA30W slope ─
    # % change over the most recent 5 weekly bars
    # → captures direction of the long-term trend.
    # Positive = MA rising (Stage 2 territory),
    # near zero = flat (Stage 1 or 3),
    # ≤ ‑1.5  = MA falling hard (Stage 4).
    slope = 0.0
    if len(ma30w_series) >= 5:
        current = _f(ma30w_series.iloc[-1])
        previous = _f(ma30w_series.iloc[-5])
        if current and previous and previous != 0:
            slope = (current - previous) / abs(previous) * 100

    # ─ RSI (Wilder 14-period) ─
    # Wilder uses an exponential moving average with α = 1/14 (NOT a simple
    # rolling mean — that's "Cutler's RSI"). adjust=False gives the recursive
    # Wilder smoothing that every charting platform (TradingView, etc.) uses.
    # → 0–30 oversold, 40–65 healthy uptrend, > 70 overbought.
    delta = closes.diff()
    gains = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    losses = (-delta).clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    rsi_value = (100 - (100 / (1 + (gains / losses.replace(0, np.nan))))).iloc[-1]
    rsi = _f(rsi_value)

    # ─ OBV + slope ─
    # On-Balance Volume = running sum of signed
    # volume (+ on up days, − on down days).
    # obv_slope = % change of OBV over the last
    # 10 sessions. Rising OBV alongside rising
    # price confirms real accumulation; falling
    # OBV while price holds = hidden distribution.
    obv_series = (volumes * np.sign(closes.diff().fillna(0))).cumsum()
    obv_now = float(obv_series.iloc[-1])
    obv_slope = 0.0
    if len(obv_series) >= 10:
        previous_obv = float(obv_series.iloc[-10])
        if previous_obv != 0:
            # Documented as "% change of OBV" — multiply the fractional change
            # by 100 so the magnitude actually matches the documentation. The
            # sign is unchanged, so the existing >0 / <0 frontend checks
            # behave identically; threshold-based gates now read in real %.
            obv_slope = (obv_now - previous_obv) / abs(previous_obv) * 100

    high_52w = _f(closes.iloc[-252:].max()) if count >= 252 else _f(closes.max())
    low_52w = _f(closes.iloc[-252:].min()) if count >= 252 else _f(closes.min())
    stage = classify_stage(close, ma30w, slope, obv_slope, high_52w, low_52w)

    # ─ RS vs Nifty ─
    # Difference in % return over the same lookback window.
    # lookback = 252 trading days (~1 year — matches fetch_price_data.py
    # so both scripts produce the same rs_vs_nifty regardless of which one
    # touched the row last). Newly listed stocks with <252 bars fall back to
    # min(252, count - 1); the matching nifty_return window is requested at
    # the same depth via get_nifty_return(days=252) default.
    # Formula:
    #   stock_return = (close_today − close_252d_ago)
    #                  / close_252d_ago × 100
    #   rs_vs_nifty  = stock_return − nifty_return
    # → +10 means the stock beat Nifty by 10 percentage points over the year.
    rs_vs_nifty: float | None = None
    if nifty_return is not None and count >= 10:
        lookback = min(252, count - 1)
        stock_past = float(closes.iloc[-(lookback + 1)])
        if stock_past > 0:
            stock_return = (close - stock_past) / stock_past * 100
            rs_vs_nifty = round(stock_return - nifty_return, 2)

    # ─ Volume ratio + 30d avg ─
    # WHY: StockDetail's "Volume above average" check reads
    # vol_ratio. Previously NULL across the board (older comment
    # said "vol_ratio not available in bhav pipeline") which made
    # the check fail for EVERY stock in every watchlist. The math
    # is trivial — today's volume divided by the 30-day mean —
    # and we already have the volumes series in scope.
    vol_ratio: float | None = None
    avg_volume_30d: float | None = None
    if len(volumes) >= 5:
        recent_vols = volumes.tail(30)
        nonzero = recent_vols[recent_vols > 0]
        if len(nonzero) >= 5:
            avg30 = float(nonzero.mean())
            avg_volume_30d = round(avg30, 0)
            today_vol = float(volumes.iloc[-1])
            if avg30 > 0:
                vol_ratio = round(today_vol / avg30, 3)

    return {
        "ma20": ma20,
        "ma50": ma50,
        "ma150": ma150,
        "ma30w": ma30w,
        "ma30w_slope": round(slope, 4),
        "rsi": rsi,
        "obv": obv_now,
        "obv_slope": round(obv_slope, 4),
        "stage": stage,
        "near_ma20": bool(ma20 and abs(close - ma20) / ma20 < 0.03),
        "rsi_healthy": bool(rsi and 40 <= rsi <= 65),
        # Use the trailing 252-session max so it matches "52-week breakout" —
        # not the all-time max of whatever hist depth we happened to fetch.
        "breakout_52w": bool(((closes.iloc[-252:].max() if count >= 252 else closes.max()) if count else 0) * 0.99 <= close),
        "rs_vs_nifty": rs_vs_nifty,
        "vol_ratio": vol_ratio,
        "avg_volume_30d": avg_volume_30d,
    }


def process_companies(
    companies: list[dict],
    nse_data: dict[str, dict],
    bse_by_code: dict[str, dict],
    bse_by_isin: dict[str, dict],
    w52: dict[str, dict],
    mcaps: dict[str, float],
    iso_date: str,
    nifty_return: float | None = None,
) -> tuple[int, int]:
    price_rows: list[dict[str, Any]] = []
    delivery_rows: list[dict[str, Any]] = []
    company_updates: list[dict[str, Any]] = []
    success = 0

    for company in companies:
        company_id = company["id"]
        symbol = company.get("symbol", "")
        bse_code = company.get("bse_code", "")
        exchange = company.get("exchange", "NSE")
        isin = company.get("isin", "")

        bhav = None
        if exchange in ("NSE", "BOTH", None, ""):
            bhav = nse_data.get(symbol)
        if bhav is None and bse_code:
            bhav = bse_by_code.get(str(bse_code))
        if bhav is None and isin:
            bhav = bse_by_isin.get(isin)

        if not bhav or not bhav.get("close"):
            continue

        close = float(bhav["close"])
        volume = float(bhav.get("volume") or 0)
        week_52 = w52.get(symbol, {})
        high_52w = week_52.get("high_52w")
        low_52w = week_52.get("low_52w")

        hist = get_price_history(company_id)
        indicators = calc_indicators(hist, close, volume, nifty_return)
        if high_52w:
            indicators["high_52w"] = high_52w
        if low_52w:
            indicators["low_52w"] = low_52w

        # Calculate weinstein substage (appended to payload; does not alter existing fields)
        _stage = indicators.get("stage")
        _ma30w = indicators.get("ma30w")
        weinstein_substage: str | None = None
        if _stage == "Stage 2":
            if _ma30w and _ma30w > 0:
                _ext = close / _ma30w
                _ab = "2A" if _ext <= 1.15 else "2B"
            else:
                _ab = "2A"
            # vol_ratio not available in bhav pipeline; rs_vs_nifty is now computed
            # delivery_signals script can refine the suffix once vol_ratio is computed
            _vol_ok = False
            _rs_ok = (indicators.get("rs_vs_nifty") or 0) > 0
            _suffix = "+" if (_vol_ok and _rs_ok) else "-"
            weinstein_substage = _ab + _suffix
        else:
            weinstein_substage = _stage

        market_cap = mcaps.get(symbol)
        price_rows.append(
            {
                "company_id": company_id,
                "date": iso_date,
                "open": bhav.get("open"),
                "high": bhav.get("high"),
                "low": bhav.get("low"),
                "close": close,
                "volume": volume,
                "prev_close": bhav.get("prev_close"),
                "is_latest": True,
                "data_source": "bhav",
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "weinstein_substage": weinstein_substage,
                **indicators,
            }
        )

        delivery_pct = bhav.get("delivery_pct")
        delivery_qty = bhav.get("delivery_qty")
        if delivery_pct is not None:
            delivery_rows.append(
                {
                    "company_id": company_id,
                    "date": iso_date,
                    "delivery_pct": delivery_pct,
                    "delivery_volume": delivery_qty,
                    "total_volume": volume,
                }
            )

        if market_cap:
            company_updates.append({"id": company_id, "market_cap": market_cap})

        success += 1

    # Flipped order from the v1 code: upsert FIRST, clear is_latest
    # SECOND. If the bulk_upsert fails for any reason (schema drift,
    # network, rate limit), we MUST NOT clear is_latest on the prior
    # rows — that's what caused the recurring "screener empty" issue.
    # Keeping the old rows flagged is_latest=true means the screener
    # keeps showing yesterday's data, which is correct behaviour
    # when today's pipeline didn't actually land.
    price_upsert_result = None
    if price_rows:
        price_upsert_result = bulk_upsert(
            "price_data", price_rows, "company_id,date"
        )

        if price_upsert_result and price_upsert_result.get("failed", 0) == 0:
            # All rows landed — safe to clear is_latest on prior rows
            # for the companies we just upserted. One bulk REST call
            # instead of N per-company UPDATEs.
            try:
                company_ids = [r["company_id"] for r in price_rows]
                today_date = price_rows[0]["date"]
                supabase.table("price_data") \
                    .update({"is_latest": False}) \
                    .in_("company_id", company_ids) \
                    .neq("date", today_date) \
                    .eq("is_latest", True) \
                    .execute()
            except Exception as exc:
                print(f"[bhav] non-fatal: clearing "
                      f"prior is_latest failed: {exc}")
        elif price_upsert_result and price_upsert_result.get("failed", 0) > 0:
            print(f"[bhav] WARNING: {price_upsert_result['failed']} rows "
                  f"failed to insert — skipping is_latest "
                  f"clear to protect screener")
            for err in price_upsert_result.get("errors", [])[:3]:
                print(f"[bhav] upsert error sample: {err}")

    if delivery_rows:
        bulk_upsert("delivery_data", delivery_rows, "company_id,date")

    for update in company_updates:
        supabase.table("companies").update({"market_cap": update["market_cap"]}).eq("id", update["id"]).execute()

    # Bubble the upsert failure count up so main() can log it. None
    # → 0 (no upsert was attempted, e.g. empty price_rows).
    failed = (price_upsert_result or {}).get("failed", 0) if price_rows else 0
    return success, len(companies) - success, failed


def save_announcements(announcements: dict[str, list[str]], iso_date: str) -> None:
    if not announcements:
        return

    symbols = list(announcements.keys())
    response = (
        supabase.table("companies")
        .select("id,symbol")
        .in_("symbol", symbols)
        .limit(5000)
        .execute()
    )
    symbol_to_id = {row["symbol"]: row["id"] for row in (response.data or [])}

    rows: list[dict[str, Any]] = []
    for symbol, texts in announcements.items():
        company_id = symbol_to_id.get(symbol)
        if not company_id:
            continue
        for text in texts:
            if len(text) < 20:
                continue
            rows.append(
                {
                    "company_id": company_id,
                    "symbol": symbol,
                    "title": text[:300],
                    "source": "NSE",
                    "published_at": f"{iso_date}T09:00:00+05:30",
                    "fetched_date": iso_date,
                }
            )

    if rows:
        bulk_upsert("stock_news", rows, "company_id,title")
        print(f"  Saved {len(rows)} announcements as news")


def save_corporate_actions(actions: list[dict], iso_date: str) -> None:
    if not actions:
        return

    symbols = list({action["symbol"] for action in actions})
    response = (
        supabase.table("companies")
        .select("id,symbol")
        .in_("symbol", symbols)
        .limit(5000)
        .execute()
    )
    symbol_to_id = {row["symbol"]: row["id"] for row in (response.data or [])}

    rows: list[dict[str, Any]] = []
    for action in actions:
        company_id = symbol_to_id.get(action["symbol"])
        if not company_id:
            continue
        ex_date = action.get("ex_date", "")
        if ex_date and ex_date != "nan":
            rows.append(
                {
                    "company_id": company_id,
                    "symbol": action["symbol"],
                    "action_type": action["action_type"],
                    "ex_date": ex_date,
                    "record_date": action.get("record_date", ""),
                    "data_source": "nse_bhav",
                }
            )

    if rows:
        bulk_upsert("corporate_actions", rows, "company_id,action_type,ex_date")
        print(f"  Saved {len(rows)} corporate actions")


def load_nifty50_symbols() -> set[str]:
    try:
        response = (
            supabase.table("companies")
            .select("symbol")
            .eq("nifty50", True)
            .limit(5000)
            .execute()
        )
        return {row["symbol"] for row in (response.data or []) if row.get("symbol")}
    except Exception as exc:
        print(f"  Nifty 50 lookup skipped: {exc}")
        return set()


def _backfill_trading_days(n: int) -> list[tuple[str, str, str]]:
    """Return up to ``n`` past trading days as (DDMMYYYY, YYYYMMDD, ISO), oldest first.

    Skips weekends and known 2026 NSE holidays. Older holidays (2024/2025) are not
    in NSE_HOLIDAYS_2026, but those dates simply 404 on download and are skipped
    by the per-day continue-on-error path, so they cost only one wasted request.
    """
    out: list[tuple[str, str, str]] = []
    cursor = date.today() - timedelta(days=1)
    while len(out) < n:
        if cursor.weekday() < 5 and cursor.isoformat() not in NSE_HOLIDAYS_2026:
            out.append(
                (
                    cursor.strftime("%d%m%Y"),
                    cursor.strftime("%Y%m%d"),
                    cursor.isoformat(),
                )
            )
        cursor -= timedelta(days=1)
    return list(reversed(out))


def _date_has_data(iso_date: str) -> bool:
    """True when price_data already holds rows for this date (skip-existing)."""
    try:
        res = (
            supabase.table("price_data")
            .select("id", count="exact")
            .eq("date", iso_date)
            .limit(1)
            .execute()
        )
        return (res.count or 0) > 100
    except Exception:
        return False


def run_backfill(days: int) -> None:
    """Backfill up to ``days`` past trading days of price_data.

    WHY: the DB previously kept only ~180 days because of a Monday cleanup
    (now removed). Reliable 30W MA needs ~150 days, 52W High/Low needs 252,
    and RS needs 180 — so we backfill ~2 years.

    Per date: skip if already present, download the NSE bhav copy zip, parse it
    the same way the daily run does (parse_nse_bhav), compute indicators from an
    in-memory rolling cache (avoids ~1M per-company DB reads that process_companies
    would do), and bulk-upsert with is_latest=False so the current latest row is
    never disturbed. Continue-on-error per day; ~1.5s between requests.
    """
    print("PineX Bhav Backfill")
    print("=" * 50)
    print(f"Target: last {days} trading days")
    if DRY_RUN:
        print("DRY RUN — no DB writes")

    trading_days = _backfill_trading_days(days)
    print(
        f"Trading days: {len(trading_days)} "
        f"({trading_days[0][2]} → {trading_days[-1][2]})"
    )

    companies = fetch_companies_paginated("id,symbol,bse_code,exchange,isin")
    sym_map = {c["symbol"]: c["id"] for c in companies}
    print(f"Companies: {len(companies)}")

    nifty_return = get_nifty_return()
    if nifty_return is not None:
        print(f"Nifty 252d return: {nifty_return:.2f}% (used for RS)")

    # Rolling per-company history (close, volume) so indicators are computed
    # without a DB round-trip per company per day. Capped at 300 rows.
    history_cache: dict[str, pd.DataFrame] = {}
    total_days = len(trading_days)
    total_written = 0

    for i, (ddmmyyyy, yyyymmdd, iso_date) in enumerate(trading_days, start=1):
        print(f"Day {i}/{total_days}: {iso_date}", end=" ", flush=True)

        if _date_has_data(iso_date):
            print("— already in DB, skipping")
            continue

        try:
            frame = download_nse_bhav(ddmmyyyy, yyyymmdd)
            nse_data = (
                parse_nse_bhav(frame)
                if frame is not None and not frame.empty
                else {}
            )
            if not nse_data:
                print("— no data (holiday/unpublished), skipping")
                time.sleep(1.5)
                continue

            price_rows: list[dict[str, Any]] = []
            delivery_rows: list[dict[str, Any]] = []

            for symbol, bhav in nse_data.items():
                company_id = sym_map.get(symbol)
                if not company_id or not bhav.get("close"):
                    continue
                close = float(bhav["close"])
                volume = float(bhav.get("volume") or 0)

                hist = history_cache.get(company_id, pd.DataFrame())
                indicators = calc_indicators(hist, close, volume, nifty_return)

                price_rows.append(
                    {
                        "company_id": company_id,
                        "date": iso_date,
                        "open": bhav.get("open"),
                        "high": bhav.get("high"),
                        "low": bhav.get("low"),
                        "close": close,
                        "volume": volume,
                        "prev_close": bhav.get("prev_close"),
                        # Backfilled history is never the latest row — the daily
                        # run owns is_latest. False keeps the current latest intact.
                        "is_latest": False,
                        "data_source": "bhav_backfill",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        **indicators,
                    }
                )

                delivery_pct = bhav.get("delivery_pct")
                if delivery_pct is not None:
                    delivery_rows.append(
                        {
                            "company_id": company_id,
                            "date": iso_date,
                            "delivery_pct": delivery_pct,
                            "delivery_volume": bhav.get("delivery_qty"),
                            "total_volume": volume,
                        }
                    )

                # Roll the in-memory cache forward (oldest→newest order).
                new_row = pd.DataFrame(
                    {"close": [close], "volume": [volume]},
                    index=[pd.Timestamp(iso_date)],
                )
                history_cache[company_id] = pd.concat(
                    [history_cache.get(company_id, pd.DataFrame()), new_row]
                ).tail(300)

            if DRY_RUN:
                print(f"— {len(price_rows)} rows (dry run, not written)")
                time.sleep(1.5)
                continue

            if price_rows:
                written = bulk_upsert("price_data", price_rows, "company_id,date")
                total_written += written
                if delivery_rows:
                    bulk_upsert("delivery_data", delivery_rows, "company_id,date")
                print(f"— {written} rows written")
            else:
                print("— 0 matched companies")
        except Exception as exc:
            print(f"— error: {exc}")

        time.sleep(1.5)

    print(f"\nBackfill complete — {total_written} rows written")
    log_event(
        "fetch_bhav_backfill",
        {"days": days, "trading_days": total_days, "written": total_written},
    )


def main() -> None:
    # Backfill mode bypasses the weekend/holiday gate — it walks its own
    # explicit list of past trading days. Handle it before should_skip().
    if BACKFILL:
        run_backfill(DAYS_ARG)
        return

    # Holiday early-exit. Dev modes (FORCE/TEST/DATE_ARG) bypass this
    # — same bypass logic as should_skip() below. Redundant with the
    # holiday clause inside should_skip(), but kept here per the
    # canonical "early-exit at top of main()" pattern so every
    # pipeline script reads the same.
    if not (FORCE or TEST or DATE_ARG):
        today_iso = date.today().isoformat()
        if is_nse_holiday(today_iso):
            print(f"NSE holiday today ({today_iso}). Skipping.")
            log_event("pipeline_skipped", {
                "reason": "nse_holiday",
                "date": today_iso,
                "script": "fetch_bhav_daily",
            })
            return

    skip = should_skip()
    if skip:
        print(skip)
        log_event("fetch_bhav_skipped", {"reason": skip})
        return

    ddmmyyyy, ddmmyy, yyyymmdd, iso_date = get_date_str()
    month_name = datetime.strptime(ddmmyyyy, "%d%m%Y").strftime("%b").upper()

    print(f"PineX Bhav Fetch — {iso_date}")
    print("=" * 50)

    # Skip-existing: don't re-download/re-process a date we already have.
    # --force re-fetches anyway (e.g. to correct a bad day). >100 rows means
    # the day was already ingested (vs. a stray manual row or two).
    if not (FORCE or TEST):
        existing = (
            supabase.table("price_data")
            .select("id", count="exact")
            .eq("date", iso_date)
            .limit(1)
            .execute()
        )
        if (existing.count or 0) > 100:
            print(f"Data already exists for {iso_date} "
                  f"({existing.count} rows) — skipping")
            log_event("fetch_bhav_skipped", {"reason": "already_exists", "date": iso_date})
            return

    print("\n[1/4] NSE bhav...")
    if NSE_FILE_ARG:
        print(f"  Using local file: {NSE_FILE_ARG}")
        nse_raw = load_nse_bhav_from_file(NSE_FILE_ARG)
    else:
        nse_raw = download_nse_bhav(ddmmyyyy, yyyymmdd)
    nse_data = parse_nse_bhav(nse_raw) if nse_raw is not None and not nse_raw.empty else {}
    print(f"  Parsed: {len(nse_data)} stocks")

    print("\n[2/4] NSE BhavCopy zip (52W data)...")
    pr = download_pr_zip(ddmmyy, iso_date[:4], month_name, yyyymmdd)
    w52: dict[str, dict] = {}
    mcaps: dict[str, float] = {}
    announcements: dict[str, list[str]] = {}
    corp_actions: list[dict] = []

    if pr:
        if "pd" in pr:
            w52 = parse_52w_from_pd(pr["pd"])
            print(f"  52W data: {len(w52)} stocks")
        if "mcap" in pr:
            mcaps = parse_mcap(pr["mcap"])
            print(f"  Market caps: {len(mcaps)} stocks")
        if "an" in pr:
            announcements = parse_announcements(pr["an"], load_nifty50_symbols())
            print(f"  Nifty50 announcements: {len(announcements)} stocks")
        if "bc" in pr:
            corp_actions = parse_corporate_actions(pr["bc"], iso_date)
            print(f"  Corp actions: {len(corp_actions)}")

    print("\n[3/4] BSE bhav...")
    bse_raw = download_bse_bhav(yyyymmdd)
    bse_by_code: dict[str, dict] = {}
    bse_by_isin: dict[str, dict] = {}
    if bse_raw is not None and not bse_raw.empty:
        bse_by_code, bse_by_isin = parse_bse_bhav(bse_raw)
        print(f"  Parsed: {len(bse_by_code)} BSE stocks")

    print("\n[4/4] Processing companies...")
    companies = fetch_companies_paginated("id,symbol,bse_code,exchange,isin")
    if TEST:
        companies = [row for row in companies if row.get("symbol") in TEST_SYMBOLS]
        print(f"  TEST mode: {len(companies)} companies")
    else:
        print(f"  Total companies: {len(companies)}")

    nifty_return = get_nifty_return()
    if nifty_return is not None:
        print(f"  Nifty 252d return: {nifty_return:.2f}% (used for RS calculation)")
    else:
        print("  Warning: Could not fetch Nifty return — rs_vs_nifty will be null")

    success, missing, failed = process_companies(companies, nse_data, bse_by_code, bse_by_isin, w52, mcaps, iso_date, nifty_return)
    print(f"  Success: {success} | No data: {missing} | Failed upserts: {failed}")

    if announcements:
        save_announcements(announcements, iso_date)
    if corp_actions:
        save_corporate_actions(corp_actions, iso_date)

    print(f"\nDone — {iso_date}")
    print(f"   Stocks updated: {success}")
    print(f"   Stocks failed:  {failed}")
    print(f"   Announcements: {len(announcements)}")
    print(f"   Corp actions: {len(corp_actions)}")

    log_event(
        "fetch_bhav_daily",
        {
            "date": iso_date,
            "nse_stocks": len(nse_data),
            "bse_stocks": len(bse_by_code),
            "companies": len(companies),
            "success": success,
            "failed": failed,
            "announcements": len(announcements),
            "corp_actions": len(corp_actions),
        },
    )

    # WHY: We now retain 2 years of price_data.
    # Supabase Small plan ($25/mo) has 8GB.
    # 2125 stocks × 500 days ≈ 500MB — well within limits.
    # Full history is needed for reliable 30W MA,
    # 52W High/Low, and RS calculations.

    # WHY: NSE bhav copy does not reliably include 52WkHigh/52WkLow, so we
    # derive them from our own price_data history. This now runs in-database via
    # update_52w_high_low() (see scripts/sql/backfill_52w_high_low.sql). The old
    # client-side loop fetched every company's 365-day history in one request —
    # which silently hit PostgREST's 1000-row cap, so only a handful of
    # companies got updated and ~all others were left null. We also run it
    # BEFORE the view refresh so the feed carries the fresh values.
    print('Updating 52W high/low...')
    try:
        supabase.rpc('update_52w_high_low').execute()
        print('52W high/low updated ✅')
    except Exception as e:
        print(f'52W high/low update error: {e}')

    # Refresh materialized view (after the 52W update) so the frontend gets
    # instant fast loads with current values.
    print('Refreshing home stocks view...')
    try:
        supabase.rpc(
            'refresh_home_stocks'
        ).execute()
        print('mv_home_stocks refreshed ✅')
    except Exception as e:
        print(f'View refresh error: {e}')

    # WHY: delivery_data is a staging/
    # calculation table. The processed
    # results live in delivery_signals.
    # Keeping more than 1 year of raw
    # delivery_data has no analytical
    # value and wastes ~75MB/month.
    # delivery_signals is kept forever
    # for backtesting.
    # price_data is kept forever.
    #
    # Runs only on the daily path — the
    # --backfill branch returns earlier
    # in main(), so a backfill writing
    # 5y of delivery_data is NOT
    # immediately wiped by this cleanup.
    cutoff = (date.today() -
              timedelta(days=365))\
             .isoformat()

    try:
        deleted = supabase\
            .table('delivery_data')\
            .delete()\
            .lt('date', cutoff)\
            .execute()
        print(f'delivery_data cleanup: '
              f'removed rows before '
              f'{cutoff}')
    except Exception as e:
        print(f'delivery_data cleanup '
              f'error: {e}')


if __name__ == "__main__":
    main()
