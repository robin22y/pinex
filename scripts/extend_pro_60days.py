from db import supabase
from datetime import datetime, timedelta
import sys

sys.stdout.reconfigure(encoding='utf-8')

# Calculate date range: last 30 days
today = datetime.utcnow()
thirty_days_ago = today - timedelta(days=30)
new_pro_expiry = today + timedelta(days=60)

print(f"Today: {today.date()}")
print(f"30 days ago: {thirty_days_ago.date()}")
print(f"Setting pro_expires_at to: {new_pro_expiry.date()}")

# Find users who logged in in the last 30 days
result = supabase.from_('profiles').select('id, email, plan, last_active_at, pro_expires_at').gte('last_active_at', thirty_days_ago.isoformat()).execute()

users_to_update = result.data if result.data else []
print(f"\nFound {len(users_to_update)} users active in last 30 days")

if users_to_update:
    print("\nSample users to update:")
    for user in users_to_update[:5]:
        print(f"  {user['email']}: plan={user['plan']}")

    # Update all users
    count = 0
    for user in users_to_update:
        supabase.from_('profiles').update({'pro_expires_at': new_pro_expiry.isoformat()}).eq('id', user['id']).execute()
        count += 1

    print(f"\n✓ Successfully extended pro mode to 60 days for {count} users (expires {new_pro_expiry.date()})")
else:
    print("No users to update")
