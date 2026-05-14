"""
fetch_result_calendar.py
Reads result calendar CSV and fetches
IndianAPI data for companies announcing
results today or in the next N days.

Workflow:
1. You paste BSE result calendar into
   scripts/data/result_calendar.csv
2. This script runs daily and fetches
   only companies announcing today

CSV format (copy-paste from BSE website):
security_code,security_name,result_date
530881,ABVL,13 May 2026
519183,ADFFOODS,13 May 2026

Usage:
  python fetch_result_calendar.py
  python fetch_result_calendar.py --force
  python fetch_result_calendar.py --days=3
  python fetch_result_calendar.py --test
  python fetch_result_calendar.py --all
"""
from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

from db import supabase, log_event, bulk_upsert

# ── Config ─────────────────────────────────
INDIANAPI_KEY = os.environ.get(
    'INDIANAPI_KEY', '')
FORCE    = '--force' in sys.argv
TEST     = '--test'  in sys.argv
FETCH_ALL= '--all'   in sys.argv
DAYS_AHEAD = next(
    (int(a.split('=')[1]) for a in sys.argv
     if a.startswith('--days=')), 0)

CSV_PATH = Path(__file__).parent / \
           'data' / 'result_calendar.csv'

INDIANAPI_HEADERS = {
    'x-api-key': INDIANAPI_KEY
}

# ── Date parsing ───────────────────────────
DATE_FORMATS = [
    '%d %b %Y',    # 13 May 2026
    '%d-%b-%Y',    # 13-May-2026
    '%d/%m/%Y',    # 13/05/2026
    '%Y-%m-%d',    # 2026-05-13
    '%d %B %Y',    # 13 May 2026 (full month)
    '%b %d, %Y',   # May 13, 2026
]

def parse_date(s: str) -> date | None:
    s = s.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(
                s, fmt).date()
        except ValueError:
            continue
    return None


# ── Read calendar ──────────────────────────
def read_calendar() -> list[dict]:
    """Read result calendar from CSV."""
    if not CSV_PATH.exists():
        print(f'ERROR: {CSV_PATH} not found')
        print('Create it with columns:')
        print('security_code,security_name,'
              'result_date')
        return []

    entries = []
    with open(CSV_PATH, 'r',
              encoding='utf-8-sig') as f:
        # Try to detect delimiter
        sample = f.read(1024)
        f.seek(0)
        delimiter = '\t' if '\t' in sample \
            else ','
        reader = csv.DictReader(
            f, delimiter=delimiter)
        
        for row in reader:
            # Flexible column name matching
            code = (
                row.get('security_code') or
                row.get('Security Code') or
                row.get('SECURITY_CODE') or
                row.get('ScripCode') or
                row.get('scrip_code') or
                ''
            ).strip()
            
            name = (
                row.get('security_name') or
                row.get('Security Name') or
                row.get('SECURITY_NAME') or
                row.get('Symbol') or
                ''
            ).strip()
            
            result_dt = (
                row.get('result_date') or
                row.get('Result Date') or
                row.get('RESULT_DATE') or
                row.get('Date') or
                ''
            ).strip()
            
            if not code or not result_dt:
                continue
            
            parsed = parse_date(result_dt)
            if not parsed:
                print(f'  Could not parse date:'
                      f' {result_dt!r}')
                continue
            
            entries.append({
                'bse_code':    code,
                'name':        name,
                'result_date': parsed,
            })
    
    print(f'Read {len(entries)} entries '
          f'from calendar')
    return entries


# ── Filter by date ─────────────────────────
def get_todays_entries(
        entries: list[dict],
        days_ahead: int = 0) -> list[dict]:
    """Get entries for today + days_ahead (CSV path)."""
    today = date.today()
    target_dates = {
        today + timedelta(days=i)
        for i in range(days_ahead + 1)
    }
    return [
        e for e in entries
        if e['result_date'] in target_dates
    ]


# ── DB-backed calendar source ──────────────
def get_entries_from_db(
        days_ahead: int = 0) -> list[dict]:
    """
    Primary source: read result_calendar Supabase table.
    Returns unfetched rows for today..today+days_ahead,
    restricted to event_type = 'financial_results'.

    If a row is missing company_id it is resolved by
    symbol against the companies table, so newly pasted
    rows can be fetched without re-saving them.

    Each entry carries source='db' so main() can call
    mark_fetched() after a successful IndianAPI fetch.
    """
    today = date.today()
    end = today + timedelta(days=days_ahead)
    try:
        res = supabase.table('result_calendar')\
            .select('symbol, security_name, '
                    'result_date, company_id, '
                    'event_type, purpose')\
            .gte('result_date',
                 today.isoformat())\
            .lte('result_date',
                 end.isoformat())\
            .eq('indianapi_fetched', False)\
            .eq('event_type',
                'financial_results')\
            .limit(5000)\
            .execute()
    except Exception as exc:
        print(f'  result_calendar query failed: '
              f'{exc}')
        return []

    entries: list[dict] = []
    for r in (getattr(res, 'data', None) or []):
        rd = r.get('result_date')
        if not rd:
            continue
        try:
            parsed = date.fromisoformat(
                str(rd)[:10])
        except ValueError:
            continue

        sym = str(r.get('symbol') or '')\
            .strip().upper()
        co_id = r.get('company_id')

        # Backfill company_id from symbol when the
        # calendar row was saved before a match
        # existed in companies.
        if not co_id and sym:
            try:
                lookup = supabase.table('companies')\
                    .select('id')\
                    .eq('symbol', sym)\
                    .limit(1)\
                    .execute()
                rows = getattr(
                    lookup, 'data', None) or []
                if rows:
                    co_id = rows[0].get('id')
            except Exception as exc:
                print(f'  company lookup failed '
                      f'({sym}): {exc}')

        entries.append({
            'bse_code':    '',
            'name':
                str(r.get('security_name') or '')
                .strip(),
            'result_date': parsed,
            'company_id':  co_id,
            'symbol':      sym,
            'source':      'db',
        })
    return entries


def mark_fetched(
    bse_code: str | None,
    result_date: date,
    symbol: str | None = None,
) -> None:
    """Mark a result_calendar row as fetched."""
    bc = (bse_code or "").strip()
    sym = (symbol or "").strip().upper()
    if not bc and not sym:
        return
    try:
        q = (
            supabase.table("result_calendar")
            .update(
                {
                    "indianapi_fetched": True,
                    "indianapi_fetched_at": datetime.utcnow().isoformat(),
                }
            )
            .eq("result_date", result_date.isoformat())
        )
        if bc:
            q = q.eq("bse_code", bc)
        else:
            q = q.eq("symbol", sym)
        q.execute()
    except Exception as exc:
        print(
            f"  mark_fetched failed "
            f"({bc or sym}/{result_date}): "
            f"{exc}"
        )


# ── Company lookup ─────────────────────────
def find_company(
        bse_code: str,
        name: str) -> dict | None:
    """
    Find company in our DB by BSE code.
    Falls back to name matching.
    """
    # Try BSE code first
    if bse_code:
        res = supabase.table('companies')\
            .select('id, symbol, tier')\
            .eq('bse_code', bse_code)\
            .limit(1)\
            .execute()
        if res.data:
            return res.data[0]
    
    # Try symbol match (NSE symbol often
    # matches BSE security name)
    if name:
        # Clean up name for symbol matching
        sym = name.strip().upper()\
            .replace(' ', '')\
            .replace('-', '')
        res = supabase.table('companies')\
            .select('id, symbol, tier')\
            .eq('symbol', sym)\
            .limit(1)\
            .execute()
        if res.data:
            return res.data[0]
        
        # Try partial match
        res = supabase.table('companies')\
            .select('id, symbol, tier')\
            .ilike('symbol', f'{sym[:6]}%')\
            .limit(1)\
            .execute()
        if res.data:
            return res.data[0]
    
    return None


# ── IndianAPI fetch ────────────────────────
def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(
            str(v).replace(',','')
                  .replace('%','')
                  .strip())
    except Exception:
        return None


def fetch_company_data(
        symbol: str,
        company_id: str) -> dict:
    """
    Fetch full company data from IndianAPI.
    Returns summary of what was saved.
    """
    saved = {
        'financials': 0,
        'shareholding': 0,
        'news': 0,
        'corp_actions': 0,
    }
    
    try:
        r = requests.get(
            'https://stock.indianapi.in/stock',
            headers=INDIANAPI_HEADERS,
            params={'name': symbol},
            timeout=30
        )
        if r.status_code != 200:
            print(f'    HTTP {r.status_code}')
            return saved
        
        data = r.json()
        
        # ── Financials ──────────────────────
        fin_data = data.get('financials',[])
        if isinstance(fin_data, list) \
                and fin_data:
            fin_rows = []
            for item in fin_data:
                q = (item.get('quarter') or
                     item.get('period') or '')
                if not q:
                    continue
                fin_rows.append({
                    'company_id': company_id,
                    'quarter': q,
                    'revenue': _safe_float(
                        item.get('revenue') or
                        item.get('sales')),
                    'pat': _safe_float(
                        item.get('pat') or
                        item.get('net_profit')),
                    'margin': _safe_float(
                        item.get('margin') or
                        item.get('opm')),
                    'eps': _safe_float(
                        item.get('eps')),
                    'revenue_growth_yoy':
                        _safe_float(item.get(
                            'revenue_growth_yoy')),
                    'pat_growth_yoy':
                        _safe_float(item.get(
                            'pat_growth_yoy')),
                    'data_source': 'indianapi',
                })
            if fin_rows:
                bulk_upsert(
                    'financials', fin_rows,
                    'company_id,quarter')
                saved['financials'] = \
                    len(fin_rows)
        
        # ── Shareholding ────────────────────
        sh_raw = data.get('shareholding')
        if sh_raw:
            sh_rows = []
            items = sh_raw \
                if isinstance(sh_raw, list) \
                else sh_raw.get('data', [])
            for item in items:
                q = (item.get('quarter') or
                     item.get('period') or '')
                if not q:
                    continue
                sh_rows.append({
                    'company_id': company_id,
                    'quarter': q,
                    'promoter_pct':
                        _safe_float(
                            item.get('promoter') or
                            item.get('promoter_pct')),
                    'fii_pct':
                        _safe_float(
                            item.get('fii') or
                            item.get('fii_pct')),
                    'dii_pct':
                        _safe_float(
                            item.get('dii') or
                            item.get('dii_pct')),
                    'public_pct':
                        _safe_float(
                            item.get('public') or
                            item.get('public_pct')),
                    'promoter_pledge_pct':
                        _safe_float(
                            item.get('pledge') or
                            item.get(
                                'promoter_pledge_pct')),
                    'data_source': 'indianapi',
                })
            if sh_rows:
                bulk_upsert(
                    'shareholding', sh_rows,
                    'company_id,quarter')
                saved['shareholding'] = \
                    len(sh_rows)
        
        # ── News ────────────────────────────
        news = data.get('recentNews', [])
        if news:
            news_rows = []
            for item in news[:10]:
                title = (
                    item.get('headline') or
                    item.get('title') or ''
                ).strip()
                if not title:
                    continue
                url = item.get('url','')
                if url and not \
                        url.startswith('http'):
                    url = ('https://www.'
                           'livemint.com' + url)
                news_rows.append({
                    'company_id':   company_id,
                    'symbol':       symbol,
                    'title':        title[:300],
                    'url':          url,
                    'source':       'Livemint',
                    'published_at': (
                        item.get('date') or
                        item.get(
                            'lastPublishedDate')
                        or ''
                    ),
                    'summary': (
                        item.get('summary','')
                        [:500]
                    ),
                    'image_url': (
                        item.get(
                            'thumbnailImage') or
                        item.get('listimage','')
                    ),
                })
            if news_rows:
                bulk_upsert(
                    'stock_news', news_rows,
                    'company_id,title')
                saved['news'] = len(news_rows)
        
        # ── Analyst ratings ─────────────────
        analyst = data.get('analystView',[])
        if analyst:
            sb = bw = h = s = 0
            for item in analyst:
                nm = item.get(
                    'ratingName','').lower()
                cnt = int(float(
                    item.get(
                        'numberOfAnalystsLatest',
                        0) or 0))
                if 'strong buy' in nm:
                    sb = cnt
                elif 'buy' in nm:
                    bw = cnt
                elif 'hold' in nm:
                    h  = cnt
                elif 'sell' in nm:
                    s  = cnt
            supabase.table('companies')\
                .update({
                    'analyst_strong_buy': sb,
                    'analyst_buy':        bw,
                    'analyst_hold':       h,
                    'analyst_sell':       s,
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
                action = (
                    item.get('purpose') or
                    item.get('action_type') or ''
                ).strip()
                ex_dt = (
                    item.get('exDate') or
                    item.get('ex_date') or ''
                ).strip()
                if not action:
                    continue
                ca_rows.append({
                    'company_id':  company_id,
                    'symbol':      symbol,
                    'action_type': action,
                    'ex_date':     ex_dt,
                    'details': json.dumps(item),
                    'data_source': 'indianapi',
                })
            if ca_rows:
                bulk_upsert(
                    'corporate_actions',
                    ca_rows,
                    'company_id,action_type,'
                    'ex_date')
                saved['corp_actions'] = \
                    len(ca_rows)
        
        return saved
    
    except Exception as e:
        print(f'    Error: {e}')
        return saved


# ── Main ───────────────────────────────────
def main():
    if not FORCE:
        today = date.today()
        if today.weekday() >= 5:
            print('Weekend — skipping')
            return

    print('PineX Result Calendar Fetcher')
    print('=' * 50)

    # Source 1 (primary): result_calendar Supabase table.
    db_days = 365 if FETCH_ALL else DAYS_AHEAD
    to_process = get_entries_from_db(db_days)
    used_db = bool(to_process)
    if used_db:
        print(f'Loaded {len(to_process)} '
              f'unfetched entries from '
              f'result_calendar (next '
              f'{db_days} days)')

    # Source 2 (fallback): CSV.
    if not used_db:
        print('No unfetched entries in '
              'result_calendar — falling back '
              'to CSV.')
        entries = read_calendar()
        if not entries:
            return

        # Show full calendar summary
        by_date = {}
        for e in entries:
            d = e['result_date'].isoformat()
            by_date.setdefault(d, []).append(e)

        print(f'\nCalendar summary:')
        for d in sorted(by_date.keys()):
            print(f'  {d}: '
                  f'{len(by_date[d])} companies')

        # Filter to today + days ahead
        if FETCH_ALL:
            to_process = entries
            print(f'\nFetching ALL '
                  f'{len(to_process)} companies')
        else:
            to_process = get_todays_entries(
                entries, DAYS_AHEAD)
            label = 'today'
            if DAYS_AHEAD:
                label = (f'today + '
                         f'{DAYS_AHEAD} days')
            print(f'\nCompanies announcing '
                  f'{label}: {len(to_process)}')

    if not to_process:
        print('Nothing to fetch today.')
        print(f'Today is: {date.today()}')
        print('Use --days=7 to fetch '
              'next 7 days')
        print('Use --all to fetch entire '
              'calendar')
        return

    # Show what we're fetching
    print('\nScheduled:')
    for e in to_process:
        print(f"  BSE:{e['bse_code']} "
              f"{e['name']} "
              f"({e['result_date']})")

    if not INDIANAPI_KEY:
        print('\nERROR: INDIANAPI_KEY not set')
        return

    # Match to our companies. DB-sourced rows
    # already carry company_id/symbol; only the
    # CSV path needs a lookup.
    matched   = []
    unmatched = []

    for e in to_process:
        if e.get('source') == 'db' \
                and e.get('company_id') \
                and e.get('symbol'):
            matched.append({
                **e,
                'id':     e['company_id'],
                'symbol': e['symbol'],
                'tier':   e.get('tier', 3),
            })
            continue
        co = find_company(
            e['bse_code'], e['name'])
        if co:
            matched.append({**e, **co})
        else:
            unmatched.append(e)

    print(f'\nMatched to DB: {len(matched)}')
    if unmatched:
        print(f'Not in DB: {len(unmatched)}')
        for e in unmatched:
            print(f"  BSE:{e['bse_code']} "
                  f"{e['name']}")

    if not matched:
        print('\nNo matched companies to fetch')
        return

    # Test mode limit
    if TEST:
        matched = matched[:3]
        print(f'\nTEST MODE: '
              f'limiting to {len(matched)}')

    # Fetch IndianAPI for each
    print(f'\nFetching {len(matched)} '
          f'companies from IndianAPI...')
    print('-' * 40)

    total_fin  = 0
    total_sh   = 0
    total_news = 0
    success    = 0
    failed     = 0

    for i, co in enumerate(matched, 1):
        sym = co['symbol']
        cid = co['id']
        tier = co.get('tier', 3)
        dt  = co['result_date']

        print(f'\n[{i}/{len(matched)}] '
              f'{sym} (tier {tier}, '
              f'results {dt})')

        saved = fetch_company_data(sym, cid)

        if saved['financials'] > 0 or \
                saved['news'] > 0:
            success += 1
            print(f'  ✅ fin={saved["financials"]}'
                  f' sh={saved["shareholding"]}'
                  f' news={saved["news"]}'
                  f' ca={saved["corp_actions"]}')
            total_fin  += saved['financials']
            total_sh   += saved['shareholding']
            total_news += saved['news']
            # Mark this result_calendar row as
            # fetched so subsequent runs skip it.
            if co.get('source') == 'db':
                mark_fetched(
                    str(co.get('bse_code') or ''),
                    dt,
                    str(co.get('symbol') or ''),
                )
        else:
            failed += 1
            print(f'  ❌ No data returned')

        time.sleep(2)

    print(f'\n{"="*40}')
    print(f'✅ Complete')
    print(f'   Companies fetched: {success}')
    print(f'   Failed:           {failed}')
    print(f'   Financials saved: {total_fin}')
    print(f'   Shareholding:     {total_sh}')
    print(f'   News items:       {total_news}')
    print(f'   API calls used:   '
          f'{success + failed}')

    log_event('fetch_result_calendar', {
        'date':       date.today().isoformat(),
        'calendar_entries': len(to_process),
        'processed':  len(matched),
        'success':    success,
        'failed':     failed,
        'fin_rows':   total_fin,
        'sh_rows':    total_sh,
        'news_rows':  total_news,
    })


if __name__ == '__main__':
    main()