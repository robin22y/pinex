"""
classify_sectors_gemini.py
Uses Gemini free tier to classify ALL companies
into sectors and industries.

One-time run after seeding companies.
Also used weekly for new stocks.

Gemini free tier:
  15 req/min, 1M tokens/day, 1500 req/day
  More than enough for 2000 companies.

Usage:
  python classify_sectors_gemini.py
  python classify_sectors_gemini.py --new-only
  python classify_sectors_gemini.py --symbol SYRMA
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from db import log_event, supabase

load_dotenv(Path(__file__).parent / ".env")

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com"
    f"/v1beta/models/{GEMINI_MODEL}:generateContent"
    f"?key={GEMINI_KEY}"
)

BATCH_SIZE = 30
BATCH_SLEEP_SEC = 4
MAX_BISECT_DEPTH = 4

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "symbol": {"type": "STRING"},
            "sector": {"type": "STRING"},
            "industry": {"type": "STRING"},
        },
        "required": ["symbol", "sector", "industry"],
    },
}

SECTORS = [
    "Banking",
    "NBFC",
    "Insurance",
    "IT Services",
    "IT Products",
    "Pharma",
    "Healthcare",
    "Auto",
    "Auto Ancillary",
    "Oil & Gas",
    "Power",
    "Renewables",
    "FMCG",
    "Consumer Durables",
    "Retail",
    "Textiles",
    "Apparel",
    "Metals & Mining",
    "Steel",
    "Cement",
    "Construction",
    "Infrastructure",
    "Real Estate",
    "Chemicals",
    "Fertilisers",
    "Agro",
    "Capital Goods",
    "Engineering",
    "Defence",
    "Aerospace",
    "Telecom",
    "Media",
    "Logistics",
    "Shipping",
    "Hotels & Tourism",
    "Aviation",
    "EMS Electronics",
    "Semiconductors",
    "Internet & New Age",
    "Fintech",
    "Exchanges & Broking",
    "Asset Management",
    "Jewellery",
    "Gems",
    "Paper & Packaging",
    "Paints & Coatings",
    "Cables & Wires",
    "Pipes & Fittings",
    "Specialty Chemicals",
    "Diagnostics",
    "Hospitals",
    "SME / Others",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Classify companies into sector and industry via Gemini.")
    parser.add_argument("--new-only", action="store_true", help="Only classify missing or generic sector rows.")
    parser.add_argument("--symbol", help="Classify a single symbol.")
    return parser.parse_args()


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 1)[-1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()
    parsed = json.loads(cleaned)
    if not isinstance(parsed, list):
        raise ValueError("Gemini response was not a JSON array")
    return parsed


def classify_batch(companies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Send a batch of companies to Gemini and return [{symbol, sector, industry}, ...]."""
    if not companies:
        return []

    co_lines = "\n".join(
        f"{c['symbol']}: {c.get('name', c['symbol'])}"
        for c in companies
    )

    prompt = f"""You are a financial data classifier for Indian stock market companies.

Classify each company into a sector and industry.
Use these standard sectors where possible:
{", ".join(SECTORS)}

For each company below, return one object with the company's exact uppercase symbol, the most appropriate sector from the list above (use "SME / Others" only as a last resort), and a concise specific industry (e.g. "Specialty Chemicals", "Two-Wheeler Auto", "Private Sector Bank").

Companies to classify:
{co_lines}"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    text = ""
    try:
        response = requests.post(
            GEMINI_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
        if response.status_code != 200:
            print(f"  Gemini error: {response.status_code} {response.text[:300]}")
            return []

        data = response.json()
        candidates = data.get("candidates") or []
        if not candidates:
            print(f"  Gemini returned no candidates: {str(data)[:300]}")
            return []

        candidate = candidates[0]
        finish_reason = candidate.get("finishReason")
        parts = candidate.get("content", {}).get("parts") or []
        text = parts[0].get("text", "") if parts else ""

        if finish_reason and finish_reason != "STOP":
            print(f"  Gemini finishReason={finish_reason} text_len={len(text)}")

        if not text.strip():
            return []

        return _extract_json_array(text)
    except json.JSONDecodeError as exc:
        print(f"  JSON parse error: {exc}")
        snippet = text[-300:] if len(text) > 300 else text
        print(f"  Raw response tail: {snippet!r}")
        return []
    except Exception as exc:
        print(f"  Gemini error: {exc}")
        return []


def classify_with_retry(
    batch: list[dict[str, Any]],
    *,
    depth: int = 0,
    indent: str = "  ",
) -> list[dict[str, Any]]:
    """Try `batch`; on empty result, halve and recurse. Bottoms out at single rows."""
    results = classify_batch(batch)
    if results:
        return results

    if len(batch) <= 1:
        sym = batch[0]["symbol"] if batch else "?"
        print(f"{indent}Could not classify {sym} after retries")
        return []

    if depth >= MAX_BISECT_DEPTH:
        print(f"{indent}Bisect depth limit reached at size {len(batch)} -- dropping batch")
        return []

    mid = len(batch) // 2
    print(f"{indent}Retrying with halves: {len(batch)} -> {mid} + {len(batch) - mid}")
    time.sleep(2)
    left = classify_with_retry(batch[:mid], depth=depth + 1, indent=indent + "  ")
    time.sleep(2)
    right = classify_with_retry(batch[mid:], depth=depth + 1, indent=indent + "  ")
    return left + right


def fetch_companies(*, new_only: bool, symbol: str | None) -> list[dict[str, Any]]:
    query = supabase.table("companies").select("id, symbol, name, sector, industry")

    if symbol:
        query = query.eq("symbol", symbol.strip().upper())
    elif new_only:
        query = query.or_("sector.is.null,sector.eq.Others,sector.eq.SME / Others,industry.is.null")

    res = query.limit(5000).execute()
    return getattr(res, "data", None) or []


def update_company_classification(company_id: str, sector: str, industry: str) -> None:
    supabase.table("companies").update(
        {
            "sector": sector or "SME / Others",
            "industry": industry or "",
        }
    ).eq("id", company_id).execute()


def main() -> int:
    args = parse_args()

    if not GEMINI_KEY:
        print("ERROR: GEMINI_API_KEY not set")
        print("Get free key at: https://aistudio.google.com/apikey")
        print("Add to scripts/.env: GEMINI_API_KEY=your_key")
        return 1

    print("PineX Sector Classifier — Gemini")
    print("=" * 50)

    companies = fetch_companies(new_only=args.new_only, symbol=args.symbol)
    print(f"Companies to classify: {len(companies)}")

    if not companies:
        print("Nothing to classify.")
        return 0

    total_classified = 0
    total_failed = 0
    total_batches = (len(companies) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_index in range(0, len(companies), BATCH_SIZE):
        batch = companies[batch_index : batch_index + BATCH_SIZE]
        batch_num = batch_index // BATCH_SIZE + 1

        print(f"\nBatch {batch_num}/{total_batches} ({len(batch)} companies)...")
        results = classify_with_retry(batch)

        result_map = {
            str(row.get("symbol", "")).strip().upper(): row
            for row in results
            if row.get("symbol")
        }

        updated = 0
        for company in batch:
            symbol = str(company.get("symbol", "")).strip().upper()
            classification = result_map.get(symbol)
            if not classification:
                continue

            sector = str(classification.get("sector") or "SME / Others").strip()
            industry = str(classification.get("industry") or "").strip()

            try:
                update_company_classification(company["id"], sector, industry)
                updated += 1
            except Exception as exc:
                print(f"  DB error {symbol}: {exc}")

        total_classified += updated
        total_failed += len(batch) - updated
        print(f"  Classified: {updated}/{len(batch)}")

        for sample in results[:3]:
            print(
                f"  {sample.get('symbol')}: "
                f"{sample.get('sector')} -> "
                f"{sample.get('industry')}"
            )

        if batch_index + BATCH_SIZE < len(companies):
            time.sleep(BATCH_SLEEP_SEC)

    print("\nDone")
    print(f"   Classified: {total_classified}")
    print(f"   Failed:     {total_failed}")

    log_event(
        "classify_sectors_gemini",
        {
            "total": len(companies),
            "classified": total_classified,
            "failed": total_failed,
            "new_only": args.new_only,
            "symbol": args.symbol,
        },
    )

    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
