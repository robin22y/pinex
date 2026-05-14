"""
fetch_bse_announcements.py
Fetches BSE announcements daily and triggers
IndianAPI fetch for companies that announced
financial results.

Free data source — no API key needed.
Uses BSE's public announcement API.

Usage:
  python fetch_bse_announcements.py
  python fetch_bse_announcements.py --force
  python fetch_bse_announcements.py --days=7
  python fetch_bse_announcements.py --test
"""
from __future__ import annotations

import os
import sys
import time
import json
import requests
from datetime import date, datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

from db import supabase, log_event, bulk_upsert

INDIANAPI_KEY = os.environ.get(
    'INDIANAPI_KEY', '')
FORCE = '--force' in sys.argv
TEST  = '--test'  in sys.argv
DAYS  = next(
    (int(a.split('=')[1]) for a in sys.argv
     if a.startswith('--days=')), 1)

# Result-related keywords in announcements
RESULT_KEYWORDS = [
    'financial results',
    'quarterly results',
    'annual results',
    'audited results',
    'unaudited results',
    'standalone & consolidated',
    'board meeting to consider',
    'q1 results', 'q2 results',
    'q3 results', 'q4 results',
    'half yearly results',
    'nine months results',
]

CORPORATE_ACTION_KEYWORDS = [
    'dividend', 'bonus', 'split',
    'rights issue', 'buyback',
    'amalgamation', 'merger',
]

# BSE API requires this exact referer
BSE_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; '
        'Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Referer': (
        'https://www.bseindia.com/corporates/'
        'ann.html'
    ),
    'Accept': (
        'application/json, '
        'text/plain, */*'
    ),
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.bseindia.com',
}

INDIANAPI_HEADERS = {
    'x-api-key': INDIANAPI_KEY
}


# ── BSE fetch ──────────────────────────────
def fetch_bse_announcements(
        from_date: str,
        to_date: str) -> list[dict]:
    """
    Fetch announcements from BSE API.
    Dates in YYYYMMDD format.
    """
    url = (
        'https://api.bseindia.com'
        '/BseIndiaAPI/api/AnnGetData/w'
        f'?strCat=-1'
        f'&strPrevDate={from_date}'
        f'&strScrip='
        f'&strSearch=P'
        f'&strToDate={to_date}'
        f'&strType=C'
        f'&subcategory=-1'
    )
    try:
        r = requests.get(
            url,
            headers=BSE_HEADERS,
            timeout=30
        )
        if r.status_code == 200:
            data = r.json()
            records = data.get('Table', [])
            print(f'  BSE API: '
                  f'{len(records)} announcements')
            return records
        print(f'  BSE API: '
              f'HTTP {r.status_code}')
    except Exception as e:
        print(f'  BSE API error: {e}')
    return []


def classify_announcement(
        subject: str) -> str | None:
    """
    Classify announcement type.
    Returns type string or None if not relevant.
    """
    s = subject.lower()
    if any(kw in s for kw in RESULT_KEYWORDS):
        return 'financial_results'
    if any(kw in s 
           for kw in CORPORATE_ACTION_KEYWORDS):
        return 'corporate_action'
    if 'board meeting' in s:
        return 'board_meeting'
    if 'change in management' in s or \
       'appointment' in s or \
       'resignation' in s:
        return 'management_change'
    return None


# ── Company lookup ─────────────────────────
def build_bse_to_company_map() -> dict:
    """
    Build mapping: bse_code → {id, symbol, tier}
    """
    res = supabase.table('companies')\
        .select('id, symbol, bse_code, tier')\
        .not_.is_('bse_code', 'null')\
        .limit(5000)\
        .execute()

    mapping = {}
    for co in (res.data or []):
        bse = str(co.get('bse_code','')).strip()
        if bse:
            mapping[bse] = {
                'id':     co['id'],
                'symbol': co['symbol'],
                'tier':   co.get('tier', 3),
            }
    return mapping


def get_symbol_map() -> dict:
    """symbol → {id, tier} for NSE lookup"""
    res = supabase.table('companies')\
        .select('id, symbol, tier')\
        .limit(5000)\
        .execute()
    return {
        co['symbol']: {
            'id':   co['id'],
            'tier': co.get('tier', 3),
        }
        for co in (res.data or [])
    }


# ── Announcement storage ───────────────────
def save_announcements(
        announcements: list[dict],
        bse_map: dict) -> list[dict]:
    """
    Save announcements to tracker table.
    Returns list of result announcements
    that need IndianAPI fetch.
    """
    to_fetch = []
    tracker_rows = []

    for ann in announcements:
        scrip_cd = str(
            ann.get('SCRIP_CD', '')).strip()
        subject  = ann.get('NEWSSUB', '')
        ann_dt   = ann.get(
            'DT_TM', '')[:10]
        ann_type = classify_announcement(subject)

        if not ann_type:
            continue

        company = bse_map.get(scrip_cd)
        if not company:
            continue

        tracker_rows.append({
            'company_id':        company['id'],
            'symbol':            company['symbol'],
            'announcement_date': ann_dt,
            'announcement_type': ann_type,
            'announcement_text': subject[:500],
            'indianapi_fetched': False,
        })

        # Queue for IndianAPI if results
        if ann_type == 'financial_results':
            to_fetch.append({
                'symbol':    company['symbol'],
                'company_id':company['id'],
                'tier':      company['tier'],
                'subject':   subject,
                'date':      ann_dt,
            })

    # Save to tracker
    if tracker_rows:
        try:
            supabase.table(
                'announcements_tracker')\
                .upsert(
                    tracker_rows,
                    on_conflict=(
                        'symbol,'
                        'announcement_date,'
                        'announcement_type'
                    )
                )\
                .execute()
            print(f'  Saved {len(tracker_rows)}'
                  f' announcements to tracker')
        except Exception as e:
            print(f'  Tracker save error: {e}')

    return to_fetch


# ── IndianAPI fetch ────────────────────────
def fetch_indianapi(
        symbol: str,
        company_id: str) -> bool:
    """
    Fetch full data from IndianAPI for symbol.
    Saves financials, shareholding, news.
    """
    try:
        r = requests.get(
            'https://stock.indianapi.in/stock',
            headers=INDIANAPI_HEADERS,
            params={'name': symbol},
            timeout=30
        )
        if r.status_code != 200:
            print(f'    IndianAPI HTTP '
                  f'{r.status_code}')
            return False

        data = r.json()

        # ── Financials ──────────────────────
        fin_data = data.get('financials', [])
        if fin_data and isinstance(
                fin_data, list):
            fin_rows = []
            for item in fin_data:
                quarter = (
                    item.get('quarter') or
                    item.get('period') or
                    item.get('date') or ''
                )
                if not quarter:
                    continue
                fin_rows.append({
                    'company_id': company_id,
                    'quarter':    quarter,
                    'revenue':    _safe_float(
                        item.get('revenue') or
                        item.get('sales')),
                    'pat':        _safe_float(
                        item.get('pat') or
                        item.get('net_profit')),
                    'margin':     _safe_float(
                        item.get('margin') or
                        item.get('opm')),
                    'eps':        _safe_float(
                        item.get('eps')),
                    'revenue_growth_yoy': _safe_float(
                        item.get(
                            'revenue_growth_yoy')),
                    'pat_growth_yoy': _safe_float(
                        item.get('pat_growth_yoy')),
                    'data_source': 'indianapi',
                })
            if fin_rows:
                bulk_upsert(
                    'financials', fin_rows,
                    'company_id,quarter')
                print(f'    Saved '
                      f'{len(fin_rows)} '
                      f'financial rows')

        # ── Shareholding ────────────────────
        sh_data = data.get('shareholding')
        if sh_data:
            sh_rows = _parse_shareholding(
                sh_data, company_id)
            if sh_rows:
                bulk_upsert(
                    'shareholding', sh_rows,
                    'company_id,quarter')
                print(f'    Saved '
                      f'{len(sh_rows)} '
                      f'shareholding rows')

        # ── News ────────────────────────────
        news = data.get('recentNews', [])
        if news:
            news_rows = []
            for item in news[:10]:
                url = item.get('url', '')
                if url and not \
                        url.startswith('http'):
                    url = (
                        'https://www.livemint.com'
                        + url
                    )
                title = (
                    item.get('headline') or
                    item.get('title') or ''
                )
                if not title:
                    continue
                news_rows.append({
                    'company_id':   company_id,
                    'symbol':       symbol,
                    'title':        title[:300],
                    'url':          url,
                    'source':       'Livemint',
                    'published_at': (
                        item.get('date') or
                        item.get('lastPublishedDate')
                        or ''
                    ),
                    'summary': (
                        item.get('summary') or ''
                    )[:500],
                    'image_url': (
                        item.get('thumbnailImage')
                        or item.get('listimage')
                        or ''
                    ),
                })
            if news_rows:
                bulk_upsert(
                    'stock_news', news_rows,
                    'company_id,title')
                print(f'    Saved '
                      f'{len(news_rows)} '
                      f'news items')

        # ── Analyst ratings ─────────────────
        analyst = data.get('analystView', [])
        if analyst:
            sb = bw = h = s = 0
            for item in analyst:
                name = item.get(
                    'ratingName', '').lower()
                cnt = int(float(
                    item.get(
                        'numberOfAnalystsLatest',
                        0) or 0))
                if 'strong buy' in name:
                    sb = cnt
                elif 'buy' in name:
                    bw = cnt
                elif 'hold' in name:
                    h = cnt
                elif 'sell' in name:
                    s = cnt
            supabase.table('companies')\
                .update({
                    'analyst_strong_buy': sb,
                    'analyst_buy':  bw,
                    'analyst_hold': h,
                    'analyst_sell': s,
                    'analyst_updated_at':
                        datetime.utcnow()
                        .isoformat(),
                })\
                .eq('id', company_id)\
                .execute()

        # ── Corporate actions ───────────────
        corp = data.get(
            'stockCorporateActionData', [])
        if corp:
            ca_rows = []
            for item in corp:
                ex_date = (
                    item.get('exDate') or
                    item.get('ex_date') or ''
                )
                action = (
                    item.get('purpose') or
                    item.get('action_type') or ''
                )
                if not action:
                    continue
                ca_rows.append({
                    'company_id':  company_id,
                    'symbol':      symbol,
                    'action_type': action,
                    'ex_date':     ex_date,
                    'details':     json.dumps(item),
                    'data_source': 'indianapi',
                })
            if ca_rows:
                bulk_upsert(
                    'corporate_actions',
                    ca_rows,
                    'company_id,action_type,'
                    'ex_date')

        # Mark tracker as fetched
        supabase.table(
            'announcements_tracker')\
            .update({
                'indianapi_fetched': True,
                'indianapi_fetched_at':
                    datetime.utcnow().isoformat(),
            })\
            .eq('symbol', symbol)\
            .eq('indianapi_fetched', False)\
            .execute()

        return True

    except Exception as e:
        print(f'    Error: {e}')
        return False


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(
            str(v).replace(',', '').strip()
                  .replace('%', ''))
    except Exception:
        return None


def _parse_shareholding(
        sh_data,
        company_id: str) -> list[dict]:
    """Parse shareholding data from IndianAPI."""
    rows = []
    if isinstance(sh_data, list):
        items = sh_data
    elif isinstance(sh_data, dict):
        items = sh_data.get('data', []) or \
                sh_data.get('shareholding', [])
    else:
        return []

    for item in items:
        quarter = (
            item.get('quarter') or
            item.get('period') or ''
        )
        if not quarter:
            continue
        rows.append({
            'company_id':          company_id,
            'quarter':             quarter,
            'promoter_pct':        _safe_float(
                item.get('promoter') or
                item.get('promoter_pct')),
            'fii_pct':             _safe_float(
                item.get('fii') or
                item.get('fii_pct')),
            'dii_pct':             _safe_float(
                item.get('dii') or
                item.get('dii_pct')),
            'public_pct':          _safe_float(
                item.get('public') or
                item.get('public_pct')),
            'promoter_pledge_pct': _safe_float(
                item.get('pledge') or
                item.get('promoter_pledge_pct')),
            'data_source':         'indianapi',
        })
    return rows


# ── Also save as news ──────────────────────
def save_announcements_as_news(
        announcements: list[dict],
        bse_map: dict,
        iso_date: str):
    """
    Save important BSE announcements
    directly as news items.
    Useful for tier-3 stocks that don't
    get IndianAPI news.
    """
    news_rows = []
    for ann in announcements:
        scrip_cd = str(
            ann.get('SCRIP_CD', '')).strip()
        subject  = ann.get('NEWSSUB', '')
        ann_dt   = ann.get('DT_TM', '')

        ann_type = classify_announcement(subject)
        if not ann_type:
            continue

        company = bse_map.get(scrip_cd)
        if not company:
            continue

        news_rows.append({
            'company_id':   company['id'],
            'symbol':       company['symbol'],
            'title':        subject[:300],
            'url':          '',
            'source':       'BSE',
            'published_at': ann_dt or iso_date,
            'summary':      '',
            'image_url':    '',
        })

    if news_rows:
        bulk_upsert(
            'stock_news', news_rows,
            'company_id,title')
        print(f'  Saved {len(news_rows)} '
              f'BSE announcements as news')


# ── Main ───────────────────────────────────
def main():
    skip_reasons = []
    if not FORCE:
        today = date.today()
        if today.weekday() >= 5:
            skip_reasons.append('Weekend')

    if skip_reasons and not FORCE:
        print(', '.join(skip_reasons),
              '— skipping')
        return

    today     = date.today()
    iso_date  = today.isoformat()
    from_date = (today - timedelta(
        days=DAYS)).strftime('%Y%m%d')
    to_date   = today.strftime('%Y%m%d')

    print('PineX BSE Announcements Fetcher')
    print('=' * 50)
    print(f'Date range: {from_date} → {to_date}')

    # Build company lookup maps
    print('\nBuilding company maps...')
    bse_map = build_bse_to_company_map()
    print(f'  BSE code map: '
          f'{len(bse_map)} companies')

    # Fetch BSE announcements
    print('\nFetching BSE announcements...')
    announcements = fetch_bse_announcements(
        from_date, to_date)

    if not announcements:
        print('No announcements fetched.')
        return

    # Save all as news for all stocks
    print('\nSaving as news...')
    save_announcements_as_news(
        announcements, bse_map, iso_date)

    # Save to tracker + get result symbols
    print('\nClassifying announcements...')
    to_fetch = save_announcements(
        announcements, bse_map)

    print(f'\nCompanies announcing results: '
          f'{len(to_fetch)}')
    for item in to_fetch:
        print(f"  {item['symbol']}: "
              f"{item['subject'][:60]}")

    if not to_fetch:
        print('No result announcements today.')
        log_event('fetch_bse_announcements', {
            'date': iso_date,
            'total_announcements':
                len(announcements),
            'result_symbols': 0,
            'fetched': 0,
        })
        return

    if not INDIANAPI_KEY:
        print('\nWARNING: INDIANAPI_KEY not set')
        print('Announcements saved but '
              'IndianAPI fetch skipped')
        return

    # Fetch IndianAPI for result companies
    print(f'\nFetching IndianAPI for '
          f'{len(to_fetch)} companies...')

    if TEST:
        to_fetch = to_fetch[:3]
        print(f'TEST MODE: limiting to '
              f'{len(to_fetch)} companies')

    success = 0
    failed  = 0

    for i, item in enumerate(to_fetch, 1):
        sym = item['symbol']
        cid = item['company_id']
        tier = item['tier']

        print(f'[{i}/{len(to_fetch)}] '
              f'{sym} (tier {tier})...')

        if fetch_indianapi(sym, cid):
            success += 1
            print(f'  ✅ Done')
        else:
            failed += 1
            print(f'  ❌ Failed')

        time.sleep(2)

    print(f'\n✅ Complete')
    print(f'   Announcements: '
          f'{len(announcements)}')
    print(f'   Result companies: '
          f'{len(to_fetch)}')
    print(f'   IndianAPI fetched: {success}')
    print(f'   Failed: {failed}')
    print(f'   API calls used: {success}')

    log_event('fetch_bse_announcements', {
        'date':                 iso_date,
        'total_announcements':  len(announcements),
        'result_symbols':       len(to_fetch),
        'fetched':              success,
        'failed':               failed,
    })


if __name__ == '__main__':
    main()