import os, json, requests
from dotenv import load_dotenv
load_dotenv()

API_KEY = os.environ.get("INDIANAPI_KEY", "")
resp = requests.get(
    "https://stock.indianapi.in/stock",
    headers={"x-api-key": API_KEY},
    params={"name": "Axis Bank"},
    timeout=30
)
data = resp.json()

print("KEY METRICS:")
print(json.dumps(data.get("keyMetrics", {}), indent=2))

print("\nSTOCK TECHNICAL DATA:")
print(json.dumps(data.get("stockTechnicalData", {}), indent=2)[:1500])

print("\nANALYST VIEW:")
print(json.dumps(data.get("analystView", {}), indent=2)[:1000])

print("\nCOMPANY PROFILE (first 500 chars):")
profile = data.get("companyProfile", "")
print(str(profile)[:500])

print("\nSHAREHOLDING KEYS:")
sh = data.get("shareholding", {})
if isinstance(sh, dict):
    print(list(sh.keys()))

print("\nRECENT NEWS (first item):")
news = data.get("recentNews", [])
if news:
    print(json.dumps(news[0], indent=2))