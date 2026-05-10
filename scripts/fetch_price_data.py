"""Fetch OHLCV + indicators and persist rolling 252 trading days."""

from __future__ import annotations

import math
import sys
import time
from datetime import date, datetime
from typing import Any

NSE_HOLIDAYS_2026 = frozenset(
    {
        "2026-01-26",
        "2026-03-19",
        "2026-04-14",
        "2026-04-17",
        "2026-05-01",
        "2026-06-29",
        "2026-08-15",
        "2026-10-02",
        "2026-11-04",
        "2026-11-20",
        "2026-12-25",
    }
)

import numpy as np
import pandas as pd
import yfinance as yf

from db import bulk_upsert, log_event, supabase, upsert
from symbols import ALL_SYMBOLS

PRICE_TABLE = "price_data"
DELAY_SECONDS = 1.5
TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return float(value)
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(parsed) or math.isinf(parsed):
        return None
    return parsed


def _normalize_dt_index(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    out = pd.to_datetime(idx)
    if getattr(out, "tz", None) is not None:
        out = out.tz_localize(None)
    return out.normalize()


def fetch_nifty_close() -> tuple[pd.Series, float | None]:
    """Load Nifty 50 index closes once; reuse for all symbols (RS vs market)."""
    nifty = yf.Ticker("^NSEI")
    nifty_hist = nifty.history(period="2y")
    if nifty_hist is None or nifty_hist.empty or "Close" not in nifty_hist.columns:
        return pd.Series(dtype=float), None
    nifty_close = nifty_hist["Close"].dropna()
    nifty_close.index = _normalize_dt_index(pd.DatetimeIndex(nifty_close.index))
    today = _to_float(nifty_close.iloc[-1]) if len(nifty_close) else None
    return nifty_close, today


def calc_rs(stock_close: pd.Series, nifty_close: pd.Series) -> float | None:
    """52-week relative strength vs Nifty: stock 1Y % return minus Nifty 1Y % return."""
    if nifty_close is None or len(nifty_close) == 0 or len(stock_close) == 0:
        return None
    sc = stock_close.copy()
    sc.index = _normalize_dt_index(pd.DatetimeIndex(sc.index))
    nc = nifty_close.copy()
    nc.index = _normalize_dt_index(pd.DatetimeIndex(nc.index))
    common_dates = sc.index.intersection(nc.index)
    common_dates = common_dates.sort_values()
    if len(common_dates) < 252:
        return None
    stock_aligned = sc.reindex(common_dates).dropna()
    nifty_aligned = nc.reindex(common_dates).dropna()
    common_dates = stock_aligned.index.intersection(nifty_aligned.index).sort_values()
    if len(common_dates) < 252:
        return None
    stock_aligned = stock_aligned.reindex(common_dates).dropna()
    nifty_aligned = nifty_aligned.reindex(common_dates).dropna()
    if len(stock_aligned) < 252 or len(nifty_aligned) < 252:
        return None
    stock_return = (
        (stock_aligned.iloc[-1] - stock_aligned.iloc[-252]) / stock_aligned.iloc[-252] * 100
    )
    nifty_return = (
        (nifty_aligned.iloc[-1] - nifty_aligned.iloc[-252]) / nifty_aligned.iloc[-252] * 100
    )
    return round(float(stock_return - nifty_return), 2)


def _obv_trend(close: pd.Series, volume: pd.Series) -> tuple[pd.Series, float, str]:
    direction = np.sign(close.diff().fillna(0.0))
    obv = (volume.fillna(0.0) * direction).cumsum()
    if len(obv) < 10:
        return obv, 0.0, "flat"
    prev = float(obv.iloc[-10])
    curr = float(obv.iloc[-1])
    if prev == 0:
        slope = 0.0
    else:
        slope = (curr - prev) / abs(prev)
    if slope > 0.02:
        trend = "rising"
    elif slope < -0.02:
        trend = "falling"
    else:
        trend = "flat"
    return obv, slope, trend


def _compute_ma30w_daily_and_slope_series(
    close: pd.Series,
) -> tuple[pd.Series, pd.Series]:
    """
    30-week MA mapped back to daily dates.
    Completely strips timezone before any resampling.
    """
    # Step 1: Build clean daily series with date-only index
    vals = close.values.astype(float)
    
    # Strip timezone from index completely
    raw_idx = pd.DatetimeIndex(close.index)
    if raw_idx.tz is not None:
        raw_idx = raw_idx.tz_localize(None)
    date_idx = raw_idx.normalize()
    
    # Remove duplicates keeping last
    clean = pd.Series(vals, index=date_idx)
    clean = clean[~clean.index.duplicated(keep='last')]
    clean = clean.sort_index().dropna()
    
    if len(clean) < 30:
        nulls = pd.Series(np.nan, index=date_idx)
        zeros = pd.Series(0.0, index=date_idx)
        return nulls, zeros

    # Step 2: Resample to weekly using period-end Friday
    weekly = clean.resample('W-FRI').last().dropna()
    
    if len(weekly) < 5:
        nulls = pd.Series(np.nan, index=date_idx)
        zeros = pd.Series(0.0, index=date_idx)
        return nulls, zeros

    # Step 3: 30-week rolling MA (min 20 weeks to start earlier)
    ma30w = weekly.rolling(window=30, min_periods=20).mean()

    # Step 4: 4-week slope on weekly MA
    prev4 = ma30w.shift(4)
    slope = ((ma30w - prev4) / prev4.abs().replace(0, np.nan) * 100)\
        .replace([np.inf, -np.inf], np.nan)\
        .fillna(0.0)

    # Step 5: Map weekly → daily using date string matching
    # This avoids any timezone reindex issues entirely
    ma30w_dict = {
        ts.date(): float(v) 
        for ts, v in ma30w.items() 
        if not pd.isna(v)
    }
    slope_dict = {
        ts.date(): float(v) 
        for ts, v in slope.items() 
        if not pd.isna(v)
    }

    # Forward fill: for each daily date, find most recent weekly value
    ma30w_daily_vals = []
    slope_daily_vals = []
    last_ma = np.nan
    last_slope = 0.0

    for dt in clean.index:
        d = dt.date()
        if d in ma30w_dict:
            last_ma = ma30w_dict[d]
        if d in slope_dict:
            last_slope = slope_dict[d]
        ma30w_daily_vals.append(last_ma)
        slope_daily_vals.append(last_slope)

    ma30w_daily = pd.Series(ma30w_daily_vals, index=clean.index)
    slope_daily = pd.Series(slope_daily_vals, index=clean.index)

    # Reindex back to original (possibly tz-aware) index
    # using the clean date-stripped index as bridge
    orig_idx = pd.DatetimeIndex(close.index)
    if orig_idx.tz is not None:
        orig_idx_clean = orig_idx.tz_localize(None).normalize()
    else:
        orig_idx_clean = orig_idx.normalize()

    ma30w_out = ma30w_daily.reindex(orig_idx_clean).ffill()
    slope_out = slope_daily.reindex(orig_idx_clean).ffill().fillna(0.0)

    # Restore original index
    ma30w_out.index = close.index
    slope_out.index = close.index

    return ma30w_out, slope_out

def classify_stage_weinstein(
    close: float,
    ma30w: float | None,
    ma30w_slope: float,
    obv_slope: float | None,
    rs_vs_nifty: float | None,
    high_52w: float | None,
    low_52w: float | None,
    close_3m_ago: float | None = None,
) -> str:
    """
    Weinstein-inspired stage: strong price vs 30W MA → Stage 2; use 52W range to split
    Stage 1 (lows/base) vs Stage 3 (highs/topping) when MA is flattening near price.
    """
    _ = rs_vs_nifty  # Proxies prior relative strength vs Nifty for future refinements.

    if not ma30w or ma30w == 0:
        # If MA30W unavailable, could fall back to MA150-based rules; for now Unclassified.
        return "Unclassified"

    pct_from_ma = (close - ma30w) / ma30w * 100
    above_ma = close > ma30w

    h52 = _to_float(high_52w)
    l52 = _to_float(low_52w)
    if h52 is not None and l52 is not None and float(h52) > float(l52):
        range_52w = float(h52) - float(l52)
        pct_position = (close - float(l52)) / range_52w * 100
    else:
        pct_position = 50.0

    ma_rising = ma30w_slope > 0.3
    ma_flattening = -1.5 < ma30w_slope <= 0.3
    ma_falling = ma30w_slope <= -1.5

    obv_slope_f = _to_float(obv_slope)
    # Match `obv_slope > 0.01 if obv_slope else False` for raw pipeline values
    obv_rising = bool(obv_slope_f and obv_slope_f > 0.01)
    obv_falling = bool(obv_slope_f and obv_slope_f < -0.01)

    close_3m_f = _to_float(close_3m_ago)
    if close_3m_f is not None and close_3m_f > 0:
        price_recovery = (close - close_3m_f) / close_3m_f * 100
    else:
        price_recovery = 0.0

    # ── STAGE 2 — Confirmed uptrend ──
    if above_ma and pct_from_ma > 5:
        return "Stage 2"

    if above_ma and ma_rising:
        return "Stage 2"

    if not above_ma and pct_from_ma > -3 and ma_rising:
        return "Stage 2"

    # ── STAGE 3 — Topping after advance ──
    if above_ma and not ma_rising:
        if pct_position > 60:
            return "Stage 3"
        if ma_falling:
            return "Stage 3"

    # Just below MA at high levels — likely rolled over after a strong run.
    if not above_ma and pct_from_ma > -5:
        if pct_position > 65:
            return "Stage 3"

    # ── STAGE 1 — Base building after decline ──
    if ma_flattening and not obv_falling:
        if pct_position < 50:
            return "Stage 1"
        if pct_position >= 50:
            return "Stage 3"

    if not above_ma and price_recovery > 15 and obv_rising:
        if pct_position < 60:
            return "Stage 1"

    if not above_ma and pct_from_ma > -10 and not ma_falling:
        if pct_position < 55:
            return "Stage 1"
        return "Stage 3"

    # ── STAGE 4 — Confirmed downtrend ──
    if not above_ma and ma_falling and pct_from_ma < -5 and not obv_rising:
        return "Stage 4"

    # ── FALLBACK ──
    if above_ma:
        if pct_from_ma > 10:
            return "Stage 2"
        return "Stage 2" if not ma_falling else "Stage 3"

    if ma_falling and pct_from_ma < -8:
        return "Stage 4"
    return "Stage 1"


def _compute_payload_rows(
    symbol: str,
    hist: pd.DataFrame,
    nifty_close: pd.Series,
    nifty_close_today: float | None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    close = hist["Close"]
    volume = hist["Volume"]

    ma10 = close.rolling(10).mean()
    ma20 = close.rolling(20).mean()
    ma30 = close.rolling(30).mean()
    ma50 = close.rolling(50).mean()
    ma150 = close.rolling(150).mean()

    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta).clip(lower=0).rolling(14).mean()
    rsi_ratio = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rsi_ratio))

    obv, obv_slope_10d, obv_trend = _obv_trend(close, volume)
    high_52w_series = close.rolling(252).max()
    low_52w_series = close.rolling(252).min()
    ma30w_daily, ma30w_slope_daily = _compute_ma30w_daily_and_slope_series(close)

    current = float(close.iloc[-1])
    # ~3M lookback: close 63 sessions before last bar is iloc[-64]; needs len >= 64
    close_3m_ago = _to_float(close.iloc[-64]) if len(close) >= 64 else None
    ma150_today = _to_float(ma150.iloc[-1])
    ma30w_today = _to_float(ma30w_daily.iloc[-1])
    ma20_today = _to_float(ma20.iloc[-1])
    rsi_today = _to_float(rsi.iloc[-1])
    high_52w = _to_float(high_52w_series.iloc[-1])
    low_52w = _to_float(low_52w_series.iloc[-1])

    _sl_latest = _to_float(ma30w_slope_daily.iloc[-1])
    ma30w_slope_latest = 0.0 if _sl_latest is None else float(_sl_latest)

    ma150_slope = 0.0
    ma150_valid = ma150.dropna()
    if len(ma150_valid) >= 21:
        ma_now = _to_float(ma150_valid.iloc[-1])
        ma_20d_ago = _to_float(ma150_valid.iloc[-21])
        if ma_now is not None and ma_20d_ago is not None and ma_20d_ago != 0:
            ma150_slope = (ma_now - ma_20d_ago) / ma_20d_ago * 100

    rs_vs_nifty = calc_rs(close, nifty_close)

    stage = classify_stage_weinstein(
        close=current,
        ma30w=ma30w_today,
        ma30w_slope=ma30w_slope_latest,
        obv_slope=obv_slope_10d,
        rs_vs_nifty=rs_vs_nifty,
        high_52w=high_52w,
        low_52w=low_52w,
        close_3m_ago=close_3m_ago,
    )

    near_ma20 = (
        ma20_today is not None
        and ma20_today != 0
        and abs(current - ma20_today) / ma20_today < 0.03
    )
    rsi_healthy = rsi_today is not None and 40 <= rsi_today <= 65
    breakout_52w = high_52w is not None and current >= high_52w * 0.99

    n_take = min(252, len(hist.index))
    offset = len(hist.index) - n_take
    rows: list[dict[str, Any]] = []

    for k in range(n_take):
        i = offset + k
        idx = hist.index[i]
        row = hist.iloc[i]
        trade_dt = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
        trading_date = trade_dt.date().isoformat()
        is_latest = i == len(hist.index) - 1

        ma30w_i = _to_float(ma30w_daily.iloc[i])
        slope_i = _to_float(ma30w_slope_daily.iloc[i])
        ma30w_slope_rounded = round(slope_i, 4) if slope_i is not None else None

        payload = {
            "company_id": None,
            "date": trading_date,
            "open": _to_float(row["Open"]),
            "high": _to_float(row["High"]),
            "low": _to_float(row["Low"]),
            "close": _to_float(row["Close"]),
            "volume": _to_float(row["Volume"]),
            "ma10": _to_float(ma10.iloc[i]),
            "ma20": _to_float(ma20.iloc[i]),
            "ma30": _to_float(ma30.iloc[i]),
            "ma50": _to_float(ma50.iloc[i]),
            "ma150": _to_float(ma150.iloc[i]),
            "ma30w": ma30w_i,
            "ma30w_slope": ma30w_slope_rounded,
            "rsi": _to_float(rsi.iloc[i]),
            "obv": _to_float(obv.iloc[i]),
            "obv_slope": obv_slope_10d if is_latest else None,
            "high_52w": high_52w if is_latest else None,
            "low_52w": low_52w if is_latest else None,
            "stage": stage if is_latest else None,
            "near_ma20": near_ma20 if is_latest else None,
            "rsi_healthy": rsi_healthy if is_latest else None,
            "breakout_52w": breakout_52w if is_latest else None,
            "ma150_slope": round(ma150_slope, 4) if is_latest else None,
            "rs_vs_nifty": rs_vs_nifty if is_latest else None,
            "rs_positive": (rs_vs_nifty > 0 if rs_vs_nifty is not None else False) if is_latest else None,
            "nifty_close": float(nifty_close_today) if (is_latest and nifty_close_today is not None) else None,
            "is_latest": is_latest,
            "updated_at": datetime.utcnow().isoformat(),
        }
        rows.append(payload)

    summary = {
        "symbol": symbol,
        "rows": len(rows),
        "stage": stage,
        "obv_trend": obv_trend,
        "obv_slope_10d": obv_slope_10d,
        "near_ma20": near_ma20,
        "rsi_healthy": rsi_healthy,
        "breakout_52w": breakout_52w,
        "high_52w": high_52w,
        "low_52w": low_52w,
        "close": current,
        "ma150_slope": ma150_slope,
        "ma30w": ma30w_today,
        "ma30w_slope": ma30w_slope_latest,
        "rs_vs_nifty": rs_vs_nifty,
    }
    return rows, summary


def process_symbol(
    symbol: str,
    nifty_close: pd.Series,
    nifty_close_today: float | None,
) -> bool:
    ticker = yf.Ticker(f"{symbol}.NS")
    hist = ticker.history(period="2y")
    if hist is None or hist.empty:
        raise ValueError("No history returned")

    hist = hist.dropna(subset=["Close"]).copy()
    if hist.empty:
        raise ValueError("No valid close prices")

    upsert(
        "companies",
        {"symbol": symbol, "name": symbol, "tier": 1},
        "symbol",
    )
    q = supabase.table("companies")\
        .select("id, stage_override, stage_override_expires_at")\
        .eq("symbol", symbol)\
        .limit(1)\
        .execute()
    data = getattr(q, "data", None) or []
    if not data:
        raise ValueError(f"company_id not found for symbol: {symbol}")

    company_id = data[0].get("id")
    if not company_id:
        raise ValueError(f"company_id not found for symbol: {symbol}")

    rows, summary = _compute_payload_rows(
        symbol, hist, nifty_close, nifty_close_today)
    for row in rows:
        row["company_id"] = company_id

    # Check for active manual stage override
    company_row = data[0]
    stage_override = company_row.get("stage_override")
    override_expires = company_row.get("stage_override_expires_at")

    if stage_override and override_expires:
        from datetime import timezone
        now = datetime.now(timezone.utc)
        if isinstance(override_expires, str):
            exp = datetime.fromisoformat(
                override_expires.replace('Z', '+00:00'))
        else:
            exp = override_expires

        if now < exp:
            print(f"  [OVERRIDE ACTIVE] "
                  f"manual stage: {stage_override} "
                  f"(expires {exp.date()})")
            for row in rows:
                if row.get("is_latest"):
                    row["stage"] = stage_override
        else:
            supabase.table("companies").update({
                "stage_override": None,
                "stage_override_expires_at": None,
                "stage_override_reason": None,
            }).eq("symbol", symbol).execute()
            print(f"  [OVERRIDE EXPIRED] cleared, "
                  f"using calculated: {summary['stage']}")

    written = bulk_upsert(PRICE_TABLE, rows, "company_id,date")
    ok = written == len(rows)

    log_event(
        "fetch_price_data_symbol",
        {
            "symbol": symbol,
            "success": ok,
            "rows_written": written,
            **summary,
        },
    )
    print(
        f"[{symbol}] rows={written}/{len(rows)} "
        f"stage={summary['stage']} "
        f"ma30w={summary.get('ma30w')} "
        f"ma30w_slope={summary.get('ma30w_slope')} "
        f"obv={summary['obv_trend']} "
        f"rs={summary.get('rs_vs_nifty')}"
    )
    return ok


def _skip_reason_for_daily_update() -> str | None:
    if TEST_MODE:
        return None
    today = date.today()
    if today.weekday() >= 5:
        return "Market closed — skipping daily update"
    if today.isoformat() in NSE_HOLIDAYS_2026:
        return "NSE holiday — skipping daily update"
    return None


def main() -> None:
    skip = _skip_reason_for_daily_update()
    if skip:
        print(skip)
        log_event(
            "fetch_price_data_skipped",
            {"reason": skip, "iso_date": date.today().isoformat()},
        )
        return

    started = time.time()
    symbols = TEST_SYMBOLS if TEST_MODE else ALL_SYMBOLS
    total = len(symbols)
    success = 0
    failed = 0

    log_event("fetch_price_data_started", {"total_symbols": total, "test_mode": TEST_MODE})
    if TEST_MODE:
        print("TEST MODE enabled: processing symbols SYRMA, APTUS, TEJASNET")
    print("Loading Nifty 50 (^NSEI) for RS vs market…")
    nifty_close, nifty_close_today = fetch_nifty_close()
    if nifty_close_today is not None:
        print(f"Nifty close (latest): {nifty_close_today:.2f}")
    else:
        print("Warning: Nifty history empty — rs_vs_nifty will be null for all symbols.")

    print(f"Starting price fetch for {total} symbols...")

    for idx, symbol in enumerate(symbols, start=1):
        try:
            print(f"[{idx}/{total}] Fetching {symbol}...")
            if process_symbol(symbol, nifty_close, nifty_close_today):
                success += 1
            else:
                failed += 1
        except Exception as exc:
            failed += 1
            print(f"[{symbol}] failed: {exc}")
            log_event(
                "fetch_price_data_failed",
                {"symbol": symbol, "error": str(exc)},
            )
        finally:
            time.sleep(DELAY_SECONDS)

    elapsed = round(time.time() - started, 2)
    print(f"Done. success={success} failed={failed} elapsed={elapsed}s")
    log_event(
        "fetch_price_data_finished",
        {
            "success_symbols": success,
            "failed_symbols": failed,
            "elapsed_sec": elapsed,
            "total_symbols": total,
        },
    )


if __name__ == "__main__":
    main()
