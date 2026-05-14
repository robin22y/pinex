import os, requests, time
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')
KEY = os.environ.get('INDIANAPI_KEY','')

# Test a mix of tier-3 small caps
test_symbols = [
    'BALAMINES', 'CHEMFAB', 'CYBERTECH',
    'ADFFOODS', 'CARERATING', 'NITCO',
    'GKENERGY', 'SECMARK', 'STALLION',
]

headers = {'x-api-key': KEY}
hit = 0
miss = 0

for sym in test_symbols:
    r = requests.get(
        'https://stock.indianapi.in/stock',
        headers=headers,
        params={'name': sym},
        timeout=15
    )
    if r.status_code == 200:
        data = r.json()
        sh = data.get('shareholding')
        fin = data.get('financials')
        has_sh = bool(sh and len(sh) > 0)
        has_fin = bool(fin and len(fin) > 0)
        print(f'{sym}: sh={has_sh} fin={has_fin}')
        if has_sh:
            hit += 1
        else:
            miss += 1
    else:
        print(f'{sym}: HTTP {r.status_code}')
        miss += 1
    time.sleep(1)

print(f'\nHit: {hit} Miss: {miss}')