import os
from dotenv import load_dotenv
load_dotenv('.env')
from supabase import create_client

supabase = create_client(
    os.environ['SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

symbols = ['SYRMA', 'APTUS', 'TEJASNET']

# Get company IDs first
companies_res = supabase\
    .table('companies')\
    .select('id, symbol, sector, '
            'industry, parent_sector')\
    .in_('symbol', symbols)\
    .execute()

company_map = {
    r['symbol']: r 
    for r in (companies_res.data or [])
}

for sym in symbols:
    print(f'=== {sym} ===')
    
    co = company_map.get(sym, {})
    cid = co.get('id')
    
    if not cid:
        print('  Company not found')
        print()
        continue
    
    print(f'  sector:       {co.get("sector")}')
    print(f'  industry:     {co.get("industry")}')
    print(f'  parent:       {co.get("parent_sector")}')

    # Price data
    p = supabase.table('price_data')\
        .select(
            'stage, ma30w, ma30w_slope, '
            'rs_vs_nifty, close, '
            'high_conviction, date')\
        .eq('is_latest', True)\
        .eq('company_id', cid)\
        .limit(1)\
        .execute()

    if p.data:
        d = p.data[0]
        close = float(d.get('close') or 0)
        ma30w = float(d.get('ma30w') or 0)
        pct = round(
            (close - ma30w) / ma30w * 100, 1
        ) if ma30w else None
        print(f'  stage:        {d.get("stage")}')
        print(f'  ma30w_slope:  {d.get("ma30w_slope")}')
        print(f'  rs_vs_nifty:  {d.get("rs_vs_nifty")}')
        print(f'  pct_from_30w: {pct}')
        print(f'  close:        {d.get("close")}')
        print(f'  ma30w:        {d.get("ma30w")}')
        print(f'  price_date:   {d.get("date")}')
    else:
        print('  No price data')

    # Delivery signals
    ds = supabase.table('delivery_signals')\
        .select(
            'vol_ratio, avg_volume_7d, '
            'avg_volume_30d, pct_from_30w, '
            'high_conviction, date')\
        .eq('company_id', cid)\
        .order('date', desc=True)\
        .limit(1)\
        .execute()

    if ds.data:
        d = ds.data[0]
        print(f'  vol_ratio:    {d.get("vol_ratio")}')
        print(f'  avg_vol_7d:   {d.get("avg_volume_7d")}')
        print(f'  avg_vol_30d:  {d.get("avg_volume_30d")}')
        print(f'  ds_pct_30w:   {d.get("pct_from_30w")}')
        print(f'  ds_date:      {d.get("date")}')
        print(f'  ds_hc:        {d.get("high_conviction")}')
    else:
        print('  No delivery signals')
    
    print()