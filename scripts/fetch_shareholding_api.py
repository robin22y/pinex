"""Fetch shareholding pattern via IndianAPI /historical_stats endpoint.

Replaces fetch_shareholding.py (Screener scraper).
Run: python scripts/fetch_shareholding_api.py [--test]
   or: cd scripts && python fetch_shareholding_api.py [--test]

IndianAPI stats value: shareholding_pattern_quarterly

Expected response shape:
  {
    "Promoters": {"Jun 2024": 72.89, "Mar 2024": 72.91, ...},
    "FIIs":      {"Jun 2024": 12.34, ...},
    "DIIs":      {"Jun 2024": 8.12,  ...},
    "Public":    {"Jun 2024": 6.65,  ...},
    "Pledged %": {"Jun 2024": 0.0,   ...}   <- may be absent
  }

Mapped to Pinex `shareholding` table columns:
  promoter_pct, fii_pct, dii_pct, public_pct,
  promoter_pledge_pct, quarter, company_id
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
SHAREHOLDING_TABLE = "shareholding"
DELAY_SECONDS = 1.2

TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["TCS", "INFY", "HDFCBANK"]


# ---------------------------------------------------------------------------
# Helpers (aligned with fetch_financials_api.py)
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
    raw = raw.strip()
    if re.search(r"\b\d{4}\b", raw):
        return raw
    m = re.match(r"([A-Za-z]+)\s+(\d{2})$", raw)
    if m:
        month, yr = m.group(1), int(m.group(2))
        year = 2000 + yr if yr < 50 else 1900 + yr
        return f"{month} {year}"
    return raw


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
    meta = COMPANY_META.get(symbol, {})
    name = meta.get("name", "")
    if name:
        name = re.sub(r"\b(Ltd\.?|Limited|Corporation|Corp\.?)\s*$", "", name, flags=re.I).strip()
    return name or symbol


def _pick_category_series(data: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    """Return the first matching sub-dict for given category label keys (case-sensitive then case-insensitive)."""
    for k in keys:
        if k in data:
            return data[k] if isinstance(data[k], dict) else {}
    lower_data = {str(dk).lower(): dv for dk, dv in data.items()}
    for k in keys:
        lk = k.lower()
        if lk in lower_data and isinstance(lower_data[lk], dict):
            return lower_data[lk]
    return {}


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------


def fetch_shareholding_pattern(stock_name: str) -> dict[str, Any]:
    url = f"{BASE_URL}/historical_stats"
    params = {"stock_name": stock_name, "stats": "shareholding_pattern_quarterly"}
    resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
    resp.raise_for_status()
    raw = resp.json()
    return raw if isinstance(raw, dict) else {}


# ---------------------------------------------------------------------------
# Mapper
# ---------------------------------------------------------------------------

_PROMOTER_KEYS = ["Promoters", "Promoter", "Promoter Holdings"]
_FII_KEYS = ["FIIs", "FII", "Foreign Institutions"]
_DII_KEYS = ["DIIs", "DII", "Domestic Institutions"]
_PUBLIC_KEYS = ["Public", "Public Shareholding"]
_PLEDGE_KEYS = ["Pledged %", "Pledge %", "Promoter Pledge", "Pledged"]


def _promoter_series_nonempty(data: dict[str, Any]) -> bool:
    m = _pick_category_series(data, _PROMOTER_KEYS)
    return bool(m)


def _map_to_rows(symbol: str, company_id: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Pivot quarter->category response into one row per quarter.
    Tries common key variations IndianAPI may use.
    """

    promoter_map = _pick_category_series(data, _PROMOTER_KEYS)
    fii_map = _pick_category_series(data, _FII_KEYS)
    dii_map = _pick_category_series(data, _DII_KEYS)
    public_map = _pick_category_series(data, _PUBLIC_KEYS)
    pledge_map = _pick_category_series(data, _PLEDGE_KEYS)

    if not promoter_map:
        raise ValueError("No promoter data in response — check stock name or API response shape")

    quarter_keys = list(promoter_map.keys())
    rows: list[dict[str, Any]] = []

    for raw_q in quarter_keys:
        q = _normalise_quarter(raw_q)

        promoter = _to_float(promoter_map.get(raw_q))
        fii = _to_float(fii_map.get(raw_q))
        dii = _to_float(dii_map.get(raw_q))
        public = _to_float(public_map.get(raw_q))
        pledge = _to_float(pledge_map.get(raw_q)) if pledge_map else None

        rows.append(
            {
                "company_id": company_id,
                "quarter": q,
                "promoter_pct": promoter,
                "fii_pct": fii,
                "dii_pct": dii,
                "public_pct": public,
                "promoter_pledge_pct": pledge,
                "data_source": "indianapi",
                "updated_at": datetime.utcnow().isoformat(),
            }
        )

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
    data = fetch_shareholding_pattern(name_for_api)

    if not data or not _promoter_series_nonempty(data):
        data = fetch_shareholding_pattern(symbol)

    if not data or not _promoter_series_nonempty(data):
        raise ValueError("No promoter shareholding series in IndianAPI response after name + symbol attempts")

    rows = _map_to_rows(symbol, company_id, data)
    written = bulk_upsert(SHAREHOLDING_TABLE, rows, "company_id,quarter")
    ok = written == len(rows)

    log_event(
        "fetch_shareholding_api_symbol",
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

    log_event("fetch_shareholding_api_started", {"total_symbols": total, "test_mode": TEST_MODE})
    print(f"Starting shareholding fetch (IndianAPI) for {total} symbols...")

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
            log_event("fetch_shareholding_api_failed", {"symbol": symbol, "error": str(exc)})
        except Exception as exc:
            failed += 1
            print(f"[{symbol}] error: {exc}")
            log_event("fetch_shareholding_api_failed", {"symbol": symbol, "error": str(exc)})
        finally:
            time.sleep(DELAY_SECONDS)

    print(f"\nDone. success={success} failed={failed}")
    log_event(
        "fetch_shareholding_api_finished",
        {"success": success, "failed": failed, "total": total},
    )


if __name__ == "__main__":
    main()
