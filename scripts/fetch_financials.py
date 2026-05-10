"""Fetch quarterly financials for tier-1 symbols (Saturday-only unless --test or --force)."""

from __future__ import annotations

import re
import sys
import time
from datetime import datetime
from typing import Any

import requests
from bs4 import BeautifulSoup

from db import log_event, supabase, upsert
from symbols import COMPANY_META, TIER1_SYMBOLS

FINANCIALS_TABLE = "financials"
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
FORCE_RUN = "--force" in sys.argv
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]
SCREENER_URL_OVERRIDES = {
    "FAG": "SCHAEFFLER",  # FAG is now Schaeffler India
    "NRB": "NRB-BEARINGS",
    "PRAJ": "PRAJ-INDUSTRIES",
    "THIRUMALCHM": "THIRUMALAI-CHEMICALS",
    "BAJAJ-AUTO": "BAJAJ-AUTO",
    "MCDOWELL-N": "UNITED-SPIRITS",
    "UNITEDSPIRITS": "UNITED-SPIRITS",
}


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    txt = str(value).strip()
    if not txt or txt == "-":
        return None
    txt = re.sub(r"[^0-9.\-]", "", txt)
    if txt in ("", "-", ".", "-."):
        return None
    try:
        return float(txt)
    except ValueError:
        return None


def _pct_growth(curr: float | None, prev: float | None) -> float | None:
    if curr is None or prev in (None, 0):
        return None
    return ((curr - prev) / abs(prev)) * 100.0


def _find_quarterly_table(soup: BeautifulSoup):
    for h2 in soup.find_all(["h2", "h3"]):
        if "quarterly results" in h2.get_text(" ", strip=True).lower():
            node = h2
            while node is not None:
                node = node.find_next_sibling()
                if node is not None and node.name == "table":
                    return node
    return soup.find("table")


def _extract_bse_code_from_soup(soup: BeautifulSoup) -> str | None:
    # 1) Direct link patterns containing scrip code
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        if "bseindia" not in href.lower():
            continue
        m = re.search(r"(?:scripcode|scode|code)=\s*(\d{6})", href, flags=re.I)
        if m:
            return m.group(1)
        m = re.search(r"\b(\d{6})\b", href)
        if m:
            return m.group(1)

    # 2) Data attributes or other element attributes
    for tag in soup.find_all(True):
        for key, val in tag.attrs.items():
            key_txt = str(key).lower()
            val_txt = " ".join(val) if isinstance(val, list) else str(val)
            if any(token in key_txt for token in ("scrip", "bse", "code")):
                m = re.search(r"\b(\d{6})\b", val_txt)
                if m:
                    return m.group(1)

    # 3) Inline scripts / page text patterns
    page_text = soup.get_text(" ", strip=True)
    m = re.search(r"(?:scripcode|bse\s*code)\D{0,10}(\d{6})", page_text, flags=re.I)
    if m:
        return m.group(1)
    for script in soup.find_all("script"):
        text = script.get_text(" ", strip=True)
        m = re.search(r"(?:scripcode|bse_code|bseCode)\D{0,10}(\d{6})", text, flags=re.I)
        if m:
            return m.group(1)
    return None


def _extract_screener_rows(symbol: str) -> tuple[list[dict[str, Any]], str | None]:
    screener_slug = SCREENER_URL_OVERRIDES.get(symbol, symbol)
    urls = [
        f"https://www.screener.in/company/{screener_slug}/consolidated/",
        f"https://www.screener.in/company/{screener_slug}/",
    ]
    last_error: Exception | None = None

    for url in urls:
        try:
            res = requests.get(url, headers=SCREENER_HEADERS, timeout=30)
            res.raise_for_status()

            soup = BeautifulSoup(res.text, "html.parser")
            table = _find_quarterly_table(soup)
            if table is None:
                raise ValueError("Quarterly results table not found")
            bse_code = _extract_bse_code_from_soup(soup)

            headers = [th.get_text(" ", strip=True) for th in table.select("thead tr th")]
            if len(headers) < 3:
                raise ValueError("Unexpected quarterly table headers")
            quarter_names = headers[1:]

            REVENUE_LABELS = [
                "Sales",
                "Revenue from Operations",
                "Interest Earned",
                "Net Interest Income",
                "Total Income",
                "Net Revenue",
                "Revenue",
                "Income from Operations",
                "Gross Revenue",
                "Net Sales",
                "Total Revenue",
                "Revenue From Operations",
                "Interest income",
                "Interest Income",
            ]
            PAT_LABELS = [
                "Net Profit",
                "PAT",
                "Profit after tax",
                "Net profit after tax",
                "Profit After Tax",
                "Net Profit after Tax",
                "Profit/Loss After Tax",
                "Net Income",
                "Profit after Tax (PAT)",
                "Reported net profit",
                "Net profit",
            ]

            metric_map: dict[str, list[float | None]] = {}
            revenue: list[float | None] | None = None
            pat: list[float | None] | None = None

            for tr in table.select("tbody tr"):
                cells = tr.find_all("td")
                if len(cells) < 2:
                    continue
                label_clean = cells[0].get_text(" ", strip=True).strip().lower()
                vals = [_to_float(td.get_text(" ", strip=True)) for td in cells[1:]]
                metric_map[label_clean] = vals

                if revenue is None:
                    for candidate in REVENUE_LABELS:
                        candidate_clean = candidate.strip().lower()
                        if candidate_clean in label_clean or label_clean in candidate_clean:
                            if any(v not in (None, 0) for v in vals):
                                revenue = vals
                                break
                if pat is None:
                    for candidate in PAT_LABELS:
                        candidate_clean = candidate.strip().lower()
                        if candidate_clean in label_clean or label_clean in candidate_clean:
                            if any(v not in (None, 0) for v in vals):
                                pat = vals
                                break

            operating_profit = metric_map.get("operating profit")
            eps = metric_map.get("eps in rs") or metric_map.get("eps")

            if revenue is None or pat is None:
                raise ValueError("Required metrics missing (revenue/pat)")

            rows: list[dict[str, Any]] = []
            for i, q in enumerate(quarter_names):
                rev = revenue[i] if i < len(revenue) else None
                npat = pat[i] if i < len(pat) else None
                op = operating_profit[i] if operating_profit and i < len(operating_profit) else None
                eps_v = eps[i] if eps and i < len(eps) else None

                margin = ((npat / rev) * 100.0) if (npat is not None and rev not in (None, 0)) else None
                rows.append(
                    {
                        "company_id": None,
                        "quarter": q,
                        "revenue": rev,
                        "pat": npat,
                        "net_profit": npat,
                        "operating_profit": op,
                        "eps": eps_v,
                        "margin": margin,
                    },
                )

            return rows, bse_code
        except Exception as exc:
            last_error = exc

    raise ValueError(f"Screener fetch failed for {symbol}: {last_error}")


def _extract_latest_bse_revenue(bse_code: str) -> float | None:
    url = f"https://api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode={bse_code}&flag=C"
    res = requests.get(url, headers=BSE_HEADERS, timeout=30)
    res.raise_for_status()
    payload = res.json()

    def scan(obj: Any) -> float | None:
        if isinstance(obj, dict):
            keys = {str(k).lower(): v for k, v in obj.items()}
            for k, v in keys.items():
                if "revenue" in k or "sales" in k:
                    parsed = _to_float(v)
                    if parsed is not None:
                        return parsed
            for v in obj.values():
                found = scan(v)
                if found is not None:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = scan(item)
                if found is not None:
                    return found
        return None

    return scan(payload)


def _finalize_rows(
    rows: list[dict[str, Any]],
    *,
    latest_bse_revenue: float | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    if len(rows) < 4:
        warnings.append("less_than_4_quarters_available")

    for i, row in enumerate(rows):
        rev = row["revenue"]
        prev = rows[i - 1]["revenue"] if i > 0 else None
        yoy_prev = rows[i - 4]["revenue"] if i >= 4 else None
        pat_prev = rows[i - 1]["net_profit"] if i > 0 else None

        rev_qoq = _pct_growth(rev, prev)
        rev_yoy = _pct_growth(rev, yoy_prev)
        pat_qoq = _pct_growth(row["net_profit"], pat_prev)

        data_quality_warning = False
        local_reasons: list[str] = []

        if rev in (None, 0):
            local_reasons.append("revenue_missing_or_zero")
            data_quality_warning = True

        if rev_qoq is not None and rev_qoq > 200:
            local_reasons.append("revenue_jump_gt_200pct_qoq")
            data_quality_warning = True

        if i == len(rows) - 1 and latest_bse_revenue not in (None, 0) and rev not in (None, 0):
            diff_ratio = abs(rev - latest_bse_revenue) / abs(latest_bse_revenue)
            if diff_ratio > 0.05:
                local_reasons.append("bse_vs_screener_diff_gt_5pct")
                data_quality_warning = True
        else:
            diff_ratio = None

        row.update(
            {
                "revenue_growth_qoq": rev_qoq,
                "revenue_growth_yoy": rev_yoy,
                "pat_growth_qoq": pat_qoq,
                "data_quality_warning": data_quality_warning,
                "metadata": {
                    "warning_reasons": local_reasons,
                    "bse_latest_revenue": latest_bse_revenue,
                    "bse_diff_ratio": diff_ratio,
                    "available_quarters": len(rows),
                },
                "updated_at": datetime.utcnow().isoformat(),
            },
        )

    return rows, warnings


def _is_saturday() -> bool:
    return datetime.now().weekday() == 5


def process_symbol(symbol: str) -> bool:
    try:
        rows, extracted_bse_code = _extract_screener_rows(symbol)
    except Exception as exc:
        print(f"[{symbol}] screener fetch failed, skipping: {exc}")
        log_event("financials_screener_fetch_failed", {"symbol": symbol, "error": str(exc)})
        return False
    if not rows:
        raise ValueError("No quarterly rows parsed")

    company_id = None
    upsert(
        "companies",
        {
            "symbol": symbol,
            "name": symbol,
            "tier": 1,
            "updated_at": datetime.utcnow().isoformat(),
        },
        "symbol",
    )
    cq = supabase.table("companies").select("id").eq("symbol", symbol).limit(1).execute()
    cdata = getattr(cq, "data", None) or []
    if cdata:
        company_id = cdata[0].get("id") or None
    if not company_id:
        raise ValueError(f"company_id not found for symbol: {symbol}")

    bse_code = str(
        extracted_bse_code
        or COMPANY_META.get(symbol, {}).get("bse_code")
        or "",
    ).strip()

    if extracted_bse_code:
        upsert(
            "companies",
            {
                "symbol": symbol,
                "name": symbol,
                "tier": 1,
                "bse_code": extracted_bse_code,
                "updated_at": datetime.utcnow().isoformat(),
            },
            "symbol",
        )

    latest_bse_revenue = None
    if bse_code:
        try:
            latest_bse_revenue = _extract_latest_bse_revenue(bse_code)
        except Exception as exc:
            log_event(
                "financials_bse_fetch_failed",
                {"symbol": symbol, "bse_code": bse_code, "error": str(exc)},
            )
            print(f"[{symbol}] BSE cross-check failed: {exc}")

    rows, global_warnings = _finalize_rows(rows, latest_bse_revenue=latest_bse_revenue)
    last_8 = rows[-8:]

    upserted = 0
    for row in last_8:
        row["company_id"] = company_id
        if row["revenue"] in (None, 0):
            print(f"[{symbol}] skip quarter {row['quarter']} due to invalid revenue")
            log_event(
                "financials_revenue_invalid",
                {"symbol": symbol, "quarter": row["quarter"]},
            )
            continue
        res = upsert(FINANCIALS_TABLE, row, "company_id,quarter")
        if res is not None:
            upserted += 1

    print(f"[{symbol}] upserted={upserted}/{len(last_8)} warnings={global_warnings}")
    log_event(
        "financials_symbol_done",
        {
            "symbol": symbol,
            "upserted": upserted,
            "quarters_considered": len(last_8),
            "global_warnings": global_warnings,
        },
    )
    return True


def main() -> None:
    # Skip if not Saturday unless --test (small run) or --force (full run on any day).
    if not TEST_MODE and not _is_saturday() and not FORCE_RUN:
        msg = "Financials job skipped: runs only on Saturdays."
        print(msg)
        log_event("financials_skipped_not_saturday", {"weekday": datetime.now().strftime("%A")})
        return

    print("Starting financials fetch...")
    symbols = TEST_SYMBOLS if TEST_MODE else TIER1_SYMBOLS
    total = len(symbols)
    success = 0
    failed = 0
    started = time.time()
    log_event(
        "financials_started",
        {"symbols": total, "test_mode": TEST_MODE, "force_run": FORCE_RUN},
    )
    if TEST_MODE:
        print("TEST MODE enabled: processing symbols SYRMA, APTUS, TEJASNET")

    for i, symbol in enumerate(symbols, start=1):
        try:
            print(f"[{i}/{total}] {symbol}")
            if process_symbol(symbol):
                success += 1
            else:
                failed += 1
        except Exception as exc:
            failed += 1
            print(f"[{symbol}] failed: {exc}")
            log_event("financials_symbol_failed", {"symbol": symbol, "error": str(exc)})
        finally:
            time.sleep(DELAY_SECONDS)

    elapsed = round(time.time() - started, 2)
    print(f"Financials complete. success={success} failed={failed} elapsed={elapsed}s")
    log_event(
        "financials_finished",
        {"success_symbols": success, "failed_symbols": failed, "elapsed_sec": elapsed},
    )


if __name__ == "__main__":
    main()
