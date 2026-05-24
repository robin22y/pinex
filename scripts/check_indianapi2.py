import requests
import os
from dotenv import load_dotenv
load_dotenv('.env')

API_KEY = os.environ.get('INDIANAPI_KEY')
print('Key exists:', bool(API_KEY))
print('Key prefix:', API_KEY[:8] 
      if API_KEY else 'None')

# Check what host we actually use
with open('fetch_indianapi.py', 
          encoding='utf-8',
          errors='ignore') as f:
    content = f.read()

# Find the host and base URL
for line in content.split('\n'):
    if any(term in line.lower() 
           for term in [
               'host', 'base_url', 
               'rapidapi', 'x-api',
               'indianapi', 'headers']):
        print(line)
    if 'market_cap' in line.lower() or \
       'marketcap' in line.lower() or \
       'mcap' in line.lower():
        print('MCAP LINE:', line)