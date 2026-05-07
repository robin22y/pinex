import re
with open('fetch_price_data.py', 'r') as f:
    content = f.read()

keys = re.findall(r'"(\w+)"\s*:', content)
keys += re.findall(r"'(\w+)'\s*:", content)
unique_keys = sorted(set(keys))
print("TOTAL KEYS FOUND:", len(unique_keys))
for k in unique_keys:
    print(" ", k)