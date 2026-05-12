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

from db import bulk_upsert, log_event, supabase
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


DATE_ARG = _parse_date_arg()


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


def download_nse_bhav(ddmmyyyy: str) -> pd.DataFrame | None:
    url = (
        "https://nsearchives.nseindia.com/products/content/"
        f"sec_bhavdata_full_{ddmmyyyy}.csv"
    )
    print(f"  GET {url}")
    try:
        response = requests.get(url, headers=HEADERS_NSE, timeout=30)
        if response.status_code != 200:
            print(f"  NSE bhav HTTP {response.status_code}")
            return None
        frame = pd.read_csv(io.StringIO(response.text))
        frame.columns = [str(c).strip() for c in frame.columns]
        if "SERIES" in frame.columns:
            frame = frame[frame["SERIES"].astype(str).str.strip() == "EQ"].copy()
        if "SYMBOL" in frame.columns:
            frame["SYMBOL"] = frame["SYMBOL"].astype(str).str.strip()
        print(f"  NSE bhav: {len(frame)} EQ stocks")
        return frame
    except Exception as exc:
        print(f"  NSE bhav error: {exc}")
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


def download_pr_zip(ddmmyy: str, yyyy: str, month_name: str) -> dict[str, Any] | None:
    url = (
        "https://nsearchives.nseindia.com/content/historical/EQUITIES/"
        f"{yyyy}/{month_name}/PR{ddmmyy}.zip"
    )
    print(f"  GET {url}")
    try:
        response = requests.get(url, headers=HEADERS_NSE, timeout=60)
        if response.status_code != 200:
            print(f"  PR zip HTTP {response.status_code}")
            return None
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        result: dict[str, Any] = {}

        pd_name = f"pd{ddmmyy}.csv"
        if pd_name in archive.namelist():
            price_frame = pd.read_csv(archive.open(pd_name), skiprows=1)
            price_frame.columns = [str(c).strip() for c in price_frame.columns]
            result["pd"] = price_frame
            print(f"  PR/pd: {len(price_frame)} rows")

        an_name = f"an{ddmmyy}.txt"
        if an_name in archive.namelist():
            result["an"] = archive.open(an_name).read().decode("utf-8", errors="ignore")
            print(f"  PR/an: {result['an'].count(chr(10))} announcements")

        bc_name = f"bc{ddmmyy}.csv"
        if bc_name in archive.namelist():
            result["bc"] = pd.read_csv(archive.open(bc_name))
            print(f"  PR/bc: {len(result['bc'])} actions")

        hl_name = f"hl{ddmmyy}.csv"
        if hl_name in archive.namelist():
            result["hl"] = pd.read_csv(archive.open(hl_name))
            print(f"  PR/hl: {len(result['hl'])} new H/L")

        mc_name = f"mcap{ddmmyy}.csv"
        if mc_name in archive.namelist():
            market_cap_frame = pd.read_csv(archive.open(mc_name))
            market_cap_frame.columns = [str(c).strip() for c in market_cap_frame.columns]
            result["mcap"] = market_cap_frame
            print(f"  PR/mcap: {len(market_cap_frame)} stocks")

        return result
    except Exception as exc:
        print(f"  PR zip error: {exc}")
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


def calc_indicators(hist: pd.DataFrame, close: float, volume: float) -> dict[str, Any]:
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
    }


def process_companies(
    companies: list[dict],
    nse_data: dict[str, dict],
    bse_by_code: dict[str, dict],
    bse_by_isin: dict[str, dict],
    w52: dict[str, dict],
    mcaps: dict[str, float],
    iso_date: str,
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
        indicators = calc_indicators(hist, close, volume)
        if high_52w:
            indicators["high_52w"] = high_52w
        if low_52w:
            indicators["low_52w"] = low_52w

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

    company_ids = [row["company_id"] for row in price_rows]
    for index in range(0, len(company_ids), 100):
        supabase.table("price_data").update({"is_latest": False}).in_("company_id", company_ids[index : index + 100]).execute()

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
    response = supabase.table("companies").select("id,symbol").in_("symbol", symbols).execute()
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
    response = supabase.table("companies").select("id,symbol").in_("symbol", symbols).execute()
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
        response = supabase.table("companies").select("symbol").eq("nifty50", True).execute()
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

    print("\n[1/4] NSE sec_bhavdata...")
    nse_raw = download_nse_bhav(ddmmyyyy)
    nse_data = parse_nse_bhav(nse_raw) if nse_raw is not None and not nse_raw.empty else {}
    print(f"  Parsed: {len(nse_data)} stocks")

    print("\n[2/4] NSE PR zip...")
    pr = download_pr_zip(ddmmyy, iso_date[:4], month_name)
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
    response = (
        supabase.table("companies")
        .select("id,symbol,bse_code,exchange,isin")
        .or_("is_suspended.is.null,is_suspended.eq.false")
        .execute()
    )
    companies = response.data or []
    if TEST:
        companies = [row for row in companies if row.get("symbol") in TEST_SYMBOLS]
        print(f"  TEST mode: {len(companies)} companies")
    else:
        print(f"  Total companies: {len(companies)}")

    success, missing = process_companies(companies, nse_data, bse_by_code, bse_by_isin, w52, mcaps, iso_date)
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


if __name__ == "__main__":
    main()
