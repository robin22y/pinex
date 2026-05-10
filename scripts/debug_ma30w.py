import yfinance as yf
import pandas as pd

for symbol in ['PAYTM', 'RELIANCE', 'IDEAFORGE']:
    ticker = yf.Ticker(f"{symbol}.NS")
    hist = ticker.history(period="2y")
    
    if hist.empty:
        print(f"{symbol}: NO DATA")
        continue
        
    close = hist["Close"]
    weekly = close.resample('W').last()
    ma30w = weekly.rolling(30).mean()
    
    print(f"\n{symbol}:")
    print(f"  Daily bars: {len(close)}")
    print(f"  Weekly bars: {len(weekly)}")
    print(f"  MA30W bars (non-null): {ma30w.dropna().__len__()}")
    print(f"  MA30W latest: {ma30w.iloc[-1]:.2f}" 
          if not pd.isna(ma30w.iloc[-1]) else "  MA30W latest: NULL")
    print(f"  Close latest: {close.iloc[-1]:.2f}")
import yfinance as yf
import pandas as pd
import numpy as np

for symbol in ['PAYTM', 'RELIANCE', 'IDEAFORGE']:
    ticker = yf.Ticker(f"{symbol}.NS")
    hist = ticker.history(period="2y")
    
    if hist.empty:
        print(f"{symbol}: NO DATA")
        continue
    
    close = hist["Close"].astype(float)
    
    # Normalize index
    idx = pd.DatetimeIndex(close.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    close.index = idx.normalize()
    
    # Weekly resampling
    weekly = close.resample("W-FRI").last().dropna()
    ma30w = weekly.rolling(30).mean()
    
    print(f"\n{symbol}:")
    print(f"  Daily bars:  {len(close)}")
    print(f"  Weekly bars: {len(weekly)}")
    print(f"  MA30W non-null: {ma30w.dropna().__len__()}")
    print(f"  MA30W latest: {float(ma30w.iloc[-1]):.2f}" 
          if not pd.isna(ma30w.iloc[-1]) else "  MA30W latest: NULL")
    
    # Map back to daily
    ma30w_daily = ma30w.reindex(close.index).ffill()
    print(f"  MA30W daily latest: {float(ma30w_daily.iloc[-1]):.2f}" 
          if not pd.isna(ma30w_daily.iloc[-1]) else "  MA30W daily latest: NULL")
    print(f"  Close latest: {float(close.iloc[-1]):.2f}")