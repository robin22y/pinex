"""
fetch_market_cap.py — Fetch and classify market cap for all NSE stocks

Sources (in priority order):
1. IndianAPI /stock endpoint (keyMetrics → priceandVolume → marketCap)
2. yfinance fast_info.marketCap
3. Calculate from price × shares if available

Classification (Cr):
  Large:  >= 20,000 Cr  (₹200B+)
  Mid:    5,000–20,000 Cr
  Small:  500–5,000 Cr
  Micro:  100–500 Cr
  Nano:   < 100 Cr

Usage:
  python scripts/fetch_market_cap.py
  python scripts/fetch_market_cap.py --tier=1   (Nifty 50 only, fast test)
  python scripts/fetch_market_cap.py --symbol=HINDCOPPER
  python scripts/fetch_market_cap.py --source=yfinance  (skip IndianAPI)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# WHY: Scripts run from their own directory
# so we add parent to path for db imports
sys.path.insert(0, str(Path(__file__).parent))

from db import supabase, log_event
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

INDIANAPI_KEY = os.environ.get(
    'INDIANAPI_KEY', '')
INDIANAPI_BASE = 'https://stock.indianapi.in'

# ─────────────────────────────────────────
# CLASSIFICATION
# WHY: We use Cr-based thresholds rather than
# SEBI rank-based (top 100/250) because we
# don't always have the full universe ranked.
# These thresholds align with common Indian
# market convention used by most brokers.
# ─────────────────────────────────────────

def classify_market_cap(mcap_cr: float) -> str:
    """Classify market cap in Crores to category."""
    if mcap_cr is None or mcap_cr <= 0:
        return 'unknown'
    if mcap_cr >= 20000:
        return 'large_cap'
    if mcap_cr >= 5000:
        return 'mid_cap'
    if mcap_cr >= 500:
        return 'small_cap'
    if mcap_cr >= 100:
        return 'micro_cap'
    return 'nano_cap'


def mcap_cr_from_indianapi(symbol: str,
                            company_name: str) -> float | None:
    """
    Fetch market cap from IndianAPI.
    Returns value in Crores or None.

    WHY: IndianAPI returns marketCap in Crores
    under keyMetrics → priceandVolume → marketCap.
    This is the most reliable source for Indian stocks.
    """
    import requests
    headers = {'x-api-key': INDIANAPI_KEY}

    try:
        r = requests.get(
            f'{INDIANAPI_BASE}/stock',
            headers=headers,
            params={'name': company_name or symbol},
            timeout=15,
        )
        if r.status_code != 200:
            return None

        data = r.json()

        # Try stockDetailsReusableData first
        # (more current, intraday)
        reusable = data.get(
            'stockDetailsReusableData', {})
        if reusable.get('marketCap'):
            mc = float(reusable['marketCap'])
            if mc > 0:
                return mc

        # Fall back to keyMetrics
        km = data.get('keyMetrics', {})
        for section in km.values():
            if not isinstance(section, list):
                continue
            for item in section:
                if (isinstance(item, dict) and
                        item.get('key') == 'marketCap'):
                    val = item.get('value')
                    if val:
                        try:
                            return float(val)
                        except (ValueError, TypeError):
                            pass
        return None

    except Exception as e:
        print(f'    IndianAPI error for {symbol}: {e}')
        return None


def mcap_cr_from_yfinance(symbol: str) -> float | None:
    """
    Fetch market cap from Yahoo Finance.
    Returns value in Crores or None.

    WHY: Yahoo Finance returns marketCap in INR (not Cr).
    We divide by 1e7 to convert to Crores.
    1 Crore = 10,000,000 = 1e7
    """
    try:
        import yfinance as yf
        t = yf.Ticker(f'{symbol}.NS')
        mc_inr = t.fast_info.get('marketCap')
        if mc_inr and mc_inr > 0:
            return round(mc_inr / 1e7, 2)
        return None
    except Exception as e:
        print(f'    yfinance error for {symbol}: {e}')
        return None


def fetch_all_companies(tier: int | None = None,
                        symbol: str | None = None) -> list[dict]:
    """Fetch companies from Supabase to process."""
    query = supabase.table('companies')\
        .select('id, symbol, name, tier')

    if symbol:
        query = query.eq('symbol', symbol.upper())
    elif tier:
        query = query.eq('tier', tier)

    # Process in batches
    all_rows = []
    page = 0
    while True:
        batch = query\
            .range(page * 1000,
                   page * 1000 + 999)\
            .execute()
        all_rows.extend(batch.data or [])
        if len(batch.data or []) < 1000:
            break
        page += 1

    return all_rows


def update_company_mcap(company_id: str,
                        mcap_cr: float,
                        cap_category: str) -> None:
    """Upsert market cap fields into companies table."""
    supabase.table('companies').update({
        'market_cap': mcap_cr,
        'cap_category': cap_category,
    }).eq('id', company_id).execute()


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Fetch market cap for NSE stocks')
    parser.add_argument('--tier', type=int, default=None,
                        help='Only process this tier')
    parser.add_argument('--symbol', type=str, default=None,
                        help='Single symbol')
    parser.add_argument('--source',
                        choices=['indianapi', 'yfinance', 'both'],
                        default='both',
                        help='Data source to use')
    parser.add_argument('--skip-existing', action='store_true',
                        help='Skip stocks that already have market_cap')
    args = parser.parse_args()

    # ── Ensure columns exist ──────────────────
    # Run once — safe to run multiple times
    print('Checking DB columns...')
    try:
        supabase.table('companies')\
            .select('market_cap, cap_category')\
            .limit(1).execute()
        print('  Columns exist ✓')
    except Exception:
        print('  Columns missing — run SQL first:')
        print('  ALTER TABLE companies')
        print('    ADD COLUMN IF NOT EXISTS')
        print('      market_cap numeric;')
        print('  ALTER TABLE companies')
        print('    ADD COLUMN IF NOT EXISTS')
        print('      cap_category text;')
        sys.exit(1)

    # ── Fetch companies ───────────────────────
    companies = fetch_all_companies(
        tier=args.tier,
        symbol=args.symbol)
    print(f'Companies to process: {len(companies)}')

    if args.skip_existing:
        # Filter out those already having market_cap
        existing = supabase.table('companies')\
            .select('id')\
            .not_.is_('market_cap', 'null')\
            .execute()
        existing_ids = {
            r['id'] for r in (existing.data or [])}
        companies = [
            c for c in companies
            if c['id'] not in existing_ids]
        print(f'  After skip-existing: '
              f'{len(companies)} remaining')

    # ── Process ───────────────────────────────
    success = 0
    failed = 0
    total = len(companies)

    for i, co in enumerate(companies):
        sym = co['symbol']
        name = co.get('name', sym)
        print(f'[{i+1}/{total}] {sym}',
              end='', flush=True)

        mcap_cr = None

        # Try IndianAPI first
        if args.source in ('indianapi', 'both'):
            mcap_cr = mcap_cr_from_indianapi(sym, name)
            if mcap_cr:
                print(f'  ₹{mcap_cr:,.0f} Cr (IndianAPI)',
                      end='')
            time.sleep(0.3)  # Rate limit

        # Fall back to yfinance
        if not mcap_cr and args.source in ('yfinance', 'both'):
            mcap_cr = mcap_cr_from_yfinance(sym)
            if mcap_cr:
                print(f'  ₹{mcap_cr:,.0f} Cr (yfinance)',
                      end='')
            time.sleep(0.2)

        if mcap_cr and mcap_cr > 0:
            cap_cat = classify_market_cap(mcap_cr)
            update_company_mcap(
                co['id'], mcap_cr, cap_cat)
            print(f'  → {cap_cat} ✓')
            success += 1
        else:
            print(f'  ✗ not found')
            failed += 1

        # Brief pause every 50 stocks
        if (i + 1) % 50 == 0:
            print(f'\n--- {i+1}/{total} done, '
                  f'{success} success, '
                  f'{failed} failed ---\n')
            time.sleep(2)

    print(f'\nDone. Success={success} '
          f'Failed={failed} '
          f'Total={total}')

    log_event('fetch_market_cap_done', {
        'success': success,
        'failed': failed,
        'total': total,
    })


if __name__ == '__main__':
    main()
