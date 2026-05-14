import requests, json

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.bseindia.com/corporates/Comp_Resultsnew.aspx',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://www.bseindia.com',
}

# Test with a known BSE code
# SYRMA = 543573
test_codes = ['543573', '500325', '532540']

for code in test_codes:
    # Try BSE shareholding API
    url = (
        f'https://api.bseindia.com/BseIndiaAPI'
        f'/api/ShareHoldingPatterns/w'
        f'?scripcode={code}'
    )
    r = requests.get(url, headers=headers,
                     timeout=15)
    print(f'BSE {code}: {r.status_code}')
    if r.status_code == 200:
        try:
            data = r.json()
            print(f'  Keys: {list(data.keys()) if isinstance(data, dict) else type(data)}')
            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(v, list) and v:
                        print(f'  {k}: {len(v)} records')
                        print(f'  Sample: {json.dumps(v[0])[:200]}')
        except:
            print(f'  Raw: {r.text[:100]}')
    print()