import requests
import zipfile
import io
from datetime import date, timedelta

headers = {'User-Agent': 'Mozilla/5.0'}

# Try last few days
for days_back in range(0, 5):
    dt = (date.today() - 
          timedelta(days=days_back))\
         .strftime('%d%b%Y').upper()
    
    # New NSE format
    url = (
        f'https://nsearchives.nseindia.com'
        f'/content/cm/'
        f'BhavCopy_NSE_CM_0_0_0_'
        f'{dt}_F_0000.csv.zip'
    )
    r = requests.get(
        url, headers=headers, timeout=15)
    print(f'{dt}: {r.status_code} {url}')
    
    if r.status_code == 200:
        z = zipfile.ZipFile(
            io.BytesIO(r.content))
        with z.open(z.namelist()[0]) as f:
            lines = f.read().decode(
                errors='ignore')\
                .split('\n')
            print('Columns:', lines[0])
            print('Row 1:', lines[1])
        break

# Also try NSE API for market cap
print()
print('Trying NSE market cap API...')
s = requests.Session()
s.get('https://www.nseindia.com',
      headers=headers, timeout=10)

r2 = s.get(
    'https://www.nseindia.com/api/'
    'equity-stockIndices?index='
    'NIFTY%2050',
    headers={**headers,
             'Referer': 
             'https://www.nseindia.com'},
    timeout=10)
print('NSE API status:', r2.status_code)
if r2.status_code == 200:
    data = r2.json()
    if data.get('data'):
        first = data['data'][0]
        print('Fields:', 
              list(first.keys()))
        print('Sample:', first)