"""Consolidated IndianAPI fetcher — one /stock call per symbol.

Feeds four tables in one pass:
  - financials
  - shareholding
  - stock_news
  - corporate_actions

Replaces:
  - fetch_financials.py      (Screener scraper)
  - fetch_shareholding.py    (Screener scraper)

Run:
  python scripts/fetch_indianapi.py           # all TIER1_SYMBOLS
  python scripts/fetch_indianapi.py --test    # 3 symbols only

Schedule: nightly after market close (6:00 PM IST / 12:30 UTC)
"""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from db import bulk_upsert, log_event, supabase
from score_sentiment import score_headlines
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
DELAY_SECONDS = 1.5  # 1 req/sec limit on Developer plan; 1.5s gives headroom

TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["TCS", "INFY", "HDFCBANK"]

TODAY = date.today().isoformat()


# ---------------------------------------------------------------------------
# Shared helpers
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
    """'Jun 24' -> 'Jun 2024', 'Mar 2024' stays as-is."""
    raw = raw.strip()
    if re.search(r"\b\d{4}\b", raw):
        return raw
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
    """Strip legal suffixes that confuse IndianAPI name matching."""
    meta = COMPANY_META.get(symbol, {})
    name = meta.get("name", "")
    if name:
        name = re.sub(r"\b(Ltd\.?|Limited|Corporation|Corp\.?)\s*$", "", name, flags=re.I).strip()
    return name or symbol


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------


def fetch_stock(stock_name: str) -> dict[str, Any]:
    """Single GET /stock?name=... returns everything."""
    resp = requests.get(
        f"{BASE_URL}/stock",
        headers=HEADERS,
        params={"name": stock_name},
        timeout=30,
    )
    resp.raise_for_status()
    raw = resp.json()
    return raw if isinstance(raw, dict) else {}


# ---------------------------------------------------------------------------
# Extractor: financials
# ---------------------------------------------------------------------------


def _extract_financials(
    company_id: str,
    data: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    financials is a list of annual statements.
    Each item has stockFinancialMap with INC/BAL/CAS arrays.
    Each metric: {key, value, qoQComp, yqoQComp}
    """
    statements = data.get("financials") or []
    if not isinstance(statements, list) or not statements:
        return []

    rows: list[dict[str, Any]] = []

    for stmt in statements:
        fiscal_year = str(stmt.get("FiscalYear") or "")
        end_date = stmt.get("EndDate") or ""
        period_type = stmt.get("Type") or "Annual"
        fin_map = stmt.get("stockFinancialMap") or {}

        # Only process Annual statements
        if period_type != "Annual":
            continue

        def _get_val(section: str, key: str) -> float | None:
            items = fin_map.get(section) or []
            if not isinstance(items, list):
                return None
            for item in items:
                if not isinstance(item, dict):
                    continue
                if item.get("key") == key:
                    return _to_float(item.get("value"))
            return None

        revenue = _get_val("INC", "Revenue") or _get_val("INC", "TotalRevenue")
        net_profit = _get_val("INC", "NetIncome")
        op_profit = _get_val("INC", "OperatingIncome")
        eps = _get_val("INC", "DilutedNormalizedEPS") or _get_val("INC", "DilutedEPSExcludingExtraOrdItems")

        margin: float | None = None
        if op_profit is not None and revenue not in (None, 0):
            margin = round((op_profit / revenue) * 100.0, 2)

        # Use fiscal year as quarter label for annual statements
        q = f"FY{fiscal_year}" if fiscal_year else (str(end_date)[:7] if end_date else "")

        rows.append(
            {
                "company_id": company_id,
                "quarter": q,
                "revenue": revenue,
                "operating_profit": op_profit,
                "net_profit": net_profit,
                "pat": net_profit,
                "eps": eps,
                "margin": margin,
                "revenue_growth_qoq": None,
                "revenue_growth_yoy": None,
                "pat_growth_qoq": None,
                "pat_growth_yoy": None,
                "data_source": "indianapi",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    # Compute YoY growth now that all rows are built oldest->newest
    for i, row in enumerate(rows):
        if i > 0:
            row["revenue_growth_yoy"] = _pct_growth(row["revenue"], rows[i - 1]["revenue"])
            row["pat_growth_yoy"] = _pct_growth(row["net_profit"], rows[i - 1]["net_profit"])

    return rows


# ---------------------------------------------------------------------------
# Extractor: shareholding
# ---------------------------------------------------------------------------


def _extract_shareholding(
    company_id: str,
    data: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    shareholding is a list of category objects:
    {
      displayName: "Promoter",
      categories: [{holdingDate: "2025-06-30", percentage: "71.77"}, ...]
    }
    Pivot: one row per holdingDate.
    """
    sh_list = data.get("shareholding") or []
    if not isinstance(sh_list, list) or not sh_list:
        return []

    # Build date -> category -> percentage map
    date_map: dict[str, dict[str, float | None]] = {}

    for cat in sh_list:
        if not isinstance(cat, dict):
            continue
        display = (cat.get("displayName") or "").strip()
        for entry in cat.get("categories") or []:
            if not isinstance(entry, dict):
                continue
            hold_date = entry.get("holdingDate") or ""
            pct = _to_float(entry.get("percentage"))
            if not hold_date:
                continue
            if hold_date not in date_map:
                date_map[hold_date] = {}
            date_map[hold_date][display] = pct

    rows: list[dict[str, Any]] = []
    for hold_date, cats in sorted(date_map.items()):
        # Normalise holdingDate "2025-06-30" -> "Jun 2025"
        try:
            d = date.fromisoformat(hold_date)
            q = d.strftime("%b %Y")
        except ValueError:
            q = hold_date

        promoter = cats.get("Promoter")
        fii = cats.get("FII") or cats.get("Foreign Institutional Investors")
        dii = cats.get("DII") or cats.get("Domestic Institutional Investors")
        public = cats.get("Public") or cats.get("Public Shareholding")
        pledge = cats.get("Pledged") or cats.get("Pledge")

        total: float | None = None
        if all(v is not None for v in (promoter, fii, dii, public)):
            total = round(float(promoter) + float(fii) + float(dii) + float(public), 2)

        rows.append(
            {
                "company_id": company_id,
                "quarter": q,
                "promoter_pct": promoter,
                "fii_pct": fii,
                "dii_pct": dii,
                "public_pct": public,
                "total_pct": total,
                "promoter_pledge_pct": pledge,
                "data_source": "indianapi",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    # Deduplicate by quarter — keep last occurrence
    seen: dict[str, dict] = {}
    for row in rows:
        seen[row["quarter"]] = row
    rows = list(seen.values())

    return rows


# ---------------------------------------------------------------------------
# Extractor: news
# ---------------------------------------------------------------------------


def _extract_news(
    symbol: str,
    company_id: str,
    data: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    data["recentNews"] is a list of news article objects.
    Exact field names vary; we try common patterns.
    """
    articles = data.get("recentNews") or []
    if not isinstance(articles, list):
        return []

    rows: list[dict[str, Any]] = []
    for item in articles:
        if not isinstance(item, dict):
            continue

        title = (
            str(item.get("title") or item.get("headline") or item.get("name") or "").strip()
        )
        url = str(item.get("url") or item.get("link") or item.get("href") or "").strip()
        source = str(
            item.get("source") or item.get("publisher") or item.get("provider") or ""
        ).strip()
        pub_raw = item.get("publishedAt") or item.get("published_at") or item.get("date") or item.get("datetime")

        if not title or not url:
            continue

        published_at: str | None = None
        if pub_raw is not None and str(pub_raw).strip():
            published_at = str(pub_raw).strip()

        rows.append(
            {
                "symbol": symbol,
                "company_id": company_id,
                "title": title,
                "url": url,
                "source": source or None,
                "published_at": published_at,
                "fetched_date": TODAY,
                "sentiment_score": None,
                "sentiment_scored_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    # Score all headlines in one Claude call
    import html

    cleaned_titles = []
    for r in rows:
        t = r["title"] or ""
        t = re.sub(r"<[^>]+>", "", t)  # strip all HTML tags
        t = html.unescape(t)  # decode &amp; &#span; etc
        t = re.sub(r"\s+", " ", t).strip()
        r["title"] = t  # also clean the stored title
        cleaned_titles.append(t)
    titles = cleaned_titles
    if titles:
        scores = score_headlines(titles)
        for row, score in zip(rows, scores):
            row["sentiment_score"] = score
            row["sentiment_scored_at"] = datetime.now(timezone.utc).isoformat()

    return rows


# ---------------------------------------------------------------------------
# Extractor: corporate actions
# ---------------------------------------------------------------------------


def _extract_corporate_actions(
    symbol: str,
    company_id: str,
    data: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    stockCorporateActionData is a dict:
    {bonus, dividend, rights, splits, annualGeneralMeeting, boardMeetings}
    Each value is a list of action objects.
    """
    ca_data = data.get("stockCorporateActionData") or {}
    if not isinstance(ca_data, dict):
        return []

    rows: list[dict[str, Any]] = []

    for action_type, items in ca_data.items():
        if not isinstance(items, list):
            continue
        # Skip routine meetings to save rows
        if action_type in ("annualGeneralMeeting", "boardMeetings"):
            continue

        for item in items:
            if not isinstance(item, dict):
                continue

            ex_date = item.get("xdDate") or item.get("exDate") or item.get("ex_date")

            def _norm_date(d: Any) -> str | None:
                if not d:
                    return None
                txt = str(d).strip()
                if re.match(r"\d{4}-\d{2}-\d{2}", txt):
                    return txt[:10]
                return txt or None

            ex_date_norm = _norm_date(ex_date)

            # Skip if no ex_date — can't deduplicate without it
            if not ex_date_norm:
                continue

            rows.append(
                {
                    "symbol": symbol,
                    "company_id": company_id,
                    "action_type": action_type.lower(),
                    "action_date": ex_date_norm,
                    "notes": item.get("remarks") or "",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )

    # Deduplicate by action_type + action_date
    seen: dict[str, dict] = {}
    for row in rows:
        key = f"{row['action_type']}_{row['action_date']}"
        seen[key] = row
    rows = list(seen.values())

    return rows


# ---------------------------------------------------------------------------
# Per-symbol processor
# ---------------------------------------------------------------------------


def _payload_nonempty(data: dict[str, Any]) -> bool:
    """True if response looks usable (at least one of the main blocks present)."""
    if not data:
        return False
    fin = data.get("financials") or data.get("initialStockFinancialData")
    sh = data.get("shareholding")
    if fin or sh:
        return True
    if data.get("recentNews") or data.get("stockCorporateActionData"):
        return True
    return False


def process_symbol(symbol: str) -> dict[str, int]:
    """
    Fetch once, write to all four tables.
    Returns counts written per table.
    """
    company_id = _get_company_id(symbol)
    if not company_id:
        print(f"  [{symbol}] no company_id — skipping")
        return {}

    name = _company_name_for_api(symbol)
    data = fetch_stock(name)

    if not _payload_nonempty(data):
        print(f"  [{symbol}] retrying with raw symbol...")
        data = fetch_stock(symbol)

    counts: dict[str, int] = {}

    fin_rows = _extract_financials(company_id, data)
    if fin_rows:
        counts["financials"] = bulk_upsert("financials", fin_rows, "company_id,quarter")
    else:
        counts["financials"] = 0

    sh_rows = _extract_shareholding(company_id, data)
    if sh_rows:
        counts["shareholding"] = bulk_upsert("shareholding", sh_rows, "company_id,quarter")
    else:
        counts["shareholding"] = 0

    news_rows = _extract_news(symbol, company_id, data)
    if news_rows:
        counts["stock_news"] = bulk_upsert("stock_news", news_rows, "symbol,url")
    else:
        counts["stock_news"] = 0

    ca_rows = _extract_corporate_actions(symbol, company_id, data)
    if ca_rows:
        counts["corporate_actions"] = bulk_upsert(
            "corporate_actions", ca_rows, "symbol,action_type,action_date"
        )
    else:
        counts["corporate_actions"] = 0

    print(
        f"  [{symbol}] fin={counts['financials']} "
        f"sh={counts['shareholding']} "
        f"news={counts['stock_news']} "
        f"ca={counts['corporate_actions']}"
    )
    return counts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    if not API_KEY:
        raise RuntimeError("INDIANAPI_KEY not set in environment or scripts/.env / .env")

    symbols = TEST_SYMBOLS if TEST_MODE else TIER1_SYMBOLS
    total = len(symbols)

    totals = {"financials": 0, "shareholding": 0, "stock_news": 0, "corporate_actions": 0}
    success = 0
    failed = 0

    log_event("fetch_indianapi_started", {"total_symbols": total, "test_mode": TEST_MODE})
    print(f"Starting consolidated IndianAPI fetch for {total} symbols...\n")

    for idx, symbol in enumerate(symbols, start=1):
        print(f"[{idx}/{total}] {symbol}")
        log_event("fetch_indianapi_symbol", {"symbol": symbol})
        try:
            counts = process_symbol(symbol)
            if counts:
                success += 1
                for k in totals:
                    totals[k] += counts.get(k, 0)
            else:
                failed += 1
        except requests.HTTPError as exc:
            failed += 1
            code = getattr(getattr(exc, "response", None), "status_code", "?")
            print(f"  [{symbol}] HTTP {code}: {exc}")
            log_event("fetch_indianapi_failed", {"symbol": symbol, "error": str(exc)})
        except Exception as exc:
            failed += 1
            print(f"  [{symbol}] error: {exc}")
            log_event("fetch_indianapi_failed", {"symbol": symbol, "error": str(exc)})
        finally:
            time.sleep(DELAY_SECONDS)

    print(f"\nDone. success={success} failed={failed}")
    print(f"  financials={totals['financials']} rows")
    print(f"  shareholding={totals['shareholding']} rows")
    print(f"  news={totals['stock_news']} rows")
    print(f"  corporate_actions={totals['corporate_actions']} rows")

    log_event(
        "fetch_indianapi_finished",
        {
            "success": success,
            "failed": failed,
            "total": total,
            **totals,
        },
    )


if __name__ == "__main__":
    main()
