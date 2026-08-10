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
  python scripts/fetch_indianapi.py                       # all TIER1_SYMBOLS (legacy default)
  python scripts/fetch_indianapi.py --test                # 3 symbols only
  python scripts/fetch_indianapi.py --tier=1 --news-only  # daily news refresh for tier 1
  python scripts/fetch_indianapi.py --tier=2 --news-only  # weekly news refresh for tier 2
  python scripts/fetch_indianapi.py --quarterly           # all tiers, financials + shareholding + actions
  python scripts/fetch_indianapi.py --shareholding-only --all-tiers  # tiers 1–3, /stock for SH only; skip if SH updated in 90d

Flags:
  --tier=N            Only fetch companies where companies.tier = N (1, 2, 3). Highest precedence.
  --quarterly         Fetch financials + shareholding + corporate actions; skip news.
  --news-only         Fetch only recentNews; skip financials + shareholding + actions.
  --financials-only   Fetch only financials; skip everything else.
  --shareholding-only Only upsert shareholding (still one /stock call); skips news, financials, corporate_actions.
  --all-tiers         When no --tier=N is given: include tiers 1+2+3 (default tiers 1+2).
  --nifty500          When no --tier=N is given: include tiers 1+2 (same as default; kept for clarity).
  --force             With --shareholding-only: refetch even if shareholding rows already exist.

Schedule: nightly after market close (6:00 PM IST / 12:30 UTC)
"""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from admin_alert import esc, send_admin_telegram
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

TIER_FILTER = next(
    (int(a.split("=", 1)[1]) for a in sys.argv if a.startswith("--tier=")),
    None,
)
QUARTERLY = "--quarterly" in sys.argv
NEWS_ONLY = "--news-only" in sys.argv
FINANCIALS_ONLY = "--financials-only" in sys.argv
SHAREHOLDING_ONLY = "--shareholding-only" in sys.argv
ALL_TIERS = "--all-tiers" in sys.argv
FORCE = "--force" in sys.argv

# Section toggles derived from the mode flags. Each is True when the
# corresponding extractor should run for the current invocation.
DO_FINANCIALS = not NEWS_ONLY and not SHAREHOLDING_ONLY
DO_SHAREHOLDING = SHAREHOLDING_ONLY or (not NEWS_ONLY and not FINANCIALS_ONLY)
DO_NEWS = not QUARTERLY and not FINANCIALS_ONLY and not SHAREHOLDING_ONLY
DO_CORPORATE_ACTIONS = not NEWS_ONLY and not FINANCIALS_ONLY and not SHAREHOLDING_ONLY

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


# PostgREST on this project caps each response at 1000 rows (db-max-rows).
# Client `.limit(5000)` does not override that — you still get ≤1000 rows.
_COMPANIES_PAGE = 1000


def get_companies() -> list[dict[str, Any]]:
    """
    Return non-suspended companies (id + symbol + name + tier).

    Precedence:
      --tier=N      -> exactly that tier (preserves daily.yml/weekly.yml semantics)
      --all-tiers   -> [1, 2, 3]
      --nifty500    -> [1, 2]
      default       -> [1, 2]

    Paginates in chunks of _COMPANIES_PAGE because a single .limit(5000) still
    returns at most 1000 rows when the server max-rows is 1000.
    """
    rows_all: list[dict[str, Any]] = []
    start = 0
    while True:
        query = supabase.table("companies").select("id,symbol,name,tier")

        if TIER_FILTER is not None:
            query = query.eq("tier", TIER_FILTER)
        else:
            if ALL_TIERS:
                tiers = [1, 2, 3]
            elif "--nifty500" in sys.argv:
                tiers = [1, 2]
            else:
                tiers = [1, 2]
            query = query.in_("tier", tiers)

        res = (
            query
            .or_("is_suspended.is.null,is_suspended.eq.false")
            .order("symbol")
            .range(start, start + _COMPANIES_PAGE - 1)
            .execute()
        )
        page = getattr(res, "data", None) or []
        rows_all.extend(page)
        if len(page) < _COMPANIES_PAGE:
            break
        start += _COMPANIES_PAGE

    return [r for r in rows_all if r.get("symbol")]


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

    quarter_keys = [row["quarter"] for row in rows]

    is_annual = any(
        str(k).strip().startswith("FY")
        for k in quarter_keys
    )

    for row in rows:
        row["is_annual"] = is_annual
        row["period_type"] = (
            "annual" if is_annual
            else "quarterly"
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


# ── Corporate-action decoding ───────────────────────────────────────────
# Every one of these exists because the screener's moving averages are
# computed off UNADJUSTED closes. When a stock splits, every close before
# the event sits on the old scale, and a "200-day average" that spans the
# split averages two different currencies. scripts/fix_split_adjustments.py
# repairs that, but it can only trust an action a human — or this parser —
# actually recorded, with a ratio attached.
#
# Before this, none of that worked. TEMBO's 1:10 on 2026-08-05 went
# unrecorded, its DMAs were nonsense, the publish gate correctly refused to
# ship them, and the static screener sat frozen for six days.

# Each action type carries its own ex-date field. Bonus rows have xbDate
# and NO xdDate, so the old `item.get("xdDate")` lookup silently dropped
# every bonus ever returned — the single reason the table held 1,979 rows
# and not one of them a bonus.
#
# recordDate is the last resort, not the preference: the ex-date is the
# first session that trades on the new scale, which is exactly the date
# fix_split_adjustments keys its adjustment on. They differ by a day often
# enough to matter (Bajaj Finserv: xs 2022-09-13, record 2022-09-14).
_EX_DATE_FIELDS = {
    "dividend": ("xdDate",),
    "bonus": ("xbDate",),
    "splits": ("xsDate",),
    "rights": ("xrDate",),
}


def _ex_date_for(action_type: str, item: dict[str, Any]) -> Any:
    fields = _EX_DATE_FIELDS.get(action_type, ())
    for field in fields:
        if item.get(field):
            return item[field]
    # Unknown type, or the expected field was absent: try every ex-date
    # spelling before falling back to the record date.
    for field in ("xdDate", "xbDate", "xsDate", "xrDate",
                  "exDate", "ex_date", "recordDate"):
        if item.get(field):
            return item[field]
    return None


# The API's key is "splits"; fix_split_adjustments.load_recorded_actions
# accepts "split". Storing the plural meant a correctly-fetched split row
# would still have been ignored downstream, so normalise at the boundary.
_ACTION_TYPE_ALIASES = {"splits": "split", "stock_split": "split"}


def _norm_action_type(action_type: str) -> str:
    kind = str(action_type).strip().lower()
    return _ACTION_TYPE_ALIASES.get(kind, kind)


_BONUS_RATIO_RE = re.compile(r"ratio\s+of\s+(\d+)\s*:\s*(\d+)", re.I)


def _action_ratio(kind: str, item: dict[str, Any]) -> float | None:
    """The PRICE factor for a rescaling action, or None.

    Consistent with fix_split_adjustments: the number returned multiplies
    every close BEFORE the event to put it on today's scale.

    SPLIT — taken from the structured face values, never from the text.
      "Stock split from Rs. 5/- to Re. 1/-" also arrives as
      oldFaceValue=5, newFaceValue=1, so the factor is 1/5 exactly. Parsing
      the sentence would add a failure mode for no gain.

    BONUS — parsed from remarks, because no structured field carries it.
      "Bonus issue in the ratio of 1:1" is a new shares for every b held,
      so the holding grows from b to a+b and the price factor is b/(a+b).
      1:1 -> 1/2. This matches the two cases fix_split_adjustments already
      documents from the other direction: an 8:1 bonus is 1/9, a 5:4 bonus
      is 4/9.

    Dividends and rights return None. A dividend does not rescale the
    series, and a rights issue's effect depends on the subscription price,
    which is not in this payload — guessing one would corrupt real closes.
    """
    if kind == "split":
        old, new = item.get("oldFaceValue"), item.get("newFaceValue")
        try:
            old_f, new_f = float(old), float(new)
        except (TypeError, ValueError):
            return None
        if old_f > 0 and new_f > 0:
            return new_f / old_f
        return None

    if kind == "bonus":
        match = _BONUS_RATIO_RE.search(str(item.get("remarks") or ""))
        if not match:
            return None
        a, b = int(match.group(1)), int(match.group(2))
        if a <= 0 or b <= 0:
            return None
        return b / (a + b)

    return None


# ── Alerting on newly seen splits and bonuses ───────────────────────────
# A split that nobody notices corrupts every moving average that spans it
# and stays corrupt until the publish gate trips, which is days of a stale
# site. The operator wants to hear about it while it is still fixable.
#
# Only RESCALING actions qualify. Dividends are the overwhelming majority
# of this table and rescale nothing, so alerting on them would bury the two
# events a year that actually matter.
RESCALING_ACTIONS = ("split", "bonus")

# Alert only on actions effective within this window or still in the
# future. The API returns a company's whole history, so without a window
# the first run after this fix would report every split since listing —
# a few thousand messages about things settled years ago. Upcoming ex-dates
# are the real prize: warning arrives BEFORE the closes go bad.
RESCALE_ALERT_LOOKBACK_DAYS = 7

_PENDING_RESCALE_ALERTS: list[dict[str, Any]] = []


def _collect_rescale_alerts(symbol: str, ca_rows: list[dict[str, Any]]) -> None:
    """Queue newly seen split/bonus rows for the end-of-run alert.

    Queued rather than sent per symbol: a full run walks ~2,000 symbols,
    and one Telegram message each would be unreadable and rate-limited.
    main() sends a single digest.
    """
    cutoff = (date.today() - timedelta(days=RESCALE_ALERT_LOOKBACK_DAYS)).isoformat()
    candidates = [
        r for r in ca_rows
        if r["action_type"] in RESCALING_ACTIONS and r["action_date"] >= cutoff
    ]
    if not candidates:
        return

    # One small query, and only for the rare symbol that has a recent
    # rescaling action at all.
    try:
        existing_rows = (
            supabase.table("corporate_actions")
            .select("action_type,action_date")
            .eq("symbol", symbol)
            .in_("action_type", list(RESCALING_ACTIONS))
            .execute()
            .data
        ) or []
    except Exception as exc:  # noqa: BLE001 — never break the fetch over an alert
        print(f"[fetch_indianapi] {symbol}: could not check known actions: {exc}")
        return

    known = {(r["action_type"], str(r["action_date"])[:10]) for r in existing_rows}
    for row in candidates:
        if (row["action_type"], row["action_date"]) not in known:
            _PENDING_RESCALE_ALERTS.append(row)


def _send_rescale_alert() -> None:
    """One digest of everything newly detected this run. Never raises."""
    if not _PENDING_RESCALE_ALERTS:
        return

    rows = sorted(_PENDING_RESCALE_ALERTS, key=lambda r: (r["action_date"], r["symbol"]))
    today = date.today().isoformat()
    lines = [
        f"<b>Corporate actions detected — {len(rows)}</b>",
        "Rescaling events new to corporate_actions.",
        "",
    ]
    for row in rows:
        ratio = row.get("ratio")
        # No ratio means fix_split_adjustments cannot act on it and will
        # fall back to guessing from the price gap — say so plainly.
        if ratio:
            factor = f"price x{ratio:.4g}"
        else:
            factor = "NO RATIO — will need one recorded by hand"
        when = "upcoming" if row["action_date"] > today else "effective"
        lines.append(
            f"• <b>{esc(row['symbol'])}</b> {esc(row['action_type'])} "
            f"{when} {esc(row['action_date'])} — {factor}"
        )
        if row.get("notes"):
            lines.append(f"  <i>{esc(row['notes'])}</i>")

    lines += [
        "",
        "Closes are unadjusted, so any average spanning the ex-date is "
        "wrong until repaired:",
        "<code>python scripts/fix_split_adjustments.py --apply</code>",
        "<code>python scripts/calc_moving_averages.py</code>",
    ]

    if send_admin_telegram("\n".join(lines), source="fetch_indianapi"):
        print(f"  admin alert sent — {len(rows)} rescaling action(s)")
    else:
        # The data is already saved; a failed alert is worth a loud log
        # line and nothing more.
        print(f"  admin alert NOT delivered — {len(rows)} rescaling action(s):")
        for row in rows:
            print(f"    {row['symbol']} {row['action_type']} {row['action_date']}")


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

            ex_date = _ex_date_for(action_type, item)

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

            kind = _norm_action_type(action_type)
            rows.append(
                {
                    "symbol": symbol,
                    "company_id": company_id,
                    "action_type": kind,
                    "action_date": ex_date_norm,
                    "ratio": _action_ratio(kind, item),
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


def process_symbol(symbol: str, company_id: str | None = None) -> dict[str, int]:
    """
    Fetch once, write to enabled tables.

    Mode flags (NEWS_ONLY / FINANCIALS_ONLY / QUARTERLY) decide which
    extractors run. The API still returns everything in one call.
    """
    if company_id is None:
        company_id = _get_company_id(symbol)
    if not company_id:
        # Caller prints the line terminator (see main loop).
        return {}

    name = _company_name_for_api(symbol)
    data = fetch_stock(name)

    if not _payload_nonempty(data):
        # Retry with raw symbol if name match returned an empty payload.
        data = fetch_stock(symbol)

    counts: dict[str, int] = {
        "financials": 0,
        "shareholding": 0,
        "stock_news": 0,
        "corporate_actions": 0,
    }

    if DO_FINANCIALS:
        fin_rows = _extract_financials(company_id, data)
        if fin_rows:
            counts["financials"] = bulk_upsert(
                "financials", fin_rows, "company_id,quarter"
            )

    if DO_SHAREHOLDING:
        sh_rows = _extract_shareholding(company_id, data)
        if sh_rows:
            counts["shareholding"] = bulk_upsert(
                "shareholding", sh_rows, "company_id,quarter"
            )

    if DO_NEWS:
        news_rows = _extract_news(symbol, company_id, data)
        if news_rows:
            counts["stock_news"] = bulk_upsert(
                "stock_news", news_rows, "symbol,url"
            )

    if DO_CORPORATE_ACTIONS:
        ca_rows = _extract_corporate_actions(symbol, company_id, data)
        if ca_rows:
            # Collected BEFORE the upsert — afterwards every row looks
            # like one we already knew about.
            _collect_rescale_alerts(symbol, ca_rows)
            counts["corporate_actions"] = bulk_upsert(
                "corporate_actions", ca_rows, "symbol,action_type,action_date"
            )

    return counts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _mode_label() -> str:
    if NEWS_ONLY:
        return "news-only"
    if FINANCIALS_ONLY:
        return "financials-only"
    if SHAREHOLDING_ONLY:
        return "shareholding-only"
    if QUARTERLY:
        return "quarterly"
    return "full"


def main() -> None:
    if not API_KEY:
        raise RuntimeError("INDIANAPI_KEY not set in environment or scripts/.env / .env")

    # Symbol source priority:
    #   --test                       → small hard-coded list (legacy)
    #   --tier=N / --quarterly /
    #   --shareholding-only / etc.   → DB-driven (get_companies handles tier set)
    #   otherwise                    → TIER1_SYMBOLS (legacy daily run)
    SymRow = tuple[str, str | None, int | None]
    if TEST_MODE:
        symbol_list: list[SymRow] = [(s, None, None) for s in TEST_SYMBOLS]
    elif TIER_FILTER is not None or QUARTERLY or SHAREHOLDING_ONLY or ALL_TIERS or "--nifty500" in sys.argv:
        companies = get_companies()
        symbol_list = [
            (str(c["symbol"]), str(c["id"]), c.get("tier"))
            for c in companies if c.get("symbol")
        ]
    else:
        symbol_list = [(s, None, None) for s in TIER1_SYMBOLS]

    total = len(symbol_list)
    mode = _mode_label()
    if TIER_FILTER is not None:
        tier_label = str(TIER_FILTER)
    elif ALL_TIERS:
        tier_label = "1+2+3"
    else:
        tier_label = "1+2"

    totals = {"financials": 0, "shareholding": 0, "stock_news": 0, "corporate_actions": 0}
    success = 0
    failed = 0
    skipped = 0

    log_event(
        "fetch_indianapi_started",
        {
            "total_symbols": total,
            "test_mode": TEST_MODE,
            "mode": mode,
            "tier_filter": TIER_FILTER,
            "quarterly": QUARTERLY,
            "news_only": NEWS_ONLY,
            "financials_only": FINANCIALS_ONLY,
            "shareholding_only": SHAREHOLDING_ONLY,
            "all_tiers": ALL_TIERS,
            "force": FORCE,
        },
    )
    print(
        f"Starting IndianAPI fetch — mode={mode} tier={tier_label} "
        f"symbols={total}\n"
    )

    for idx, (symbol, company_id, tier) in enumerate(symbol_list, start=1):
        tier_txt = tier if tier is not None else "?"
        print(f"[{idx}/{total}] {symbol} (tier {tier_txt})...", end=" ", flush=True)

        # --shareholding-only: skip companies that already have shareholding rows
        # unless --force. (Existence check; ordering is irrelevant for `if data`.)
        if SHAREHOLDING_ONLY and company_id and not FORCE:
            existing = (
                supabase.table("shareholding")
                .select("quarter")
                .eq("company_id", company_id)
                .order("quarter", desc=True)
                .limit(1)
                .execute()
            )
            if getattr(existing, "data", None):
                skipped += 1
                print("skip (has shareholding)")
                continue

        log_event("fetch_indianapi_symbol", {"symbol": symbol})
        try:
            counts = process_symbol(symbol, company_id=company_id)
            if counts:
                success += 1
                for k in totals:
                    totals[k] += counts.get(k, 0)
                print(
                    f"fin={counts['financials']} "
                    f"sh={counts['shareholding']} "
                    f"news={counts['stock_news']} "
                    f"ca={counts['corporate_actions']}"
                )
            else:
                failed += 1
                print("no_data")
        except requests.HTTPError as exc:
            failed += 1
            code = getattr(getattr(exc, "response", None), "status_code", "?")
            print(f"HTTP {code}: {exc}")
            log_event("fetch_indianapi_failed", {"symbol": symbol, "error": str(exc)})
        except Exception as exc:
            failed += 1
            print(f"error: {exc}")
            log_event("fetch_indianapi_failed", {"symbol": symbol, "error": str(exc)})
        finally:
            time.sleep(DELAY_SECONDS)

    print(f"\nDone. success={success} failed={failed}", end="")
    if SHAREHOLDING_ONLY:
        print(f" skipped={skipped}", end="")
    print()
    print(f"  financials={totals['financials']} rows")
    print(f"  shareholding={totals['shareholding']} rows")
    print(f"  news={totals['stock_news']} rows")
    print(f"  corporate_actions={totals['corporate_actions']} rows")

    _send_rescale_alert()

    # Clean old news — keep only last 30 days
    try:
        cutoff_30 = (date.today() - timedelta(days=30)).isoformat()
        supabase.table("stock_news").delete().lt("published_at", cutoff_30).execute()
        print("  stock_news: cleaned (>30 days removed)")
    except Exception as e:
        print(f"  stock_news cleanup error: {e}")

    log_event(
        "fetch_indianapi_finished",
        {
            "success": success,
            "failed": failed,
            "total": total,
            "mode": mode,
            "tier_filter": TIER_FILTER,
            "shareholding_only": SHAREHOLDING_ONLY,
            "all_tiers": ALL_TIERS,
            "skipped": skipped if SHAREHOLDING_ONLY else 0,
            **totals,
        },
    )


if __name__ == "__main__":
    main()
