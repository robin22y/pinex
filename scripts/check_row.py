import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

res = sb.table('market_internals').select('*').eq('date', '2026-06-25').execute()
if res.data:
    row = res.data[0]
    print('Current row 2026-06-25:')
    print(f'  52w_highs: {row.get("new_52w_highs")}')
    print(f'  52w_lows: {row.get("new_52w_lows")}')
    print(f'  advances: {row.get("advances")}')
    print(f'  declines: {row.get("declines")}')
    print(f'  stage1: {row.get("stage1_count")}')
    print(f'  stage2: {row.get("stage2_count")}')
    print(f'  above_ma150_pct: {row.get("above_ma150_pct")}')
else:
    print('No row')
