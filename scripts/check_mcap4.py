import requests
import os
import json
from dotenv import load_dotenv
load_dotenv('.env')

API_KEY = os.environ.get('INDIANAPI_KEY')
BASE_URL = 'https://stock.indianapi.in'
HEADERS = {'x-api-key': API_KEY}

r = requests.get(
    f'{BASE_URL}/stock',
    headers=HEADERS,
    params={'name': 'HINDCOPPER'},
    timeout=15)

data = r.json()

# Check keyMetrics
print('=== keyMetrics ===')
print(json.dumps(
    data.get('keyMetrics', {}), 
    indent=2))

print()
print('=== stockDetailsReusableData ===')
print(json.dumps(
    data.get(
        'stockDetailsReusableData', {}),
    indent=2)[:1000])

print()
print('=== initialStockFinancialData ===')
print(json.dumps(
    data.get(
        'initialStockFinancialData', {}),
    indent=2)[:500])