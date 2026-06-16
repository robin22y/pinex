"""
calc_market_context.py

Computes the daily "Today in Market Context" row by mining
market_internals history. One row written per call into
public.daily_market_context, keyed on date.

WHY THIS SCRIPT EXISTS
  The homepage TodayVsHistory section used to pull the entire
  market_internals history into the browser and bucket Nifty
  forward returns client-side. That meant every visitor downloaded
  ~250 KB of breadth history before the section could render, and
  the same compute ran 100 % of the time on the client. This script
  moves the work to the nightly pipeline: the frontend now reads a
  single pre-baked row from daily_market_context. Zero on-the-fly
  computation, fast first paint.

WHEN IT RUNS
  Wired into run_daily.py after the swing_conditions step. By that
  point market_internals carries today's row (the breadth /
  stage-distribution / VIX computation), so the matcher has fresh
  inputs.

WHAT IT DOES
  1. Pull all market_internals rows (small table — ~1700 rows).
  2. Pre-compute the 10-trading-day forward Nifty return for every
     row (rows in the last 10 trading days get no forward and are
     skipped from the sample).
  3. Pick today's row — the most recent date — as the anchor.
  4. Filter the rest to past days similar to today:
       above_ma30w_pct      within ±5 % points
       stage2_count         within ±50 stocks
       india_vix bucket     same (low / normal / elevated / high)
  5. Bucket the matched rows' 10-day forwards into:
       strong   > +5 %
       positive +1 % < x ≤ +5 %
       flat     −1 % ≤ x ≤ +1 %
       negative <  −1 %
     Percentages rounded to integers, normalised so the sum equals
     100 (large-remainder method to absorb rounding drift).
  6. Upsert one row into daily_market_context with today's
     condition snapshot + the distribution + a market_phase label
     derived from above_ma30w_pct.

The script is safe to re-run on the same date — the upsert keyed
on `date` overwrites yesterday's row idempotently.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))

from loguru import logger  # noqa: E402
from db import supabase, upsert  # noqa: E402


# ─────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────

PAGE_SIZE        = 1000
FORWARD_DAYS     = 10        # trading days, not calendar
BREADTH_TOL      = 5         # ±  percentage points on above_ma30w_pct
STAGE2_TOL       = 50        # ±  stocks on stage2_count
MIN_SAMPLE       = 30        # below this we don't publish a distribution

# 10-day Nifty forward return buckets. Non-overlapping, sum to 100 %.
# Strong / positive / flat / negative match the keys the frontend
# spec expects. Order matters for the percent-of-total rounding.
BUCKETS = [
    ('strong',   lambda v: v >   5.0),
    ('positive', lambda v: v >   1.0 and v <=  5.0),
    ('flat',     lambda v: v >= -1.0 and v <=  1.0),
    ('negative', lambda v: v <  -1.0),
]


def vix_bucket(vix: float | None) -> str:
    """Classify an India VIX value into a coarse regime label. The
    matcher then narrows to days in the SAME regime — actual VIX
    levels drift across years (12 in a low-vol bull, 18 in a normal
    period) so a fixed ± tolerance would over-include adjacent
    regimes."""
    if vix is None or vix == '' :
        return 'unknown'
    try:
        v = float(vix)
    except (TypeError, ValueError):
        return 'unknown'
    if v < 12:  return 'low'
    if v < 18:  return 'normal'
    if v < 25:  return 'elevated'
    return 'high'


def market_phase_label(breadth: float | None) -> str | None:
    """Above-30W-MA breadth → market_phase. Same thresholds the
    Home hero already uses for the green / amber / red pill so the
    two surfaces never disagree."""
    if breadth is None:
        return None
    try:
        b = float(breadth)
    except (TypeError, ValueError):
        return None
    if b > 60:  return 'healthy'
    if b > 40:  return 'mixed'
    return 'weak'


def round_to_integers(percents: list[float]) -> list[int]:
    """Largest-remainder rounding so the percent list sums to 100
    even after each entry is integer-rounded. Avoids the common
    'oops, 99 %' or '101 %' display bug."""
    floored = [int(p) for p in percents]
    remainder = 100 - sum(floored)
    if remainder == 0:
        return floored
    # Sort indices by descending fractional part, hand out the
    # remainder one at a time.
    fracs = [(i, percents[i] - floored[i]) for i in range(len(percents))]
    fracs.sort(key=lambda x: -x[1])
    for i, _ in fracs[:abs(remainder)]:
        floored[i] += (1 if remainder > 0 else -1)
    return floored


# ─────────────────────────────────────────────────────────────────
# Data load
# ─────────────────────────────────────────────────────────────────

def fetch_market_internals() -> list[dict[str, Any]]:
    """All market_internals rows, oldest first. Small table."""
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        res = (
            supabase.table('market_internals')
            .select(
                'date, above_ma30w_pct, stage2_count, stage3_count, '
                'india_vix, nifty_close, nifty_change_1d'
            )
            .order('date', desc=False)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


# ─────────────────────────────────────────────────────────────────
# Compute
# ─────────────────────────────────────────────────────────────────

def attach_forward_10d(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adds forward_10d_pct = (close[i+10] − close[i]) / close[i] × 100
    to every row that has both a current and forward close. Rows in
    the last FORWARD_DAYS get None (will be skipped by the matcher).
    """
    out = []
    for i, r in enumerate(rows):
        if i + FORWARD_DAYS >= len(rows):
            r2 = dict(r); r2['forward_10d_pct'] = None
            out.append(r2)
            continue
        cur = r.get('nifty_close')
        fwd = rows[i + FORWARD_DAYS].get('nifty_close')
        if cur in (None, 0) or fwd in (None, 0):
            r2 = dict(r); r2['forward_10d_pct'] = None
            out.append(r2)
            continue
        try:
            pct = ((float(fwd) - float(cur)) / float(cur)) * 100.0
        except (TypeError, ValueError, ZeroDivisionError):
            pct = None
        r2 = dict(r); r2['forward_10d_pct'] = pct
        out.append(r2)
    return out


def find_similar(
    today: dict[str, Any],
    history: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Past trading days whose breadth / stage2 count / VIX regime
    match today's. Excludes today itself and any row without a
    forward_10d_pct (the last 10 days)."""
    target_breadth = today.get('above_ma30w_pct')
    target_stage2  = today.get('stage2_count')
    target_bucket  = vix_bucket(today.get('india_vix'))

    if target_breadth is None:
        return []

    matches: list[dict[str, Any]] = []
    for r in history:
        if r.get('date') == today.get('date'):
            continue
        if r.get('forward_10d_pct') is None:
            continue
        b = r.get('above_ma30w_pct')
        if b is None or abs(float(b) - float(target_breadth)) > BREADTH_TOL:
            continue
        if target_stage2 is not None and r.get('stage2_count') is not None:
            if abs(int(r['stage2_count']) - int(target_stage2)) > STAGE2_TOL:
                continue
        # VIX is optional — match the bucket when both sides have it,
        # otherwise let it pass (early history may not carry VIX).
        if target_bucket != 'unknown':
            r_bucket = vix_bucket(r.get('india_vix'))
            if r_bucket != 'unknown' and r_bucket != target_bucket:
                continue
        matches.append(r)
    return matches


def bucket_distribution(rows: list[dict[str, Any]]) -> dict[str, int]:
    """Return the % share of each named bucket. Always returns all
    four keys so the frontend can render the layout without keys
    appearing and disappearing across days."""
    n = len(rows)
    if n == 0:
        return {name: 0 for name, _ in BUCKETS}
    counts = []
    for name, test in BUCKETS:
        counts.append(sum(1 for r in rows if test(r['forward_10d_pct'])))
    percents = [c / n * 100.0 for c in counts]
    rounded = round_to_integers(percents)
    return {name: pct for (name, _), pct in zip(BUCKETS, rounded)}


# ─────────────────────────────────────────────────────────────────
# Entry
# ─────────────────────────────────────────────────────────────────

def main() -> None:
    logger.info('calc_market_context — start')

    rows = fetch_market_internals()
    logger.info(f'loaded {len(rows)} market_internals rows')
    if len(rows) < FORWARD_DAYS + 1:
        logger.error('not enough market_internals history — aborting')
        sys.exit(1)

    rows_fwd = attach_forward_10d(rows)
    today = rows_fwd[-1]
    target_date = today.get('date')
    if not target_date:
        logger.error('latest market_internals row has no date — aborting')
        sys.exit(1)

    logger.info(
        f'today anchor — date={target_date} '
        f'above_ma30w_pct={today.get("above_ma30w_pct")} '
        f'stage2_count={today.get("stage2_count")} '
        f'india_vix={today.get("india_vix")}'
    )

    # The anchor itself has no forward window (it IS the latest row)
    # so we never include it in the sample — find_similar() also
    # filters by forward_10d_pct not null, defensively.
    similar = find_similar(today, rows_fwd)
    logger.info(f'similar past days: {len(similar)}')

    distribution = bucket_distribution(similar) if len(similar) >= MIN_SAMPLE else None

    row = {
        'date':               str(target_date),
        'above_ma30w_pct':    today.get('above_ma30w_pct'),
        'stage2_count':       today.get('stage2_count'),
        'stage3_count':       today.get('stage3_count'),
        'india_vix':          today.get('india_vix'),
        'vix_level':          vix_bucket(today.get('india_vix')),
        'nifty_close':        today.get('nifty_close'),
        'nifty_change_1d':    today.get('nifty_change_1d'),
        'similar_days_count': len(similar),
        'distribution_10d':   distribution,
        'market_phase':       market_phase_label(today.get('above_ma30w_pct')),
    }

    logger.info(
        f'upserting daily_market_context date={target_date} '
        f'phase={row["market_phase"]} vix_level={row["vix_level"]} '
        f'similar={row["similar_days_count"]} '
        f'distribution={json.dumps(distribution) if distribution else "null"}'
    )

    res = upsert('daily_market_context', row, on_conflict_column='date')
    if res is None:
        logger.error('upsert returned None — see preceding error log')
        sys.exit(1)
    logger.info('done')


if __name__ == '__main__':
    main()
