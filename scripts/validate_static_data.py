"""validate_static_data.py — publish gate for the static pages.

A GATE, NOT A REPORT. Exits 0 only when every check passes; exits 1 on any
failure so the calling pipeline halts before publishing. Run it immediately
before publication:

    python scripts/validate_static_data.py && <publish command>

USAGE
    python scripts/validate_static_data.py
    python scripts/validate_static_data.py --update-baseline

CHECKS
    1  row count      distinct company_id in daily_closes within 5% of the
                      active company count
    2  freshness      max(date) in daily_closes is the most recent trading
                      day; weekends and NSE holidays are not failures
    3  null / zero    no daily_closes row has close IS NULL or close <= 0
    4  MA sanity      0.3 * last_close < dma_N < 3.0 * last_close, for each
                      of dma_50 / dma_150 / dma_200 that is not null
    5  drift          no company's dma_200 moved more than 5% since the
                      previous run; skipped on first run
    6  stage coverage every company that will be rendered has a stage

WHY ONE FULL SCAN
    Checks 1 and 3 both need every row of daily_closes: check 1 needs the
    distinct company_id set, check 3 needs every close inspected. PostgREST
    aggregates are disabled on this instance (PGRST123), so COUNT(DISTINCT)
    and a server-side MIN(close) are both unavailable. Rather than scan
    twice, collect() makes one pass and both checks read from it. ~444 pages
    at 1000 rows, roughly three minutes.

    A cheaper approximation exists — sample the last few trading dates and
    union the company_ids — but it silently misses a company whose rows all
    predate the sample window, which is exactly the coverage gap check 1 is
    supposed to catch. A gate that can be fooled is not a gate.

STRUCTURE
    collect()  talks to Supabase and returns a plain dict of facts.
    evaluate() takes those facts and decides pass/fail. It touches no I/O.

    That split is what makes the gate testable: a caller can snapshot real
    facts, corrupt one value, and confirm the corresponding check fails and
    names the offending ticker — without writing bad data to the database.

BASELINE
    public.validation_baseline in Supabase — the previous run's dma_200 per
    company_id, for check 5. See scripts/sql/create_validation_baseline.sql.

    ONE SOURCE OF TRUTH. It was a gitignored file next to this script until
    the file's nature was recognised as the bug: the baseline describes the
    DATABASE, and there is one database, so a per-machine copy is a fork,
    not state. In CI — a fresh runner, no gitignored file — check 5 reported
    "first run" on every run it ever made and compared nothing, while a
    laptop's copy silently drifted from what CI would have seen. Local and
    CI now read and write the same rows.

    It is rewritten ONLY when the whole validation passes. A failed run must
    not overwrite the baseline, or the bad values become next run's reference
    and the drift check waves through the very corruption it exists to catch.

    --update-baseline forces a rewrite regardless. That is the escape hatch
    for a legitimate discontinuity (a backfill, a corporate action sweep),
    it is the only way past a persistent check-5 failure, and it is how an
    empty table gets seeded on first use.

    ABSENT OR STALE IS A FAILURE, NOT A SKIP. A missing baseline used to
    print [SKIP] and pass, which is indistinguishable from the mechanism
    being broken — and it was broken, invisibly, for the whole life of the
    check. It now fails and alerts. A baseline older than three trading days
    alerts too: one that stops updating is the same silent failure in slower
    motion.
"""
from __future__ import annotations

import sys
import time
from datetime import date, datetime, timedelta, timezone

from admin_alert import esc, preflight, send_admin_telegram
from db import supabase
from nse_holidays import is_nse_holiday

# ── Thresholds ──────────────────────────────────────────────────────────
ROW_COUNT_TOLERANCE_PCT = 5.0     # check 1
MA_BAND_LOW = 0.3                 # check 4
MA_BAND_HIGH = 3.0                # check 4

# Check 4's band is a PROXY for "this company's history mixes two price
# scales" — the signature of an unadjusted split. It is not the fault
# itself, and it has a false positive: a stock that genuinely collapses
# 75% inside the MA window pushes its own average past 3x the last close
# with nothing wrong in the data.
#
# NATIONSTD and LEMERITE are exactly that. Their worst sessions are
# -20.0%, -20.0%, -10.0%, -10.0% — NSE circuit limits, hit day after day.
# Legitimately falling, not corrupt.
#
# So the band alone no longer decides. A company only FAILS when it is
# outside the band AND its close series contains a session-over-session
# jump too large to be price action — direct evidence of the scale break
# the band was standing in for. Outside the band with a continuous series
# is reported, not failed.
#
# 0.25 sits just above the widest NSE price band (20%), so normal trading
# can never trip it while a split (typically 50-90%) always does.
CONTINUITY_LIMIT = 0.25
DRIFT_LIMIT_PCT = 5.0             # check 5

MA_COLUMNS = ("dma_50", "dma_150", "dma_200")

# ── Operational constants ───────────────────────────────────────────────
READ_PAGE = 1000                  # PostgREST server-side ceiling
SUPABASE_SLEEP = 0.1
PROGRESS_EVERY = 100              # pages

# How many offending tickers to name before truncating. Naming all of them
# turns a failure into an unreadable wall; naming none makes it undiagnosable.
MAX_NAMED = 20

# IST. The pipeline, the exchange and the trading calendar are all IST, so
# the machine's local timezone must not be allowed to shift the answer.
IST = timezone(timedelta(hours=5, minutes=30))

# Hour (IST) after which today's close is expected to be loaded. NSE closes
# at 15:30; the bhav copy lands and the pipeline runs after that. Before
# this hour on a trading day, the newest data we can fairly demand is the
# PREVIOUS trading day — otherwise the gate fails every morning.
DATA_READY_HOUR_IST = 18

# Rows per write to validation_baseline.
WRITE_CHUNK = 500

# How old the baseline may get before it is called out. Three trading days
# clears any weekend or holiday cluster, so exceeding it means writes have
# stopped rather than merely paused.
BASELINE_MAX_AGE_TRADING_DAYS = 3


def _trading_days_between(start: datetime, end: datetime) -> int:
    """NSE sessions strictly after `start`'s date, up to and including `end`'s.

    Weekend- and holiday-aware, so a Friday baseline read on Monday is one
    trading day old, not three calendar days.
    """
    first = start.astimezone(IST).date()
    last = end.astimezone(IST).date()
    if last <= first:
        return 0
    count = 0
    cursor = first + timedelta(days=1)
    while cursor <= last:
        if cursor.weekday() < 5 and not is_nse_holiday(cursor.isoformat()):
            count += 1
        cursor += timedelta(days=1)
    return count


# ════════════════════════════════════════════════════════════════════════
# Result plumbing
# ════════════════════════════════════════════════════════════════════════
class Check:
    """One check's outcome: a verdict, a headline, and optional detail."""

    def __init__(self, number: int, name: str, passed: bool, headline: str,
                 details: list[str] | None = None, skipped: bool = False):
        self.number = number
        self.name = name
        self.passed = passed
        self.headline = headline
        self.details = details or []
        self.skipped = skipped

    def render(self) -> str:
        if self.skipped:
            verdict = "SKIP"
        else:
            verdict = "PASS" if self.passed else "FAIL"
        lines = [f"[{verdict}] {self.number}. {self.name}: {self.headline}"]
        for d in self.details:
            lines.append(f"         {d}")
        return "\n".join(lines)


def _named(items: list[str]) -> list[str]:
    """Format a ticker list for the detail block, truncated."""
    shown = items[:MAX_NAMED]
    out = [f"  - {s}" for s in shown]
    if len(items) > MAX_NAMED:
        out.append(f"  ... and {len(items) - MAX_NAMED} more")
    return out


# ════════════════════════════════════════════════════════════════════════
# Trading calendar
# ════════════════════════════════════════════════════════════════════════
def is_trading_day(d: date) -> bool:
    """Weekday and not an NSE holiday.

    Note is_nse_holiday() only knows 2026 and returns False for other
    years, so beyond 2026 this degrades to a weekday check until
    nse_holidays.py gains the next year's list.
    """
    if d.weekday() >= 5:
        return False
    return not is_nse_holiday(d.isoformat())


def previous_trading_day(d: date) -> date:
    """The most recent trading day strictly before d."""
    cursor = d - timedelta(days=1)
    # 10 days is ample: the longest NSE closure is a weekend plus a
    # couple of adjacent holidays.
    for _ in range(10):
        if is_trading_day(cursor):
            return cursor
        cursor -= timedelta(days=1)
    return cursor


def expected_latest_session(now_ist: datetime | None = None) -> date:
    """The newest session daily_closes should be expected to contain.

    Today, if today is a trading day AND the market has closed and the
    pipeline has had time to run. Otherwise the previous trading day.
    This is what stops weekends, holidays and pre-market runs from being
    reported as staleness.
    """
    now = now_ist or datetime.now(IST)
    today = now.date()
    if is_trading_day(today) and now.hour >= DATA_READY_HOUR_IST:
        return today
    return previous_trading_day(today)


# ════════════════════════════════════════════════════════════════════════
# Collection — all Supabase I/O lives here
# ════════════════════════════════════════════════════════════════════════
def _paginate(build):
    """Yield every row from a paginated select.

    `build` is called with (start, end) and must return an executable
    query. Ordering must be a TOTAL order, or .range() pagination can
    skip and repeat rows as it advances.
    """
    start = 0
    while True:
        resp = build(start, start + READ_PAGE - 1).execute()
        time.sleep(SUPABASE_SLEEP)
        batch = resp.data or []
        yield batch
        if len(batch) < READ_PAGE:
            return
        start += READ_PAGE


def collect() -> dict:
    """Gather every fact the checks need. No verdicts are formed here."""
    facts: dict = {}

    # ── companies ────────────────────────────────────────────────────
    companies: list[dict] = []
    for batch in _paginate(
        lambda a, b: supabase.table("companies")
        .select("id,symbol,is_suspended,is_index_proxy")
        .order("id")
        .range(a, b)
    ):
        companies.extend(batch)

    # "Active" = tradeable and renderable. Filtered in Python rather than
    # via PostgREST because `neq.true` on a nullable boolean drops NULL
    # rows (NULL <> true is NULL, not true) — the flags are false today,
    # but a future NULL would silently shrink the denominator.
    facts["symbol_by_id"] = {c["id"]: c.get("symbol") or c["id"] for c in companies}
    facts["active_ids"] = {
        c["id"]
        for c in companies
        if c.get("is_suspended") is not True and c.get("is_index_proxy") is not True
    }
    facts["total_companies"] = len(companies)

    print(f"  collected {len(companies):,} companies "
          f"({len(facts['active_ids']):,} active)")

    # ── price_data latest rows ───────────────────────────────────────
    latest: list[dict] = []
    for batch in _paginate(
        lambda a, b: supabase.table("price_data")
        .select("company_id,date,close,stage," + ",".join(MA_COLUMNS))
        .eq("is_latest", True)
        .order("company_id")
        .range(a, b)
    ):
        latest.extend(batch)
    facts["latest_rows"] = latest
    print(f"  collected {len(latest):,} price_data latest rows")

    # ── daily_closes: one full pass, feeding checks 1, 2 and 3 ───────
    # Ordered by (company_id, date) — the primary key, therefore a total
    # order, therefore safe to paginate.
    dc_ids: set[str] = set()
    bad_closes: list[tuple[str, str, object]] = []
    max_date: str | None = None
    total_rows = 0
    page = 0
    # Largest session-over-session move per company, computed in this same
    # pass — the rows already arrive grouped by company and ascending by
    # date, so it costs one float compare per row and no extra queries.
    max_jump: dict[str, float] = {}
    jump_at: dict[str, str] = {}
    prev_cid: str | None = None
    prev_close: float | None = None

    for batch in _paginate(
        lambda a, b: supabase.table("daily_closes")
        .select("company_id,date,close")
        .order("company_id")
        .order("date")
        .range(a, b)
    ):
        for row in batch:
            total_rows += 1
            dc_ids.add(row["company_id"])
            d = row.get("date")
            if d and (max_date is None or d > max_date):
                max_date = d
            raw = row.get("close")
            if raw is None:
                bad_closes.append((row["company_id"], d, None))
                continue
            try:
                val = float(raw)
            except (TypeError, ValueError):
                bad_closes.append((row["company_id"], d, raw))
                continue
            if val != val or val <= 0:  # NaN or non-positive
                bad_closes.append((row["company_id"], d, val))
                continue

            cid = row["company_id"]
            if cid == prev_cid and prev_close and prev_close > 0:
                jump = abs(val - prev_close) / prev_close
                if jump > max_jump.get(cid, 0.0):
                    max_jump[cid] = jump
                    jump_at[cid] = d
            prev_cid, prev_close = cid, val
        page += 1
        if page % PROGRESS_EVERY == 0:
            print(f"  scanned {total_rows:,} daily_closes rows ({page} pages)")

    facts["dc_company_ids"] = dc_ids
    facts["dc_bad_closes"] = bad_closes
    facts["dc_max_date"] = max_date
    facts["dc_total_rows"] = total_rows
    facts["dc_max_jump"] = max_jump
    facts["dc_jump_at"] = jump_at
    print(f"  scanned {total_rows:,} daily_closes rows across "
          f"{len(dc_ids):,} companies ({page} pages)")

    return facts


def load_baseline() -> tuple[dict | None, datetime | None]:
    """(dma_200 per company_id, when it was written) from validation_baseline.

    Returns (None, None) when the table is empty or unreadable. The caller
    treats that as a failure, not a skip — see check_drift.

    A read error is deliberately NOT swallowed into "first run". The old
    file-based version did that, and it is how a broken mechanism passes
    itself off as a fresh one.
    """
    rows: list[dict] = []
    start = 0
    while True:
        try:
            batch = (
                supabase.table("validation_baseline")
                .select("company_id,dma_200,written_at")
                .order("company_id")
                .range(start, start + READ_PAGE - 1)
                .execute()
                .data
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  baseline unreadable ({exc})")
            return None, None
        if not batch:
            break
        rows.extend(batch)
        start += READ_PAGE
        time.sleep(SUPABASE_SLEEP)

    if not rows:
        return None, None

    values = {r["company_id"]: float(r["dma_200"]) for r in rows}
    stamps = [r["written_at"] for r in rows if r.get("written_at")]
    written_at = None
    if stamps:
        try:
            written_at = datetime.fromisoformat(max(stamps).replace("Z", "+00:00"))
        except ValueError:
            written_at = None
    return values, written_at


def save_baseline(facts: dict) -> None:
    """Replace the baseline wholesale with this run's dma_200 values.

    Delete-then-insert rather than upsert: a company that has dropped out
    of the universe must drop out of the baseline too, or its last known
    value lingers forever as a comparison target for a row that no longer
    arrives.
    """
    stamp = datetime.now(IST).isoformat()
    rows = [
        {
            "company_id": row["company_id"],
            "dma_200": float(row["dma_200"]),
            "written_at": stamp,
        }
        for row in facts["latest_rows"]
        if row.get("dma_200") is not None
    ]
    if not rows:
        print("baseline NOT updated - no dma_200 values in this run")
        return

    keep = {r["company_id"] for r in rows}
    existing = load_baseline()[0] or {}
    stale_ids = [cid for cid in existing if cid not in keep]

    for i in range(0, len(rows), WRITE_CHUNK):
        supabase.table("validation_baseline").upsert(
            rows[i:i + WRITE_CHUNK], on_conflict="company_id"
        ).execute()
        time.sleep(SUPABASE_SLEEP)

    for i in range(0, len(stale_ids), WRITE_CHUNK):
        supabase.table("validation_baseline").delete().in_(
            "company_id", stale_ids[i:i + WRITE_CHUNK]
        ).execute()
        time.sleep(SUPABASE_SLEEP)

    dropped = f", {len(stale_ids):,} dropped" if stale_ids else ""
    print(f"baseline updated - {len(rows):,} dma_200 values -> "
          f"validation_baseline{dropped}")


# ════════════════════════════════════════════════════════════════════════
# Checks — pure functions over collected facts
# ════════════════════════════════════════════════════════════════════════
def check_row_count(facts: dict) -> Check:
    active = len(facts["active_ids"])
    distinct = len(facts["dc_company_ids"])

    if active == 0:
        return Check(1, "Row count", False,
                     "no active companies in the companies table")

    delta_pct = abs(distinct - active) / active * 100.0
    passed = delta_pct <= ROW_COUNT_TOLERANCE_PCT

    headline = (
        f"{distinct:,} distinct company_id in daily_closes vs {active:,} "
        f"active companies - {delta_pct:.2f}% apart "
        f"(tolerance {ROW_COUNT_TOLERANCE_PCT:.0f}%)"
    )
    details = []
    missing = facts["active_ids"] - facts["dc_company_ids"]
    if missing:
        names = sorted(facts["symbol_by_id"].get(i, i) for i in missing)
        details.append(f"{len(missing):,} active companies absent from daily_closes:")
        details.extend(_named(names))
    return Check(1, "Row count", passed, headline, details)


def check_freshness(facts: dict, now_ist: datetime | None = None) -> Check:
    expected = expected_latest_session(now_ist)
    actual_raw = facts["dc_max_date"]

    if not actual_raw:
        return Check(2, "Freshness", False, "daily_closes is empty - no max(date)")

    actual = date.fromisoformat(str(actual_raw)[:10])
    today = (now_ist or datetime.now(IST)).date()

    if actual > today:
        return Check(2, "Freshness", False,
                     f"max(date) {actual} is in the FUTURE (today is {today})")

    # Newer than expected is fine — it means the pipeline ran early, not
    # that the data is stale. Only older than expected is a failure.
    passed = actual >= expected
    lag = (expected - actual).days
    headline = (
        f"max(date) = {actual}, most recent trading day = {expected}"
        + ("" if passed else f" - {lag} calendar day(s) stale")
    )
    details = []
    if not passed:
        skipped = []
        cursor = expected
        while cursor > actual and len(skipped) < 8:
            skipped.append(cursor.isoformat())
            cursor = previous_trading_day(cursor)
        if skipped:
            details.append("missing trading session(s): " + ", ".join(reversed(skipped)))
    elif not is_trading_day(today):
        details.append(f"today ({today}) is not a trading day - "
                       f"comparing against the previous session")
    return Check(2, "Freshness", passed, headline, details)


def check_no_null_or_zero(facts: dict) -> Check:
    bad = facts["dc_bad_closes"]
    total = facts["dc_total_rows"]
    nulls = sum(1 for _, _, v in bad if v is None)
    nonpos = len(bad) - nulls
    passed = not bad

    headline = (
        f"{total:,} rows scanned - {nulls:,} with close IS NULL, "
        f"{nonpos:,} with close <= 0"
    )
    details = []
    if bad:
        labels = [
            f"{facts['symbol_by_id'].get(cid, cid)} on {d}: close="
            f"{'NULL' if v is None else v}"
            for cid, d, v in bad
        ]
        details.append("offending rows:")
        details.extend(_named(labels))
    return Check(3, "No nulls or zeros", passed, headline, details)


def check_ma_sanity(facts: dict) -> Check:
    checked = 0
    offenders: list[str] = []
    unusable: list[str] = []
    # Outside the band but with a provably continuous series — a real
    # trend, not corruption. Reported, not failed. See CONTINUITY_LIMIT.
    trending: list[str] = []
    max_jump = facts.get("dc_max_jump", {})
    jump_at = facts.get("dc_jump_at", {})

    for row in facts["latest_rows"]:
        cid = row["company_id"]
        symbol = facts["symbol_by_id"].get(cid, cid)
        present = [c for c in MA_COLUMNS if row.get(c) is not None]
        if not present:
            continue

        raw_close = row.get("close")
        try:
            last_close = float(raw_close) if raw_close is not None else None
        except (TypeError, ValueError):
            last_close = None
        if last_close is None or last_close != last_close or last_close <= 0:
            # Cannot evaluate the band without a usable reference price.
            # That is a failure, not something to quietly skip — the MAs
            # are unverifiable and would ship unchecked.
            unusable.append(f"{symbol}: has {', '.join(present)} but "
                            f"last_close={raw_close}")
            continue

        low, high = MA_BAND_LOW * last_close, MA_BAND_HIGH * last_close
        for col in present:
            checked += 1
            try:
                val = float(row[col])
            except (TypeError, ValueError):
                offenders.append(f"{symbol} {col}={row[col]!r} (not numeric)")
                continue
            if not (low < val < high):
                jump = max_jump.get(cid, 0.0)
                detail = (f"{symbol} {col}={val:,.2f} outside "
                          f"({low:,.2f}, {high:,.2f}), "
                          f"last_close={last_close:,.2f}")
                if jump > CONTINUITY_LIMIT:
                    offenders.append(
                        f"{detail} — {jump*100:.0f}% jump on "
                        f"{jump_at.get(cid, '?')} indicates a scale break"
                    )
                else:
                    trending.append(
                        f"{detail} — series continuous "
                        f"(worst session {jump*100:.0f}%)"
                    )

    passed = not offenders and not unusable
    headline = (
        f"{checked:,} moving averages checked against "
        f"{MA_BAND_LOW}x-{MA_BAND_HIGH}x last_close - "
        f"{len(offenders):,} with a scale break, {len(unusable):,} "
        f"unverifiable, {len(trending):,} wide but continuous"
    )
    details = []
    if offenders:
        details.append("SCALE BREAK — outside band AND the close series "
                       "jumps further than any circuit limit allows:")
        details.extend(_named(offenders))
    if unusable:
        details.append("unverifiable (no usable last_close):")
        details.extend(_named(unusable))
    if trending:
        details.append("outside band but NOT a fault — these fell hard "
                       "inside the MA window with no discontinuity:")
        details.extend(_named(trending))
    return Check(4, "MA sanity", passed, headline, details)


def check_drift(facts: dict, baseline: dict | None,
                written_at: datetime | None = None,
                now_ist: datetime | None = None) -> Check:
    # ── ABSENT IS A FAILURE ─────────────────────────────────────────────
    # This used to return skipped=True and pass. That is indistinguishable
    # from the mechanism being broken — and it WAS broken: the baseline
    # lived in a gitignored file, so every CI run reported "first run" and
    # compared nothing, for the entire life of the check. A gate that
    # cannot tell "nothing to compare" from "comparison is broken" is not
    # a gate. Seeding an empty table is a one-off --update-baseline.
    if baseline is None:
        return Check(
            5, "Day-over-day drift", False,
            "NO BASELINE in validation_baseline - the drift check cannot run",
            details=[
                "this is either a first run or the baseline mechanism is broken;",
                "both need a human, so neither is allowed to pass silently.",
                "apply scripts/sql/create_validation_baseline.sql if the table "
                "is missing, then seed it with:",
                "  python scripts/validate_static_data.py --update-baseline",
            ],
        )

    # ── STALE IS AN ALERT ───────────────────────────────────────────────
    # A baseline that stops updating fails the same way as one that never
    # existed, just slowly: comparisons keep succeeding against a reference
    # drifting further from reality every day. Three trading days is past
    # any single weekend or holiday cluster, so it means writes stopped.
    stale_note: list[str] = []
    if written_at is not None:
        age = _trading_days_between(written_at, now_ist or datetime.now(IST))
        if age > BASELINE_MAX_AGE_TRADING_DAYS:
            stale_note = [
                f"BASELINE IS STALE: last written {written_at.date().isoformat()}, "
                f"{age} trading days ago (limit {BASELINE_MAX_AGE_TRADING_DAYS}).",
                "comparisons below are against an old reference — baseline "
                "writes have stopped.",
            ]

    compared = 0
    offenders: list[str] = []
    for row in facts["latest_rows"]:
        cid = row["company_id"]
        current = row.get("dma_200")
        prev = baseline.get(cid)
        if current is None or prev is None:
            continue
        try:
            cur_f, prev_f = float(current), float(prev)
        except (TypeError, ValueError):
            continue
        if prev_f == 0:
            continue
        compared += 1
        move = abs(cur_f - prev_f) / abs(prev_f) * 100.0
        if move > DRIFT_LIMIT_PCT:
            symbol = facts["symbol_by_id"].get(cid, cid)
            offenders.append(
                f"{symbol} dma_200 {prev_f:,.2f} -> {cur_f:,.2f} ({move:+.2f}%)"
            )

    passed = not offenders
    age_note = " [STALE BASELINE]" if stale_note else ""
    headline = (
        f"{compared:,} companies compared against baseline - "
        f"{len(offenders):,} moved more than {DRIFT_LIMIT_PCT:.0f}%{age_note}"
    )
    # Staleness is reported but does not by itself fail the gate: an old
    # reference still catches a rewritten series, and blocking publication
    # over the age of a bookkeeping row would be the wrong trade. It raises
    # its own alert from main() instead.
    details = list(stale_note)
    if offenders:
        # A 200-day average shifts by (new_close - dropped_close) / 200 per
        # session, so a >5% jump is arithmetically almost impossible from
        # real price action. It means the input series changed, not the price.
        details.append("a 200-day average cannot move this much in one "
                       "session from price action alone:")
        details.extend(_named(offenders))
        details.append("if this is a legitimate backfill or corporate-action "
                       "sweep, re-run with --update-baseline")
    return Check(5, "Day-over-day drift", passed, headline, details)


def check_stage_coverage(facts: dict) -> Check:
    renderable = 0
    missing: list[str] = []
    for row in facts["latest_rows"]:
        cid = row["company_id"]
        if cid not in facts["active_ids"]:
            continue  # suspended or an index proxy - never rendered
        renderable += 1
        stage = row.get("stage")
        if stage is None or (isinstance(stage, str) and not stage.strip()):
            missing.append(facts["symbol_by_id"].get(cid, cid))

    passed = not missing
    headline = (
        f"{renderable:,} renderable companies - {len(missing):,} with a "
        f"null or empty stage"
    )
    details = []
    if missing:
        details.append("missing stage:")
        details.extend(_named(sorted(missing)))

    # Active companies with no latest price_data row at all cannot render.
    # Informational: check 1 is what fails on a genuine coverage gap.
    no_row = len(facts["active_ids"]) - renderable
    if no_row > 0:
        details.append(f"note: {no_row:,} active companies have no "
                       f"is_latest price_data row and will not render")
    return Check(6, "Stage coverage", passed, headline, details)


def evaluate(facts: dict, baseline: dict | None,
             now_ist: datetime | None = None,
             baseline_written_at: datetime | None = None) -> tuple[list[Check], int]:
    """Run every check. Returns (results, exit_code). Performs no I/O."""
    results = [
        check_row_count(facts),
        check_freshness(facts, now_ist),
        check_no_null_or_zero(facts),
        check_ma_sanity(facts),
        check_drift(facts, baseline, baseline_written_at, now_ist),
        check_stage_coverage(facts),
    ]
    failed = sum(1 for c in results if not c.passed and not c.skipped)
    return results, (1 if failed else 0)


# ════════════════════════════════════════════════════════════════════════
# WHY A FAILURE HAS TO SPEAK UP
#   This is the publish gate: a non-zero exit skips generation and publish
#   in .github/workflows/daily.yml, and the previously published page stays
#   live. That is the correct behaviour — shipping wrong numbers is worse
#   than shipping yesterday's. But the workflow's other jobs still succeed,
#   the Telegram broadcast still goes out, and the only trace is a failed
#   job nobody opens. In August 2026 that combination held the screener on
#   4 Aug for six days while every other part of the site moved on.
#
#   Silence is the bug. The refusal to publish is not.
#
# Best-effort by construction: admin_alert never raises, and the exit code
# is decided before this runs, so an alert failure cannot turn a failing
# gate into a passing one — or the reverse.
MAX_ALERT_DETAILS = 6


def alert_failure(results: list[Check]) -> None:
    """Telegram the operator which checks failed and why."""
    broken = [c for c in results if not c.passed and not c.skipped]
    if not broken:
        return

    lines = [
        "<b>PUBLISH GATE FAILED</b>",
        f"{len(broken)} check{'s' if len(broken) != 1 else ''} failed — "
        "the static screener will NOT publish. The live page keeps "
        "yesterday's data until this clears.",
        "",
    ]
    for check in broken:
        lines.append(f"<b>{check.number}. {esc(check.name)}</b>")
        lines.append(esc(check.headline))
        # The offender list is the actionable part — which ticker, which
        # column — but it can run to dozens of lines, so it is capped here
        # and left complete in the run log.
        for detail in (check.details or [])[:MAX_ALERT_DETAILS]:
            lines.append(f"  {esc(detail.strip())}")
        remaining = len(check.details or []) - MAX_ALERT_DETAILS
        if remaining > 0:
            lines.append(f"  … and {remaining} more — see the run log")
        lines.append("")

    lines.append(
        "An unadjusted split is the usual cause. Check the newest "
        "corporate_actions rows, then:"
    )
    lines.append("<code>python scripts/fix_split_adjustments.py</code>")

    if not send_admin_telegram("\n".join(lines), source="validate_static_data"):
        print("admin alert NOT delivered — failure is visible only in this log")


def alert_stale_baseline(written_at: datetime, age: int) -> None:
    """Separate alert for a baseline that has stopped updating.

    Not folded into alert_failure because staleness does not fail the gate.
    It is the quieter failure — everything keeps passing while the reference
    rots — so it needs its own way out.
    """
    send_admin_telegram(
        "\n".join([
            "<b>DRIFT BASELINE IS STALE</b>",
            f"validation_baseline was last written "
            f"<b>{esc(written_at.date().isoformat())}</b> — {age} trading days "
            f"ago (limit {BASELINE_MAX_AGE_TRADING_DAYS}).",
            "",
            "The gate is still passing, which is the problem: check 5 is "
            "comparing today against an increasingly old reference, so a "
            "rewritten price series would slip past it.",
            "",
            "The baseline is written only on a clean pass, so this usually "
            "means the gate has been failing on some other check for days, "
            "or the write is erroring.",
        ]),
        source="validate_static_data",
    )


# ════════════════════════════════════════════════════════════════════════
def main() -> int:
    force_baseline = "--update-baseline" in sys.argv

    print("=" * 72)
    print("STATIC DATA VALIDATION")
    print("=" * 72)

    # Verify the alert channel BEFORE doing the work. If the gate is about
    # to fail and Telegram is misconfigured, this is the line that says so —
    # on a good day as well as a bad one, which is the only way a broken
    # alerting path gets noticed before it is needed.
    preflight("validate_static_data")

    facts = collect()
    baseline, baseline_written_at = load_baseline()
    now_ist = datetime.now(IST)

    print()
    results, exit_code = evaluate(facts, baseline, now_ist, baseline_written_at)
    for check in results:
        print(check.render())

    failed = sum(1 for c in results if not c.passed and not c.skipped)
    print()
    if failed == 0:
        print("VALIDATION PASSED")
    else:
        print(f"VALIDATION FAILED — {failed} check{'s' if failed != 1 else ''} failed")
        alert_failure(results)

    # Staleness rides alongside the pass/fail verdict rather than inside it:
    # the run can be perfectly clean and the baseline still rotting.
    if baseline_written_at is not None:
        age = _trading_days_between(baseline_written_at, now_ist)
        if age > BASELINE_MAX_AGE_TRADING_DAYS:
            print(f"baseline is STALE - last written "
                  f"{baseline_written_at.date().isoformat()}, {age} trading days ago")
            alert_stale_baseline(baseline_written_at, age)

    # The baseline is refreshed only on a clean run. Rewriting it after a
    # failure would make today's bad numbers tomorrow's reference point,
    # and check 5 would then wave through the corruption it exists to catch.
    if failed == 0 or force_baseline:
        save_baseline(facts)
        if failed and force_baseline:
            print("baseline force-updated despite failures (--update-baseline)")
    else:
        print("baseline NOT updated - validation failed")

    return exit_code


if __name__ == "__main__":
    # The Windows console defaults to cp1252, which cannot encode the em-dash
    # the summary line requires.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    sys.exit(main())
