"""
fetch_bhav_history.py
One-time historical data loader.
Downloads NSE bhav copies for last 2 years
and builds complete price history for all stocks.

Run ONCE after seeding companies.
Takes 30-60 minutes. Run overnight.

Usage:
  python fetch_bhav_history.py
  python fetch_bhav_history.py --days=365
  python fetch_bhav_history.py --days=100 --test
"""
from __future__ import annotations

import io
import math
import sys
import time
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd
import requests

from db import bulk_upsert, fetch_companies_paginated, log_event, supabase

DAYS_BACK = 500
for arg in sys.argv:
    if arg.startswith('--days='):
        DAYS_BACK = int(arg.split('=')[1])

TEST = '--test' in sys.argv

NSE_HOLIDAYS = frozenset({
    '2024-01-22','2024-03-25','2024-04-09',
    '2024-04-11','2024-04-14','2024-04-17',
    '2024-04-21','2024-05-23','2024-06-17',
    '2024-07-17','2024-08-15','2024-10-02',
    '2024-10-24','2024-11-01','2024-11-15',
    '2024-11-20','2024-12-25',
    '2025-01-26','2025-02-26','2025-03-14',
    '2025-03-31','2025-04-10','2025-04-14',
    '2025-04-18','2025-05-01','2025-08-15',
    '2025-08-27','2025-10-02','2025-10-20',
    '2025-10-21','2025-10-24','2025-11-05',
    '2025-12-25',
    '2026-01-26','2026-03-19','2026-04-14',
    '2026-04-17','2026-05-01',
})

HEADERS = {
    'User-Agent': 'Mozilla/5.0 PineX/1.0',
    'Referer':    'https://www.nseindia.com',
}


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(str(v).replace(',','').strip())
        return None if (math.isnan(f)
                        or math.isinf(f)) else f
    except Exception:
        return None


def get_trading_days(n: int) -> list[str]:
    """
    Returns list of trading days (DDMMYYYY)
    from oldest to newest.
    """
    days = []
    d = date.today() - timedelta(days=1)
    while len(days) < n:
        if d.weekday() < 5 and \
                d.isoformat() not in NSE_HOLIDAYS:
            days.append(d.strftime('%d%m%Y'))
        d -= timedelta(days=1)
    return list(reversed(days))  # oldest first


def download_bhav(ddmmyyyy: str) \
        -> dict[str, dict] | None:
    url = (
        'https://nsearchives.nseindia.com'
        '/products/content/'
        f'sec_bhavdata_full_{ddmmyyyy}.csv'
    )
    try:
        r = requests.get(
            url, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            return None
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = [c.strip()
                      for c in df.columns]
        df = df[df['SERIES'].str.strip()
                == 'EQ'].copy()
        df['SYMBOL'] = df['SYMBOL'].str.strip()

        out = {}
        for _, row in df.iterrows():
            sym = str(row['SYMBOL']).strip()
            if not sym:
                continue
            out[sym] = {
                'open':  _f(row.get('OPEN_PRICE')),
                'high':  _f(row.get('HIGH_PRICE')),
                'low':   _f(row.get('LOW_PRICE')),
                'close': _f(row.get('CLOSE_PRICE')),
                'volume':_f(row.get('TTL_TRD_QNTY')),
                'prev_close':
                    _f(row.get('PREV_CLOSE')),
                'delivery_qty':
                    _f(row.get('DELIV_QTY')),
                'delivery_pct':
                    _f(row.get('DELIV_PER')),
            }
        return out
    except Exception as e:
        print(f'    Download error: {e}')
        return None


def calc_indicators(
        history: pd.DataFrame,
        close: float,
        volume: float) -> dict:
    """Calculate indicators from stored history."""
    today_row = pd.DataFrame(
        {'close': [close],
         'volume': [volume or 0]},
        index=[pd.Timestamp.today().normalize()]
    )
    if not history.empty:
        df = pd.concat(
            [history[['close','volume']],
             today_row])
    else:
        df = today_row

    df = df[~df.index.duplicated(
        keep='last')].sort_index()
    c = df['close'].dropna()
    v = df['volume'].fillna(0)

    if len(c) < 2:
        return {'stage': 'Unclassified'}

    def ma(w):
        x = c.rolling(w).mean().iloc[-1]
        return _f(x)

    ma20  = ma(20)
    ma50  = ma(50)
    ma150 = ma(150)

    # 30W MA
    wk = c.resample('W-FRI').last().dropna()
    ma30w_s = wk.rolling(30,min_periods=20).mean()
    ma30w = _f(ma30w_s.iloc[-1]) \
        if len(ma30w_s) else None

    slope = 0.0
    if len(ma30w_s) >= 5:
        cur = _f(ma30w_s.iloc[-1])
        prv = _f(ma30w_s.iloc[-5])
        if cur and prv and prv != 0:
            slope = (cur-prv)/abs(prv)*100

    # RSI
    d = c.diff()
    g = d.clip(lower=0).rolling(14).mean()
    l = (-d).clip(lower=0).rolling(14).mean()
    rsi = _f((100-(100/(1+(g/l.replace(
        0,np.nan))))).iloc[-1])

    # OBV
    obv_s = (v*np.sign(
        c.diff().fillna(0))).cumsum()
    obv = float(obv_s.iloc[-1])
    obv_sl = 0.0
    if len(obv_s) >= 10:
        p = float(obv_s.iloc[-10])
        if p != 0:
            obv_sl = (obv-p)/abs(p)

    n = len(c)
    h52 = _f(c.iloc[-252:].max()
             if n >= 252 else c.max())
    l52 = _f(c.iloc[-252:].min()
             if n >= 252 else c.min())

    # Stage
    stage = 'Unclassified'
    if ma30w and ma30w != 0:
        pct = (close-ma30w)/ma30w*100
        above = close > ma30w
        pos = ((close-l52)/(h52-l52)*100
               if h52 and l52 and h52>l52
               else 50)
        rising  = slope > 0.3
        falling = slope <= -1.5
        obv_up  = obv_sl > 0.01
        if above and pct > 5:
            stage = 'Stage 2'
        elif above and rising:
            stage = 'Stage 2'
        elif not above and pct>-3 and rising:
            stage = 'Stage 2'
        elif above and not rising:
            stage = 'Stage 3' \
                if pos > 60 or falling \
                else 'Stage 2'
        elif not above and pct > -5 and pos > 65:
            stage = 'Stage 3'
        elif -1.5 < slope <= 0.3:
            stage = 'Stage 1' \
                if pos < 50 else 'Stage 3'
        elif not above and not falling \
                and pct > -10:
            stage = 'Stage 1' \
                if pos < 55 else 'Stage 3'
        elif not above and falling \
                and pct < -5 and not obv_up:
            stage = 'Stage 4'
        else:
            stage = 'Stage 2' \
                if above else 'Stage 1'

    return {
        'ma20': ma20, 'ma50': ma50,
        'ma150': ma150, 'ma30w': ma30w,
        'ma30w_slope': round(slope, 4),
        'rsi': rsi,
        'obv': obv, 'obv_slope': round(obv_sl,4),
        'high_52w': h52, 'low_52w': l52,
        'stage': stage,
        'near_ma20': bool(
            ma20 and abs(close-ma20)/ma20<0.03),
        'rsi_healthy': bool(
            rsi and 40<=rsi<=65),
        'breakout_52w': bool(
            h52 and close >= h52*0.99),
    }


def main():
    print('PineX Historical Bhav Loader')
    print('=' * 50)
    print(f'Loading last {DAYS_BACK} '
          f'trading days')
    if TEST:
        print('TEST MODE — 3 days only')

    all_rows = fetch_companies_paginated('id,symbol,exchange')
    companies = [
        c for c in all_rows
        if c.get('exchange') in
           ('NSE','BOTH',None,'')
    ]
    print(f'Companies to process: '
          f'{len(companies)}')

    # Build symbol → company_id map
    sym_map = {
        c['symbol']: c['id']
        for c in companies
    }

    # Get trading days
    days = get_trading_days(
        3 if TEST else DAYS_BACK)
    print(f'Trading days: {len(days)}')
    print(f'From: {days[0]} to {days[-1]}')

    # Get companies that have NO price data yet (per-company, not global)
    print('\nChecking which companies need data...')
    existing_ids: set[str] = set()
    page_size = 1000
    start = 0
    while True:
        existing_res = supabase.table('price_data')\
            .select('company_id')\
            .range(start, start + page_size - 1)\
            .execute()
        page = existing_res.data or []
        existing_ids.update(
            r['company_id']
            for r in page
            if r.get('company_id')
        )
        if len(page) < page_size:
            break
        start += page_size

    companies_needing_data = [
        c for c in companies
        if c['id'] not in existing_ids
    ]
    print(f'Companies with no price data: '
          f'{len(companies_needing_data)}')
    print(f'Companies already have data: '
          f'{len(companies) - len(companies_needing_data)}')

    sym_map = {
        c['symbol']: c['id']
        for c in companies_needing_data
    }

    if not sym_map:
        print('All companies already have data!')
        print('To force reload use --force flag')
        return

    latest_existing = None  # Per-company filter above replaces the global date skip

    # Rolling history cache
    # Key: company_id → DataFrame
    history_cache: dict[str, pd.DataFrame] = {}

    total_written = 0
    days_processed = 0

    for day_str in days:
        d = datetime.strptime(day_str,'%d%m%Y')
        iso = d.strftime('%Y-%m-%d')

        print(f'\n[{days_processed+1}/'
              f'{len(days)}] {iso}...',
              end=' ', flush=True)

        # Download bhav
        bhav = download_bhav(day_str)
        if not bhav:
            print('download failed')
            time.sleep(2)
            continue

        print(f'{len(bhav)} stocks', end='')

        price_rows    = []
        delivery_rows = []

        for sym, data in bhav.items():
            co_id = sym_map.get(sym)
            if not co_id:
                continue
            close  = data.get('close')
            volume = data.get('volume') or 0
            if not close:
                continue

            # Get history from cache
            hist = history_cache.get(
                co_id, pd.DataFrame())

            # Calculate indicators
            indicators = calc_indicators(
                hist, float(close),
                float(volume))

            price_rows.append({
                'company_id': co_id,
                'date':       iso,
                'open':       data.get('open'),
                'high':       data.get('high'),
                'low':        data.get('low'),
                'close':      close,
                'volume':     volume,
                'prev_close': data.get('prev_close'),
                'is_latest':  False,
                'data_source':'bhav_history',
                **indicators,
            })

            # Delivery
            dp = data.get('delivery_pct')
            if dp is not None:
                delivery_rows.append({
                    'company_id':    co_id,
                    'date':          iso,
                    'delivery_pct':  dp,
                    'delivery_volume':
                        data.get('delivery_qty'),
                    'total_volume':  volume,
                })

            # Update history cache
            new_row = pd.DataFrame(
                {'close': [float(close)],
                 'volume': [float(volume)]},
                index=[pd.Timestamp(iso)]
            )
            if co_id not in history_cache:
                history_cache[co_id] = \
                    pd.DataFrame()
            history_cache[co_id] = pd.concat(
                [history_cache[co_id], new_row]
            ).tail(300)

        # Bulk write
        if price_rows:
            written = bulk_upsert(
                'price_data', price_rows,
                'company_id,date')
            total_written += written
            print(f' → {written} written')
        else:
            print(' → 0 written')

        if delivery_rows:
            bulk_upsert('delivery_data',
                        delivery_rows,
                        'company_id,date')

        days_processed += 1

        # Respectful delay
        time.sleep(1.5)

    # Mark latest row for each company
    print('\nMarking latest price rows...')
    for co_id in sym_map.values():
        try:
            res = supabase.table('price_data')\
                .select('date')\
                .eq('company_id', co_id)\
                .order('date', desc=True)\
                .limit(1)\
                .execute()
            if res.data:
                latest = res.data[0]['date']
                supabase.table('price_data')\
                    .update({'is_latest': True})\
                    .eq('company_id', co_id)\
                    .eq('date', latest)\
                    .execute()
        except Exception:
            pass

    print(f'\n✅ Complete')
    print(f'   Days processed: {days_processed}')
    print(f'   Total rows: {total_written}')

    log_event('fetch_bhav_history', {
        'days': DAYS_BACK,
        'days_processed': days_processed,
        'total_written': total_written,
        'companies': len(companies),
    })


if __name__ == '__main__':
    main()