import requests
import os
from dotenv import load_dotenv
load_dotenv('.env')

API_KEY = os.environ.get('INDIANAPI_KEY')
headers = {
    'x-rapidapi-key': API_KEY,
    'x-rapidapi-host': 
        'indian-stock-market-api.p.rapidapi.com'
}

# Test with a few stocks
symbols = ['HINDCOPPER', 'SYRMA', 
           'POWERGRID', 'TATASTEEL']

for sym in symbols:
    r = requests.get(
        f'https://indian-stock-market-api'
        f'.p.rapidapi.com/stock',
        headers=headers,
        params={'symbol': sym},
        timeout=10)
    print(f'{sym}: {r.status_code}')
    if r.status_code == 200:
        data = r.json()
        print(f'  Keys: {list(data.keys())}')
        # Look for market cap
        for k, v in data.items():
            if any(term in k.lower() 
                   for term in [
                       'cap', 'market', 
                       'mcap', 'value']):
                print(f'  {k}: {v}')
        break