"""
fetch_company_overview.py — weekly refresh of company_overview from
IndianAPI.

For every company we hit GET https://stock.indianapi.in/stock?name=
<company_name> and extract the narrative profile fields: about,
business_model, products_brands, founded_year, headquarters,
employee_count, promoter_names.

FRESHNESS GATE
  If the company_overview row already exists AND was updated less
  than 30 days ago, skip — narrative facts don't change weekly and
  IndianAPI has a per-key request budget. A re-run after 30 days
  refreshes the row.

UPSERT
  ON CONFLICT (symbol) DO UPDATE. updated_at stamped on every write.

RATE LIMIT
  sleep(0.2) between calls, same as fetch_fundamentals.py.

CONTINUE-ON-ERROR
  Single bad symbol never aborts the loop.

Run weekly via .github/workflows/weekly.yml, AFTER fetch_fundamentals.py.
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")
sys.path.insert(0, str(_script_dir))

from db import log_event, supabase  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ── Config ────────────────────────────────────────────────────────────────

INDIANAPI_KEY = os.environ.get("INDIANAPI_KEY", "")
INDIANAPI_BASE = "https://stock.indianapi.in"

OVERVIEW_TABLE = "company_overview"
COMPANIES_TABLE = "companies"

REQUEST_TIMEOUT_SEC = 15
SLEEP_BETWEEN_CALLS = 0.2
LOG_EVERY_N = 100
STALE_AFTER_DAYS = 30   # rows older than this get re-fetched


def _truncate(s: Any, n: int = 4000) -> str | None:
    """Trim narrative-ish fields to a sensible max so a single row
    can't blow up the table size."""
    if s is None:
        return None
    txt = str(s).strip()
    if not txt:
        return None
    return txt[:n]


def _safe_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# ── IndianAPI extraction ─────────────────────────────────────────────────
# The endpoint returns a deep nested object. We probe the common
# locations for each field; any field that isn't present in the
# response lands as None in the upsert.


def _pick(obj: Any, *paths: str) -> Any:
    """Try multiple dot-paths against the nested dict; return the
    first non-empty hit. e.g. _pick(data, 'companyProfile.about',
    'profile.description')."""
    if not isinstance(obj, dict):
        return None
    for path in paths:
        cur: Any = obj
        ok = True
        for part in path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                ok = False
                break
        if ok and cur not in (None, "", [], {}):
            return cur
    return None


def extract_overview(data: dict[str, Any]) -> dict[str, Any]:
    """Map the IndianAPI payload onto our column shape. Tolerant of
    missing fields — every key in the returned dict may be None."""
    return {
        "about":           _truncate(_pick(
            data,
            "companyProfile.about",
            "companyProfile.description",
            "profile.about",
            "profile.description",
            "stockDetailsReusableData.about",
        )),
        "business_model":  _truncate(_pick(
            data,
            "companyProfile.businessModel",
            "profile.businessModel",
        )),
        "products_brands": _truncate(_pick(
            data,
            "companyProfile.productsAndBrands",
            "companyProfile.products",
            "profile.products",
        )),
        "founded_year":    _safe_int(_pick(
            data,
            "companyProfile.foundedYear",
            "companyProfile.yearOfIncorporation",
            "profile.founded",
        )),
        "headquarters":    _truncate(_pick(
            data,
            "companyProfile.headquarters",
            "companyProfile.address",
            "profile.headquarters",
        ), n=500),
        "employee_count":  _safe_int(_pick(
            data,
            "companyProfile.employeeCount",
            "profile.employees",
        )),
        "promoter_names":  _truncate(_pick(
            data,
            "companyProfile.promoters",
            "shareHolding.promoterNames",
        ), n=2000),
    }


def fetch_overview(symbol: str, name: str) -> dict[str, Any] | None:
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
    overview = extract_overview(data)
    if not any(v is not None for v in overview.values()):
        return None
    return overview


# ── Companies + freshness ────────────────────────────────────────────────


def fetch_all_companies() -> list[dict[str, Any]]:
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


def fetch_existing_freshness() -> dict[str, datetime]:
    """Return {symbol: updated_at_datetime} for every row already in
    company_overview. Used by the freshness gate so we only re-fetch
    rows older than STALE_AFTER_DAYS."""
    out: dict[str, datetime] = {}
    try:
        page = 1000
        start = 0
        while True:
            res = (
                supabase.table(OVERVIEW_TABLE)
                .select("symbol,updated_at")
                .range(start, start + page - 1)
                .execute()
            )
            batch = getattr(res, "data", None) or []
            for r in batch:
                sym = r.get("symbol")
                ts = r.get("updated_at")
                if not sym or not ts:
                    continue
                try:
                    out[sym] = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                except ValueError:
                    continue
            if len(batch) < page:
                break
            start += page
    except Exception as exc:  # noqa: BLE001
        print(f"  ! freshness fetch failed: {exc}")
    return out


def is_fresh(symbol: str, freshness: dict[str, datetime]) -> bool:
    ts = freshness.get(symbol)
    if ts is None:
        return False
    age = datetime.now(timezone.utc) - ts
    return age < timedelta(days=STALE_AFTER_DAYS)


# ── Upsert ───────────────────────────────────────────────────────────────


def upsert_overview(symbol: str, overview: dict[str, Any]) -> bool:
    row = {
        "symbol":     symbol,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **overview,
    }
    try:
        supabase.table(OVERVIEW_TABLE).upsert(row, on_conflict="symbol").execute()
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! upsert failed for {symbol}: {exc}")
        return False


# ── Main ─────────────────────────────────────────────────────────────────


def main() -> None:
    if not INDIANAPI_KEY:
        print("INDIANAPI_KEY env var is not set. Aborting.")
        return

    log_event("fetch_company_overview_started", {})

    companies = fetch_all_companies()
    print(f"fetch_company_overview — {len(companies)} companies to process")

    freshness = fetch_existing_freshness()
    print(f"  {len(freshness)} rows already in company_overview")

    success = 0
    failed = 0
    skipped_fresh = 0

    for i, co in enumerate(companies):
        symbol = str(co.get("symbol") or "").strip()
        name = str(co.get("name") or "").strip() or symbol
        if not symbol:
            continue

        if is_fresh(symbol, freshness):
            skipped_fresh += 1
            continue

        overview = fetch_overview(symbol, name)
        if overview is None:
            failed += 1
        else:
            if upsert_overview(symbol, overview):
                success += 1
            else:
                failed += 1

        time.sleep(SLEEP_BETWEEN_CALLS)

        if (i + 1) % LOG_EVERY_N == 0:
            print(
                f"  progress {i+1}/{len(companies)} — "
                f"success={success} failed={failed} skipped_fresh={skipped_fresh}",
                flush=True,
            )

    print(
        f"\nfetch_company_overview done. "
        f"success={success} failed={failed} skipped_fresh={skipped_fresh}",
    )
    log_event(
        "fetch_company_overview_finished",
        {"success": success, "failed": failed, "skipped_fresh": skipped_fresh},
    )


if __name__ == "__main__":
    main()
