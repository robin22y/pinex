import yfinance as yf
import json

ticker = yf.Ticker("AXISBANK.NS")

print("INFO KEYS:")
info = ticker.info
for k, v in info.items():
    if v is not None and v != 'N/A':
        print(f"  {k}: {v}")