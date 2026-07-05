from db import supabase
import os

print("Checking Supabase auth setup...")

# Check auth users table (only accessible to service role)
try:
    # Try to get all auth users - this won't work with anon key
    result = supabase.from_('auth.users').select('id, email').eq('email', 'robin22y@gmail.com').execute()
    print(f'Auth user query result: {result}')
except Exception as e:
    print(f'Cannot query auth.users directly (expected): {type(e).__name__}')

# Check profiles.id
result = supabase.from_('profiles').select('id, email, role').eq('email', 'robin22y@gmail.com').execute()
if result.data:
    profile = result.data[0]
    print(f'\nProfile found:')
    print(f'  ID: {profile["id"]}')
    print(f'  Email: {profile["email"]}')
    print(f'  Role: {profile["role"]}')

# The issue: when RPC is called from backend (anon key), auth.uid() returns NULL
# When called from frontend (authenticated session), auth.uid() returns the user's UUID
# For the function to work, the user's UUID must exist in profiles table with role='superadmin'

print('\nThe function should work from the frontend app when robin22y is logged in.')
print('In the browser, auth.uid() will return the actual user UUID.')
