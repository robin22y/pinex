import requests, json
from datetime import date, timedelta

headers = {
    'User-Agent': 'Mozilla/5.0 PineX/1.0',
    'Referer': 'https://www.bseindia.com',
}

today = date.today().strftime('%Y%m%d')
week_ago = (date.today() - 
            timedelta(days=7)).strftime('%Y%m%d')

# Get announcements with more details
r = requests.get(
    f'https://api.bseindia.com/BseIndiaAPI'
    f'/api/AnnGetData/w?strCat=-1'
    f'&strPrevDate={week_ago}'
    f'&strScrip=&strSearch=P'
    f'&strToDate={today}'
    f'&strType=C&subcategory=-1',
    headers=headers,
    timeout=15
)

data = r.json()
records = data.get('Table', [])
print(f'Total announcements: {len(records)}')
print(f'Total in DB: {data.get("Table1",[{}])[0]}')
print()

# Show all unique announcement types
subjects = [r.get('NEWSSUB','') 
            for r in records]

# Find result-related announcements
result_keywords = [
    'financial result', 'quarterly result',
    'annual result', 'audited result',
    'unaudited result', 'q4', 'q3', 'q2', 'q1',
    'board meeting', 'dividend', 'bonus',
    'split', 'rights'
]

print('RESULT-RELATED ANNOUNCEMENTS:')
for rec in records:
    subj = rec.get('NEWSSUB','').lower()
    if any(kw in subj 
           for kw in result_keywords):
        print(f"  BSE:{rec['SCRIP_CD']} — "
              f"{rec['NEWSSUB'][:80]}")
        print(f"    Date: {rec['DT_TM'][:10]}")
print()

# Check if we can get future board meetings
print('BOARD MEETING ANNOUNCEMENTS:')
for rec in records:
    subj = rec.get('NEWSSUB','').lower()
    if 'board meeting' in subj:
        print(f"  BSE:{rec['SCRIP_CD']} — "
              f"{rec['NEWSSUB'][:80]}")

# Show all unique categories
categories = set(
    r.get('ANNOUNCEMENT_TYPE','') 
    for r in records)
print(f'\nUnique types: {categories}')

# Try getting upcoming board meetings
print('\n\nUPCOMING BOARD MEETINGS:')
r2 = requests.get(
    f'https://api.bseindia.com/BseIndiaAPI'
    f'/api/AnnGetData/w?strCat=-1'
    f'&strPrevDate={today}'
    f'&strScrip=&strSearch=P'
    f'&strToDate={(date.today() + timedelta(days=14)).strftime("%Y%m%d")}'
    f'&strType=C&subcategory=-1',
    headers=headers,
    timeout=15
)
if r2.status_code == 200:
    future = r2.json().get('Table', [])
    print(f'Upcoming (14 days): {len(future)}')
    for rec in future[:10]:
        print(f"  BSE:{rec['SCRIP_CD']} — "
              f"{rec['NEWSSUB'][:70]}")