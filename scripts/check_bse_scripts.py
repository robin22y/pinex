"""Probe BSE script / security master endpoints.

The common guess ``ListOfScripts/w`` returns an ASP.NET XHTML error page (HTTP
200, not JSON). The bseindia PyPI package uses ``LitsOfScripCSVDownload/w``
(note spelling) with query params ``segment``, ``status``, ``Group``.

Run:
  python scripts/check_bse_scripts.py
"""

from __future__ import annotations

import json

import requests

HEADERS_ANN = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bseindia.com/corporates/ann.html",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.bseindia.com",
}

HEADERS_ROOT = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bseindia.com/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Original user combos target ListOfScripts/w
LIST_OF_SCRIPTS_COMBOS = [
    ("A", "A"),
    ("B", "A"),
    ("", "A"),
    ("A", ""),
]


def _preview_json(data: object) -> None:
    if isinstance(data, list):
        print(f"  {len(data)} records")
        if data:
            print(f"  Keys: {list(data[0].keys())}")
            print(f"  Sample: {json.dumps(data[0])[:400]}")
    elif isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, list):
                print(f"  {k}: {len(v)} records")
                if v:
                    print(f"  Keys: {list(v[0].keys())}")
                    print(f"  Sample: {json.dumps(v[0])[:400]}")


def probe_list_of_scripts() -> None:
    print("=== ListOfScripts/w (often returns XHTML, not JSON) ===\n")
    for group, status in LIST_OF_SCRIPTS_COMBOS:
        url = (
            "https://api.bseindia.com/BseIndiaAPI"
            f"/api/ListOfScripts/w?Group={group}&Status={status}"
        )
        r = requests.get(url, headers=HEADERS_ANN, timeout=15)
        ct = r.headers.get("Content-Type", "")
        print(f"Group={group!r} Status={status!r}: HTTP {r.status_code}  {ct[:50]}")
        if "json" not in ct.lower():
            print(f"  Non-JSON preview: {r.text[:120].replace(chr(10), ' ')}\n")
            continue
        try:
            _preview_json(r.json())
        except Exception as e:
            print(f"  Parse error: {e}")
        print()


def probe_lits_of_scrip_csv() -> None:
    print("=== LitsOfScripCSVDownload/w (bseindia package security master) ===\n")
    # Same pattern as bseindia.libutil._download_security_master
    url = "https://api.bseindia.com/BseIndiaAPI/api/LitsOfScripCSVDownload/w"
    params = {"segment": "Equity", "status": "", "Group": "", "Scripcode": ""}
    with requests.Session() as s:
        s.headers.update(HEADERS_ROOT)
        s.get("https://www.bseindia.com/", timeout=20)
        r = s.get(url, params=params, timeout=30)
    print(f"GET {r.url}")
    print(f"HTTP {r.status_code}  Content-Type: {r.headers.get('Content-Type', '')}")
    txt = r.text or ""
    if not txt.strip():
        print("  Empty body")
        return
    if txt.lstrip().startswith("<"):
        print(f"  HTML/XML preview: {txt[:200].replace(chr(10), ' ')}")
        return
    # CSV: first line = header
    lines = txt.strip().splitlines()
    print(f"  Lines: {len(lines)}")
    if lines:
        print(f"  Header: {lines[0][:200]}")
    if len(lines) > 1:
        print(f"  Row1:   {lines[1][:200]}")


def main() -> None:
    probe_list_of_scripts()
    probe_lits_of_scrip_csv()


if __name__ == "__main__":
    main()
