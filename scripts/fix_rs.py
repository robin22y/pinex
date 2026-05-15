"""
fix_rs.py
Calculates rs_vs_nifty for all stocks.

Since we don't have Nifty index history,
we approximate Nifty return using average
return of Nifty 50 stocks we track.

OR: fetch Nifty from yfinance (one call only)
"""
import time
import pandas as pd
import yfinance as yf
from db import supabase

print('Fetching Nifty 50 index history...')

# Fetch Nifty 50 index — just one call
nifty = yf.Ticker('^NSEI')
nifty_hist = nifty.history(period='2y')

if nifty_hist.empty:
    print('ERROR: Could not fetch Nifty data')
    exit()

nifty_close = nifty_hist['Close'].dropna()
print(f'Nifty rows: {len(nifty_close)}')

if len(nifty_close) < 63:
    print('Not enough Nifty history (need ≥ 63 days)')
    exit()

nifty_now = float(nifty_close.iloc[-1])
print(f'Nifty current: {nifty_now:,.0f}')
print(f'Nifty history rows: {len(nifty_close)}')

# Get all companies
print('\nFetching companies...')
companies = []
start = 0
while True:
    res = supabase.table('companies')\
        .select('id, symbol')\
        .range(start, start + 999)\
        .execute()
    batch = res.data or []
    companies.extend(batch)
    if len(batch) < 1000:
        break
    start += 1000
print(f'Total companies: {len(companies)}')

# Also store Nifty history in market_internals
print('\nStoring Nifty history in market_internals...')
nifty_rows = []
for date, close in nifty_close.items():
    nifty_rows.append({
        'date': date.strftime('%Y-%m-%d'),
        'nifty_close': float(close),
    })

# Upsert in batches
for i in range(0, len(nifty_rows), 100):
    batch = nifty_rows[i:i+100]
    try:
        supabase.table('market_internals')\
            .upsert(batch, on_conflict='date')\
            .execute()
    except Exception as e:
        print(f'  market_internals error: {e}')
        break
print(f'Stored {len(nifty_rows)} Nifty rows')

# Calculate RS for each stock
print('\nCalculating RS for all stocks...')
updated = 0
skipped = 0
no_history = 0

for i, co in enumerate(companies):
    co_id = co['id']
    sym   = co['symbol']

    # Get most recent 300 price rows (desc so we get latest, then reverse to oldest→newest)
    res = supabase.table('price_data')\
        .select('date, close')\
        .eq('company_id', co_id)\
        .order('date', desc=True)\
        .limit(300)\
        .execute()

    rows = list(reversed(res.data or []))
    closes = [float(r['close']) for r in rows if r.get('close')]

    if len(closes) < 63:
        no_history += 1
        continue

    lookback = min(len(closes), 252)
    stock_now    = closes[-1]
    stock_start  = closes[-lookback]

    if stock_start == 0:
        skipped += 1
        continue

    stock_return = (stock_now - stock_start) / stock_start * 100

    # Use same lookback period for Nifty so comparison is apples-to-apples
    nifty_lookback = min(lookback, len(nifty_close))
    nifty_start = float(nifty_close.iloc[-nifty_lookback])
    nifty_period_return = (nifty_now - nifty_start) / nifty_start * 100 if nifty_start != 0 else 0

    rs = round(stock_return - nifty_period_return, 2)

    # Update is_latest row
    try:
        supabase.table('price_data')\
            .update({'rs_vs_nifty': rs})\
            .eq('company_id', co_id)\
            .eq('is_latest', True)\
            .execute()
        updated += 1
    except Exception as e:
        print(f'  Error {sym}: {e}')
        skipped += 1

    if updated % 100 == 0 and updated > 0:
        print(f'  Updated {updated}/{len(companies)}...')

print(f'\n✅ Done')
print(f'   Updated:    {updated}')
print(f'   No history: {no_history}')
print(f'   Skipped:    {skipped}')