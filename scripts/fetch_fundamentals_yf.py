"""
fetch_fundamentals_yf.py — yfinance-backed fundamentals refresh.

Sibling to fetch_fundamentals.py (which uses IndianAPI). Either can
populate key_metrics; whichever runs last wins on overlapping fields.
The yfinance source adds 9 fields the IndianAPI source doesn't expose
(forward_pe, roa, profit / operating margins, revenue / earnings
growth, beta, 52W high / low) and writes quarterly numbers into a
separate quarterly_financials_yf table.

For each symbol in the live `companies` table (~2,100 stocks):
  1. ticker = yf.Ticker(f"{symbol}.NS")
  2. metrics = subset of ticker.info we care about → upsert to
     key_metrics (ON CONFLICT symbol).
  3. quarters = first 4 columns of ticker.quarterly_financials →
     upsert to quarterly_financials_yf (ON CONFLICT
     symbol, quarter_end).
  4. sleep 0.5 s between symbols — yfinance is free but rate-
     friendly is the right default.

CONTINUE-ON-ERROR
  Per-symbol try/except around BOTH fetches AND the upserts so a
  single flake never aborts the run. Per-100 progress events get
  logged to usage_events for pipeline observability.

Run ad-hoc:
  python scripts/fetch_fundamentals_yf.py
Or via the weekly workflow once you decide whether yf or
IndianAPI is the canonical source.
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yfinance as yf
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")
sys.path.insert(0, str(_script_dir))

from db import log_event, supabase  # noqa: E402

# ── Yahoo Finance symbol aliases ──────────────────────────────────────
# Some NSE tickers don't match the canonical name 1:1 on Yahoo (corporate
# actions, demergers, alternate suffixes). We store the original symbol
# in the DB (so every other table that joins on companies.symbol keeps
# working) but probe Yahoo under the alias. Add entries as discovered.
#
#   TATAMOTORS → TMPV  (passenger-vehicles entity post-demerger)
YF_SYMBOL_ALIASES: dict[str, str] = {
    "TATAMOTORS": "TMPV",
}


def _yahoo_symbol(symbol: str) -> str:
    """Return the Yahoo lookup symbol — alias if mapped, else the
    original. The `.NS` suffix is applied at the call site."""
    return YF_SYMBOL_ALIASES.get(symbol, symbol)

# Force UTF-8 on Windows console so non-ASCII names don't crash a print.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ── Constants ──────────────────────────────────────────────────────────

COMPANIES_TABLE   = "companies"
KEY_METRICS_TABLE = "key_metrics"
QUARTERLY_TABLE   = "quarterly_financials_yf"

# ── Pacing ────────────────────────────────────────────────────────────
# yfinance is an unofficial wrapper around Yahoo Finance's internal
# endpoints. Yahoo does NOT publish rate limits; in practice they
# block / 429 a key when the call cadence looks bot-like. Conservative
# pacing avoids flags entirely:
#   - 2 s base sleep between EVERY Yahoo call (the two info / quarterly
#     calls per symbol AND between consecutive symbols).
#   - ±0.5 s uniform jitter so the cadence isn't perfectly periodic.
#   - One-time retry per call on failure, with a 10 s cool-off — handles
#     transient blips without escalating.
#   - 30 s cool-down every 50 symbols — gives Yahoo's per-IP counters
#     time to decay.
# Wall-clock for 2,100 symbols: ~(2,100 × 6 s) + (42 × 30 s) ≈ 3.7 h.
# Sized to fit weekly.yml's bumped timeout.
SLEEP_BETWEEN_CALLS_BASE  = 2.0
SLEEP_BETWEEN_CALLS_JITTER = 0.5
COOLDOWN_EVERY_N          = 50
COOLDOWN_SECONDS          = 30
RETRY_BACKOFF_SEC         = 10
LOG_EVERY_N               = 100


def _yahoo_pause():
    """Sleep base ± jitter between calls to Yahoo."""
    delay = SLEEP_BETWEEN_CALLS_BASE + random.uniform(
        -SLEEP_BETWEEN_CALLS_JITTER, SLEEP_BETWEEN_CALLS_JITTER,
    )
    time.sleep(max(0.5, delay))


# ── Helpers ────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe(df, row: str, col) -> float | None:
    """Pull a single cell from a pandas DataFrame without raising on
    missing label / NaN / non-numeric. Used for the quarterly fetch."""
    try:
        val = df.loc[row, col]
        if val is None:
            return None
        v = float(val)
        if v != v:   # NaN check (NaN != NaN)
            return None
        return v
    except Exception:   # noqa: BLE001
        return None


def _safe_num(v: Any) -> float | None:
    """Cast yfinance-provided info[] value to float-or-None."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:
        return None
    return f


# ── Fetchers ───────────────────────────────────────────────────────────

def _fetch_ticker_info(symbol: str) -> dict[str, Any] | None:
    """One yfinance .info call with a single retry on failure. Returns
    None when both attempts miss."""
    for attempt in (1, 2):
        try:
            ticker = yf.Ticker(f"{_yahoo_symbol(symbol)}.NS")
            info = ticker.info or {}
            if info.get("regularMarketPrice") is not None:
                return info
            return None
        except Exception as exc:   # noqa: BLE001
            if attempt == 1:
                print(f"  [{symbol}] info attempt 1 failed: {exc} — retry in {RETRY_BACKOFF_SEC} s")
                time.sleep(RETRY_BACKOFF_SEC)
            else:
                print(f"  [{symbol}] info attempt 2 failed: {exc}")
                return None
    return None


def _fetch_ticker_quarterly(symbol: str):
    """One yfinance .quarterly_financials call with a single retry."""
    for attempt in (1, 2):
        try:
            ticker = yf.Ticker(f"{_yahoo_symbol(symbol)}.NS")
            qf = ticker.quarterly_financials
            return qf
        except Exception as exc:   # noqa: BLE001
            if attempt == 1:
                print(f"  [{symbol}] quarterly attempt 1 failed: {exc} — retry in {RETRY_BACKOFF_SEC} s")
                time.sleep(RETRY_BACKOFF_SEC)
            else:
                print(f"  [{symbol}] quarterly attempt 2 failed: {exc}")
                return None
    return None


def fetch_key_metrics(symbol: str) -> dict[str, Any]:
    """Return a key_metrics row (with `symbol` + `updated_at`) or an
    empty dict on any failure / missing data."""
    try:
        info = _fetch_ticker_info(symbol)
        if not info:
            return {}
        return {
            "symbol":              symbol,
            "market_cap":          _safe_num(info.get("marketCap")),
            "pe_ratio":            _safe_num(info.get("trailingPE")),
            "forward_pe":          _safe_num(info.get("forwardPE")),
            "pb_ratio":            _safe_num(info.get("priceToBook")),
            "de_ratio":            _safe_num(info.get("debtToEquity")),
            "current_ratio":       _safe_num(info.get("currentRatio")),
            "roe":                 _safe_num(info.get("returnOnEquity")),
            "roa":                 _safe_num(info.get("returnOnAssets")),
            "eps_ttm":             _safe_num(info.get("trailingEps")),
            "revenue_ttm":         _safe_num(info.get("totalRevenue")),
            "profit_margins":      _safe_num(info.get("profitMargins")),
            "operating_margins":   _safe_num(info.get("operatingMargins")),
            "revenue_growth":      _safe_num(info.get("revenueGrowth")),
            "earnings_growth":     _safe_num(info.get("earningsGrowth")),
            "dividend_yield":      _safe_num(info.get("dividendYield")),
            "beta":                _safe_num(info.get("beta")),
            "fifty_two_week_high": _safe_num(info.get("fiftyTwoWeekHigh")),
            "fifty_two_week_low":  _safe_num(info.get("fiftyTwoWeekLow")),
            "updated_at":          _now_iso(),
        }
    except Exception as exc:   # noqa: BLE001
        print(f"  [{symbol}] metrics failed: {exc}")
        return {}


def fetch_quarterly_financials(symbol: str) -> list[dict[str, Any]]:
    """Return up to the latest 4 quarter rows; empty list on failure /
    no data."""
    try:
        qf = _fetch_ticker_quarterly(symbol)
        if qf is None or getattr(qf, "empty", True):
            return []
        rows: list[dict[str, Any]] = []
        for col in qf.columns[:4]:
            try:
                quarter_date = col.strftime("%Y-%m-%d")
            except Exception:   # noqa: BLE001
                continue
            rows.append({
                "symbol":           symbol,
                "quarter_end":      quarter_date,
                "revenue":          _safe(qf, "Total Revenue", col),
                "gross_profit":     _safe(qf, "Gross Profit", col),
                "operating_income": _safe(qf, "Operating Income", col),
                "net_income":       _safe(qf, "Net Income", col),
                "ebitda":           _safe(qf, "EBITDA", col),
                "updated_at":       _now_iso(),
            })
        return rows
    except Exception as exc:   # noqa: BLE001
        print(f"  [{symbol}] quarterly failed: {exc}")
        return []


# ── Companies list ─────────────────────────────────────────────────────

def fetch_all_companies() -> list[str]:
    """Paginated read of every company symbol. Mirrors the pattern in
    fetch_fundamentals.py / fetch_market_cap.py so all weekly fetchers
    cover the same universe (~2,100 stocks, not just the static
    large/mid-cap seed list in symbols.py)."""
    symbols: list[str] = []
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table(COMPANIES_TABLE)
            .select("symbol")
            .order("symbol")
            .range(start, start + page - 1)
            .execute()
        )
        batch = getattr(res, "data", None) or []
        symbols.extend((r.get("symbol") or "").upper() for r in batch if r.get("symbol"))
        if len(batch) < page:
            break
        start += page
    return symbols


# ── Upserts ────────────────────────────────────────────────────────────

def upsert_key_metrics(row: dict[str, Any]) -> bool:
    try:
        supabase.table(KEY_METRICS_TABLE).upsert(row, on_conflict="symbol").execute()
        return True
    except Exception as exc:   # noqa: BLE001
        print(f"  ! key_metrics upsert failed for {row.get('symbol')}: {exc}")
        return False


def upsert_quarterly(rows: list[dict[str, Any]]) -> int:
    """Returns the number of rows successfully written."""
    if not rows:
        return 0
    try:
        supabase.table(QUARTERLY_TABLE).upsert(
            rows, on_conflict="symbol,quarter_end",
        ).execute()
        return len(rows)
    except Exception as exc:   # noqa: BLE001
        sym = rows[0].get("symbol") if rows else "?"
        print(f"  ! quarterly upsert failed for {sym}: {exc}")
        return 0


# ── Main ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="yfinance-backed fundamentals refresh")
    parser.add_argument(
        "--symbol",
        type=str,
        default=None,
        help="Single symbol to fetch (skip the full ALL_SYMBOLS sweep). Useful for ad-hoc verification.",
    )
    args = parser.parse_args()

    symbols = [args.symbol.upper()] if args.symbol else fetch_all_companies()
    total = len(symbols)
    success = 0
    failed = 0
    quarters_written = 0

    label = f"--symbol {args.symbol}" if args.symbol else "companies table"
    print(f"fetch_fundamentals_yf — {total} symbol(s) via yfinance ({label})...")
    log_event("fetch_fundamentals_yf_started", {"total": total, "mode": label})

    for i, symbol in enumerate(symbols, 1):
        print(f"[{i}/{total}] {symbol}", flush=True)

        # Key metrics — call #1 to Yahoo.
        metrics = fetch_key_metrics(symbol)
        if metrics and upsert_key_metrics(metrics):
            success += 1
        else:
            failed += 1

        # Within-symbol pause BEFORE the second Yahoo call.
        _yahoo_pause()

        # Quarterly financials — call #2 to Yahoo. Best-effort;
        # failure doesn't count against the success ledger (the
        # metrics call already did).
        quarters = fetch_quarterly_financials(symbol)
        quarters_written += upsert_quarterly(quarters)

        # Pause BEFORE the next symbol's first call.
        if i < total:
            _yahoo_pause()

        # Periodic cool-down — lets Yahoo's per-IP counters decay so
        # a long sweep doesn't drift into a flag late in the run.
        if i % COOLDOWN_EVERY_N == 0 and i < total:
            print(f"  …cool-down {COOLDOWN_SECONDS} s after {i} symbols", flush=True)
            time.sleep(COOLDOWN_SECONDS)

        if i % LOG_EVERY_N == 0:
            log_event(
                "fetch_fundamentals_yf_progress",
                {
                    "processed":         i,
                    "success":           success,
                    "failed":            failed,
                    "quarters_written":  quarters_written,
                },
            )

    print(
        f"Done. success={success} failed={failed} "
        f"quarters_written={quarters_written}",
    )
    log_event(
        "fetch_fundamentals_yf_complete",
        {
            "success":          success,
            "failed":           failed,
            "total":            total,
            "quarters_written": quarters_written,
        },
    )


if __name__ == "__main__":
    main()
