"""
backfill_rs.py
==============
Backfills rs_vs_nifty for all historical
price_data rows.

Uses market_internals for Nifty history.
Calculates RS as stock return minus
Nifty return over same period.

Usage:
  python backfill_rs.py
  python backfill_rs.py --days=90

Takes 10-20 minutes for full history.
Safe to run multiple times (idempotent).
"""
import os, sys
from datetime import date, timedelta
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')
from supabase import create_client

supabase = create_client(
    os.environ['SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

DAYS = 180
for a in sys.argv:
    if a.startswith('--days='):
        DAYS = int(a.split('=')[1])

def main():
    print(f'Backfilling RS for {DAYS} days')
    print('=' * 40)

    # Load Nifty history from
    # market_internals
    print('Loading Nifty history...')
    nifty_res = supabase\
        .table('market_internals')\
        .select('date, nifty_close')\
        .not_.is_('nifty_close', 'null')\
        .order('date', desc=False)\
        .execute()

    nifty_map = {
        r['date']: float(r['nifty_close'])
        for r in (nifty_res.data or [])
        if r.get('nifty_close')
    }
    nifty_dates = sorted(nifty_map.keys())
    print(f'Nifty history: {len(nifty_dates)} days')
    print(f'  {nifty_dates[0]} → '
          f'{nifty_dates[-1]}')

    # Get all distinct trading dates
    # in price_data
    print('Loading trading dates...')
    dates_res = supabase\
        .table('price_data')\
        .select('date')\
        .order('date', desc=False)\
        .execute()

    all_dates = sorted(set(
        r['date']
        for r in (dates_res.data or [])
        if r.get('date')
    ))
    print(f'Trading dates: {len(all_dates)}')

    # Get all companies
    print('Loading companies...')
    co_res = supabase\
        .table('companies')\
        .select('id, symbol')\
        .execute()
    companies = co_res.data or []
    print(f'Companies: {len(companies)}')

    # Process each trading date
    # Use "today" = that date
    # Compare to oldest available date
    # for that stock

    total_updated = 0
    errors = 0

    for i, trading_date in enumerate(
            all_dates):

        # Get all closes for this date
        price_res = supabase\
            .table('price_data')\
            .select('company_id, close')\
            .eq('date', trading_date)\
            .limit(3000)\
            .execute()

        if not price_res.data:
            continue

        today_prices = {
            r['company_id']: 
                float(r['close'])
            for r in price_res.data
            if r.get('close')
        }

        # Find Nifty on this date
        nifty_today = nifty_map.get(
            trading_date)
        if not nifty_today:
            # Find nearest date
            candidates = [
                d for d in nifty_dates
                if d <= trading_date
            ]
            if candidates:
                nifty_today = nifty_map[
                    candidates[-1]]

        if not nifty_today:
            continue

        # Find comparison date
        # Use oldest available price
        # up to DAYS ago
        cutoff = (
            date.fromisoformat(trading_date)
            - timedelta(days=DAYS)
        ).isoformat()

        # Get oldest prices for all
        # companies on or after cutoff
        old_res = supabase\
            .table('price_data')\
            .select('company_id, close, date')\
            .gte('date', cutoff)\
            .lte('date', trading_date)\
            .order('date', desc=False)\
            .limit(3000)\
            .execute()

        # Keep oldest per company
        oldest_prices = {}
        oldest_dates = {}
        for r in (old_res.data or []):
            cid = r['company_id']
            if cid not in oldest_prices:
                oldest_prices[cid] = \
                    float(r['close'])
                oldest_dates[cid] = \
                    r['date']

        # Calculate RS for each stock
        updates = []
        for cid, today_close in \
                today_prices.items():

            past_close = oldest_prices\
                .get(cid)
            past_date = oldest_dates\
                .get(cid)

            if not past_close or \
                    past_close == 0:
                continue

            # Match Nifty to same period
            nifty_past = nifty_map.get(
                past_date)
            if not nifty_past:
                candidates = [
                    d for d in nifty_dates
                    if d <= past_date
                ]
                if candidates:
                    nifty_past = nifty_map[
                        candidates[-1]]

            if not nifty_past or \
                    nifty_past == 0:
                continue

            stock_return = (
                today_close - past_close
            ) / past_close * 100

            nifty_return = (
                nifty_today - nifty_past
            ) / nifty_past * 100

            rs = round(
                stock_return - 
                nifty_return, 2)

            updates.append({
                'company_id': cid,
                'date': trading_date,
                'rs_vs_nifty': rs,
            })

        # Batch update
        if updates:
            for j in range(
                    0, len(updates), 500):
                chunk = updates[j:j+500]
                try:
                    supabase\
                        .table('price_data')\
                        .upsert(
                            chunk,
                            on_conflict=
                            'company_id,date'
                        )\
                        .execute()
                    total_updated += \
                        len(chunk)
                except Exception as e:
                    errors += 1
                    print(f'  Error: {e}')

        print(f'[{i+1}/{len(all_dates)}] '
              f'{trading_date}: '
              f'{len(updates)} stocks '
              f'updated')

    print()
    print('=' * 40)
    print(f'Total updated: {total_updated}')
    print(f'Errors: {errors}')

if __name__ == '__main__':
    main()