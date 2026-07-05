import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

# Delete the bad partial row
print("Deleting bad row from 2026-06-25...")
res = sb.table('market_internals').delete().eq('date', '2026-06-25').execute()
print(f"Deleted {len(res.data)} rows")

print("\nNow run: python calc_market_internals.py --force")
print("This will create a fresh complete row with all breadth metrics.")
