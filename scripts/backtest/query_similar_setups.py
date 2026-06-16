"""
query_similar_setups.py

Given current stock conditions, find historically similar setups
in pattern_snapshots and report aggregate forward outcomes.

Used as:
  1. A standalone CLI for debugging / spot-checking the matcher.
  2. The reference implementation that
     supabase/functions/pattern-match/index.ts mirrors. If you change
     ranges or aggregation here, update the edge function to match.

Match criteria (RANGES, NOT EXACT — except where noted):
  stage         exact match
  substage      exact match
  rs_vs_nifty   within ±10 points
  vol_ratio     within ±0.5
  above_ma30w_pct   within ±7 percentage points

Always-applied filters:
  - Exclude rows from the last 90 days (forward data incomplete).
  - Forward fields must be non-null (the writer already guarantees
    this, but defensive).

Returns a dict with the same shape the edge function emits.

CLI:
  python scripts/backtest/query_similar_setups.py \\
      --stage "Stage 2" --substage "2A" \\
      --rs 12.4 --vol 1.6 --breadth 58
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR.parent))

from db import supabase  # noqa: E402


# ─── Match-window constants (mirror in edge function) ───────────
RS_TOL          = 10.0
VOL_TOL         = 0.5
BREADTH_TOL     = 7.0
EXCLUDE_DAYS    = 90
TOP_N_INSTANCES = 4   # the "TOP SIMILAR HISTORICAL INSTANCES" list
PAGE_SIZE       = 1000


def _pct_positive(values: list[float]) -> float | None:
    if not values:
        return None
    pos = sum(1 for v in values if v is not None and v > 0)
    return round(100.0 * pos / len(values), 1)


def _median(values: list[float]) -> float | None:
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return None
    n = len(xs)
    mid = n // 2
    if n % 2 == 1:
        return round(xs[mid], 2)
    return round((xs[mid - 1] + xs[mid]) / 2.0, 2)


def _bool_pct(values: list[bool | None]) -> float | None:
    flat = [v for v in values if v is not None]
    if not flat:
        return None
    return round(100.0 * sum(1 for v in flat if v) / len(flat), 1)


def _similarity_score(
    row: dict[str, Any],
    rs: float, vol: float, breadth: float,
) -> float:
    """Cosine-ish similarity over the three numeric axes. 100 =
    perfect match on all three; 0 = at every tolerance boundary.
    Used to rank the TOP SIMILAR INSTANCES list — not part of the
    aggregate maths."""

    def axis(value, target, tol):
        if value is None or tol <= 0:
            return 0.0
        diff = abs(float(value) - float(target))
        if diff >= tol:
            return 0.0
        return 1.0 - (diff / tol)

    parts = [
        axis(row.get("rs_vs_nifty"),  rs,      RS_TOL),
        axis(row.get("vol_ratio"),    vol,     VOL_TOL),
        axis(row.get("above_ma30w_pct"),  breadth, BREADTH_TOL),
    ]
    score = sum(parts) / len(parts)
    return round(score * 100.0, 0)


def _fetch_companies_lookup(company_ids: set[str]) -> dict[str, str]:
    """company_id → symbol map, paged to handle large match sets."""
    if not company_ids:
        return {}
    ids = list(company_ids)
    out: dict[str, str] = {}
    CHUNK = 200
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i : i + CHUNK]
        try:
            res = (
                supabase.table("companies")
                .select("id, symbol")
                .in_("id", chunk)
                .execute()
            )
            for r in res.data or []:
                if r.get("id") and r.get("symbol"):
                    out[str(r["id"])] = str(r["symbol"])
        except Exception:
            continue
    return out


def find_similar_setups(
    *,
    stage: str,
    substage: str | None,
    rs_score: float,
    vol_ratio: float,
    above_ma30w_pct: float,
) -> dict[str, Any]:
    """Core matcher. See the file docstring for the rules."""

    # Last-90-day exclusion — use today's date in UTC.
    cutoff = (date.today() - timedelta(days=EXCLUDE_DAYS)).isoformat()

    # Build the equality + range query.
    q = (
        supabase.table("pattern_snapshots")
        .select(
            "company_id, date, rs_vs_nifty, vol_ratio, above_ma30w_pct, "
            "forward_7d, forward_30d, forward_60d, forward_90d, "
            "hit_52w_high_30d, hit_52w_low_30d, "
            "stage_upgraded_30d, dropped_below_ma_30d"
        )
        .eq("stage", stage)
        .lt("date", cutoff)
        .gte("rs_vs_nifty",  rs_score      - RS_TOL)
        .lte("rs_vs_nifty",  rs_score      + RS_TOL)
        .gte("vol_ratio",    vol_ratio     - VOL_TOL)
        .lte("vol_ratio",    vol_ratio     + VOL_TOL)
        .gte("above_ma30w_pct",  above_ma30w_pct   - BREADTH_TOL)
        .lte("above_ma30w_pct",  above_ma30w_pct   + BREADTH_TOL)
    )
    # Substage is OPTIONAL — apply the equality filter only when the
    # caller actually has one to match against. With substage now a
    # write-as-found field (most historical snapshots carry null
    # because the upstream pipeline never backfilled it), making the
    # filter conditional means:
    #   current stock HAS substage    → narrow to same-substage rows
    #   current stock has no substage → match on stage + RS + vol only
    # If the field were ALWAYS filtered we'd exclude every pre-pipeline
    # row even when the caller never asked to narrow by substage.
    if substage:
        q = q.eq("substage", substage)

    # Page through results — there's no soft cap on the answer size.
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        res = q.range(start, start + PAGE_SIZE - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE

    if not rows:
        return {
            "sample_size":            0,
            "earliest_date":          None,
            "latest_date":            None,
            "pct_positive_7d":        None,
            "pct_positive_30d":       None,
            "pct_positive_60d":       None,
            "median_return_30d":      None,
            "best_case_30d":          None,
            "worst_case_30d":         None,
            "pct_hit_52w_high":       None,
            "pct_dropped_below_ma":   None,
            "pct_stage_upgraded":     None,
            "similar_instances":      [],
            "table": {
                "headers": ["7 days", "30 days", "60 days"],
                "positive":     [None, None, None],
                "median_return":[None, None, None],
                "best_case":    [None, None, None],
                "worst_case":   [None, None, None],
            },
        }

    # ── Aggregate over the matched rows ─────────────────────────
    f7  = [r.get("forward_7d")  for r in rows]
    f30 = [r.get("forward_30d") for r in rows]
    f60 = [r.get("forward_60d") for r in rows]
    f90 = [r.get("forward_90d") for r in rows]

    f7_v  = [v for v in f7  if v is not None]
    f30_v = [v for v in f30 if v is not None]
    f60_v = [v for v in f60 if v is not None]
    f90_v = [v for v in f90 if v is not None]

    table = {
        "headers": ["7 days", "30 days", "60 days"],
        "positive": [
            _pct_positive(f7_v),
            _pct_positive(f30_v),
            _pct_positive(f60_v),
        ],
        "median_return": [
            _median(f7_v),
            _median(f30_v),
            _median(f60_v),
        ],
        "best_case": [
            round(max(f7_v),  2) if f7_v  else None,
            round(max(f30_v), 2) if f30_v else None,
            round(max(f60_v), 2) if f60_v else None,
        ],
        "worst_case": [
            round(min(f7_v),  2) if f7_v  else None,
            round(min(f30_v), 2) if f30_v else None,
            round(min(f60_v), 2) if f60_v else None,
        ],
    }

    # ── TOP N similar instances ─────────────────────────────────
    # Score every row, sort descending, take TOP_N_INSTANCES.
    scored = [
        {
            **r,
            "similarity_score": _similarity_score(r, rs_score, vol_ratio, above_ma30w_pct),
        }
        for r in rows
    ]
    scored.sort(
        key=lambda r: (
            r["similarity_score"],
            # Tie-break by 30d return so two equally-similar setups
            # show the better-performing one first.
            r.get("forward_30d") or -math.inf,
        ),
        reverse=True,
    )
    top = scored[:TOP_N_INSTANCES]
    company_ids = {str(r.get("company_id")) for r in top if r.get("company_id")}
    sym_by_id = _fetch_companies_lookup(company_ids)

    instances = []
    for r in top:
        cid = str(r.get("company_id") or "")
        instances.append({
            "symbol":            sym_by_id.get(cid, cid[:8] + "…"),
            "date":              r.get("date"),
            "similarity_score":  int(r["similarity_score"]),
            "forward_7d":        r.get("forward_7d"),
            "forward_30d":       r.get("forward_30d"),
            "forward_60d":       r.get("forward_60d"),
            "forward_90d":       r.get("forward_90d"),
        })

    dates = sorted([str(r["date"]) for r in rows if r.get("date")])

    return {
        "sample_size":            len(rows),
        "earliest_date":          dates[0]  if dates else None,
        "latest_date":            dates[-1] if dates else None,
        "pct_positive_7d":        _pct_positive(f7_v),
        "pct_positive_30d":       _pct_positive(f30_v),
        "pct_positive_60d":       _pct_positive(f60_v),
        "median_return_30d":      _median(f30_v),
        "best_case_30d":          round(max(f30_v), 2) if f30_v else None,
        "worst_case_30d":         round(min(f30_v), 2) if f30_v else None,
        "pct_hit_52w_high":       _bool_pct([r.get("hit_52w_high_30d")     for r in rows]),
        "pct_dropped_below_ma":   _bool_pct([r.get("dropped_below_ma_30d") for r in rows]),
        "pct_stage_upgraded":     _bool_pct([r.get("stage_upgraded_30d")   for r in rows]),
        "similar_instances":      instances,
        "table":                  table,
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Find similar historical setups in pattern_snapshots.")
    p.add_argument("--stage", required=True, help='e.g. "Stage 2"')
    p.add_argument("--substage", default=None)
    p.add_argument("--rs", type=float, required=True, dest="rs_score",
                   help="rs_vs_nifty centre — matches within ±10")
    p.add_argument("--vol", type=float, required=True, dest="vol_ratio",
                   help="vol_ratio centre — matches within ±0.5")
    p.add_argument("--breadth", type=float, required=True, dest="above_ma30w_pct",
                   help="above_ma30w_pct centre — matches within ±7 pts")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    result = find_similar_setups(
        stage=args.stage,
        substage=args.substage,
        rs_score=args.rs_score,
        vol_ratio=args.vol_ratio,
        above_ma30w_pct=args.above_ma30w_pct,
    )
    indent = 2 if args.pretty else None
    print(json.dumps(result, indent=indent, default=str))


if __name__ == "__main__":
    main()
