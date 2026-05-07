"""Fetch OHLCV + indicators and persist rolling 252 trading days."""

from __future__ import annotations

import math
import sys
import time
from datetime import datetime
from typing import Any

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


def _stage_for_latest(
    *,
    current: float,
    ma150: float | None,
    recent_high: float | None,
    obv_trend: str,
) -> str:
    if ma150 is not None and current > ma150 and obv_trend == "rising":
        return "Stage 2"

    if (
        ma150 is not None
        and ma150 != 0
        and abs(current - ma150) / ma150 < 0.05
        and obv_trend in ("flat", "rising")
    ):
        return "Stage 1"

    if recent_high is not None and current < recent_high * 0.85 and obv_trend == "flat":
        return "Stage 3"

    if ma150 is not None and current < ma150 and obv_trend == "falling":
        return "Stage 4"

    return "Unclassified"


def _compute_payload_rows(symbol: str, hist: pd.DataFrame) -> tuple[list[dict[str, Any]], dict[str, Any]]:
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
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    obv, obv_slope_10d, obv_trend = _obv_trend(close, volume)
    high_52w_series = close.rolling(252).max()
    low_52w_series = close.rolling(252).min()

    current = float(close.iloc[-1])
    ma150_today = _to_float(ma150.iloc[-1])
    ma20_today = _to_float(ma20.iloc[-1])
    rsi_today = _to_float(rsi.iloc[-1])
    high_52w = _to_float(high_52w_series.iloc[-1])
    low_52w = _to_float(low_52w_series.iloc[-1])

    stage = _stage_for_latest(
        current=current,
        ma150=ma150_today,
        recent_high=high_52w,
        obv_trend=obv_trend,
    )

    near_ma20 = (
        ma20_today is not None
        and ma20_today != 0
        and abs(current - ma20_today) / ma20_today < 0.03
    )
    rsi_healthy = rsi_today is not None and 40 <= rsi_today <= 65
    breakout_52w = high_52w is not None and current >= high_52w * 0.99

    last_252 = hist.tail(252)
    rows: list[dict[str, Any]] = []

    for idx, row in last_252.iterrows():
        trade_dt = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
        trading_date = trade_dt.date().isoformat()
        i = hist.index.get_loc(idx)
        is_latest = i == len(hist.index) - 1

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
            "rsi": _to_float(rsi.iloc[i]),
            "obv": _to_float(obv.iloc[i]),
            "obv_slope": obv_slope_10d if is_latest else None,
            "high_52w": high_52w if is_latest else None,
            "low_52w": low_52w if is_latest else None,
            "stage": stage if is_latest else None,
            "near_ma20": near_ma20 if is_latest else None,
            "rsi_healthy": rsi_healthy if is_latest else None,
            "breakout_52w": breakout_52w if is_latest else None,
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
    }
    return rows, summary


def process_symbol(symbol: str) -> bool:
    ticker = yf.Ticker(f"{symbol}.NS")
    hist = ticker.history(period="2y")
    if hist is None or hist.empty:
        raise ValueError("No history returned")

    hist = hist.dropna(subset=["Close"]).copy()
    if hist.empty:
        raise ValueError("No valid close prices")

    company_id = None
    upsert(
        "companies",
        {
            "symbol": symbol,
            "name": symbol,
            "tier": 1,
        },
        "symbol",
    )
    q = supabase.table("companies").select("id").eq("symbol", symbol).limit(1).execute()
    data = getattr(q, "data", None) or []
    if data:
        company_id = data[0].get("id") or None
    if not company_id:
        raise ValueError(f"company_id not found for symbol: {symbol}")

    rows, summary = _compute_payload_rows(symbol, hist)
    for row in rows:
        row["company_id"] = company_id
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
    print(f"[{symbol}] rows={written}/{len(rows)} stage={summary['stage']} obv={summary['obv_trend']}")
    return ok


def main() -> None:
    started = time.time()
    symbols = TEST_SYMBOLS if TEST_MODE else ALL_SYMBOLS
    total = len(symbols)
    success = 0
    failed = 0

    log_event("fetch_price_data_started", {"total_symbols": total, "test_mode": TEST_MODE})
    if TEST_MODE:
        print("TEST MODE enabled: processing symbols SYRMA, APTUS, TEJASNET")
    print(f"Starting price fetch for {total} symbols...")

    for idx, symbol in enumerate(symbols, start=1):
        try:
            print(f"[{idx}/{total}] Fetching {symbol}...")
            if process_symbol(symbol):
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
