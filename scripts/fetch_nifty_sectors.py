"""
fetch_nifty_sectors.py
Fetches NSE sector index data from NSE allIndices API daily.
"""

import os
import time
import requests
from datetime import date
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"]
)

TODAY = date.today().isoformat()

# NSE API name → our display name
INDEX_MAP = {
    'NIFTY BANK':                 'Nifty Bank',
    'NIFTY IT':                   'Nifty IT',
    'NIFTY PHARMA':               'Nifty Pharma',
    'NIFTY AUTO':                 'Nifty Auto',
    'NIFTY FMCG':                 'Nifty FMCG',
    'NIFTY METAL':                'Nifty Metal',
    'NIFTY REALTY':               'Nifty Realty',
    'NIFTY ENERGY':               'Nifty Energy',
    'NIFTY INFRASTRUCTURE':       'Nifty Infra',
    'NIFTY MEDIA':                'Nifty Media',
    'NIFTY PSU BANK':             'Nifty PSU Bank',
    'NIFTY 50':                   'Nifty 50',
    'NIFTY FINANCIAL SERVICES':   'Nifty Financial Services',
    'NIFTY CONSUMER DURABLES':    'Nifty Consumer Durables',
    'NIFTY OIL & GAS':            'Nifty Oil & Gas',
    'NIFTY PRIVATE BANK':         'Nifty Private Bank',
    'NIFTY HEALTHCARE INDEX':     'Nifty Healthcare',
    'NIFTY COMMODITIES':          'Nifty Commodities',
}

NSE_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/',
    'Connection': 'keep-alive',
}


def fetch_nse_all_indices():
    """Fetch all NSE indices from NSE allIndices API. Returns dict keyed by index name."""
    session = requests.Session()

    # Hit homepage first to get cookies
    session.get('https://www.nseindia.com', headers=NSE_HEADERS, timeout=15)
    time.sleep(1)

    r = session.get(
        'https://www.nseindia.com/api/allIndices',
        headers=NSE_HEADERS,
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()

    result = {}
    for item in data.get('data', []):
        name = item.get('index', '')
        if name:
            result[name] = item
    return result


def classify_stage(current, change_1m, change_1w):
    """Simple stage classification for a sector index."""
    if change_1m is None:
        return 'Unknown'
    w = change_1w if change_1w is not None else 0.0
    if change_1m > 2 and w > 0:
        return 'Stage 2'
    if change_1m < -2 and w < 0:
        return 'Stage 4'
    if abs(change_1m) < 3:
        return 'Stage 1'
    if change_1m < 0:
        return 'Stage 3'
    return 'Stage 1'


def get_trend_signal(change_1d, change_1w, change_1m):
    """Short sector index regime label stored in trend_signal."""
    d = change_1d if change_1d is not None else 0.0
    w = change_1w if change_1w is not None else 0.0
    m = change_1m if change_1m is not None else 0.0
    if m > 5 and w > 2:
        return 'Strong'
    if m > 2 and w > 0:
        return 'Recovering'
    if d > 0 and w > 0:
        return 'Bouncing'
    if m < -5 and w < -2:
        return 'Weak'
    if m < -2 and w < 0:
        return 'Under Pressure'
    if d < 0 and w < 0:
        return 'Fading'
    return 'Neutral'


def main():
    print(f'\nFetching Nifty sector indices — {TODAY}')

    print('Fetching from NSE API...')
    try:
        nse_data = fetch_nse_all_indices()
    except Exception as e:
        print(f'[FAIL] Failed to fetch NSE data: {e}')
        return
    print(f'Got {len(nse_data)} indices from NSE')

    records = []
    success = 0
    failed = 0

    for nse_name, display_name in INDEX_MAP.items():
        item = nse_data.get(nse_name)
        if not item:
            print(f'  [MISS] Not found: {nse_name}')
            failed += 1
            continue

        try:
            current    = float(item.get('last', 0) or 0)
            prev_close = float(item.get('previousClose', 0) or 0)
            week_ago   = float(item.get('oneWeekAgoVal', 0) or 0)
            month_ago  = float(item.get('oneMonthAgoVal', 0) or 0)
            year_high  = float(item.get('yearHigh', 0) or 0)
            year_low   = float(item.get('yearLow', 0) or 0)

            change_1d = float(item.get('percentChange', 0) or 0)
            change_1w = round((current - week_ago)  / week_ago  * 100, 2) if week_ago  > 0 else None
            change_1m = round((current - month_ago) / month_ago * 100, 2) if month_ago > 0 else None
            change_1y = float(item.get('perChange365d', 0) or 0)

            pct_from_high = round((current - year_high) / year_high * 100, 2) if year_high > 0 else None

            stage = classify_stage(current, change_1m, change_1w)
            trend = get_trend_signal(change_1d, change_1w, change_1m)

            record = {
                'date':          TODAY,
                'index_name':    display_name,
                'display_name':  display_name,
                'yf_symbol':     nse_name,
                'current_value': round(current, 2),
                'change_1d':     change_1d,
                'change_1w':     change_1w,
                'change_1m':     change_1m,
                'change_3m':     None,
                'change_6m':     None,
                'change_1y':     change_1y,
                'high_52w':      year_high  if year_high  > 0 else None,
                'low_52w':       year_low   if year_low   > 0 else None,
                'pct_from_52w_high': pct_from_high,
                'stage':         stage,
                'trend_signal':  trend,
            }
            records.append(record)

            c1w_str = f'{change_1w:+.1f}%' if change_1w is not None else 'N/A'
            c1m_str = f'{change_1m:+.1f}%' if change_1m is not None else 'N/A'
            print(
                f'  [OK] {display_name:<30} '
                f'{current:>8,.0f}  '
                f'1D: {change_1d:+.1f}%  '
                f'1W: {c1w_str}  '
                f'1M: {c1m_str}  '
                f'{stage:<8} {trend}'
            )
            success += 1

        except Exception as e:
            print(f'  [ERR] {display_name}: {e}')
            failed += 1

    if records:
        supabase.table('nifty_sectors') \
            .upsert(records, on_conflict='index_name,date') \
            .execute()

    print(f'\nDone. success={success} failed={failed}')


if __name__ == '__main__':
    main()
