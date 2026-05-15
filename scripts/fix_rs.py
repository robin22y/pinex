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

if len(nifty_close) < 252:
    print('Not enough Nifty history')
    exit()

# Nifty 1-year return
nifty_now = float(nifty_close.iloc[-1])
nifty_1y_ago = float(nifty_close.iloc[-252])
nifty_return = (nifty_now - nifty_1y_ago) / \
               nifty_1y_ago * 100
print(f'Nifty current: {nifty_now:,.0f}')
print(f'Nifty 1Y ago: {nifty_1y_ago:,.0f}')
print(f'Nifty 1Y return: {nifty_return:.2f}%')

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

    # Get price history
    res = supabase.table('price_data')\
        .select('date, close')\
        .eq('company_id', co_id)\
        .order('date', desc=False)\
        .limit(300)\
        .execute()

    rows = res.data or []
    if len(rows) < 252:
        no_history += 1
        continue

    closes = [float(r['close'])
              for r in rows
              if r.get('close')]

    if len(closes) < 252:
        no_history += 1
        continue

    stock_now    = closes[-1]
    stock_1y_ago = closes[-252]

    if stock_1y_ago == 0:
        skipped += 1
        continue

    stock_return = (stock_now - stock_1y_ago) / \
                   stock_1y_ago * 100
    rs = round(stock_return - nifty_return, 2)

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
print(f'   Nifty 1Y:   {nifty_return:.2f}%')