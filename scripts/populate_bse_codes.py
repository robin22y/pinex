"""Populate companies.bse_code by merging NSE/BSE masters on ISIN.

Run this once before scripts that rely on BSE scrip code.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import Any
from urllib.parse import urljoin
from zipfile import ZipFile

import requests
from bs4 import BeautifulSoup

from db import log_event, upsert
from symbols import ALL_SYMBOLS

NSE_MASTER_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
BSE_LIST_PAGE_URL = "https://www.bseindia.com/corporates/List_Scrips.aspx"
HEADERS = {"User-Agent": "Mozilla/5.0"}


def _norm(v: Any) -> str:
    return str(v or "").strip()


def _norm_isin(v: Any) -> str:
    return _norm(v).upper()


def _download_text(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=45)
    r.raise_for_status()
    return r.text


def _download_bytes(url: str) -> bytes:
    r = requests.get(url, headers=HEADERS, timeout=45)
    r.raise_for_status()
    return r.content


def download_nse_master() -> list[dict[str, str]]:
    text = _download_text(NSE_MASTER_URL)
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    for row in reader:
        rows.append({str(k).strip(): str(v).strip() for k, v in row.items()})
    return rows


def _candidate_bse_export_urls() -> list[str]:
    html = _download_text(BSE_LIST_PAGE_URL)
    soup = BeautifulSoup(html, "html.parser")
    found: list[str] = []

    # Anchor tags that look like downloads
    for a in soup.find_all("a", href=True):
        href = _norm(a.get("href"))
        text = a.get_text(" ", strip=True).lower()
        if (
            "download" in text
            or href.lower().endswith((".csv", ".zip", ".xls", ".xlsx"))
            or "download" in href.lower()
        ):
            found.append(urljoin(BSE_LIST_PAGE_URL, href))

    # Raw URL patterns embedded in HTML/JS
    for m in re.findall(
        r"https://[^\s'\"<>]+\.(?:csv|zip|xls|xlsx)",
        html,
        flags=re.I,
    ):
        found.append(m)

    # Common fallback paths seen on BSE pages
    found.extend(
        [
            "https://www.bseindia.com/download/ListScrips/list_scrips.csv",
            "https://www.bseindia.com/download/ListScrips/List_Scrips.csv",
            "https://www.bseindia.com/download/BhavCopy/Equity/list_scrips.csv",
        ],
    )

    # Deduplicate preserving order
    out: list[str] = []
    seen: set[str] = set()
    for u in found:
        if u and u not in seen:
            out.append(u)
            seen.add(u)
    return out


def _parse_table_like_csv(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    for row in reader:
        rows.append({str(k).strip(): str(v).strip() for k, v in row.items()})
    return rows


def _extract_csv_from_zip(content: bytes) -> str:
    with ZipFile(io.BytesIO(content)) as zf:
        for name in zf.namelist():
            if name.lower().endswith(".csv"):
                with zf.open(name) as fh:
                    return fh.read().decode("utf-8", errors="replace")
    raise ValueError("No CSV found in zip")


def download_bse_master() -> tuple[list[dict[str, str]], str]:
    errors: list[str] = []
    for url in _candidate_bse_export_urls():
        try:
            lower = url.lower()
            if lower.endswith(".zip"):
                txt = _extract_csv_from_zip(_download_bytes(url))
                rows = _parse_table_like_csv(txt)
            else:
                txt = _download_text(url)
                rows = _parse_table_like_csv(txt)

            if not rows:
                raise ValueError("Empty parsed rows")

            sample_cols = {c.strip().lower() for c in rows[0].keys()}
            # We need Security Code + ISIN columns in some form
            if not any("security code" in c or "scrip code" in c for c in sample_cols):
                raise ValueError("Missing Security Code column")
            if not any("isin" in c for c in sample_cols):
                raise ValueError("Missing ISIN column")

            return rows, url
        except Exception as exc:
            errors.append(f"{url} :: {exc}")
            continue

    raise RuntimeError(
        "Failed to download BSE master CSV from List_Scrips page. "
        + " | ".join(errors[:5]),
    )


def _pick_col(row: dict[str, str], names: list[str]) -> str:
    key_map = {k.strip().lower(): k for k in row.keys()}
    for n in names:
        if n in key_map:
            return _norm(row.get(key_map[n]))
    # fuzzy match
    for lk, rk in key_map.items():
        for n in names:
            if n in lk:
                return _norm(row.get(rk))
    return ""


def fetch_company_symbols() -> list[str]:
    # If companies table read fails, fall back to project symbol universe.
    try:
        symbols: list[str] = []
        from_idx = 0
        page = 5000
        while True:
            res = (
                __import__("db").supabase.table("companies")
                .select("symbol")
                .range(from_idx, from_idx + page - 1)
                .execute()
            )
            data = getattr(res, "data", None) or []
            if not data:
                break
            symbols.extend(_norm(x.get("symbol")) for x in data if _norm(x.get("symbol")))
            if len(data) < page:
                break
            from_idx += page
        return sorted(set(symbols)) if symbols else list(ALL_SYMBOLS)
    except Exception:
        return list(ALL_SYMBOLS)


def main() -> None:
    log_event("populate_bse_codes_started", {})

    nse_rows = download_nse_master()
    bse_rows, bse_source_url = download_bse_master()

    nse_by_symbol_isin: dict[str, str] = {}
    for row in nse_rows:
        symbol = _pick_col(row, ["symbol"])
        isin = _norm_isin(_pick_col(row, ["isin number", "isin"]))
        if symbol and isin:
            nse_by_symbol_isin[symbol] = isin

    bse_isin_to_code: dict[str, str] = {}
    for row in bse_rows:
        isin = _norm_isin(_pick_col(row, ["isin no", "isin", "isin number"]))
        code = _pick_col(row, ["security code", "scrip code", "security_code"])
        if code:
            m = re.search(r"\d+", code)
            code = m.group(0) if m else code
        if isin and code:
            bse_isin_to_code[isin] = code

    company_symbols = fetch_company_symbols()
    matched = 0
    unmatched: list[str] = []

    for symbol in company_symbols:
        isin = nse_by_symbol_isin.get(symbol)
        if not isin:
            unmatched.append(symbol)
            continue

        bse_code = bse_isin_to_code.get(isin)
        if not bse_code:
            unmatched.append(symbol)
            continue

        res = upsert(
            "companies",
            {
                "symbol": symbol,
                "bse_code": bse_code,
                "updated_at": datetime.utcnow().isoformat(),
            },
            "symbol",
        )
        if res is not None:
            matched += 1
        else:
            unmatched.append(symbol)

    total = len(company_symbols)
    print(f"Matched: {matched} of {total} companies")
    print(f"Unmatched: {unmatched}")
    log_event(
        "populate_bse_codes_finished",
        {
            "matched": matched,
            "total": total,
            "unmatched_count": len(unmatched),
            "bse_source_url": bse_source_url,
        },
    )


if __name__ == "__main__":
    main()
