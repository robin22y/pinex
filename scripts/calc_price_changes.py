from db import supabase
from datetime import datetime, date
import time

def calc_price_changes():
    print("Fetching all companies...")
    companies = supabase.table('companies').select('id, symbol').limit(5000).execute()
    total = len(companies.data)
    print(f"Processing {total} companies...")

    success = 0
    failed = 0

    for i, company in enumerate(companies.data):
        cid = company['id']
        symbol = company['symbol']

        try:
            # Fetch last 252 days of price data
            rows = supabase.table('price_data')\
                .select('close, date')\
                .eq('company_id', cid)\
                .order('date', desc=True)\
                .limit(252)\
                .execute()

            if not rows.data or len(rows.data) < 2:
                continue

            prices = rows.data  # newest first

            def pct_change(days):
                if len(prices) > days:
                    latest = prices[0]['close']
                    old = prices[days]['close']
                    if old and old > 0:
                        return round((latest - old) / old * 100, 2)
                return None

            # Calculate changes
            change_1d  = pct_change(1)
            change_7d  = pct_change(5)   # 5 trading days = 1 week
            change_30d = pct_change(21)  # 21 trading days = 1 month
            change_90d = pct_change(63)  # 63 trading days = 3 months
            change_180d = pct_change(126)
            change_365d = pct_change(252)

            today_str = date.today().isoformat()

            # Upsert into delivery_signals
            payload = {
                'company_id': cid,
                'date': today_str,
                'price_change_7d': change_7d,
                'price_change_30d': change_30d,
            }

            supabase.table('delivery_signals')\
                .upsert(payload, on_conflict='company_id,date')\
                .execute()

            # Also update price_data with 1d change flag
            if change_1d is not None:
                supabase.table('price_data')\
                    .update({'price_change_1d': change_1d})\
                    .eq('company_id', cid)\
                    .eq('date', prices[0]['date'])\
                    .execute()

            print(f"[{i+1}/{total}] {symbol}: 1D={change_1d}% 1W={change_7d}% 1M={change_30d}%")
            success += 1

        except Exception as e:
            print(f"[{i+1}/{total}] {symbol} failed: {e}")
            failed += 1

        time.sleep(0.1)  # gentle rate limiting

    print(f"\nDone. success={success} failed={failed}")

if __name__ == '__main__':
    calc_price_changes()