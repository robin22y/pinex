"""
generate_descriptions_gemini.py
Uses Gemini free tier to generate AI descriptions
for ALL companies (not just Nifty 500).

Much cheaper than Claude for bulk generation.
Use Claude only for Nifty 50 premium descriptions.

Gemini free: 1500 req/day, 1M tokens/day
Can generate descriptions for ALL 2000 stocks
in 20 batches of 100. Takes ~2 minutes.

Usage:
  python generate_descriptions_gemini.py
  python generate_descriptions_gemini.py --new-only
  python generate_descriptions_gemini.py --tier=3
"""

from __future__ import annotations

import argparse
import os
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
    "/v1beta/models/gemini-2.5-flash"
    ":generateContent"
    f"?key={GEMINI_KEY}"
)

REQUEST_SLEEP_SEC = 4
MIN_DESCRIPTION_LEN = 50
PROGRESS_EVERY = 50


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate company descriptions via Gemini.")
    parser.add_argument("--new-only", action="store_true", help="Only fill missing or short descriptions.")
    parser.add_argument("--tier", type=int, default=None, help="Restrict to companies.tier (e.g. 3 for bulk).")
    return parser.parse_args()


def needs_description(company: dict[str, Any]) -> bool:
    text = str(company.get("description") or "").strip()
    return not text or len(text) < MIN_DESCRIPTION_LEN


def fetch_companies(*, new_only: bool, tier: int | None) -> list[dict[str, Any]]:
    query = supabase.table("companies").select(
        "id, symbol, name, sector, industry, description, tier"
    )

    if tier is not None:
        query = query.eq("tier", tier)
    if new_only:
        query = query.or_("description.is.null,description.eq.")

    res = query.execute()
    rows = getattr(res, "data", None) or []
    return [row for row in rows if needs_description(row)]


def generate_description(symbol: str, name: str, sector: str, industry: str) -> str | None:
    """Generate a 3-sentence company description."""
    prompt = f"""Write a plain-language description of this Indian listed company for retail investors.

Company: {name} ({symbol})
Sector: {sector}
Industry: {industry}

Rules:
- Exactly 3 sentences
- Plain English, no jargon
- Cover: what they do, how they make money, one key risk or opportunity
- No investment advice
- No "buy" or "sell" language
- Write as if explaining to a friend

Return ONLY the description text.
No introduction, no formatting."""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 256,
        },
    }

    try:
        response = requests.post(
            GEMINI_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        if response.status_code != 200:
            return None

        data = response.json()
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        cleaned = text.strip()
        return cleaned or None
    except Exception:
        return None


def update_company_description(company_id: str, description: str) -> None:
    supabase.table("companies").update(
        {
            "description": description,
            "description_approved": False,
        }
    ).eq("id", company_id).execute()


def main() -> int:
    args = parse_args()

    if not GEMINI_KEY:
        print("ERROR: GEMINI_API_KEY not set")
        print("Get free key at: https://aistudio.google.com/apikey")
        print("Add to scripts/.env: GEMINI_API_KEY=your_key")
        return 1

    print("PineX Description Generator — Gemini")
    print("=" * 50)

    companies = fetch_companies(new_only=args.new_only, tier=args.tier)
    print(f"Companies needing descriptions: {len(companies)}")

    if not companies:
        print("Nothing to generate.")
        return 0

    success = 0
    failed = 0

    for index, company in enumerate(companies, 1):
        symbol = str(company.get("symbol", "")).strip().upper()
        name = str(company.get("name") or symbol)
        sector = str(company.get("sector") or "SME / Others")
        industry = str(company.get("industry") or sector)

        print(f"[{index}/{len(companies)}] {symbol}...", end=" ")

        description = generate_description(symbol, name, sector, industry)
        if description:
            try:
                update_company_description(company["id"], description)
                print(f"ok ({len(description)} chars)")
                success += 1
            except Exception as exc:
                print(f"db error: {exc}")
                failed += 1
        else:
            print("failed")
            failed += 1

        if index < len(companies):
            time.sleep(REQUEST_SLEEP_SEC)

        if index % PROGRESS_EVERY == 0:
            print(f"\n  Progress: {success} done, {failed} failed\n")

    print("\nDone")
    print(f"   Generated: {success}")
    print(f"   Failed:    {failed}")

    log_event(
        "generate_descriptions_gemini",
        {
            "total": len(companies),
            "success": success,
            "failed": failed,
            "new_only": args.new_only,
            "tier": args.tier,
        },
    )

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
