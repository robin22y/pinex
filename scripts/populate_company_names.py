"""
populate_company_names.py

Populates companies.name from the NSE EQUITY_L.csv file
that is already in the repo at scripts/data/EQUITY_L.csv.

No API calls needed — the CSV has all NSE company names.

Usage:
    python scripts/populate_company_names.py
    python scripts/populate_company_names.py --dry-run
"""

import csv
import sys
import os
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from db import supabase
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

# Path to the CSV file already in the repo
EQUITY_CSV = Path(__file__).parent / 'data' / 'EQUITY_L.csv'


def load_names_from_csv() -> dict[str, str]:
    """
    Read EQUITY_L.csv and return {symbol: company_name} dict.

    WHY: NSE's EQUITY_L.csv is the authoritative source for
    all listed company names. It's already in the repo and
    covers all 2100+ NSE stocks. No API calls needed.
    """
    names = {}

    if not EQUITY_CSV.exists():
        print(f'ERROR: {EQUITY_CSV} not found')
        print('Make sure scripts/data/EQUITY_L.csv exists')
        sys.exit(1)

    with open(EQUITY_CSV, encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Column names in EQUITY_L.csv:
            # "SYMBOL", "NAME OF COMPANY", " SERIES" etc.
            symbol = (row.get('SYMBOL') or '').strip().upper()
            name = (row.get('NAME OF COMPANY') or '').strip()

            # Clean up name — remove trailing periods, extra spaces
            name = ' '.join(name.split())
            if name.endswith('.'):
                name = name[:-1]

            if symbol and name:
                names[symbol] = name

    print(f'Loaded {len(names)} names from EQUITY_L.csv')
    return names


def fetch_all_companies() -> list[dict]:
    """Fetch all companies from Supabase in batches."""
    all_rows = []
    page = 0
    while True:
        batch = supabase.table('companies')\
            .select('id, symbol, name')\
            .range(page * 1000, page * 1000 + 999)\
            .execute()
        all_rows.extend(batch.data or [])
        if len(batch.data or []) < 1000:
            break
        page += 1
    return all_rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be updated without writing')
    parser.add_argument('--force', action='store_true',
                        help='Update even stocks that already have names')
    args = parser.parse_args()

    # Load names from CSV
    csv_names = load_names_from_csv()

    # Fetch companies from DB
    print('Fetching companies from Supabase...')
    companies = fetch_all_companies()
    print(f'Found {len(companies)} companies in DB')

    # Find companies needing name update
    to_update = []
    already_named = 0
    not_in_csv = []

    for co in companies:
        symbol = co.get('symbol', '').upper()
        current_name = co.get('name', '')

        # Skip if already has a real name (not null, not empty, not same as symbol)
        if (not args.force and
                current_name and
                current_name.strip() and
                current_name.strip().upper() != symbol):
            already_named += 1
            continue

        # Look up in CSV
        csv_name = csv_names.get(symbol)
        if not csv_name:
            not_in_csv.append(symbol)
            continue

        to_update.append({
            'id': co['id'],
            'symbol': symbol,
            'old_name': current_name or '(null)',
            'new_name': csv_name,
        })

    print(f'\nSummary:')
    print(f'  Already have names: {already_named}')
    print(f'  Need update: {len(to_update)}')
    print(f'  Not in CSV: {len(not_in_csv)}')

    if not to_update:
        print('\nNothing to update.')
        return

    if args.dry_run:
        print(f'\n[DRY RUN] Would update {len(to_update)} companies:')
        for r in to_update[:20]:
            print(f'  {r["symbol"]:15} '
                  f'{r["old_name"][:20]:20} → {r["new_name"]}')
        if len(to_update) > 20:
            print(f'  ... and {len(to_update) - 20} more')
        return

    # Update in batches of 50
    print(f'\nUpdating {len(to_update)} companies...')
    success = 0
    failed = 0

    for i in range(0, len(to_update), 50):
        batch = to_update[i:i+50]
        for row in batch:
            try:
                supabase.table('companies')\
                    .update({'name': row['new_name']})\
                    .eq('id', row['id'])\
                    .execute()
                success += 1
            except Exception as e:
                print(f'  ERROR updating {row["symbol"]}: {e}')
                failed += 1

        # Progress
        done = min(i + 50, len(to_update))
        print(f'  {done}/{len(to_update)} updated...')

    print(f'\nDone! Updated: {success}  Failed: {failed}')

    # Verify
    print('\nVerifying...')
    sample = supabase.table('companies')\
        .select('symbol, name')\
        .in_('symbol', ['RELIANCE', 'HINDCOPPER',
                         'MAHABANK', 'FEDERALBNK',
                         'TATAELXSI'])\
        .execute()

    print('Sample check:')
    for r in (sample.data or []):
        print(f'  {r["symbol"]:15} → {r["name"]}')


if __name__ == '__main__':
    main()
