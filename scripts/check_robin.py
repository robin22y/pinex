from db import supabase

# Find robin22y@gmail.com
result = supabase.from_('profiles').select('id, email, role').ilike('email', '%robin22y%').execute()
print('Profiles matching robin22y:')
for row in result.data:
    print(f'  ID: {str(row["id"])[:8]}..., Email: {row["email"]}, Role: {row["role"]}')

# Check total profiles
result3 = supabase.from_('profiles').select('count').execute()
print(f'\nTotal profiles: {result3.data}')

# Test RPC with proper context
print('\nTesting RPC admin_most_watched:')
try:
    rpc_result = supabase.rpc('admin_most_watched', {'p_window_days': 0}).execute()
    if rpc_result.data:
        print(f'  Returned {len(rpc_result.data)} rows')
        for row in rpc_result.data[:3]:
            print(f'    {row["symbol"]} - {row["watch_count"]} watches')
    else:
        print(f'  Error: {rpc_result.error}')
except Exception as e:
    print(f'  Exception: {e}')
