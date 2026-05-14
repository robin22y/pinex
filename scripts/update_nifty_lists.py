"""
update_nifty_lists.py
Marks Nifty 50 and Nifty 500 stocks
and sets their tier accordingly.

Tier 1 = Nifty 50  (daily news, full analysis)
Tier 2 = Nifty 500 (weekly news, full analysis)
Tier 3 = All others (price + stage only)

Run after seed_companies.py
Run again after each index rebalancing.
"""
from __future__ import annotations
import time
from db import supabase, log_event

NIFTY_50 = [
    'ADANIENT','ADANIPORTS','APOLLOHOSP',
    'ASIANPAINT','AXISBANK','BAJAJ-AUTO',
    'BAJFINANCE','BAJAJFINSV','BPCL',
    'BHARTIARTL','BRITANNIA','CIPLA',
    'COALINDIA','DIVISLAB','DRREDDY',
    'EICHERMOT','GRASIM','HCLTECH',
    'HDFCBANK','HDFCLIFE','HEROMOTOCO',
    'HINDALCO','HINDUNILVR','ICICIBANK',
    'INDUSINDBK','INFY','ITC','JSWSTEEL',
    'KOTAKBANK','LT','LTIM','M&M',
    'MARUTI','NESTLEIND','NTPC','ONGC',
    'POWERGRID','RELIANCE','SBILIFE',
    'SBIN','SHRIRAMFIN','SUNPHARMA',
    'TATACONSUM','TATAMOTORS','TATASTEEL',
    'TCS','TECHM','TITAN','ULTRACEMCO',
    'WIPRO',
]

NIFTY_500_EXTRA = [
    'ABB','ABBOTINDIA','ABCAPITAL',
    'ABFRL','ACC','AIAENG','AJANTPHARM',
    'ALKEM','AMBUJACEM','ANGELONE',
    'APLAPOLLO','APTUS','ATGL','ATUL',
    'AUBANK','AUROPHARMA','AVALON','AWL',
    'BAJAJCON','BAJAJHFL','BALKRISHNA',
    'BANDHANBNK','BANKBARODA','BANKINDIA',
    'BATAINDIA','BDL','BEL','BEML',
    'BERGEPAINT','BHEL','BIOCON',
    'BIRLACORPN','BLUEDART','BLUESTARCO',
    'BOSCHLTD','BSE','CAMS','CANFINHOME',
    'CANBK','CDSL','CESC','CHOLAFIN',
    'COFORGE','COLPAL','CONCOR',
    'COROMANDEL','CUMMINSIND','CYIENT',
    'DABUR','DALBHARAT','DEEPAKNTR',
    'DELHIVERY','DIXON','DLF',
    'EIDPARRY','EMAMILTD','ESCORTS',
    'EXIDEIND','FEDERALBNK','FORTIS',
    'GAIL','GLAXO','GLENMARK',
    'GMRINFRA','GNFC','GODREJCP',
    'GODREJPROP','GRANULES','GSPL',
    'GUJGASLTD','HAL','HAVELLS',
    'HFCL','HUDCO','IDFCFIRSTB',
    'IEX','IPCALAB','IRB','IRCTC',
    'IRFC','JKCEMENT','JKTYRE',
    'JUBLFOOD','KALYANKJIL','KAYNES',
    'KEI','KPITTECH','KPRMILL',
    'LAURUSLABS','LICI','LINDEINDIA',
    'LUPIN','LUXIND','MANKIND',
    'MANAPPURAM','MARICO','MASTEK',
    'MFSL','MPHASIS','MRF','MUTHOOTFIN',
    'NATCOPHARM','NATIONALUM','NAUKRI',
    'NAVINFLUOR','NBCC','NCC','NHPC',
    'NLCINDIA','NMDC','NYKAA',
    'OBEROIRLTY','OIL','PAGEIND',
    'PEL','PERSISTENT','PETRONET','PFC',
    'PIDILITIND','PIIND','PNB','POLYCAB',
    'POONAWALLA','PRESTIGE','PVRINOX',
    'RADICO','RAILTEL','RBLBANK',
    'RECLTD','RELAXO','RITES','ROUTE',
    'SCHAEFFLER','SIEMENS','SJVN',
    'SOBHA','SOLARINDS','SONACOMS',
    'STAR','STARHEALTH','SUPREMEIND',
    'SYNGENE','SYRMA','TATACHEM',
    'TATACOMM','TATAELXSI','TATAPOWER',
    'TEJASNET','THERMAX','THYROCARE',
    'TIINDIA','TIMKEN','TORNTPHARM',
    'TORNTPOWER','TRENT','TRIDENT',
    'UJJIVANSFB','UNIONBANK','UPL',
    'UTIAMC','VBL','VEDL','VOLTAS',
    'VGUARD','YESBANK','ETERNAL',
    'SWIGGY','BAJAJHFL','NTPCGREEN',
    'ZOMATO','MANKIND','MAPMYINDIA',
]

def update_tier(symbols, tier,
                nifty50=False,
                nifty500=False,
                label=''):
    total = 0
    for i in range(0, len(symbols), 20):
        batch = symbols[i:i+20]
        supabase.table('companies')\
            .update({
                'tier':     tier,
                'nifty50':  nifty50,
                'nifty500': nifty500,
            })\
            .in_('symbol', batch)\
            .execute()
        total += len(batch)
        time.sleep(0.2)
    print(f'  {label}: {total} stocks → tier={tier}')
    return total

def main():
    print('PineX Nifty List Updater')
    print('=' * 50)

    print('\nSetting Nifty 50 → tier=1...')
    update_tier(
        NIFTY_50, tier=1,
        nifty50=True, nifty500=True,
        label='Nifty 50')

    print('\nSetting Nifty 500 extra → tier=2...')
    update_tier(
        NIFTY_500_EXTRA, tier=2,
        nifty50=False, nifty500=True,
        label='Nifty 500 extra')

    # Verify
    res = supabase.table('companies')\
        .select('tier')\
        .limit(5000)\
        .execute()
    from collections import Counter
    counts = Counter(
        r['tier'] for r in (res.data or []))
    print('\nTier distribution:')
    labels = {1:'Nifty 50',
              2:'Nifty 500',
              3:'All others',
              None:'Unset'}
    for tier in sorted(
            counts.keys(),
            key=lambda x: x or 99):
        print(f'  Tier {tier} '
              f'({labels.get(tier,"")}): '
              f'{counts[tier]} stocks')

    log_event('update_nifty_lists', {
        'nifty50': len(NIFTY_50),
        'nifty500': len(NIFTY_500_EXTRA),
    })
    print('\n✅ Done')

if __name__ == '__main__':
    main()