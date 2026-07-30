"""fix_split_adjustments.py — repair daily_closes: drop phantom sessions,
then back-adjust unadjusted corporate actions.

    python scripts/fix_split_adjustments.py            # dry run, writes nothing
    python scripts/fix_split_adjustments.py --apply
    python scripts/fix_split_adjustments.py --apply --phase 1

Writes ONLY to daily_closes. price_data, delivery_data and every pipeline
script are untouched.

════════════════════════════════════════════════════════════════════════
PHASE 1 — delete rows dated on an NSE holiday
════════════════════════════════════════════════════════════════════════
Two separate faults share this one fix.

  a) CARRY-FORWARD DUPLICATES. On Holi 2026-03-03, 834 of 834 companies
     carry a close byte-identical to 2026-03-02. The exchange was shut;
     these sessions never happened. Inside a rolling mean they double-
     weight the previous day, so a "200-day" average spans ~194 real
     sessions with six counted twice.

  b) A POISONED SESSION. 11 companies show a one-day collapse on
     2026-01-15 that fully reverses on 01-16 — ratios of exactly 0.1000,
     0.2000, 0.0667. A corporate action is PERMANENT; a dip that reverses
     next session is not one. Those rows hold retroactively SPLIT-ADJUSTED
     prices among unadjusted neighbours, for splits that happened months
     later (PASHUPATI's 01-15 row shows its April 2026 post-split price).
     Something that adjusts by default — yfinance does — wrote them.

  2026-01-15 is itself an NSE holiday, so deleting holiday-dated rows
  removes the poisoned session as a side effect. No real trading data is
  lost: none of these sessions traded.

════════════════════════════════════════════════════════════════════════
PHASE 2 — back-adjust genuine splits and bonuses
════════════════════════════════════════════════════════════════════════
NSE bhav copy is UNADJUSTED. After a 1:10 split the price drops ~90%
overnight and every earlier close stays on the old scale, so any average
spanning the event mixes two scales and is meaningless.

WHY GAP DETECTION IS SOUND ON NSE DATA
  NSE applies price bands — 2%, 5%, 10%, 20% — to most scrips. A stock
  physically cannot fall 90% in a session. So a gap past GAP_THRESHOLD is
  a corporate action, a bad tick or a relisting; it is never price
  action. The same heuristic on US data would be far weaker.

SNAP, DO NOT TRUST THE OBSERVED RATIO
  DBEIL's observed ratio is 0.0990, but the true factor is exactly 1/10 —
  the 1% difference is that day's genuine price move. Adjusting by the
  observed ratio would bake the noise into every historical close, so the
  ratio is snapped to a simple fraction and the fraction is what gets
  applied. A gap that snaps to nothing is REPORTED, never guessed at.

THE ADJUSTMENT
  For each company, with r_i the snapped ratio of the split whose first
  new-scale session is d_i:

      adjusted(t) = raw(t) x product of r_i for every d_i > t

  i.e. walk newest to oldest carrying a cumulative factor, and rescale
  everything before each event onto today's scale. Today's close is never
  touched, so the series stays comparable with price_data's latest row.

IDEMPOTENT
  Adjusting removes the gap, so a second run detects nothing and changes
  nothing. Safe to re-run.
"""
from __future__ import annotations

import sys
import time
from fractions import Fraction

from loguru import logger

from db import supabase
from nse_holidays import NSE_HOLIDAYS_2026

READ_PAGE = 1000
WRITE_CHUNK = 500
SUPABASE_SLEEP = 0.1

# A gap this large cannot be price action under NSE circuit limits.
GAP_THRESHOLD = 0.30

# How far the observed ratio may sit from a simple fraction and still be
# accepted as that corporate action.
SNAP_TOLERANCE = 0.10

# Refuse to delete more than this share of the table — a bug in the
# holiday list should not be able to empty it.
MAX_DELETE_FRACTION = 0.10

# Sanity rail on the cumulative rescale. Several stacked splits are
# legitimate; a factor past this means detection went wrong.
MAX_CUMULATIVE = 1e4
MIN_CUMULATIVE = 1e-4

# Ratios an Indian split or bonus actually produces. Splits: FV 10->1 is
# 1/10, 10->2 is 1/5, 10->5 is 1/2. Bonus 1:1 halves the price (1/2),
# 2:1 gives 1/3, 3:1 gives 1/4. Inverses cover consolidations.
_BASE = [Fraction(1, n) for n in (2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50, 100)]
_BASE += [Fraction(2, 3), Fraction(3, 4), Fraction(4, 5), Fraction(2, 5),
          Fraction(3, 5), Fraction(5, 6), Fraction(3, 10), Fraction(7, 10)]
RATIOS = sorted(set(_BASE) | {1 / f for f in _BASE})


def _flag(name: str) -> bool:
    return name in sys.argv


def _phase() -> int | None:
    for i, a in enumerate(sys.argv):
        if a == "--phase" and i + 1 < len(sys.argv):
            try:
                return int(sys.argv[i + 1])
            except ValueError:
                return None
        if a.startswith("--phase="):
            try:
                return int(a.split("=", 1)[-1])
            except ValueError:
                return None
    return None


def snap(ratio: float) -> tuple[Fraction | None, float]:
    """Nearest plausible corporate-action fraction, or None."""
    best, err = None, float("inf")
    for f in RATIOS:
        v = float(f)
        e = abs(ratio - v) / v
        if e < err:
            best, err = f, e
    return (best, err) if err <= SNAP_TOLERANCE else (None, err)


def _paginate(build):
    start = 0
    while True:
        resp = build(start, start + READ_PAGE - 1).execute()
        time.sleep(SUPABASE_SLEEP)
        batch = resp.data or []
        yield batch
        if len(batch) < READ_PAGE:
            return
        start += READ_PAGE


def load_symbols() -> dict[str, str]:
    out: dict[str, str] = {}
    for batch in _paginate(
        lambda a, b: supabase.table("companies").select("id,symbol")
        .order("id").range(a, b)
    ):
        out.update({r["id"]: r.get("symbol") or r["id"] for r in batch})
    return out


def load_series() -> dict[str, list[tuple[str, float]]]:
    """company_id -> [(date, close)] ascending.

    Ordered (company_id, date) — the primary key, hence a total order,
    hence safe to paginate with .range().
    """
    series: dict[str, list[tuple[str, float]]] = {}
    total = 0
    for batch in _paginate(
        lambda a, b: supabase.table("daily_closes").select("company_id,date,close")
        .order("company_id").order("date").range(a, b)
    ):
        for r in batch:
            try:
                close = float(r["close"])
            except (TypeError, ValueError):
                continue
            if close != close:
                continue
            series.setdefault(r["company_id"], []).append((str(r["date"])[:10], close))
            total += 1
    logger.info(f"loaded {total:,} closes across {len(series):,} companies")
    return series


# ════════════════════════════════════════════════════════════════════════
def phase1(apply: bool) -> int:
    """Delete rows dated on an NSE holiday."""
    logger.info("─" * 62)
    logger.info("PHASE 1 — holiday-dated rows")
    logger.info("─" * 62)

    total = (supabase.table("daily_closes").select("company_id", count="exact")
             .limit(1).execute().count or 0)
    time.sleep(SUPABASE_SLEEP)

    doomed: dict[str, int] = {}
    for holiday in sorted(NSE_HOLIDAYS_2026):
        n = (supabase.table("daily_closes").select("company_id", count="exact")
             .eq("date", holiday).limit(1).execute().count or 0)
        time.sleep(SUPABASE_SLEEP)
        if n:
            doomed[holiday] = n
            logger.info(f"  {holiday}  {n:>6,} rows")

    count = sum(doomed.values())
    if not count:
        logger.success("  no holiday-dated rows — nothing to delete")
        return 0

    share = count / total if total else 1.0
    logger.info(f"  total {count:,} of {total:,} rows ({share*100:.2f}%)")
    if share > MAX_DELETE_FRACTION:
        logger.error(f"  refusing: over the {MAX_DELETE_FRACTION*100:.0f}% rail")
        raise SystemExit(1)

    if not apply:
        logger.warning(f"  DRY RUN — would delete {count:,} rows")
        return 0

    for holiday in doomed:
        supabase.table("daily_closes").delete().eq("date", holiday).execute()
        time.sleep(SUPABASE_SLEEP)
        logger.success(f"  deleted {holiday}")
    logger.success(f"  removed {count:,} phantom rows")
    return count


def phase2(apply: bool) -> tuple[int, int, list[str]]:
    """Detect and back-adjust splits. Returns (companies, rows, ambiguous)."""
    logger.info("─" * 62)
    logger.info("PHASE 2 — back-adjust corporate actions")
    logger.info("─" * 62)

    symbols = load_symbols()
    series = load_series()

    payload: list[dict] = []
    fixed: list[tuple[str, int, float]] = []
    ambiguous: list[str] = []

    for cid, rows in series.items():
        sym = symbols.get(cid, cid)
        events: list[tuple[str, Fraction]] = []   # (first new-scale date, ratio)
        for i in range(1, len(rows)):
            (_d0, c0), (d1, c1) = rows[i - 1], rows[i]
            if c0 <= 0 or c1 <= 0:
                continue
            ratio = c1 / c0
            if abs(1 - ratio) < GAP_THRESHOLD:
                continue
            frac, err = snap(ratio)
            if frac is None:
                ambiguous.append(
                    f"{sym} {_d0} {c0:,.2f} -> {d1} {c1:,.2f} "
                    f"(ratio {ratio:.4f}, nearest off by {err*100:.0f}%)"
                )
                continue
            events.append((d1, frac))

        if not events:
            continue

        # Newest to oldest, carrying the product of every later ratio.
        cumulative = 1.0
        factors: dict[str, float] = {}
        event_map = dict(events)
        for date, _close in reversed(rows):
            # RECORD BEFORE MULTIPLY. `date` here is the FIRST session on
            # the new scale, so it must NOT be rescaled — only sessions
            # strictly older than it. Multiplying first would apply the
            # factor to the event date itself and push that one bar back
            # onto the pre-split scale, producing a fresh one-day cliff
            # exactly where we just removed one.
            if cumulative != 1.0:
                factors[date] = cumulative
            if date in event_map:
                cumulative *= float(event_map[date])

        if not factors:
            continue
        worst = min(factors.values()), max(factors.values())
        if worst[0] < MIN_CUMULATIVE or worst[1] > MAX_CUMULATIVE:
            ambiguous.append(f"{sym} cumulative factor out of range {worst} — skipped")
            continue

        changed = 0
        for date, close in rows:
            f = factors.get(date)
            if f is None:
                continue
            new = round(close * f, 4)
            if new <= 0:
                continue
            if abs(new - close) < 1e-9:
                continue
            payload.append({"company_id": cid, "date": date, "close": new})
            changed += 1
        if changed:
            fixed.append((sym, changed, float(events[-1][1])))

    logger.info(f"  {len(fixed):,} companies need adjusting, "
                f"{len(payload):,} closes to rewrite")
    for sym, n, last in sorted(fixed)[:25]:
        logger.info(f"    {sym:<13} {n:>4} closes rescaled  (latest ratio {last:.4f})")
    if len(fixed) > 25:
        logger.info(f"    ... and {len(fixed)-25} more")

    if ambiguous:
        logger.warning(f"  {len(ambiguous)} gap(s) NOT adjusted — no clean ratio, "
                       f"needs a human:")
        for a in ambiguous:
            logger.warning(f"    {a}")

    if not apply:
        logger.warning(f"  DRY RUN — would rewrite {len(payload):,} closes")
        return len(fixed), 0, ambiguous

    written = 0
    for i in range(0, len(payload), WRITE_CHUNK):
        chunk = payload[i:i + WRITE_CHUNK]
        supabase.table("daily_closes").upsert(
            chunk, on_conflict="company_id,date").execute()
        time.sleep(SUPABASE_SLEEP)
        written += len(chunk)
        if written % 5000 < WRITE_CHUNK:
            logger.info(f"    wrote {written:,}/{len(payload):,}")
    logger.success(f"  rewrote {written:,} closes across {len(fixed):,} companies")
    return len(fixed), written, ambiguous


def main() -> int:
    apply = _flag("--apply")
    only = _phase()
    if not apply:
        logger.warning("DRY RUN — pass --apply to write. Nothing is modified.")

    deleted = 0
    if only in (None, 1):
        deleted = phase1(apply)
    companies = rows = 0
    ambiguous: list[str] = []
    if only in (None, 2):
        companies, rows, ambiguous = phase2(apply)

    logger.success("=" * 62)
    logger.success(f"  phantom rows deleted      {deleted:,}")
    logger.success(f"  companies back-adjusted   {companies:,}")
    logger.success(f"  closes rewritten          {rows:,}")
    logger.success(f"  left for manual review    {len(ambiguous):,}")
    logger.success("=" * 62)
    if apply:
        logger.success("NEXT: python scripts/calc_moving_averages.py")
        logger.success("THEN: python scripts/validate_static_data.py")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    sys.exit(main())
