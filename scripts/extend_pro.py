from db import supabase
from datetime import datetime, timedelta

# First, check the profiles table structure
result = supabase.from_('profiles').select('*').limit(1).execute()
if result.data:
    print('Profiles table columns:', list(result.data[0].keys()))
    print('Sample profile:', result.data[0])

# Check if there's an activity log or login history
try:
    result = supabase.from_('user_activity').select('*').limit(1).execute()
    print('\nuser_activity table exists:', list(result.data[0].keys()) if result.data else 'empty')
except:
    print('\nuser_activity table: does not exist')

# Check for pro_expires_at column in profiles
result = supabase.from_('profiles').select('id, email, pro_expires_at').limit(5).execute()
print('\nSample profiles with pro_expires_at:')
for row in result.data:
    print(f'  {row["email"]}: expires {row["pro_expires_at"]}')
