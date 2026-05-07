"""Fetch shareholding pattern (promoters/FII/DII/public + named investors)."""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any

import requests
from bs4 import BeautifulSoup

from db import log_event, supabase, upsert
from symbols import ALL_SYMBOLS, SCREENER_SYMBOL_MAP
import sys

SHAREHOLDING_TABLE = "shareholding"
SCREENER_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
}
DELAY_SECONDS = 4.0

TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]


def _safe_log_event(event_type: str, metadata: dict[str, Any]) -> None:
    try:
        log_event(event_type, metadata)
    except Exception as exc:
        print(f"warning: log_event failed [{event_type}] -> {exc}")


def _is_saturday() -> bool:
    return datetime.now().weekday() == 5


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    txt = str(value).strip()
    if not txt or txt in ("-", "—", "NA", "N/A"):
        return None
    # keep digits, minus, dot
    txt = re.sub(r"[^0-9.\-]", "", txt)
    if txt in ("", ".", "-", "-."):
        return None
    try:
        return float(txt)
    except ValueError:
        return None


def _find_broad_shareholding_table(container: Any) -> Any | None:
    # Heuristic: find the first table that mentions all key categories.
    target_tokens = ("promoter", "fii", "dii", "public")
    for table in container.find_all("table"):
        text = table.get_text(" ", strip=True).lower()
        if all(t in text for t in target_tokens):
            return table
    # Fallback: any table containing "FII" and "DII"
    for table in container.find_all("table"):
        text = table.get_text(" ", strip=True).lower()
        if "fii" in text and "dii" in text:
            return table
    return None


def _extract_qtr_labels_and_rows(container: Any) -> list[dict[str, Any]]:
    """
    Expected output: list of 8 dicts:
      {
        quarter_name,
        promoter_pct,
        promoter_pledge_pct,
        fii_pct,
        dii_pct,
        public_pct,
        total_pct
      }
    """
    table = _find_broad_shareholding_table(container)
    if table is None:
        raise ValueError("Shareholding pattern table not found on Screener")

    # Screener tables typically: first column = category, header columns = quarters.
    headers = [th.get_text(" ", strip=True) for th in table.select("thead tr th")]
    # sometimes first th is blank/caption; quarter columns are after that.
    quarter_labels = headers[1:] if len(headers) > 1 else []

    # Build row label -> cell values aligned to quarter columns
    row_map: dict[str, list[float | None]] = {}
    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        if len(tds) < 2:
            continue
        label = tds[0].get_text(" ", strip=True).lower()
        vals: list[float | None] = []
        for td in tds[1: len(quarter_labels) + 1]:
            vals.append(_to_float(td.get_text(" ", strip=True)))
        row_map[label] = vals

    # Normalize row keys by picking best match entries
    def pick_row(match_fn) -> list[float | None]:
        for k, v in row_map.items():
            if match_fn(k):
                return v
        return []

    promoter = pick_row(lambda s: "promoter" in s and "pledge" not in s)
    promoter_pledge = pick_row(lambda s: "pledge" in s)
    fii = pick_row(lambda s: "fii" in s)
    dii = pick_row(lambda s: "dii" in s)
    public = pick_row(lambda s: "public" in s)

    # If promoter pledge isn't found via label, try "promoter holding (pledged)" patterns.
    if not promoter_pledge:
        promoter_pledge = pick_row(lambda s: "pledged" in s or "promoter pledge" in s)

    if not (promoter and fii and dii and public):
        # Try alternate layout: categories in columns (transpose)
        # If we can't parse, we fail loudly so it's obvious.
        raise ValueError(
            "Could not extract promoter/FII/DII/public from Screener shareholding table",
        )

    # Use the last 8 quarter columns (most recent)
    if not quarter_labels:
        # Some tables may use no thead; infer from row count not possible. Fail.
        raise ValueError("Quarter labels not found in shareholding table header")

    last_n = 8
    quarter_labels_last = quarter_labels[-last_n:]

    def slice_last(arr: list[float | None]) -> list[float | None]:
        return arr[-last_n:] if len(arr) >= last_n else arr + [None] * (last_n - len(arr))

    promoter_last = slice_last(promoter)
    promoter_pledge_last = slice_last(promoter_pledge) if promoter_pledge else [None] * last_n
    fii_last = slice_last(fii)
    dii_last = slice_last(dii)
    public_last = slice_last(public)

    out: list[dict[str, Any]] = []
    for i in range(last_n):
        promoter_pct = promoter_last[i]
        promoter_pledge_pct = promoter_pledge_last[i]
        fii_pct = fii_last[i]
        dii_pct = dii_last[i]
        public_pct = public_last[i]
        total_pct = None
        if all(v is not None for v in (promoter_pct, fii_pct, dii_pct, public_pct)):
            total_pct = float(promoter_pct) + float(fii_pct) + float(dii_pct) + float(public_pct)

        out.append(
            {
                "quarter": quarter_labels_last[i],
                "promoter_pct": promoter_pct,
                "promoter_pledge_pct": promoter_pledge_pct,
                "fii_pct": fii_pct,
                "dii_pct": dii_pct,
                "public_pct": public_pct,
                "total_pct": total_pct,
            },
        )

    return out


def _extract_bse_qtrid_map_from_page(soup: BeautifulSoup, quarter_names: list[str]) -> dict[str, str]:
    """
    Best-effort extraction:
    - Search for occurrences of qtrid near quarter labels in the HTML text.
    - If nothing found, return empty map and named-investor step will be skipped.
    """
    html_text = soup.get_text(" ", strip=True)

    # Look for patterns like "... qtrid=12345 ... Jun 24 ..."
    qtrid_map: dict[str, str] = {}
    for q in quarter_names:
        q_norm = re.sub(r"[^A-Za-z0-9]", "", q).lower()
        if not q_norm:
            continue

        # Search window around quarter label
        # (This is approximate; if it fails, we don't want to block the whole job.)
        m_label = re.search(re.escape(q), html_text)
        if not m_label:
            continue
        start = max(0, m_label.start() - 300)
        end = min(len(html_text), m_label.end() + 300)
        window = html_text[start:end]
        m = re.search(r"\bqtrid\b[^0-9]*(\d+)", window, flags=re.I)
        if m:
            qtrid_map[q] = m.group(1)

    return qtrid_map


def _fetch_bse_shareholding_pattern(bse_code: str, qtrid: str) -> list[dict[str, Any]]:
    url = (
        "https://api.bseindia.com/BseIndIA/api/ShareHoldingPatternData/"
        f"?scripcode={bse_code}&type=QB&qtrid={qtrid}"
    )
    res = requests.get(url, headers=BSE_HEADERS, timeout=30)
    res.raise_for_status()
    payload = res.json()

    # Generic scan for objects that look like holder rows.
    holders: list[dict[str, Any]] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, list):
            for item in obj:
                walk(item)
            return
        if not isinstance(obj, dict):
            return

        # Heuristics: look for name + pct-ish keys
        keys = {str(k).lower(): k for k in obj.keys()}
        name_key = None
        for k in ("name", "holder_name", "entity_name"):
            if k in keys:
                name_key = keys[k]
                break
        pct_key = None
        for k in ("pct", "share_pct", "holding_pct", "shareholding", "holding"):
            if k in keys:
                pct_key = keys[k]
                break
        category_key = None
        for k in ("category", "holding_category", "investor_category"):
            if k in keys:
                category_key = keys[k]
                break
        change_key = None
        for k in ("change", "change_pct", "change_in_pct", "net_change"):
            if k in keys:
                change_key = keys[k]
                break

        if name_key and pct_key:
            name = str(obj.get(name_key) or "").strip()
            pct = _to_float(obj.get(pct_key))
            category = str(obj.get(category_key) or "").strip() if category_key else ""
            change = _to_float(obj.get(change_key)) if change_key else None
            if name and pct is not None:
                holders.append(
                    {
                        "name": name,
                        "pct": pct,
                        "category": category,
                        "change": change,
                    },
                )

        # recurse
        for v in obj.values():
            walk(v)

    walk(payload)
    return holders


def _extract_named_investors(holders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    promo_tokens = ("promoter", "promoter group")
    fii_tokens = ("fii", "foreign institutional")
    dii_tokens = ("dii", "domestic institutional")

    others: list[dict[str, Any]] = []
    for h in holders:
        pct = h.get("pct")
        if pct is None or pct <= 1:
            continue
        cat = str(h.get("category") or "").lower()
        name = str(h.get("name") or "").strip()

        is_promo = any(t in cat for t in promo_tokens)
        is_fii = any(t in cat for t in fii_tokens)
        is_dii = any(t in cat for t in dii_tokens)

        if is_promo or is_fii or is_dii:
            continue

        others.append(
            {
                "name": name,
                "pct": float(pct),
                "change": h.get("change"),
            },
        )
    # stable order
    return sorted(others, key=lambda x: x["pct"], reverse=True)


def process_symbol(symbol: str) -> None:
    # Screener scrape
    screener_symbol = SCREENER_SYMBOL_MAP.get(symbol, symbol)
    screener_url = f"https://www.screener.in/company/{screener_symbol}/consolidated/"
    res = requests.get(screener_url, headers=SCREENER_HEADERS, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    shareholding_section = soup.find(id="shareholding")
    if shareholding_section is None:
        raise ValueError("Shareholding section (#shareholding) not found on consolidated page")

    quarter_rows = _extract_qtr_labels_and_rows(shareholding_section)
    quarter_names = [r["quarter"] for r in quarter_rows]

    bse_code = None
    company_id = None
    try:
        upsert(
            "companies",
            {
                "symbol": symbol,
                "name": symbol,
                "tier": 1,
            },
            "symbol",
        )
        # read companies table bse_code
        q = supabase.table("companies").select("id,bse_code").eq("symbol", symbol).limit(1).execute()
        data = getattr(q, "data", None) or []
        if data:
            bse_code = str(data[0].get("bse_code") or "").strip() or None
            company_id = data[0].get("id") or None
    except Exception:
        bse_code = None

    qtrid_map = {}
    if bse_code:
        qtrid_map = _extract_bse_qtrid_map_from_page(soup, quarter_names)

    # Named investors (>=1% and not promo/FII/DII)
    for i, row in enumerate(quarter_rows):
        total_pct = row.get("total_pct")
        data_quality_warning = False
        if total_pct is not None and (total_pct < 95 or total_pct > 105):
            data_quality_warning = True

        row["data_quality_warning"] = data_quality_warning
        row["updated_at"] = datetime.utcnow().isoformat()

        named_investors: list[dict[str, Any]] = []
        if bse_code and row["quarter"] in qtrid_map:
            qtrid = qtrid_map[row["quarter"]]
            try:
                holders = _fetch_bse_shareholding_pattern(bse_code, qtrid)
                named_investors = _extract_named_investors(holders)
            except Exception as exc:
                _safe_log_event(
                    "shareholding_bse_pattern_failed",
                    {
                        "symbol": symbol,
                        "bse_code": bse_code,
                        "quarter": row["quarter"],
                        "qtrid": qtrid,
                        "error": str(exc),
                    },
                )

        row["named_investors"] = named_investors
        # Persist
        row["company_id"] = company_id
        upsert(SHAREHOLDING_TABLE, row, "company_id,quarter")

    if TEST_MODE:
        print(f"[{symbol}] quarter rows:")
        for r in quarter_rows:
            print(" ", r)

    _safe_log_event(
        "shareholding_symbol_done",
        {
            "symbol": symbol,
            "quarters": len(quarter_rows),
            "bse_code_present": bool(bse_code),
            "qtrid_map_size": len(qtrid_map),
        },
    )
    print(f"[{symbol}] upserted {len(quarter_rows)} quarters")


def main() -> None:
    if not TEST_MODE and not _is_saturday():
        print("shareholding job skipped: runs only on Saturdays")
        _safe_log_event("shareholding_skipped_not_saturday", {"weekday": datetime.now().strftime("%A")})
        return

    symbols = TEST_SYMBOLS if TEST_MODE else ALL_SYMBOLS
    total = len(symbols)
    started = time.time()
    success = 0
    failed = 0

    _safe_log_event("shareholding_started", {"symbols": total, "test_mode": TEST_MODE})
    for i, symbol in enumerate(symbols, start=1):
        try:
            print(f"[{i}/{total}] {symbol}")
            process_symbol(symbol)
            success += 1
        except Exception as exc:
            failed += 1
            print(f"[{symbol}] failed: {exc}")
            _safe_log_event("shareholding_symbol_failed", {"symbol": symbol, "error": str(exc)})
        finally:
            time.sleep(DELAY_SECONDS)

    elapsed = round(time.time() - started, 2)
    print(f"shareholding complete success={success} failed={failed} elapsed={elapsed}s")
    _safe_log_event(
        "shareholding_finished",
        {"success_symbols": success, "failed_symbols": failed, "elapsed_sec": elapsed},
    )


if __name__ == "__main__":
    main()

