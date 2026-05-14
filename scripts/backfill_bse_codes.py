"""
backfill_bse_codes.py
Downloads BSE equity list and matches
BSE codes to our companies table.

Uses BSE's equity master file which is
more reliable than the ListOfScripts API.
"""
import requests
import io
import time
import pandas as pd
from db import supabase

BSE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.bseindia.com/corporates/ann.html',
    'Accept': '*/*',
    'Origin': 'https://www.bseindia.com',
}

def get_bse_equity_master() -> pd.DataFrame | None:
    """
    Download BSE equity master CSV.
    Contains: Security Code, Issuer Name, 
    ISIN, NSE Symbol etc.
    """
    urls = [
        # BSE equity master file
        'https://www.bseindia.com/download/'
        'BhavCopy/Equity/EQ_ISINCODE.CSV',
        
        # Alternative: BSE listed securities
        'https://api.bseindia.com/BseIndiaAPI'
        '/api/ddlListingStatus/w',
    ]
    
    for url in urls:
        try:
            print(f'  Trying: {url[:60]}...')
            r = requests.get(
                url,
                headers=BSE_HEADERS,
                timeout=30,
                allow_redirects=False)
            print(f'  Status: {r.status_code}')
            
            if r.status_code == 200:
                if 'text/csv' in r.headers.get(
                        'Content-Type', ''):
                    df = pd.read_csv(
                        io.StringIO(r.text))
                    print(f'  Rows: {len(df)}')
                    print(f'  Cols: '
                          f'{list(df.columns)}')
                    return df
                elif 'json' in r.headers.get(
                        'Content-Type', ''):
                    import json
                    data = r.json()
                    print(f'  JSON keys: '
                          f'{list(data.keys()) if isinstance(data, dict) else "list"}')
                    return data
                else:
                    print(f'  Content: '
                          f'{r.text[:100]}')
        except requests.exceptions.TooManyRedirects:
            print(f'  Too many redirects — skip')
        except Exception as e:
            print(f'  Error: {e}')
    
    return None


def backfill_from_bhav() -> int:
    """
    Alternative: Extract BSE codes from
    the BSE bhav copy we already download daily.
    Parse the most recent BSE bhav file.
    """
    from datetime import date, timedelta
    
    # Try last few days
    updated = 0
    d = date.today()
    
    for _ in range(5):
        if d.weekday() >= 5:
            d -= timedelta(days=1)
            continue
        
        yyyymmdd = d.strftime('%Y%m%d')
        url = (
            'https://www.bseindia.com/download/'
            'BhavCopy/Equity/'
            f'BhavCopy_BSE_CM_0_0_0_'
            f'{yyyymmdd}_F_0000.CSV'
        )
        
        try:
            r = requests.get(
                url, headers=BSE_HEADERS,
                timeout=30,
                allow_redirects=False)
            
            if r.status_code == 200:
                df = pd.read_csv(
                    io.StringIO(
                        r.content.decode(
                            'utf-8',
                            errors='ignore')))
                print(f'  BSE bhav {yyyymmdd}: '
                      f'{len(df)} rows')
                print(f'  Columns: '
                      f'{list(df.columns[:8])}')
                
                # BSE bhav has:
                # FinInstrmId = BSE code
                # TckrSymb = BSE ticker
                # ISIN = ISIN code
                # FinInstrmNm = company name
                
                if 'FinInstrmId' not in df.columns:
                    d -= timedelta(days=1)
                    continue
                
                # Get our companies
                res = supabase.table('companies')\
                    .select('id, symbol, isin')\
                    .limit(5000)\
                    .execute()
                companies = res.data or []
                
                # Build lookup maps
                isin_to_co = {
                    co['isin']: co
                    for co in companies
                    if co.get('isin')
                }
                sym_to_co = {
                    co['symbol']: co
                    for co in companies
                }
                
                print(f'  Companies with ISIN: '
                      f'{len(isin_to_co)}')
                
                # Match and update
                for _, row in df.iterrows():
                    bse_code = str(
                        row.get('FinInstrmId',
                                '')).strip()
                    isin = str(
                        row.get('ISIN',
                                '')).strip()
                    bse_ticker = str(
                        row.get('TckrSymb',
                                '')).strip()
                    
                    if not bse_code:
                        continue
                    
                    # Try ISIN match first
                    co = isin_to_co.get(isin)
                    
                    # Try BSE ticker = NSE symbol
                    if not co:
                        co = sym_to_co.get(
                            bse_ticker.upper())
                    
                    if co:
                        try:
                            supabase.table(
                                'companies')\
                                .update({
                                    'bse_code': 
                                        bse_code,
                                    'bse_listed': 
                                        True,
                                })\
                                .eq('id', co['id'])\
                                .is_('bse_code',
                                     'null')\
                                .execute()
                            updated += 1
                        except Exception:
                            pass
                
                print(f'  Updated: {updated}')
                return updated
                
        except Exception as e:
            print(f'  Error: {e}')
        
        d -= timedelta(days=1)
        time.sleep(1)
    
    return updated


def main():
    print('BSE Code Backfiller')
    print('=' * 40)
    
    # Check current state
    res = supabase.table('companies')\
        .select('bse_code')\
        .limit(5000)\
        .execute()
    total = len(res.data or [])
    has_code = sum(
        1 for r in (res.data or [])
        if r.get('bse_code'))
    print(f'Companies total: {total}')
    print(f'Already have BSE code: {has_code}')
    print(f'Need BSE code: {total - has_code}')
    
    # Method: Use BSE bhav copy
    # (already downloading this daily)
    print('\nExtracting BSE codes from '
          'daily bhav copy...')
    updated = backfill_from_bhav()
    
    # Verify
    res2 = supabase.table('companies')\
        .select('bse_code')\
        .limit(5000)\
        .execute()
    has_code2 = sum(
        1 for r in (res2.data or [])
        if r.get('bse_code'))
    
    print(f'\nDone.')
    print(f'   Before: {has_code}')
    print(f'   After:  {has_code2}')
    print(f'   Added:  {has_code2 - has_code}')


if __name__ == '__main__':
    main()