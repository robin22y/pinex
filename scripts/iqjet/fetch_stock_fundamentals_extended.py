"""Extended yfinance fundamentals → key_metrics.

Populates the new columns from scripts/sql/add_key_metrics_extended_columns.sql:
  operating_cashflow, free_cashflow, net_receivables, inventory,
  goodwill, total_debt, total_cash, total_assets

Why a separate script:
  The /iqjet-desk Stock Lookup card needs cashflow + balance-sheet
  fields to drive its forensic flag panel. Yahoo's open quoteSummary
  endpoint started returning 401 from server-side callers in 2024,
  so the Deno-based Supabase Edge Function hits Yahoo and gets back
  a blank skeleton. yfinance handles Yahoo's crumb-cookie flow
  internally and Just Works from Python — we run it nightly here
  and write straight to Supabase. Browser reads from key_metrics;
  no Yahoo dependency on the user's request path.

Usage:
    cd scripts/
    python iqjet/fetch_stock_fundamentals_extended.py            # all active companies
    python iqjet/fetch_stock_fundamentals_extended.py --test     # first 5
    python iqjet/fetch_stock_fundamentals_extended.py --limit 100
    python iqjet/fetch_stock_fundamentals_extended.py --sleep 0.1

Run nightly via scripts/run_daily.py — recommended position is AFTER
the existing key_metrics refresh so we never overwrite a fresher
marquee snapshot with stale extended fields.

Env required:
  SUPABASE_URL, SUPABASE_SERVICE_KEY — same as the rest of the pipeline
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Make `db` importable from the parent scripts/ dir — same trick the
# rest of the iqjet scripts use.
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from db import log_event, supabase  # noqa: E402
from loguru import logger           # noqa: E402

import yfinance as yf  # noqa: E402


# ── Helpers ─────────────────────────────────────────────────────────────

def _coerce_num(v) -> float | None:
    """yfinance returns NaN / inf / None / Decimal for missing or odd
    values. Force everything that isn't a finite real number to None
    so Supabase stores a real NULL instead of choking on JSON encode."""
    try:
        if v is None:
            return None
        f = float(v)
        if not math.isfinite(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _latest_col_value(df, row_label: str) -> float | None:
    """Pick the most-recent column from a yfinance balance_sheet /
    cashflow DataFrame. Columns are timestamp-indexed, most recent
    first — `iloc[0]` gives the latest reporting period. Returns
    None when the row label is absent or the value is NaN."""
    if df is None or getattr(df, "empty", True):
        return None
    try:
        if row_label not in df.index:
            return None
        val = df.loc[row_label].iloc[0]
        return _coerce_num(val)
    except Exception:                                              # noqa: BLE001
        return None


def _latest_col_value_any(df, row_labels: list[str]) -> float | None:
    """Try each row label in turn — yfinance has shipped the same
    concept under several names over the years (e.g. "Net Receivables"
    vs "Receivables" vs "Accounts Receivable")."""
    for lbl in row_labels:
        v = _latest_col_value(df, lbl)
        if v is not None:
            return v
    return None


def _fetch_one(symbol_yf: str) -> dict | None:
    """Fetch one symbol's extended fundamentals. Returns a dict of the
    eight extended fields, or None on a hard fetch failure (rate
    limit, no data, network blip). Soft-misses on individual fields
    just resolve to None for that field."""
    try:
        t = yf.Ticker(symbol_yf)
        info = t.info or {}
        cashflow = getattr(t, "cashflow", None)
        balance_sheet = getattr(t, "balance_sheet", None)
    except Exception as exc:                                       # noqa: BLE001
        logger.warning(f"[fundx] yfinance fetch failed for {symbol_yf}: {exc}")
        return None

    # ── .info — has the marquee numbers ────────────────────────────
    operating_cashflow = _coerce_num(info.get("operatingCashflow"))
    free_cashflow      = _coerce_num(info.get("freeCashflow"))
    total_debt         = _coerce_num(info.get("totalDebt"))
    total_cash         = _coerce_num(info.get("totalCash"))

    # ── balance_sheet items ────────────────────────────────────────
    net_receivables = _latest_col_value_any(balance_sheet, [
        "Net Receivables", "Accounts Receivable", "Receivables",
    ])
    inventory = _latest_col_value_any(balance_sheet, [
        "Inventory", "Inventories",
    ])
    goodwill = _latest_col_value_any(balance_sheet, [
        "Goodwill", "Good Will",
    ])
    total_assets = _latest_col_value_any(balance_sheet, [
        "Total Assets", "TotalAssets",
    ])

    # ── cashflow fallbacks ─────────────────────────────────────────
    if operating_cashflow is None:
        operating_cashflow = _latest_col_value_any(cashflow, [
            "Total Cash From Operating Activities",
            "Operating Cash Flow",
            "Cash Flow From Continuing Operating Activities",
        ])
    if free_cashflow is None:
        # FCF rarely sits in cashflow df directly; build from OCF +
        # capital expenditure (capex is negative in yfinance, so we
        # ADD it to OCF rather than subtract).
        ocf = operating_cashflow
        capex = _latest_col_value_any(cashflow, [
            "Capital Expenditures", "Capital Expenditure",
        ])
        if ocf is not None and capex is not None:
            free_cashflow = ocf + capex

    return {
        "operating_cashflow": operating_cashflow,
        "free_cashflow":      free_cashflow,
        "net_receivables":    net_receivables,
        "inventory":          inventory,
        "goodwill":           goodwill,
        "total_debt":         total_debt,
        "total_cash":         total_cash,
        "total_assets":       total_assets,
    }


# ── Entry point ─────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--test",  action="store_true",
                    help="Process only the first 5 active companies.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap the symbol list (e.g. 100 for a quick check).")
    ap.add_argument("--sleep", type=float, default=0.3,
                    help="Seconds to sleep between yfinance calls. "
                         "Default 0.3 = ~3 req/sec, safely below Yahoo's "
                         "informal rate limit.")
    args = ap.parse_args()

    # Active, non-suspended companies — same universe the rest of the
    # daily pipeline operates over. Paginated because Supabase's
    # PostgREST gateway caps a single .select() at 1000 rows by
    # default; without this loop we'd silently truncate at the first
    # 1000 of a ~2,100-company universe.
    PAGE = 1000
    companies: list[dict] = []
    offset = 0
    try:
        while True:
            res = (
                supabase.table("companies")
                .select("id,symbol")
                .or_("is_suspended.is.null,is_suspended.eq.false")
                .range(offset, offset + PAGE - 1)
                .execute()
            )
            page = getattr(res, "data", None) or []
            if not page:
                break
            companies.extend(page)
            if len(page) < PAGE:
                break
            offset += PAGE
    except Exception as exc:                                       # noqa: BLE001
        logger.error(f"[fundx] companies lookup failed: {exc}")
        return 1
    logger.info(f"[fundx] companies universe size: {len(companies)}")

    if args.test:
        companies = companies[:5]
    elif args.limit:
        companies = companies[: args.limit]

    logger.info(
        f"[fundx] processing {len(companies)} companies · sleep={args.sleep}s",
    )

    ok_count   = 0
    fail_count = 0
    skip_count = 0
    started_at = time.time()

    for i, c in enumerate(companies, 1):
        sym = (c.get("symbol") or "").upper()
        if not sym:
            skip_count += 1
            continue

        if i % 50 == 0:
            elapsed = time.time() - started_at
            logger.info(
                f"[fundx] {i}/{len(companies)} · "
                f"ok={ok_count} fail={fail_count} skip={skip_count} · "
                f"{elapsed:.0f}s elapsed",
            )

        try:
            fields = _fetch_one(f"{sym}.NS")
        except Exception as exc:                                   # noqa: BLE001
            logger.warning(f"[fundx] {sym} fetch raised: {exc}")
            fail_count += 1
            time.sleep(args.sleep)
            continue

        if not fields:
            fail_count += 1
            time.sleep(args.sleep)
            continue

        # Skip the upsert when EVERY extended field is None — there's
        # nothing to write and we'd just churn updated_at.
        if all(v is None for v in fields.values()):
            skip_count += 1
            time.sleep(args.sleep)
            continue

        fields["symbol"] = sym
        fields["extended_updated_at"] = datetime.now(timezone.utc).isoformat()

        try:
            supabase.table("key_metrics").upsert(
                fields,
                on_conflict="symbol",
            ).execute()
            ok_count += 1
        except Exception as exc:                                   # noqa: BLE001
            logger.warning(f"[fundx] upsert failed for {sym}: {exc}")
            fail_count += 1

        time.sleep(args.sleep)

    elapsed = time.time() - started_at
    logger.info(
        f"[fundx] done · ok={ok_count} fail={fail_count} skip={skip_count} · "
        f"{elapsed:.0f}s total",
    )

    log_event("fetch_stock_fundamentals_extended_finished", {
        "ok":          ok_count,
        "fail":        fail_count,
        "skip":        skip_count,
        "elapsed_sec": int(elapsed),
    })

    # Exit non-zero only when the failure rate looks pathological so
    # GitHub Actions / Railway surfaces a real outage instead of the
    # usual ~5% per-call yfinance flake.
    if ok_count == 0 and fail_count > 5:
        logger.error("[fundx] no successful upserts — yfinance or DB outage?")
        return 1
    if fail_count > ok_count * 2:
        logger.warning("[fundx] failure rate >2x success — investigate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
