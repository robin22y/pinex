"""
fetch_fundamentals.py — weekly refresh of key_metrics from IndianAPI.

For every company in the live universe (companies table) we hit
GET https://stock.indianapi.in/stock?name=<company_name> and extract
the 15 standard fundamentals: market_cap, pe, pb, ev_ebitda, de,
current_ratio, roe, roce, eps_ttm, revenue_ttm, pat_ttm,
dividend_yield, face_value, book_value. Anything missing in the
response is upserted as NULL — partial rows are valuable.

UPSERT
  ON CONFLICT (symbol) DO UPDATE — one row per stock, overwritten
  weekly. Set updated_at to now() on every write so a downstream
  freshness check is possible (the company-overview fetcher uses
  this pattern).

RATE LIMIT
  IndianAPI rate-limits per-key. sleep(0.2) between every call is
  enough headroom for the paid tier on ~2,100 symbols (≈ 7 min
  wall-clock).

CONTINUE-ON-ERROR
  A single bad symbol must NEVER abort the loop. Every network
  call is wrapped in try/except; failures are logged and counted
  but the script keeps going.

Run weekly via .github/workflows/weekly.yml.
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")
sys.path.insert(0, str(_script_dir))

from db import log_event, supabase  # noqa: E402

# Force UTF-8 on Windows console so non-ASCII company names don't crash.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ── Config ────────────────────────────────────────────────────────────────

INDIANAPI_KEY = os.environ.get("INDIANAPI_KEY", "")
INDIANAPI_BASE = "https://stock.indianapi.in"

KEY_METRICS_TABLE = "key_metrics"
COMPANIES_TABLE = "companies"

REQUEST_TIMEOUT_SEC = 15
SLEEP_BETWEEN_CALLS = 0.2   # per IndianAPI rate limit
LOG_EVERY_N = 100


# ── Field map — IndianAPI camelCase → our snake_case column ───────────────
# The IndianAPI response shape varies between "stockDetailsReusableData"
# (always present, intraday snapshot) and "keyMetrics" (richer but
# structured as an array of {key, value} objects). We probe both
# layers below; this map is the canonical destination naming.
FIELD_MAP_REUSABLE: dict[str, str] = {
    "marketCap":      "market_cap",
    "pe":             "pe_ratio",
    "pb":             "pb_ratio",
    "evEbitda":       "ev_ebitda",
    "de":             "de_ratio",
    "currentRatio":   "current_ratio",
    "roe":            "roe",
    "roce":           "roce",
    "eps":            "eps_ttm",
    "revenueT12M":    "revenue_ttm",
    "patT12M":        "pat_ttm",
    "dividendYield":  "dividend_yield",
    "faceValue":      "face_value",
    "bookValue":      "book_value",
}


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not (f == f):   # NaN
        return None
    return f


def _extract_from_reusable(reusable: dict[str, Any]) -> dict[str, float | None]:
    """Pull fields from stockDetailsReusableData (top-level dict)."""
    out: dict[str, float | None] = {dest: None for dest in FIELD_MAP_REUSABLE.values()}
    if not isinstance(reusable, dict):
        return out
    for src, dest in FIELD_MAP_REUSABLE.items():
        out[dest] = _safe_float(reusable.get(src))
    return out


def _extract_from_key_metrics(km: Any) -> dict[str, float | None]:
    """keyMetrics is a dict of sections; each section is a list of
    {key, value} objects. Flatten into a {key: value} dict and map."""
    flat: dict[str, Any] = {}
    if isinstance(km, dict):
        for section in km.values():
            if not isinstance(section, list):
                continue
            for item in section:
                if isinstance(item, dict) and "key" in item:
                    flat[item["key"]] = item.get("value")
    out: dict[str, float | None] = {}
    for src, dest in FIELD_MAP_REUSABLE.items():
        if src in flat:
            out[dest] = _safe_float(flat[src])
    return out


def _merge_extracts(*sources: dict[str, float | None]) -> dict[str, float | None]:
    """First-non-null win across multiple extracts."""
    merged: dict[str, float | None] = {}
    for dest in FIELD_MAP_REUSABLE.values():
        for src in sources:
            v = src.get(dest)
            if v is not None:
                merged[dest] = v
                break
        merged.setdefault(dest, None)
    return merged


def fetch_metrics(symbol: str, name: str) -> dict[str, float | None] | None:
    """Single IndianAPI call. Returns the extracted dict or None on
    network / JSON / status failure."""
    headers = {"x-api-key": INDIANAPI_KEY}
    try:
        r = requests.get(
            f"{INDIANAPI_BASE}/stock",
            headers=headers,
            params={"name": name or symbol},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception as exc:  # noqa: BLE001
        print(f"  ! IndianAPI error for {symbol}: {exc}")
        return None
    reusable = _extract_from_reusable(data.get("stockDetailsReusableData") or {})
    km = _extract_from_key_metrics(data.get("keyMetrics"))
    merged = _merge_extracts(reusable, km)
    # If every field is None → treat as a miss so caller logs it
    if not any(v is not None for v in merged.values()):
        return None
    return merged


# ── Companies list ────────────────────────────────────────────────────────


def fetch_all_companies() -> list[dict[str, Any]]:
    """Paginated read of every company. Returns [{symbol, name}]."""
    rows: list[dict[str, Any]] = []
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table(COMPANIES_TABLE)
            .select("symbol,name")
            .order("symbol")
            .range(start, start + page - 1)
            .execute()
        )
        batch = getattr(res, "data", None) or []
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


# ── Upsert ────────────────────────────────────────────────────────────────


def upsert_metrics(symbol: str, metrics: dict[str, float | None]) -> bool:
    """Per-row upsert into key_metrics. Returns True on success."""
    row = {
        "symbol":     symbol,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **metrics,
    }
    try:
        supabase.table(KEY_METRICS_TABLE).upsert(row, on_conflict="symbol").execute()
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! upsert failed for {symbol}: {exc}")
        return False


# ── Main ─────────────────────────────────────────────────────────────────


def main() -> None:
    if not INDIANAPI_KEY:
        print("INDIANAPI_KEY env var is not set. Aborting.")
        return

    log_event("fetch_fundamentals_started", {})

    companies = fetch_all_companies()
    print(f"fetch_fundamentals — {len(companies)} companies to process")

    success = 0
    failed = 0
    skipped = 0

    for i, co in enumerate(companies):
        symbol = str(co.get("symbol") or "").strip()
        name = str(co.get("name") or "").strip() or symbol
        if not symbol:
            skipped += 1
            continue

        metrics = fetch_metrics(symbol, name)
        if metrics is None:
            failed += 1
        else:
            if upsert_metrics(symbol, metrics):
                success += 1
            else:
                failed += 1

        time.sleep(SLEEP_BETWEEN_CALLS)

        if (i + 1) % LOG_EVERY_N == 0:
            print(
                f"  progress {i+1}/{len(companies)} — "
                f"success={success} failed={failed} skipped={skipped}",
                flush=True,
            )

    print(
        f"\nfetch_fundamentals done. "
        f"success={success} failed={failed} skipped={skipped}",
    )
    log_event(
        "fetch_fundamentals_finished",
        {"success": success, "failed": failed, "skipped": skipped},
    )


if __name__ == "__main__":
    main()
