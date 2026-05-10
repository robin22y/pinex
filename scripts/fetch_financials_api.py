"""Fetch quarterly financials via IndianAPI /historical_stats endpoint.

Replaces fetch_financials.py (Screener scraper).
Run: python scripts/fetch_financials_api.py [--test]
   or: cd scripts && python fetch_financials_api.py [--test]

Mapping:
  IndianAPI field        -> Pinex financials table column
  Sales                  -> revenue
  Operating Profit       -> operating_profit
  Net Profit             -> net_profit
  EPS in Rs              -> eps
  OPM %                  -> margin (operating margin %)
  quarter label (Jun 24) -> quarter (normalised to "Jun 2024")
"""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from db import bulk_upsert, log_event, supabase
from symbols import COMPANY_META, TIER1_SYMBOLS

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = "https://stock.indianapi.in"
API_KEY = os.environ.get("INDIANAPI_KEY", "")
HEADERS = {"x-api-key": API_KEY}
FINANCIALS_TABLE = "financials"
DELAY_SECONDS = 1.2  # stay well within 1 req/sec rate limit

TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["TCS", "INFY", "HDFCBANK"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    txt = str(value).strip()
    if not txt or txt in ("-", "—", "NA", "N/A"):
        return None
    txt = re.sub(r"[^0-9.\-]", "", txt)
    if txt in ("", ".", "-", "-."):
        return None
    try:
        return float(txt)
    except ValueError:
        return None


def _normalise_quarter(raw: str) -> str:
    """Convert 'Jun 24' -> 'Jun 2024', 'Mar 2024' stays as-is."""
    raw = raw.strip()
    # Already 4-digit year
    if re.search(r"\b\d{4}\b", raw):
        return raw
    # 2-digit year: 'Jun 24' -> 'Jun 2024'
    m = re.match(r"([A-Za-z]+)\s+(\d{2})$", raw)
    if m:
        month, yr = m.group(1), int(m.group(2))
        year = 2000 + yr if yr < 50 else 1900 + yr
        return f"{month} {year}"
    return raw


def _pct_growth(curr: float | None, prev: float | None) -> float | None:
    if curr is None or prev in (None, 0):
        return None
    return round(((curr - prev) / abs(prev)) * 100.0, 2)


def _get_company_id(symbol: str) -> str | None:
    res = (
        supabase.table("companies")
        .select("id")
        .eq("symbol", symbol)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0]["id"] if rows else None


def _company_name_for_api(symbol: str) -> str:
    """Return the company name string to send to IndianAPI.
    Uses COMPANY_META first; falls back to symbol itself."""
    meta = COMPANY_META.get(symbol, {})
    name = meta.get("name", "")
    if name:
        # Strip suffixes IndianAPI doesn't like: 'Ltd.', 'Limited', 'Ltd'
        name = re.sub(r"\b(Ltd\.?|Limited|Corporation|Corp\.?)\s*$", "", name, flags=re.I).strip()
    return name or symbol


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------


def fetch_quarter_results(stock_name: str) -> dict[str, Any]:
    """Call /historical_stats?stock_name=...&stats=quarter_results"""
    url = f"{BASE_URL}/historical_stats"
    params = {"stock_name": stock_name, "stats": "quarter_results"}
    resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Mapper
# ---------------------------------------------------------------------------


def _map_to_rows(company_id: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    """
    IndianAPI returns:
      {
        "Sales":            {"Jun 2021": 45411, "Sep 2021": 46867, ...},
        "Operating Profit": {...},
        "Net Profit":       {...},
        "EPS in Rs":        {...},
        "OPM %":            {...},
        ...
      }
    We pivot to one row per quarter.
    """
    sales_map = data.get("Sales") or {}
    op_map = data.get("Operating Profit") or {}
    pat_map = data.get("Net Profit") or {}
    eps_map = data.get("EPS in Rs") or {}
    opm_map = data.get("OPM %") or {}

    if not sales_map:
        raise ValueError("No 'Sales' key in response — check stock name")

    # All quarters present in Sales dict (most recent last in API response)
    quarter_keys = list(sales_map.keys())

    rows: list[dict[str, Any]] = []
    prev_rev: float | None = None
    prev_pat: float | None = None

    # Build list oldest->newest so YoY can look back 4 quarters
    for i, raw_q in enumerate(quarter_keys):
        q = _normalise_quarter(raw_q)
        rev = _to_float(sales_map.get(raw_q))
        op = _to_float(op_map.get(raw_q))
        npat = _to_float(pat_map.get(raw_q))
        eps = _to_float(eps_map.get(raw_q))
        # Prefer OPM% from API; fallback to computing from op/rev
        margin_raw = _to_float(opm_map.get(raw_q))
        if margin_raw is not None:
            margin = margin_raw
        elif op is not None and rev not in (None, 0):
            margin = round((op / rev) * 100.0, 2)
        else:
            margin = None

        # QoQ growth
        rev_qoq = _pct_growth(rev, prev_rev)
        pat_qoq = _pct_growth(npat, prev_pat)

        # YoY growth (compare to same quarter 4 periods ago)
        yoy_idx = i - 4
        rev_yoy: float | None = None
        pat_yoy: float | None = None
        if yoy_idx >= 0:
            prev_yoy_q = quarter_keys[yoy_idx]
            rev_yoy = _pct_growth(rev, _to_float(sales_map.get(prev_yoy_q)))
            pat_yoy = _pct_growth(npat, _to_float(pat_map.get(prev_yoy_q)))

        rows.append(
            {
                "company_id": company_id,
                "quarter": q,
                "revenue": rev,
                "operating_profit": op,
                "net_profit": npat,
                "eps": eps,
                "margin": margin,
                "revenue_growth_qoq": rev_qoq,
                "revenue_growth_yoy": rev_yoy,
                "pat_growth_qoq": pat_qoq,
                "pat_growth_yoy": pat_yoy,
                "data_source": "indianapi",
                "updated_at": datetime.utcnow().isoformat(),
            }
        )

        prev_rev = rev
        prev_pat = npat

    return rows


# ---------------------------------------------------------------------------
# Per-symbol processor
# ---------------------------------------------------------------------------


def process_symbol(symbol: str) -> bool:
    company_id = _get_company_id(symbol)
    if not company_id:
        print(f"[{symbol}] no company_id in DB — skipping")
        return False

    name_for_api = _company_name_for_api(symbol)
    data = fetch_quarter_results(name_for_api)

    if not data or "Sales" not in data:
        # Try with raw symbol as fallback
        data = fetch_quarter_results(symbol)

    if not data or "Sales" not in data:
        raise ValueError("No Sales in IndianAPI response after name + symbol attempts")

    rows = _map_to_rows(company_id, data)
    written = bulk_upsert(FINANCIALS_TABLE, rows, "company_id,quarter")
    ok = written == len(rows)

    log_event(
        "fetch_financials_api_symbol",
        {
            "symbol": symbol,
            "success": ok,
            "rows_written": written,
            "source": "indianapi",
        },
    )
    print(f"[{symbol}] quarters={written}/{len(rows)} ok={ok}")
    return ok


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    if not API_KEY:
        raise RuntimeError("INDIANAPI_KEY not set in environment or scripts/.env / .env")

    symbols = TEST_SYMBOLS if TEST_MODE else TIER1_SYMBOLS
    total = len(symbols)
    success = 0
    failed = 0

    log_event("fetch_financials_api_started", {"total_symbols": total, "test_mode": TEST_MODE})
    print(f"Starting financials fetch (IndianAPI) for {total} symbols...")

    for idx, symbol in enumerate(symbols, start=1):
        try:
            print(f"[{idx}/{total}] {symbol}...")
            if process_symbol(symbol):
                success += 1
            else:
                failed += 1
        except requests.HTTPError as exc:
            failed += 1
            print(f"[{symbol}] HTTP error: {exc}")
            log_event("fetch_financials_api_failed", {"symbol": symbol, "error": str(exc)})
        except Exception as exc:
            failed += 1
            print(f"[{symbol}] error: {exc}")
            log_event("fetch_financials_api_failed", {"symbol": symbol, "error": str(exc)})
        finally:
            time.sleep(DELAY_SECONDS)

    print(f"\nDone. success={success} failed={failed}")
    log_event(
        "fetch_financials_api_finished",
        {"success": success, "failed": failed, "total": total},
    )


if __name__ == "__main__":
    main()
