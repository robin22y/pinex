import yfinance as yf
import pandas as pd

symbol = "PAYTM"
ticker = yf.Ticker(f"{symbol}.NS")
hist = ticker.history(period="2y")
close = hist["Close"]

# True 30-week MA
weekly_close = close.resample('W').last()
ma30w_series = weekly_close.rolling(30).mean()
ma30w_daily = ma30w_series.reindex(close.index, method='ffill')

# Current values
ma30w_today = float(ma30w_daily.iloc[-1])
close_today = float(close.iloc[-1])
ma150_today = float(close.rolling(150).mean().iloc[-1])

# ── 4-WEEK SLOPE (not 10-week) ──
if len(ma30w_series.dropna()) >= 5:
    ma_now = float(ma30w_series.iloc[-1])
    ma_4w_ago = float(ma30w_series.iloc[-5])
    slope_4w = (ma_now - ma_4w_ago) / ma_4w_ago * 100
else:
    slope_4w = 0

# Price recovery from 3 months ago
if len(close) >= 64:
    close_3m_ago = float(close.iloc[-64])
    price_recovery = (close_today - close_3m_ago) / close_3m_ago * 100
else:
    close_3m_ago = None
    price_recovery = 0

# OBV
obv = []
obv_val = 0
closes = close.values
volumes = hist["Volume"].values
for i in range(len(closes)):
    if i == 0:
        obv_val = volumes[i]
    elif closes[i] > closes[i-1]:
        obv_val += volumes[i]
    elif closes[i] < closes[i-1]:
        obv_val -= volumes[i]
    obv.append(obv_val)

obv_series = pd.Series(obv, index=close.index)
if len(obv_series) >= 11:
    x = list(range(10))
    y = obv_series.iloc[-10:].values
    import numpy as np
    slope_obv, _ = np.polyfit(x, y, 1)
    obv_slope = slope_obv / (abs(obv_series.mean()) + 1e-10)
else:
    obv_slope = 0

obv_rising = obv_slope > 0.01
obv_falling = obv_slope < -0.01

# 52W high/low
high_52w = float(close.tail(252).max())
low_52w = float(close.tail(252).min())
pct_position = (close_today - low_52w) / (high_52w - low_52w) * 100

# Pct from MA
pct_from_ma = (close_today - ma30w_today) / ma30w_today * 100
above_ma = close_today > ma30w_today

# Stage flags with 4W slope
ma_rising     = slope_4w > 0.5
ma_flattening = -1.0 < slope_4w <= 0.5
ma_falling    = slope_4w <= -1.0

print(f"\n{'='*45}")
print(f"PAYTM Stage Analysis")
print(f"{'='*45}")
print(f"Close:           ₹{close_today:.2f}")
print(f"MA30W:           ₹{ma30w_today:.2f}")
print(f"Pct from MA30W:  {pct_from_ma:.2f}%")
print(f"Above MA30W:     {above_ma}")
print(f"")
print(f"4W MA Slope:     {slope_4w:.3f}%")
print(f"MA Rising:       {ma_rising}")
print(f"MA Flattening:   {ma_flattening}")
print(f"MA Falling:      {ma_falling}")
print(f"")
print(f"OBV Slope:       {obv_slope:.6f}")
print(f"OBV Rising:      {obv_rising}")
print(f"")
print(f"52W High:        ₹{high_52w:.2f}")
print(f"52W Low:         ₹{low_52w:.2f}")
print(f"52W Position:    {pct_position:.1f}%")
print(f"")
print(f"3M ago price:    ₹{close_3m_ago:.2f}")
print(f"Price recovery:  {price_recovery:.1f}%")
print(f"{'='*45}")

# ── Stage classification with new logic ──
def classify(close, ma30w, slope_4w, obv_rising,
             obv_falling, price_recovery, pct_from_ma,
             above_ma, pct_position):

    ma_rising     = slope_4w > 0.5
    ma_flattening = -1.0 < slope_4w <= 0.5
    ma_falling    = slope_4w <= -1.0

    # Stage 2: above MA + MA rising
    if above_ma and ma_rising:
        return 'Stage 2', 'Price above 30W MA, MA rising'

    # Stage 2 transition: just below MA, MA rising
    if not above_ma and pct_from_ma > -3 and ma_rising:
        return 'Stage 2', 'Just below MA but MA rising strongly'

    # Stage 3: above MA, MA flattening, OBV not confirming
    if above_ma and not ma_rising and not obv_rising:
        return 'Stage 3', 'Price above MA but momentum fading'

    # Stage 3: above MA, OBV falling (distribution)
    if above_ma and obv_falling:
        return 'Stage 3', 'Distribution — OBV falling despite price holding'

    # Stage 1: MA flattening + OBV not falling
    if ma_flattening and not obv_falling:
        return 'Stage 1', 'MA bottoming, base forming'

    # Stage 1: strong price recovery + OBV rising
    if price_recovery > 15 and obv_rising and slope_4w > -1.5:
        return 'Stage 1', f'Price recovered {price_recovery:.0f}% from 3M low, OBV rising'

    # Stage 1: near MA from below, MA almost flat
    if not above_ma and pct_from_ma > -8 and ma_flattening:
        return 'Stage 1', 'Building base near 30W MA'

    # Stage 4: clear downtrend
    if not above_ma and ma_falling and pct_from_ma < -5:
        if obv_falling or not obv_rising:
            return 'Stage 4', 'Price below MA, MA falling, OBV weak'

    # Fallback
    if above_ma:
        return ('Stage 2' if ma_rising else 'Stage 3'), 'Fallback'
    else:
        if ma_falling and pct_from_ma < -10:
            return 'Stage 4', 'Fallback — below MA with falling MA'
        return 'Stage 1', 'Fallback — base building'

stage, reason = classify(
    close_today, ma30w_today, slope_4w,
    obv_rising, obv_falling, price_recovery,
    pct_from_ma, above_ma, pct_position
)

print(f"\nSTAGE:  {stage}")
print(f"REASON: {reason}")
print(f"{'='*45}")