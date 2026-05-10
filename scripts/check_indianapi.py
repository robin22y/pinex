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

# Print all top-level keys
print("TOP LEVEL KEYS:")
for k in data.keys():
    print(f"  {k}")

# Print stockMetaData if exists
if "stockMetaData" in data:
    print("\nSTOCK METADATA:")
    print(json.dumps(data["stockMetaData"], indent=2)[:2000])

# Print keyMetrics or similar
for key in ["keyMetrics","fundamentals","ratios","metrics"]:
    if key in data:
        print(f"\n{key.upper()}:")
        print(json.dumps(data[key], indent=2)[:2000])