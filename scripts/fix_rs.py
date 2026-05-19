"""
fix_rs.py
Calculates rs_vs_nifty for all stocks using whatever price history
is available in the DB — no fixed minimum row requirement.

RS = stock % return over available window minus Nifty % return over same window.
Requires at least 10 rows to be meaningful.
"""
from db import supabase

print('Fetching Nifty history from market_internals...')

nifty_res = supabase\
    .table('market_internals')\
    .select('date, nifty_close')\
    .not_.is_('nifty_close', 'null')\
    .order('date', desc=False)\
    .execute()

nifty_data = {
    r['date']: float(r['nifty_close'])
    for r in (nifty_res.data or [])
    if r.get('nifty_close')
}

nifty_dates = sorted(nifty_data.keys())
if not nifty_dates:
    print('ERROR: No Nifty data in market_internals. Run fix_rs.py with yfinance first or populate market_internals.')
    exit()

print(f'Nifty history: {len(nifty_dates)} days')
print(f'Range: {nifty_dates[0]} → {nifty_dates[-1]}')

if len(nifty_dates) >= 252:
    PERIOD = 252
    print('Using 252-day (1-year) RS ✅')
elif len(nifty_dates) >= 180:
    PERIOD = len(nifty_dates)
    print(f'Using {PERIOD}-day RS')
else:
    print('Not enough Nifty history (need 180+ days). Populate market_internals first.')
    exit()

nifty_now = nifty_data[nifty_dates[-1]]
nifty_past = nifty_data[nifty_dates[-PERIOD]]
nifty_return = (nifty_now - nifty_past) / nifty_past * 100

print(f'Nifty {PERIOD}d return: {nifty_return:.2f}%')
print(f'  {nifty_dates[-PERIOD]} → {nifty_dates[-1]}')
print(f'  {nifty_past:,.0f} → {nifty_now:,.0f}')

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

# Calculate RS for each stock
print('\nCalculating RS for all stocks...')
updated = 0
skipped = 0
no_history = 0

for i, co in enumerate(companies):
    co_id = co['id']
    sym = co['symbol']

    res = supabase.table('price_data')\
        .select('date, close')\
        .eq('company_id', co_id)\
        .order('date', desc=False)\
        .execute()

    rows = res.data or []
    if len(rows) < 10:
        no_history += 1
        continue

    close_map = {
        r['date']: float(r['close'])
        for r in rows
        if r.get('close')
    }
    stock_dates = sorted(close_map.keys())

    stock_now = close_map[stock_dates[-1]]

    # Use PERIOD days ago if available, else oldest available
    target_idx = max(0, len(stock_dates) - PERIOD)
    stock_past = close_map[stock_dates[target_idx]]

    if stock_past == 0:
        skipped += 1
        continue

    # Adjust Nifty to the same actual period for apples-to-apples comparison
    actual_period = len(stock_dates) - target_idx
    nifty_target_idx = max(0, len(nifty_dates) - actual_period)
    nifty_past_adjusted = nifty_data[nifty_dates[nifty_target_idx]]

    stock_return = (stock_now - stock_past) / stock_past * 100
    nifty_return_adjusted = (nifty_now - nifty_past_adjusted) / nifty_past_adjusted * 100
    rs_vs_nifty = round(stock_return - nifty_return_adjusted, 2)

    try:
        supabase.table('price_data')\
            .update({'rs_vs_nifty': rs_vs_nifty})\
            .eq('company_id', co_id)\
            .eq('is_latest', True)\
            .execute()
        updated += 1
    except Exception as e:
        print(f'  Error {sym}: {e}')
        skipped += 1

    if updated % 100 == 0 and updated > 0:
        print(f'  Updated {updated}/{len(companies)}...')

print(f'\nDone')
print(f'   Updated:    {updated}')
print(f'   No history: {no_history}')
print(f'   Skipped:    {skipped}')
