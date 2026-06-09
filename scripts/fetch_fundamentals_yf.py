"""
fetch_fundamentals_yf.py — yfinance-backed fundamentals refresh.

Sibling to fetch_fundamentals.py (which uses IndianAPI). Either can
populate key_metrics; whichever runs last wins on overlapping fields.
The yfinance source adds 9 fields the IndianAPI source doesn't expose
(forward_pe, roa, profit / operating margins, revenue / earnings
growth, beta, 52W high / low) and writes quarterly numbers into a
separate quarterly_financials_yf table.

For each symbol in symbols.ALL_SYMBOLS:
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
from symbols import ALL_SYMBOLS  # noqa: E402

# Force UTF-8 on Windows console so non-ASCII names don't crash a print.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ── Constants ──────────────────────────────────────────────────────────

KEY_METRICS_TABLE = "key_metrics"
QUARTERLY_TABLE = "quarterly_financials_yf"
SLEEP_BETWEEN_SYMBOLS = 0.5
LOG_EVERY_N = 100


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

def fetch_key_metrics(symbol: str) -> dict[str, Any]:
    """Return a key_metrics row (with `symbol` + `updated_at`) or an
    empty dict on any failure / missing data."""
    try:
        ticker = yf.Ticker(f"{symbol}.NS")
        info = ticker.info or {}
        if info.get("regularMarketPrice") is None:
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
        ticker = yf.Ticker(f"{symbol}.NS")
        qf = ticker.quarterly_financials
        if qf is None or qf.empty:
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
    total = len(ALL_SYMBOLS)
    success = 0
    failed = 0
    quarters_written = 0

    print(f"fetch_fundamentals_yf — {total} symbols via yfinance...")
    log_event("fetch_fundamentals_yf_started", {"total": total})

    for i, symbol in enumerate(ALL_SYMBOLS, 1):
        print(f"[{i}/{total}] {symbol}", flush=True)

        # Key metrics
        metrics = fetch_key_metrics(symbol)
        if metrics and upsert_key_metrics(metrics):
            success += 1
        else:
            failed += 1

        # Quarterly financials — best-effort; failure doesn't count
        # against the success ledger (the metrics call already did).
        quarters = fetch_quarterly_financials(symbol)
        quarters_written += upsert_quarterly(quarters)

        # yfinance is free; respect rate-friendly default.
        time.sleep(SLEEP_BETWEEN_SYMBOLS)

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
