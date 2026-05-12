import os, requests
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

KEY = os.environ.get('GEMINI_API_KEY','')
r = requests.get(
    f'https://generativelanguage.googleapis.com'
    f'/v1beta/models?key={KEY}',
    timeout=15)
import json
data = r.json()
for m in data.get('models', []):
    name = m.get('name','')
    if 'flash' in name.lower() or \
       'pro' in name.lower():
        print(name, '→', 
              m.get('supportedGenerationMethods'))