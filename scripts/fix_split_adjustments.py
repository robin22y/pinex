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
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction

from loguru import logger

from db import supabase
from nse_holidays import NSE_HOLIDAYS_2026

READ_PAGE = 1000
WRITE_CHUNK = 500
SUPABASE_SLEEP = 0.1

# A gap this large cannot be price action under NSE circuit limits.
GAP_THRESHOLD = 0.30

# How far the observed ratio may sit from a candidate fraction and still be
# accepted as that corporate action.
#
# Tightened from 0.10 when the candidate set below was derived properly.
# The two are a pair: a sparse hand-written list needs a loose tolerance to
# catch anything, and a loose tolerance on a DENSE set would snap almost
# any number to something. A principled set wants a strict tolerance — and
# the real actions land far inside it (AHCL 0.67%, MAHAPEXLTD 0.09%).
SNAP_TOLERANCE = 0.04

# ── Rails on a HAND-RECORDED ratio ──────────────────────────────────────
# Both are looser than SNAP_TOLERANCE because this is a confirmation, not
# a search: an operator read the exchange notice, so we already know which
# action occurred and only need to tell a ratio from its inverse.
#
# The widest residual the WINNING candidate may carry and still be
# believed. A genuine action can sit well off the observed gap when the
# stock moved hard across the event. TEMBO's 1:10 on 2026-08-05 is the
# case that forced this constant into existence: the exchange notice says
# the factor is exactly 1/10, but 2026-08-03 560.40
# -> 2026-08-05 65.90 observes 0.1176, 17.6% out, because the stock
# rallied through the split. Under the old flat 15% rail that authoritative
# ratio was rejected and the publish gate stayed shut for six days.
#
# One NSE session can legitimately move 20% and a gap may span more than
# one, so a residual inside 30% is price action. Past that the recorded
# ratio and the price series genuinely disagree — a typo, the wrong date,
# or an action that never reached this data — and it is still refused.
RECORDED_MAX_RESIDUAL = 0.30

# How decisively the winner must beat its inverse for the ORIENTATION to
# count as settled. TEMBO wins 0.176 against 0.988 — 5.6x, never in doubt.
# Two candidates within this factor of each other means the ratio sits
# close enough to 1 that it cannot be told from its inverse, which is the
# precise thing resolve_recorded exists to prevent, so that is refused too.
RECORDED_ORIENTATION_MARGIN = 3.0

# Refuse to delete more than this share of the table — a bug in the
# holiday list should not be able to empty it.
MAX_DELETE_FRACTION = 0.10

# Sanity rail on the cumulative rescale. Several stacked splits are
# legitimate; a factor past this means detection went wrong.
MAX_CUMULATIVE = 1e4
MIN_CUMULATIVE = 1e-4

# ── Candidate ratios, DERIVED rather than listed ────────────────────────
# The first version of this was a hand-written list of "ratios that look
# like a split". It missed two real actions in the very first run:
#
#   AHCL        observed 0.1104 — bonus 8:1, i.e. 1/9   (list had 1/8, 1/10)
#   MAHAPEXLTD  observed 0.4448 — bonus 5:4, i.e. 4/9   (list had nothing near)
#
# Both are BONUS issues, and a bonus does not produce 1/n. A bonus a:b
# gives `a` new shares for every `b` held, so `b` shares become `a + b`
# and the price scales by b/(a+b) — which generates 1/9, 4/9, 2/5, 3/7 and
# a long tail the hand-written list could never have anticipated.
#
# So the set is generated from the two mechanics that actually exist:
#   SPLIT 1:n      face value divided n ways        -> 1/n
#   BONUS a:b      b shares become a+b              -> b/(a+b)
# plus the inverse of each, which covers reverse splits / consolidations.
_SPLITS = {Fraction(1, n) for n in range(2, 101)}
_BONUSES = {Fraction(b, a + b) for a in range(1, 13) for b in range(1, 13)}
_BASE = _SPLITS | _BONUSES
RATIOS = sorted(_BASE | {1 / f for f in _BASE})


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


def load_recorded_actions() -> dict[tuple[str, str], dict]:
    """Splits and bonuses recorded by hand in `corporate_actions`.

    Keyed (company_id, action_date). These are AUTHORITATIVE: when an
    operator has recorded an action, its ratio is used instead of the
    heuristic snap, because a human reading the exchange notice knows
    things the price series cannot tell us — a 3:1 bonus and a 1:4 split
    both quarter the price.

    The table is populated two ways: fetch_bhav_daily parses NSE's bhav
    corporate-actions file into it nightly, and AdminStockEdit inserts
    rows manually. Only split/bonus rows with a ratio are read here;
    dividends do not rescale a price series.
    """
    rows: list[dict] = []
    for batch in _paginate(
        lambda a, b: supabase.table("corporate_actions")
        .select("company_id,symbol,action_type,action_date,ratio,notes,applied")
        .order("id").range(a, b)
    ):
        rows.extend(batch)

    out: dict[tuple[str, str], dict] = {}
    skipped_no_ratio = 0
    for r in rows:
        kind = str(r.get("action_type") or "").strip().lower()
        # "rights" is here because a rights issue DOES rescale the series —
        # Yahoo and every data vendor back-adjust for one. It is absent from
        # the inference path on purpose: the factor is TERP/cum-price, which
        # depends on the subscription price and cannot be read off the gap.
        # But when an operator has worked it out and recorded it, refusing
        # to use it would leave a known-good number on the floor.
        if kind not in ("split", "bonus", "stock_split", "consolidation", "rights"):
            continue
        if r.get("ratio") in (None, ""):
            skipped_no_ratio += 1
            continue
        try:
            ratio = float(r["ratio"])
        except (TypeError, ValueError):
            skipped_no_ratio += 1
            continue
        if ratio <= 0 or ratio == 1:
            skipped_no_ratio += 1
            continue
        date_key = str(r.get("action_date") or "")[:10]
        if not date_key or not r.get("company_id"):
            continue
        out[(r["company_id"], date_key)] = {
            "ratio": ratio, "kind": kind,
            "symbol": r.get("symbol"), "applied": bool(r.get("applied")),
        }

    logger.info(
        f"corporate_actions: {len(rows):,} rows, {len(out):,} usable "
        f"split/bonus entries, {skipped_no_ratio:,} without a usable ratio"
    )
    return out


def resolve_recorded(ratio: float, observed: float) -> float | None:
    """Turn a recorded ratio into a price factor, checked against reality.

    The operator can reasonably write EITHER convention for a 1:10 split:
    `10` ("one becomes ten") or `0.1` (the price factor). Guessing wrong
    inverts the adjustment and multiplies a decade of closes by 100 in the
    wrong direction, so this does not guess — it takes whichever of the
    two candidates matches the gap the prices ACTUALLY show on that date.

    Returns None when neither matches, which means the recorded ratio and
    the price series disagree: a typo, the wrong date, or an action that
    never reached this data. Those are reported, never applied.

    WHY THIS PICKS A WINNER INSTEAD OF TAKING THE FIRST CLEAN MATCH
      The question here is orientation, not identity — an operator read the
      exchange notice, so WHICH action occurred is already known and only
      its convention is in doubt. Scoring both candidates and taking the
      better one answers that question directly. The previous version
      instead demanded that some candidate land inside a flat 15% band,
      which conflates two different things: how well the series confirms
      the ratio, and how much the stock moved across the event. A real
      1:10 on a stock that rallied 17.6% through its split failed that
      test with the correct ratio sitting right there (see TEMBO under
      RECORDED_MAX_RESIDUAL).

      Both rails still hold. The winner must be plausible in absolute
      terms, and it must beat its inverse decisively — so a ratio too near
      1 to orient is refused rather than guessed at, exactly as before.
    """
    scored: list[tuple[float, float]] = []
    for candidate in (ratio, 1.0 / ratio):
        if candidate <= 0:
            continue
        scored.append((abs(observed - candidate) / candidate, candidate))
    if not scored:
        return None
    scored.sort()

    best_err, best = scored[0]
    if best_err > RECORDED_MAX_RESIDUAL:
        return None
    # A single candidate (ratio was its own inverse) has nothing to be
    # ambiguous against, so the margin test only applies when there are two.
    if len(scored) > 1:
        runner_err = scored[1][0]
        if runner_err < best_err * RECORDED_ORIENTATION_MARGIN:
            return None
    return best


def _missing_sessions(d0: str, d1: str) -> list[str]:
    """NSE trading days strictly between two dates that the series lacks.

    Weekday-and-holiday aware, so a Friday->Monday step is correctly empty
    and only a genuinely absent session is reported. Empty list means the
    two rows are truly adjacent and a gap between them is safe to reason
    about.
    """
    start = date.fromisoformat(d0)
    end = date.fromisoformat(d1)
    gap: list[str] = []
    cursor = start + timedelta(days=1)
    while cursor < end:
        iso = cursor.isoformat()
        if cursor.weekday() < 5 and iso not in NSE_HOLIDAYS_2026:
            gap.append(iso)
        cursor += timedelta(days=1)
    return gap


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
    recorded = load_recorded_actions()
    series = load_series()

    payload: list[dict] = []
    fixed: list[tuple[str, int, float]] = []
    ambiguous: list[str] = []
    used_records: list[tuple[str, str]] = []   # (company_id, date) to mark applied
    record_conflicts: list[str] = []

    for cid, rows in series.items():
        sym = symbols.get(cid, cid)
        events: list[tuple[str, float]] = []   # (first new-scale date, factor)
        for i in range(1, len(rows)):
            (_d0, c0), (d1, c1) = rows[i - 1], rows[i]
            if c0 <= 0 or c1 <= 0:
                continue
            ratio = c1 / c0
            if abs(1 - ratio) < GAP_THRESHOLD:
                continue

            # A recorded action for this date wins: a human read the
            # exchange notice, and 1:4 split vs 3:1 bonus are
            # indistinguishable from the price gap alone.
            rec = recorded.get((cid, d1))
            if rec:
                factor = resolve_recorded(rec["ratio"], ratio)
                if factor is None:
                    record_conflicts.append(
                        f"{sym} {d1}: recorded {rec['kind']} ratio "
                        f"{rec['ratio']:g} matches neither the observed gap "
                        f"{ratio:.4f} nor its inverse — not applied"
                    )
                else:
                    events.append((d1, factor))
                    used_records.append((cid, d1))
                    continue
                continue

            # ── MISSING SESSIONS DISQUALIFY INFERENCE ───────────────────
            # Gap detection rests on one premise: NSE price bands cap a
            # single session at 20%, so a 44% move between ADJACENT rows
            # cannot be price action and must be a corporate action. The
            # premise holds only if the two rows really are adjacent.
            #
            # On 2026-08-10 they were not. daily_closes had lost 2026-07-31
            # and 2026-08-04 entirely, so two legitimate 20% sessions
            # collapsed into one apparent 44% jump and this code invented
            # corporate actions for MOREPENLAB, RSDFIN and UEL that do not
            # exist — rescaling 410 closes of correct history. NSE confirms
            # no action for any of the three.
            #
            # A hole is therefore not a detail to note, it is grounds to
            # refuse: with a session missing, the observed ratio is the
            # product of an unknown number of days and means nothing. A
            # RECORDED action is unaffected and still applies above — this
            # guard sits on the inference path alone.
            skipped_sessions = _missing_sessions(_d0, d1)
            if skipped_sessions:
                ambiguous.append(
                    f"{sym} {_d0} {c0:,.2f} -> {d1} {c1:,.2f} "
                    f"(ratio {ratio:.4f}) — {len(skipped_sessions)} trading "
                    f"session(s) missing between them "
                    f"({', '.join(skipped_sessions[:3])}"
                    f"{'…' if len(skipped_sessions) > 3 else ''}); refusing to "
                    f"infer across a hole — backfill the session(s) first"
                )
                continue

            frac, err = snap(ratio)
            if frac is None:
                ambiguous.append(
                    f"{sym} {_d0} {c0:,.2f} -> {d1} {c1:,.2f} "
                    f"(ratio {ratio:.4f}, nearest off by {err*100:.0f}%) "
                    f"— record it in corporate_actions to resolve"
                )
                continue
            events.append((d1, float(frac)))

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

    if used_records:
        logger.success(f"  {len(used_records):,} adjustment(s) taken from "
                       f"corporate_actions rather than inferred")

    if record_conflicts:
        logger.error(
            f"  {len(record_conflicts)} recorded action(s) DISAGREE with the "
            f"price series — a typo, the wrong date, or an action this data "
            f"never saw. Not applied:")
        for c in record_conflicts:
            logger.error(f"    {c}")

    if ambiguous:
        logger.warning(f"  {len(ambiguous)} gap(s) NOT adjusted — no clean ratio, "
                       f"needs a human:")
        for a in ambiguous:
            logger.warning(f"    {a}")

    if not apply:
        logger.warning(f"  DRY RUN — would rewrite {len(payload):,} closes")
        return len(fixed), 0, ambiguous + record_conflicts

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

    # Mark the recorded actions we actually used, so a re-run does not
    # re-report them and an operator can see at a glance which entries
    # have reached the price series. Only flipped AFTER the writes land —
    # marking first would lie if the upsert failed.
    marked = 0
    for cid, action_date in used_records:
        try:
            supabase.table("corporate_actions").update(
                {"applied": True, "applied_at": datetime.now(timezone.utc).isoformat()}
            ).eq("company_id", cid).eq("action_date", action_date).execute()
            time.sleep(SUPABASE_SLEEP)
            marked += 1
        except Exception as exc:
            logger.warning(f"  could not mark {cid} {action_date} applied: {exc}")
    if marked:
        logger.success(f"  marked {marked:,} corporate_actions row(s) applied")

    return len(fixed), written, ambiguous + record_conflicts


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
