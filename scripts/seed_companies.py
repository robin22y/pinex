"""
seed_companies.py
Seeds ALL NSE-listed stocks from EQUITY_L.csv
into the companies table as tier=3.
Existing stocks are preserved (not overwritten).

Run once after downloading EQUITY_L.csv from NSE.

Usage:
  python seed_companies.py
  python seed_companies.py --dry-run
"""
from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

from db import supabase, log_event

DRY_RUN = '--dry-run' in sys.argv

CSV_PATH = Path(__file__).parent / \
           'data' / 'EQUITY_L.csv'

def main():
    if not CSV_PATH.exists():
        print(f'ERROR: {CSV_PATH} not found')
        print('Download from NSE:')
        print('nseindia.com → Market Data'
              ' → Equity → List of Securities')
        print(f'Save to: {CSV_PATH}')
        return

    print('PineX Company Seeder')
    print('=' * 50)
    print(f'Reading {CSV_PATH}...')

    stocks = []
    with open(CSV_PATH, 'r',
              encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        print(f'Columns: {headers}')
        for row in reader:
            # Get symbol - strip spaces
            symbol = (
                row.get('SYMBOL') or
                row.get('Symbol') or
                row.get(' SYMBOL') or
                ''
            ).strip()

            # Get series
            series = (
                row.get('SERIES') or
                row.get(' SERIES') or
                row.get('Series') or
                ''
            ).strip()

            # Only EQ series
            if series != 'EQ':
                continue

            # Get name
            name = (
                row.get('NAME OF COMPANY') or
                row.get('Company Name') or
                row.get(' NAME OF COMPANY') or
                symbol
            ).strip()

            # Get ISIN
            isin = (
                row.get('ISIN NUMBER') or
                row.get(' ISIN NUMBER') or
                row.get('ISIN') or
                ''
            ).strip()

            if not symbol:
                continue

            stocks.append({
                'symbol':     symbol,
                'name':       name or symbol,
                'isin':       isin or None,
                'tier':       3,
                'exchange':   'NSE',
                'nse_listed': True,
                'sector':     'Others',
            })

    print(f'Found {len(stocks)} EQ stocks in CSV')

    if DRY_RUN:
        print('\nDRY RUN — first 10 stocks:')
        for s in stocks[:10]:
            print(f"  {s['symbol']}: "
                  f"{s['name']} "
                  f"({s['isin']})")
        return

    # Get existing symbols
    print('Fetching existing symbols from DB...')
    existing_res = supabase.table('companies')\
        .select('symbol, tier')\
        .limit(5000)\
        .execute()
    existing = {
        r['symbol']: r['tier']
        for r in (existing_res.data or [])
    }
    print(f'Existing in DB: {len(existing)}')

    # Split into new vs existing
    new_stocks = [
        s for s in stocks
        if s['symbol'] not in existing
    ]
    already_higher_tier = [
        s for s in stocks
        if s['symbol'] in existing
        and existing[s['symbol']] < 3
    ]

    print(f'New stocks to add: {len(new_stocks)}')
    print(f'Already in DB (higher tier): '
          f'{len(already_higher_tier)} '
          f'(skipping — preserving tier)')

    if not new_stocks:
        print('No new stocks to add.')
        return

    # Insert in batches
    BATCH = 100
    inserted = 0
    failed   = 0

    for i in range(0, len(new_stocks), BATCH):
        batch = new_stocks[i:i+BATCH]
        try:
            supabase.table('companies')\
                .upsert(
                    batch,
                    on_conflict='symbol',
                    ignore_duplicates=True
                )\
                .execute()
            inserted += len(batch)
            print(f'  Inserted {inserted}/'
                  f'{len(new_stocks)}...')
        except Exception as e:
            failed += len(batch)
            print(f'  Batch failed: {e}')
        time.sleep(0.3)

    print(f'\n✅ Done')
    print(f'   Inserted: {inserted}')
    print(f'   Failed:   {failed}')
    print(f'   Skipped (higher tier): '
          f'{len(already_higher_tier)}')

    log_event('seed_companies', {
        'inserted': inserted,
        'failed':   failed,
        'total_csv': len(stocks),
    })


if __name__ == '__main__':
    main()