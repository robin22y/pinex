import requests
import os
from dotenv import load_dotenv
load_dotenv('.env')

API_KEY = os.environ.get('INDIANAPI_KEY')
BASE_URL = 'https://stock.indianapi.in'
HEADERS = {'x-api-key': API_KEY}

# Test one stock
r = requests.get(
    f'{BASE_URL}/stock',
    headers=HEADERS,
    params={'name': 'HINDCOPPER'},
    timeout=15)

print(f'Status: {r.status_code}')
if r.status_code == 200:
    data = r.json()
    print(f'Top keys: {list(data.keys())}')
    # Look for market cap
    for k, v in data.items():
        if any(term in str(k).lower() 
               for term in [
                   'cap', 'market',
                   'mcap', 'value',
                   'worth']):
            print(f'  {k}: {v}')
    # Print full response
    import json
    print(json.dumps(data, indent=2)[:2000])
else:
    print(r.text[:500])