"""
calc_signal_outcomes.py
Calculates what happened 30 days after
SwingX / volume spike / Stage 2 entry signals.
"""
import sys, os
from datetime import date, timedelta
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')
from supabase import create_client

supabase = create_client(
    os.environ['SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

FORCE = '--force' in sys.argv
DAYS = 90
for a in sys.argv:
    if a.startswith('--days='):
        DAYS = int(a.split('=')[1])

# Signals must be 32+ days old
# so 30-day outcome is available
LOOKBACK_MIN = 32
OUTCOME_DAYS = 30


def get_all_dates():
    """Distinct trading dates, oldest first.

    Sourced from market_internals (1 row per trading date — small and fast,
    ~500 rows for 2 years). The old implementation queried price_data and
    capped at 300 rows, but with ~2125 stocks per date that returned only ~1
    distinct date — silently breaking every outcome_date calc downstream
    (which uses this list to find signal_date + 30 trading days).
    """
    out: set[str] = set()
    start = 0
    page = 1000
    while True:
        res = (
            supabase.table('market_internals')
            .select('date')
            .order('date', desc=False)
            .range(start, start + page - 1)
            .execute()
        )
        batch = res.data or []
        out.update(r['date'] for r in batch if r.get('date'))
        if len(batch) < page:
            break
        start += page
    return sorted(out)


def get_outcome_date(signal_date, all_dates):
    target = (
        date.fromisoformat(signal_date) + 
        timedelta(days=OUTCOME_DAYS)
    ).isoformat()
    future = [d for d in all_dates 
              if d >= target]
    return future[0] if future else None


def get_price(symbol, target_date, all_dates):
    """Get close price on or after target_date."""
    candidates = [
        d for d in all_dates 
        if d >= target_date][:5]
    for d in candidates:
        res = supabase.table('price_data')\
            .select('close')\
            .eq('symbol', symbol)\
            .eq('date', d)\
            .limit(1)\
            .execute()
        if res.data and res.data[0].get('close'):
            return float(res.data[0]['close'])
    return None


def get_companies():
    """Returns {company_id: {symbol, sector}}"""
    rows = []
    start = 0
    while True:
        res = supabase.table('companies')\
            .select('id, symbol, sector')\
            .range(start, start+999)\
            .execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    return {
        r['id']: {
            'symbol': r['symbol'],
            'sector': r.get('sector', ''),
        }
        for r in rows if r.get('id')
    }


def exists(symbol, signal_date, stype):
    if FORCE:
        return False
    res = supabase.table('signal_outcomes')\
        .select('id')\
        .eq('symbol', symbol)\
        .eq('signal_date', signal_date)\
        .eq('signal_type', stype)\
        .limit(1)\
        .execute()
    return bool(res.data)


def save(record):
    supabase.table('signal_outcomes')\
        .upsert(record,
            on_conflict=
            'symbol,signal_date,signal_type')\
        .execute()


def main():
    today = date.today()
    from_date = (
        today - timedelta(days=DAYS)
    ).isoformat()
    to_date = (
        today - timedelta(days=LOOKBACK_MIN)
    ).isoformat()

    print(f'PineX Signal Outcomes')
    print(f'Window: {from_date} → {to_date}')
    print()

    all_dates = get_all_dates()
    print(f'Trading dates available: '
          f'{len(all_dates)}')
    if all_dates:
        print(f'  Range: {all_dates[0]} → '
              f'{all_dates[-1]}')
    print()

    companies = get_companies()
    print(f'Companies: {len(companies)}')
    print()

    # ── SWINGX signals ─────────────────────
    print('Scanning SwingX signals...')
    swingx_rows = []
    start = 0
    while True:
        res = supabase.table('delivery_signals')\
            .select('company_id, date, '
                    'vol_ratio, '
                    'avg_delivery_30d')\
            .eq('high_conviction', True)\
            .gte('date', from_date)\
            .lte('date', to_date)\
            .range(start, start+999)\
            .execute()
        batch = res.data or []
        swingx_rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    print(f'  Found: {len(swingx_rows)}')

    swingx_saved = 0
    for row in swingx_rows:
        cid = row.get('company_id')
        sdate = row.get('date')
        co = companies.get(cid, {})
        sym = co.get('symbol')
        if not sym or not sdate:
            continue
        if exists(sym, sdate, 'swingx'):
            continue
        sp = get_price(sym, sdate, all_dates)
        od = get_outcome_date(sdate, all_dates)
        if not sp or not od:
            continue
        op = get_price(sym, od, all_dates)
        if not op:
            continue
        chg = round(
            (op - sp) / sp * 100, 2)
        days = (
            date.fromisoformat(od) - 
            date.fromisoformat(sdate)
        ).days
        save({
            'symbol': sym,
            'company_id': cid,
            'signal_type': 'swingx',
            'signal_date': sdate,
            'signal_price': sp,
            'outcome_date': od,
            'outcome_price': op,
            'change_pct': chg,
            'days_held': days,
            'sector': co.get('sector', ''),
            'stage_at_signal': 'Stage 2',
            'substage_at_signal': 'SwingX',
        })
        swingx_saved += 1
        d = '+' if chg >= 0 else ''
        print(f'  {sym} {sdate} '
              f'→ {d}{chg}%')

    print(f'  Saved: {swingx_saved}')
    print()

    # ── VOLUME SPIKE signals ───────────────
    print('Scanning volume spikes...')
    vol_rows = []
    start = 0
    while True:
        res = supabase.table('delivery_signals')\
            .select('company_id, date, '
                    'vol_ratio')\
            .gte('vol_ratio', 2.0)\
            .gte('date', from_date)\
            .lte('date', to_date)\
            .range(start, start+999)\
            .execute()
        batch = res.data or []
        vol_rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000

    # Filter out those already 
    # caught by swingx
    vol_rows = [
        r for r in vol_rows
        if not exists(
            companies.get(
                r.get('company_id'),{}
            ).get('symbol',''),
            r.get('date',''),
            'swingx'
        )
    ]
    print(f'  Found: {len(vol_rows)}')

    vol_saved = 0
    for row in vol_rows:
        cid = row.get('company_id')
        sdate = row.get('date')
        co = companies.get(cid, {})
        sym = co.get('symbol')
        if not sym or not sdate:
            continue
        if exists(sym, sdate, 'volume_spike'):
            continue
        sp = get_price(sym, sdate, all_dates)
        od = get_outcome_date(sdate, all_dates)
        if not sp or not od:
            continue
        op = get_price(sym, od, all_dates)
        if not op:
            continue
        chg = round(
            (op - sp) / sp * 100, 2)
        days = (
            date.fromisoformat(od) - 
            date.fromisoformat(sdate)
        ).days
        vr = row.get('vol_ratio', 0)
        save({
            'symbol': sym,
            'company_id': cid,
            'signal_type': 'volume_spike',
            'signal_date': sdate,
            'signal_price': sp,
            'outcome_date': od,
            'outcome_price': op,
            'change_pct': chg,
            'days_held': days,
            'sector': co.get('sector', ''),
            'stage_at_signal': '',
            'substage_at_signal':
                f'Vol {vr:.1f}x',
        })
        vol_saved += 1

    print(f'  Saved: {vol_saved}')
    print()

    # ── STAGE 2 ENTRIES ────────────────────
    print('Scanning Stage 2 entries...')

    # Get all price_data in window
    # comparing consecutive dates
    stage2_saved = 0
    window_dates = [
        d for d in all_dates
        if from_date <= d <= to_date
    ]

    if len(window_dates) >= 2:
        # Get all symbols
        all_syms = list(set(
            co['symbol'] 
            for co in companies.values()
            if co.get('symbol')
        ))

        # Process in batches of 100 symbols
        batch_size = 100
        for i in range(
                0, len(all_syms), batch_size):
            sym_batch = all_syms[i:i+batch_size]

            res = supabase.table('price_data')\
                .select('symbol, date, stage, '
                        'weinstein_substage')\
                .in_('symbol', sym_batch)\
                .gte('date', 
                     window_dates[0])\
                .lte('date', 
                     window_dates[-1])\
                .order('date',
                       desc=False)\
                .execute()

            rows = res.data or []

            # Group by symbol
            by_sym: dict = {}
            for r in rows:
                s = r.get('symbol')
                if s:
                    by_sym.setdefault(
                        s, []).append(r)

            for sym, hist in by_sym.items():
                hist.sort(
                    key=lambda x: 
                    x.get('date',''))
                for j in range(
                        1, len(hist)):
                    prev = hist[j-1]
                    curr = hist[j]
                    ps = prev.get('stage','')
                    cs = curr.get('stage','')
                    cd = curr.get('date','')
                    if (cs == 'Stage 2' and
                            ps != 'Stage 2' and
                            from_date <= cd 
                            <= to_date):
                        if exists(
                                sym, cd,
                                'stage2_entry'):
                            continue
                        sp = get_price(
                            sym, cd, all_dates)
                        od = get_outcome_date(
                            cd, all_dates)
                        if not sp or not od:
                            continue
                        op = get_price(
                            sym, od, all_dates)
                        if not op:
                            continue
                        chg = round(
                            (op-sp)/sp*100, 2)
                        days = (
                            date.fromisoformat(od)-
                            date.fromisoformat(cd)
                        ).days
                        # Get company_id
                        cid = next((
                            cid for cid, co 
                            in companies.items()
                            if co.get(
                                'symbol') == sym
                        ), None)
                        sec = companies.get(
                            cid or '',{}
                        ).get('sector','')
                        sub = curr.get(
                            'weinstein_substage',
                            'Stage 2')
                        save({
                            'symbol': sym,
                            'company_id': cid,
                            'signal_type':
                                'stage2_entry',
                            'signal_date': cd,
                            'signal_price': sp,
                            'outcome_date': od,
                            'outcome_price': op,
                            'change_pct': chg,
                            'days_held': days,
                            'sector': sec,
                            'stage_at_signal':
                                'Stage 2',
                            'substage_at_signal':
                                sub,
                        })
                        stage2_saved += 1
                        d = '+' if chg >= 0 \
                            else ''
                        print(f'  S2 entry {sym}'
                              f' {cd} → {d}{chg}%')

    print(f'  Saved: {stage2_saved}')
    print()

    # ── SUMMARY ────────────────────────────
    total = (swingx_saved + 
             vol_saved + stage2_saved)
    print('=' * 40)
    print(f'Total saved: {total}')

    # Stats
    res = supabase.table('signal_outcomes')\
        .select('change_pct')\
        .execute()
    all_chg = [
        float(r['change_pct'])
        for r in (res.data or [])
        if r.get('change_pct') is not None
    ]
    if all_chg:
        wins = [c for c in all_chg if c > 0]
        print(f'All-time signals: {len(all_chg)}')
        print(f'Win rate: '
              f'{len(wins)/len(all_chg)*100:.1f}%')
        print(f'Avg: '
              f'{sum(all_chg)/len(all_chg):.1f}%')
    else:
        print()
        print('No outcomes in DB yet.')
        print('Possible reasons:')
        print('  1. delivery_signals < 32 days old')
        print('     Run: python '
              'calc_delivery_signals.py '
              '--backfill --days=90')
        print('  2. high_conviction never true')
        print('     Check SwingX calculation')
        print('  3. Not enough price history')


if __name__ == '__main__':
    main()