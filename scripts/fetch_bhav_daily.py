"""Download and process NSE + BSE bhav copies for price and delivery.

Replaces fetch_price_data.py and fetch_delivery.py for the daily pipeline.

Usage:
  python fetch_bhav_daily.py
  python fetch_bhav_daily.py --force
  python fetch_bhav_daily.py --date 12052026
  python fetch_bhav_daily.py --test
"""

from __future__ import annotations

import io
import math
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv

from db import bulk_upsert, fetch_companies_paginated, log_event, supabase
from nse_holidays import NSE_HOLIDAYS_2026

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

FORCE = "--force" in sys.argv
TEST = "--test" in sys.argv
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


DATE_ARG = _parse_date_arg()
NSE_FILE_ARG = _parse_nse_file_arg()


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
    response = (
        supabase.table("price_data")
        .select("date,close,volume")
        .eq("company_id", company_id)
        .order("date", desc=False)
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


def get_nifty_return(days: int = 180) -> float | None:
    """Fetch Nifty 180-day return from market_internals for RS calculation."""
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
    if not ma30w or ma30w == 0:
        return "Unclassified"
    pct = (close - ma30w) / ma30w * 100
    above = close > ma30w
    pos = ((close - l52) / (h52 - l52) * 100 if h52 and l52 and h52 > l52 else 50)
    rising = slope > 0.3
    falling = slope <= -1.5
    obv_up = obv_sl > 0.01

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
    if -1.5 < slope <= 0.3 and not (obv_sl < -0.01):
        return "Stage 1" if pos < 50 else "Stage 3"
    if not above and pct > -10 and not falling:
        return "Stage 1" if pos < 55 else "Stage 3"
    if not above and falling and pct < -5 and not obv_up:
        return "Stage 4"
    return "Stage 2" if above else "Stage 1"


def calc_indicators(hist: pd.DataFrame, close: float, volume: float, nifty_return: float | None = None) -> dict[str, Any]:
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

    weekly = closes.resample("W-FRI").last().dropna()
    ma30w_series = weekly.rolling(30, min_periods=20).mean()
    ma30w = _f(ma30w_series.iloc[-1]) if len(ma30w_series) else None

    slope = 0.0
    if len(ma30w_series) >= 5:
        current = _f(ma30w_series.iloc[-1])
        previous = _f(ma30w_series.iloc[-5])
        if current and previous and previous != 0:
            slope = (current - previous) / abs(previous) * 100

    delta = closes.diff()
    gains = delta.clip(lower=0).rolling(14).mean()
    losses = (-delta).clip(lower=0).rolling(14).mean()
    rsi_value = (100 - (100 / (1 + (gains / losses.replace(0, np.nan))))).iloc[-1]
    rsi = _f(rsi_value)

    obv_series = (volumes * np.sign(closes.diff().fillna(0))).cumsum()
    obv_now = float(obv_series.iloc[-1])
    obv_slope = 0.0
    if len(obv_series) >= 10:
        previous_obv = float(obv_series.iloc[-10])
        if previous_obv != 0:
            obv_slope = (obv_now - previous_obv) / abs(previous_obv)

    high_52w = _f(closes.iloc[-252:].max()) if count >= 252 else _f(closes.max())
    low_52w = _f(closes.iloc[-252:].min()) if count >= 252 else _f(closes.min())
    stage = classify_stage(close, ma30w, slope, obv_slope, high_52w, low_52w)

    rs_vs_nifty: float | None = None
    if nifty_return is not None and count >= 10:
        lookback = min(180, count - 1)
        stock_past = float(closes.iloc[-(lookback + 1)])
        if stock_past > 0:
            stock_return = (close - stock_past) / stock_past * 100
            rs_vs_nifty = round(stock_return - nifty_return, 2)

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
        "breakout_52w": bool((closes.max() if count else 0) * 0.99 <= close),
        "rs_vs_nifty": rs_vs_nifty,
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

    for row in price_rows:
        try:
            supabase.table("price_data") \
                .update({"is_latest": False}) \
                .eq("company_id", row["company_id"]) \
                .eq("is_latest", True) \
                .execute()
        except Exception:
            pass

    if price_rows:
        bulk_upsert("price_data", price_rows, "company_id,date")

    if delivery_rows:
        bulk_upsert("delivery_data", delivery_rows, "company_id,date")

    for update in company_updates:
        supabase.table("companies").update({"market_cap": update["market_cap"]}).eq("id", update["id"]).execute()

    return success, len(companies) - success


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


def main() -> None:
    skip = should_skip()
    if skip:
        print(skip)
        log_event("fetch_bhav_skipped", {"reason": skip})
        return

    ddmmyyyy, ddmmyy, yyyymmdd, iso_date = get_date_str()
    month_name = datetime.strptime(ddmmyyyy, "%d%m%Y").strftime("%b").upper()

    print(f"PineX Bhav Fetch — {iso_date}")
    print("=" * 50)

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
        print(f"  Nifty 180d return: {nifty_return:.2f}% (used for RS calculation)")
    else:
        print("  Warning: Could not fetch Nifty return — rs_vs_nifty will be null")

    success, missing = process_companies(companies, nse_data, bse_by_code, bse_by_isin, w52, mcaps, iso_date, nifty_return)
    print(f"  Success: {success} | No data: {missing}")

    if announcements:
        save_announcements(announcements, iso_date)
    if corp_actions:
        save_corporate_actions(corp_actions, iso_date)

    print(f"\nDone — {iso_date}")
    print(f"   Stocks updated: {success}")
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
            "announcements": len(announcements),
            "corp_actions": len(corp_actions),
        },
    )

    # Auto cleanup every Monday — keeps DB under 500MB free tier
    if date.today().weekday() == 0:
        cutoff = (date.today() - timedelta(days=180)).isoformat()
        print(f"\nMonday cleanup: removing data before {cutoff}...")
        try:
            supabase.table("price_data").delete().lt("date", cutoff).execute()
            supabase.table("delivery_data").delete().lt("date", cutoff).execute()
            supabase.table("delivery_signals").delete().lt("date", cutoff).execute()
            print("Cleanup complete ✅")
            print("Kept: last 180 trading days")
            print("Nifty RS still uses 252 days from market_internals")
        except Exception as e:
            print(f"Cleanup warning: {e}")

    # Refresh materialized view
    # so frontend gets instant fast loads
    print('Refreshing home stocks view...')
    try:
        supabase.rpc(
            'refresh_home_stocks'
        ).execute()
        print('mv_home_stocks refreshed ✅')
    except Exception as e:
        print(f'View refresh error: {e}')


if __name__ == "__main__":
    main()
