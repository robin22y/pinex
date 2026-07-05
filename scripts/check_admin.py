from db import supabase

# Get current user
auth_user = supabase.auth.get_user()
if auth_user:
    user_id = auth_user.user.id
    print(f'Logged in as: {auth_user.user.email}')

    # Check profile role
    result = supabase.table('profiles').select('role, id').eq('id', user_id).execute()
    if result.data:
        print(f'Profile role: {result.data[0]["role"]}')
    else:
        print('No profile found')
else:
    print('Not logged in')
