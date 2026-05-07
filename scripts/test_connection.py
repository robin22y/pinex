from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get('SUPABASE_URL')
key = os.environ.get('SUPABASE_SERVICE_KEY')

print('URL:', url)
print('KEY starts with:', key[:20] if key else 'MISSING')

if not url or not key:
    print('ERROR: Missing environment variables in .env file')
else:
    try:
        client = create_client(url, key)
        result = client.table('companies').select('id').limit(1).execute()
        print('CONNECTION OK')
    except Exception as e:
        print('CONNECTION FAILED:', str(e))