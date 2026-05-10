import yfinance as yf
import pandas as pd

symbol = "PAYTM"
ticker = yf.Ticker(f"{symbol}.NS")
hist = ticker.history(period="2y")
close = hist["Close"]

# Weekly
weekly_close = close.resample('W').last()
ma30w = weekly_close.rolling(30).mean()

print("Last 15 weeks of 30W MA:")
print(ma30w.tail(15).to_string())

print(f"\nWeekly closes last 15 weeks:")
print(weekly_close.tail(15).to_string())

# Slope at different lookback periods
for weeks in [4, 6, 8, 10, 12]:
    if len(ma30w.dropna()) > weeks:
        now = float(ma30w.iloc[-1])
        then = float(ma30w.iloc[-(weeks+1)])
        slope = (now - then) / then * 100
        print(f"Slope over {weeks}W: {slope:.3f}%")