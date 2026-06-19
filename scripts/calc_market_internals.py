"""
calc_market_internals.py
Calculates market breadth, stage distribution,
52W highs/lows, and divergence signals daily.
Runs after fetch_price_data.py completes.
"""

import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import yfinance as yf

from nse_holidays import NSE_HOLIDAYS_2026
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

TODAY = date.today().isoformat()


def _skip_reason_for_daily_update() -> str | None:
    if "--force" in sys.argv:
        print("FORCE MODE — skipping market closed check")
        return None
    t = date.today()
    if t.weekday() >= 5:
        return "Market closed — skipping market internals update"
    if t.isoformat() in NSE_HOLIDAYS_2026:
        return "NSE holiday — skipping market internals update"
    return None


# ─────────────────────────────────────────
# FETCH DATA FROM PRICE_DATA TABLE
# ─────────────────────────────────────────

def fetch_latest_price_data():
    """Get today's latest row per company.

    CRITICAL: paginate. PostgREST caps a single request at 1000 rows; without
    .range() the breadth feed silently used only ~half the ~2125 stocks, so
    above_ma150_pct / above_ma30w_pct / stage-distribution were computed off
    less than 50% of the universe and read low. WHY ma30w/ma150 both: ma30w
    is the true Weinstein breadth (30-week MA); ma150 is the daily 150-day MA.
    Both are published so the frontend can show above_ma150_pct AND
    above_ma30w_pct.
    """
    print("Fetching latest price data...")
    out: list[dict] = []
    page = 1000
    start = 0
    while True:
        res = supabase.table("price_data")\
            .select("company_id,date,close,ma20,ma50,ma150,ma30w,"
                    "stage,obv_slope,high_52w,low_52w,rsi")\
            .eq("is_latest", True)\
            .range(start, start + page - 1)\
            .execute()
        batch = list(res.data or [])
        out.extend(batch)
        if len(batch) < page:
            break
        start += page
    print(f"  Found {len(out)} companies with price data")
    return out


def has_price_data_for_date(d: str) -> bool:
    """True if any price_data row exists for the given date.

    WHY: On weekends and NSE holidays no fetch runs, so price_data
    has no new rows. If we then upsert a market_internals row with
    breadth recomputed from yesterday's `is_latest` rows but stamped
    with TODAY, the breadth values are valid for yesterday but the
    `date` column lies. Worse, if any column (above_ma150, ma150)
    is NULL for the bulk of rows the breadth comes out near 0 and
    SwingX's condition-10 check (>=35%) fails for the entire market.
    We use this to skip writing breadth fields on non-trading days
    so the last real trading day's row remains the latest with
    non-zero breadth.
    """
    try:
        res = (
            supabase.table("price_data")
            .select("id", count="exact")
            .eq("date", d)
            .limit(1)
            .execute()
        )
        return (res.count or 0) > 0
    except Exception:
        return False


def _to_float(v):
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_previous_close_by_company(latest_date_str: str, company_ids: list[str]) -> dict[str, float]:
    """Map company_id -> prior session close by walking back calendar days."""
    if not company_ids or not latest_date_str:
        return {}
    d = date.fromisoformat(str(latest_date_str)[:10])
    need = max(50, int(len(company_ids) * 0.25))
    prev_map: dict[str, float] = {}
    for back in range(1, 15):
        probe = (d - timedelta(days=back)).isoformat()
        prev_map.clear()
        chunk_size = 500
        for i in range(0, len(company_ids), chunk_size):
            chunk = company_ids[i : i + chunk_size]
            try:
                res = (
                    supabase.table("price_data")
                    .select("company_id,close")
                    .eq("date", probe)
                    .in_("company_id", chunk)
                    .execute()
                )
            except Exception:
                continue
            for r in res.data or []:
                cid = r.get("company_id")
                c = _to_float(r.get("close"))
                if cid is not None and c is not None:
                    prev_map[str(cid)] = c
        if len(prev_map) >= need:
            print(f"  Prior closes: {len(prev_map)} names @ {probe}")
            return prev_map
    print(f"  Prior closes: sparse ({len(prev_map)}), using partial map")
    return prev_map


def calc_advance_decline(rows: list[dict], prev_by_company: dict[str, float]):
    """Advances / declines from latest close vs prior session close."""
    advances = 0
    declines = 0
    for r in rows:
        cid = r.get("company_id")
        if cid is None:
            continue
        cur = _to_float(r.get("close"))
        prev = prev_by_company.get(str(cid))
        if cur is None or prev is None:
            continue
        if cur > prev:
            advances += 1
        elif cur < prev:
            declines += 1
    if declines > 0:
        ratio = round(advances / declines, 2)
    elif advances > 0:
        ratio = None
    else:
        ratio = None
    return advances, declines, ratio


def fetch_all_latest_price_rows_for_metrics() -> list[dict]:
    """All is_latest rows: close / 52W / optional prev_close (for A/D).

    CRITICAL: paginate. PostgREST caps a single request at 1000 rows, so an
    un-ranged fetch silently returned only ~half the ~2125 stocks — meaning
    breadth, advances/declines and 52W new-highs/lows were being computed on
    less than 50% of the universe.
    """
    for cols in ("close,high_52w,low_52w,prev_close", "close,high_52w,low_52w"):
        try:
            out: list[dict] = []
            page = 1000
            start = 0
            while True:
                res = (
                    supabase.table("price_data")
                    .select(cols)
                    .eq("is_latest", True)
                    .range(start, start + page - 1)
                    .execute()
                )
                batch = list(res.data or [])
                out.extend(batch)
                if len(batch) < page:
                    break
                start += page
            return out
        except Exception:
            continue
    return []


def compute_52w_highs_lows_and_ad(all_latest: list[dict]):
    """Counts from latest snapshot; A/D uses prev_close when column populated."""
    # HOW IT'S DERIVED
    #   new_52w_highs = # stocks where today's close ≥ 99 %
    #                   of their 52-week high (1 % buffer
    #                   so near-misses aren't excluded).
    #   new_52w_lows  = # stocks where today's close ≤ 101 %
    #                   of their 52-week low.
    #   advances      = # stocks with close > prev_close.
    #   declines      = # stocks with close < prev_close.
    #   ad_ratio      = advances / declines  (Nones when 0).
    new_highs = sum(
        1
        for r in all_latest
        if r.get("close") is not None and r.get("high_52w") is not None
        and float(r["close"]) >= float(r["high_52w"]) * 0.99
    )
    new_lows = sum(
        1
        for r in all_latest
        if r.get("close") is not None and r.get("low_52w") is not None
        and float(r["close"]) <= float(r["low_52w"]) * 1.01
    )
    advances = sum(
        1
        for r in all_latest
        if r.get("close") is not None and r.get("prev_close") is not None
        and float(r["close"]) > float(r["prev_close"])
    )
    declines = sum(
        1
        for r in all_latest
        if r.get("close") is not None and r.get("prev_close") is not None
        and float(r["close"]) < float(r["prev_close"])
    )
    ad_ratio = round(advances / declines, 2) if declines > 0 else None
    return new_highs, new_lows, advances, declines, ad_ratio


def recompute_52w_highs_lows_from_history(
    all_latest: list[dict] | None = None,
    days: int = 365,
) -> tuple[int, int] | None:
    """DEPRECATED FOR THE DAILY PATH — kept for ad-hoc recovery only.

    No longer called by the main calc_market_internals flow. Removed
    after two production incidents where it produced wrong numbers
    silently:
      - Companies missing from the 365-day window (new listings,
        pagination bail-outs) were skipped without surfacing — the
        skip-rate guard added 19 Jun 2026 made this loud but didn't
        eliminate the underlying brittleness.
      - The output never matched NSE's published count exactly.
    The daily path is now NSE-direct only (live API + MW52 CSV).
    Re-enable this function only if you're doing a one-shot recovery
    on a day NSE was unreachable AND you accept the homegrown count
    won't equal NSE's.

    Recompute new_52w_highs / new_52w_lows directly from price_data
    history — bypasses the per-row high_52w/low_52w columns which get
    stale between backfill runs.

    Logic (per company):
      prior_max = MAX(close) over the trailing `days` days, EXCLUDING
                  today's row.
      prior_min = MIN(close) over the same window.
      new_high  = today_close >= prior_max
      new_low   = today_close <= prior_min

    Returns (new_highs, new_lows) or None on fetch failure (caller
    keeps the snapshot-based count). NOT a no-buffer port of the
    99 %/101 % heuristic in compute_52w_highs_lows_and_ad() — this is
    the strict "actually a new 52W high today" count, which is what
    Robin's Telegram broadcast quotes.

    PERFORMANCE
      Universe is ~2,100 companies × ~252 trading days = ~530k rows.
      We paginate 1k rows per call to stay under PostgREST's default
      response cap. Wall time ~15-30 s on the prod Supabase pool. Cron
      runs this once per day, so the latency is tolerable.

    PARAMETER `all_latest`
      Kept for backwards-compat but no longer used — earlier versions
      tried to key today_close off this dict, but
      fetch_all_latest_price_rows_for_metrics() selects only
      (close, high_52w, low_52w, prev_close) without company_id, so the
      lookup silently produced an empty dict and the function returned
      None on every run. Today's per-company close is now fetched
      inline from price_data WHERE is_latest = true.
    """
    from datetime import date as _date, timedelta
    from collections import defaultdict

    print("  52W on-the-fly recompute: starting...")

    # ── today_close per company — keyed by company_id, fetched inline ─
    today_close: dict = {}
    start = 0
    page = 1000
    while True:
        try:
            res = (
                supabase.table("price_data")
                .select("company_id,close")
                .eq("is_latest", True)
                .range(start, start + page - 1)
                .execute()
            )
            rows = getattr(res, "data", None) or []
        except Exception as e:
            print(f"  52W on-the-fly recompute: today fetch failed at offset {start}: {e}")
            return None
        if not rows:
            break
        for r in rows:
            cid = r.get("company_id")
            close = r.get("close")
            if cid is not None and close is not None:
                try:
                    today_close[cid] = float(close)
                except (TypeError, ValueError):
                    continue
        if len(rows) < page:
            break
        start += page
    if not today_close:
        print("  52W on-the-fly recompute: no today (is_latest) rows found.")
        return None
    print(f"  52W on-the-fly recompute: today_close has {len(today_close):,} companies.")

    today = _date.today()
    start_date = (today - timedelta(days=days)).isoformat()
    end_date   = today.isoformat()

    prior_max: dict[int, float] = defaultdict(lambda: float("-inf"))
    prior_min: dict[int, float] = defaultdict(lambda: float("inf"))

    start = 0
    page  = 1000
    fetched = 0
    while True:
        try:
            res = (
                supabase.table("price_data")
                .select("company_id,close")
                .gt("date", start_date)
                .lt("date", end_date)
                .range(start, start + page - 1)
                .execute()
            )
            rows = getattr(res, "data", None) or []
        except Exception as e:
            print(f"  recompute_52w_highs_lows: history fetch failed at offset {start}: {e}")
            return None
        if not rows:
            break
        for r in rows:
            cid = r.get("company_id")
            close = r.get("close")
            if cid is None or close is None:
                continue
            c = float(close)
            if c > prior_max[cid]: prior_max[cid] = c
            if c < prior_min[cid]: prior_min[cid] = c
        fetched += len(rows)
        if len(rows) < page:
            break
        start += page

    if fetched == 0:
        print(f"  recompute_52w_highs_lows: no history rows between {start_date} and {end_date}.")
        return None

    # ── Coverage sanity check ─────────────────────────────────────────
    # A "skipped" company is one we have today_close for, but whose
    # 365-day history window came back empty (defaultdict still at
    # -inf). The original code just continued past these companies
    # silently — so on a day when the recompute query hit a Supabase
    # row-limit or timeout for some company, that company was just
    # NOT counted toward new highs. Today's 19 Jun 2026 wrong-data
    # broadcast traced partly to this: the recompute fell back to
    # tier-3 because NSE was flaky, and the recompute under-counted
    # by hundreds of companies without saying anything.
    #
    # Rule: if more than 5 % of the universe is missing from the
    # history window, we DON'T TRUST THIS FALLBACK. Return None and
    # let the caller decide whether to abort or use the snapshot
    # count with appropriate downstream gates.
    skipped = sum(
        1 for cid in today_close
        if prior_max.get(cid, float("-inf")) == float("-inf")
    )
    total = len(today_close)
    skip_pct = (skipped / total * 100) if total else 0.0
    print(
        f"  52W on-the-fly recompute: history coverage "
        f"covered={total - skipped:,} skipped={skipped:,} "
        f"({skip_pct:.1f}% missing)"
    )
    SKIP_PCT_THRESHOLD = 5.0
    if skip_pct > SKIP_PCT_THRESHOLD:
        print(
            f"  ❌ 52W on-the-fly recompute: skip rate {skip_pct:.1f}% "
            f"> {SKIP_PCT_THRESHOLD}% threshold — history coverage too "
            f"thin to trust this fallback. Returning None so the caller "
            f"falls through (or fails loudly on the next gate)."
        )
        return None

    new_highs = 0
    new_lows = 0
    for cid, close in today_close.items():
        pmax = prior_max.get(cid)
        pmin = prior_min.get(cid)
        if pmax is not None and pmax != float("-inf") and close >= pmax:
            new_highs += 1
        if pmin is not None and pmin != float("inf") and close <= pmin:
            new_lows += 1
    print(
        f"  52W on-the-fly recompute: rows={fetched:,} companies_with_history={len(prior_max)} "
        f"→ highs={new_highs} lows={new_lows}"
    )
    return new_highs, new_lows


def fetch_prior_nifty_close_for_1d() -> float | None:
    """Most recent stored nifty_close before today's row (any past date)."""
    try:
        res = (
            supabase.table("market_internals")
            .select("date,nifty_close")
            .order("date", desc=True)
            .limit(5)
            .execute()
        )
    except Exception:
        return None
    for row in res.data or []:
        if row.get("date") == TODAY:
            continue
        nc = _to_float(row.get("nifty_close"))
        if nc is not None and nc > 0:
            return nc
    return None


def compute_nifty_change_1d_from_internals(today_nifty: float | None) -> float | None:
    """(today - yesterday) / yesterday * 100 using market_internals.nifty_close.

    Kept as a fallback only — see nifty_change_1d_canonical() below for
    the preferred path that reads the value straight out of
    nifty_sectors for today's exact trading date.
    """
    if today_nifty is None:
        return None
    prev = fetch_prior_nifty_close_for_1d()
    if prev is None or prev <= 0:
        return None
    return round((float(today_nifty) - prev) / prev * 100, 2)


def _self_heal_nifty_sectors(today_str: str) -> bool:
    """If today's nifty_sectors row is missing, run fetch_nifty_sectors.py
    inline as a subprocess so the canonical lookup downstream succeeds.

    Returns True if today's row exists AFTER the heal attempt.

    WHY this exists
      Both the GitHub daily.yml and scripts/run_daily.py orchestrate
      fetch_nifty_sectors LATER than calc_market_internals — calc reads
      a row that hasn't been written yet, falls back, and writes a
      stale nifty_change_1d. The pre-send Telegram gate then ships
      yesterday's number with today's date.

      Reordering the cron is the right long-term fix (recommended
      separately to ops). This inline self-heal closes the gap
      regardless: if today's row isn't there, we make it appear.
    """
    import subprocess
    import sys
    from pathlib import Path

    script = Path(__file__).parent / "fetch_nifty_sectors.py"
    if not script.exists():
        print(f"  self-heal: fetch_nifty_sectors.py not found at {script}")
        return False
    print(f"  self-heal: invoking fetch_nifty_sectors.py for {today_str}")
    try:
        proc = subprocess.run(
            [sys.executable, str(script)],
            timeout=180,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            print(
                f"  self-heal: fetch_nifty_sectors.py exited {proc.returncode}. "
                f"stderr tail: {(proc.stderr or '')[-400:]}"
            )
            return False
    except subprocess.TimeoutExpired:
        print("  self-heal: fetch_nifty_sectors.py timed out after 180 s.")
        return False
    except Exception as e:
        print(f"  self-heal: fetch_nifty_sectors.py launch failed: {e}")
        return False

    # Re-probe — did today's row actually land?
    try:
        res = (
            supabase.table("nifty_sectors")
            .select("date")
            .eq("index_name", "Nifty 50")
            .eq("date", today_str)
            .limit(1)
            .execute()
        )
        ok = bool(getattr(res, "data", None) or [])
        print(f"  self-heal: today's row {'now present' if ok else 'STILL missing'}.")
        return ok
    except Exception as e:
        print(f"  self-heal: re-probe failed: {e}")
        return False


def nifty_change_1d_canonical(
    trading_date,
    today_nifty: float | None,
) -> tuple[float | None, bool]:
    """Read the day's Nifty 50 change from the nifty_sectors row whose
    date EQUALS the resolved trading_date — NOT the latest-row-by-date
    pattern used elsewhere. If today's row is missing (the sectors
    fetcher hasn't run yet) we fall back to:
      1. the existing (today_close - prior_internals_close) computation
      2. last resort: yesterday's nifty_sectors.change_1d, flagged stale

    Returns (change_1d_pct, is_stale).
      change_1d_pct — float (e.g. 0.34) or None when no calc possible
      is_stale      — True iff the value did NOT come from today's
                      nifty_sectors row. Caller writes it through to
                      market_internals.nifty_data_stale (add the column
                      via ALTER TABLE; default false) so downstream
                      consumers can choose to suppress the number.

    WHY a strict date match
      The previous "ORDER BY date DESC LIMIT 1" pattern returned
      whatever was newest in nifty_sectors. On 18 Jun 2026 the freshest
      row was 17 Jun's, so market_internals(18 Jun) got 0.4 % as its
      "today" change — and an even worse race produced literal 0.0
      when today_close == prior_close from a stale yfinance fetch.

    DIAGNOSTIC LOGGING
      Every call prints what it tried and chose. Logs are how the
      pipeline operator (Robin) detects mismatches across runs.
    """
    today_str = str(trading_date)[:10]
    # ── Primary: exact-date row in nifty_sectors ───────────────────────
    try:
        res = (
            supabase.table("nifty_sectors")
            .select("date,change_1d,current_value")
            .eq("index_name", "Nifty 50")
            .eq("date", today_str)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
    except Exception as e:
        print(f"  nifty_sectors lookup failed for {today_str}: {e}")
        rows = []
    if rows:
        row = rows[0]
        try:
            chg = float(row.get("change_1d"))
            print(
                f"  nifty_change_1d source: nifty_sectors[date={today_str}] "
                f"value={chg:+.2f} % current_value={row.get('current_value')}"
            )
            return round(chg, 2), False
        except (TypeError, ValueError):
            print(
                f"  nifty_sectors[date={today_str}] has non-numeric "
                f"change_1d={row.get('change_1d')!r} — falling back."
            )
    else:
        # Cron order: fetch_nifty_sectors runs AFTER calc_market_internals
        # in both .github/workflows/daily.yml (step 7 vs step 4) and
        # scripts/run_daily.py (never called). Heal in-process so this
        # script gets the truth without waiting for tomorrow's cron.
        print(f"  nifty_sectors[date={today_str}] missing — attempting self-heal.")
        if _self_heal_nifty_sectors(today_str):
            try:
                res2 = (
                    supabase.table("nifty_sectors")
                    .select("date,change_1d,current_value")
                    .eq("index_name", "Nifty 50")
                    .eq("date", today_str)
                    .limit(1)
                    .execute()
                )
                rows2 = getattr(res2, "data", None) or []
            except Exception as e:
                print(f"  self-heal retry lookup failed: {e}")
                rows2 = []
            if rows2:
                try:
                    chg = float(rows2[0].get("change_1d"))
                    print(
                        f"  nifty_change_1d source: nifty_sectors[date={today_str}] "
                        f"(post-heal) value={chg:+.2f} %"
                    )
                    return round(chg, 2), False
                except (TypeError, ValueError):
                    pass

    print(
        f"  ⚠️  nifty_sectors has no usable row for {today_str}. "
        f"Falling back to market_internals own history."
    )
    # ── Fallback 1: (today_close vs prior internals_close) % ───────────
    fallback = compute_nifty_change_1d_from_internals(today_nifty)
    if fallback is not None and fallback != 0.0:
        print(
            f"  nifty_change_1d source: market_internals history "
            f"value={fallback:+.2f} % (flagged stale=true)"
        )
        return fallback, True
    if fallback == 0.0:
        print(
            f"  ⚠️  market_internals fallback returned 0.0 — likely a "
            f"yfinance stale-close. Will try yesterday's nifty_sectors next."
        )

    # ── Fallback 2: yesterday's nifty_sectors row ─────────────────────
    try:
        prev_res = (
            supabase.table("nifty_sectors")
            .select("date,change_1d")
            .eq("index_name", "Nifty 50")
            .lt("date", today_str)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        prev_rows = getattr(prev_res, "data", None) or []
    except Exception:
        prev_rows = []
    if prev_rows:
        try:
            chg = float(prev_rows[0].get("change_1d"))
            print(
                f"  nifty_change_1d source: nifty_sectors[date={prev_rows[0].get('date')}] "
                f"value={chg:+.2f} % (flagged stale=true — yesterday's data)"
            )
            return round(chg, 2), True
        except (TypeError, ValueError):
            pass
    print(f"  ❌ Could not determine nifty_change_1d for {today_str}. Returning None.")
    return None, True


def fetch_market_internals_prior_rows(limit: int = 6) -> list[dict]:
    """Rows with date < TODAY, oldest first (for 7d breadth vs today)."""
    try:
        res = (
            supabase.table("market_internals")
            .select(
                "date,new_52w_lows,new_52w_highs,above_ma150_pct,stage2_pct",
            )
            .lt("date", TODAY)
            .order("date", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception:
        return []
    rows = list(reversed(res.data or []))
    return rows


def compute_breadth_7d_flags(prior_rows: list[dict], breadth: dict) -> tuple[bool, bool]:
    """
    Compare today's counts vs oldest available row in the prior window
    (up to 6 days before today → with today forms up to a 7-session window).
    """
    if not prior_rows:
        return False, False
    first = prior_rows[0]
    lows_0 = first.get("new_52w_lows")
    ma150_0 = first.get("above_ma150_pct")
    lows_t = breadth.get("new_52w_lows")
    ma150_t = breadth.get("above_ma150_pct")
    try:
        lows_rising = (
            lows_0 is not None
            and lows_t is not None
            and int(lows_t) > int(lows_0)
        )
    except (TypeError, ValueError):
        lows_rising = False
    try:
        ma150_falling = (
            ma150_0 is not None
            and ma150_t is not None
            and float(ma150_t) < float(ma150_0)
        )
    except (TypeError, ValueError):
        ma150_falling = False
    return lows_rising, ma150_falling


def fetch_previous_internals(days_ago=7):
    """Get internals from N days ago for WoW comparison."""
    past_date = (date.today() - timedelta(days=days_ago)).isoformat()
    res = supabase.table("market_internals")\
        .select("*")\
        .lte("date", past_date)\
        .order("date", desc=True)\
        .limit(1)\
        .execute()
    return res.data[0] if res.data else None


# ─────────────────────────────────────────
# FETCH NIFTY 50 AND VIX
# ─────────────────────────────────────────

def fetch_nifty_and_vix():
    """Fetch Nifty 50 and India VIX from yfinance.

    yfinance can return stale data for Indian indices (its upstream sometimes
    lags by 1–3 days). The old code blindly took iloc[-1] without checking the
    date, so a stale value would silently be stored as TODAY's close for days
    on end. We now read the last row's actual date and refuse to use it if it
    is more than 2 calendar days old.
    """
    print("Fetching Nifty 50 and VIX...")

    nifty_close = None
    nifty_ath = None
    vix = None
    vix_change = None

    try:
        nifty = yf.Ticker("^NSEI")
        nifty_hist = nifty.history(period="2y")
        if not nifty_hist.empty:
            last_date = nifty_hist.index[-1].date()
            days_old = (date.today() - last_date).days
            candidate_close = float(nifty_hist["Close"].iloc[-1])
            if days_old > 2:
                # 2 days covers Mon-after-Fri-close. Anything older is yfinance lag.
                print(
                    f"  ⚠️  yfinance Nifty data is STALE (last close {candidate_close:.2f} "
                    f"on {last_date.isoformat()}, {days_old} days old) — refusing to use it. "
                    f"Today's nifty_close will be left blank for this run."
                )
            else:
                nifty_close = candidate_close
                nifty_ath = float(nifty_hist["Close"].max())
                print(f"  Nifty 50: {nifty_close:.2f} as of {last_date.isoformat()} | ATH: {nifty_ath:.2f}")
    except Exception as e:
        print(f"  Nifty fetch failed: {e}")

    try:
        vix_ticker = yf.Ticker("^INDIAVIX")
        vix_hist = vix_ticker.history(period="5d")
        if not vix_hist.empty and len(vix_hist) >= 2:
            vix = float(vix_hist["Close"].iloc[-1])
            vix_prev = float(vix_hist["Close"].iloc[-2])
            vix_change = round((vix - vix_prev) / vix_prev * 100, 2)
            print(f"  India VIX: {vix:.1f} ({vix_change:+.1f}%)")
        elif not vix_hist.empty:
            vix = float(vix_hist["Close"].iloc[-1])
            print(f"  India VIX: {vix:.1f}")
    except Exception as e:
        print(f"  VIX fetch failed: {e}")

    return nifty_close, nifty_ath, vix, vix_change


# ─────────────────────────────────────────
# CALCULATE BREADTH METRICS
# ─────────────────────────────────────────

def calc_breadth(rows):
    """Calculate all breadth metrics from price_data rows."""
    # HOW IT'S DERIVED
    #   total        = count of stocks with a price row today
    #                  (≈ 2125 — the full NSE universe).
    #   stageN_count = # stocks classified as Stage N today
    #                  (Stage 2 is the only "buyable" stage).
    #   stage2_pct   = stage2_count / total × 100.
    #                  > 50 % = broad bull market;
    #                  < 30 % = narrow rally or correction.
    #   above_maNN   = # stocks whose close > their MA(NN).
    #   above_maNN_pct = above_maNN / total × 100.
    #                    above_ma150_pct is the "breadth"
    #                    metric used on the home page.
    #                    > 60 % = healthy bull, < 40 % = weak.
    total = len(rows)
    if total == 0:
        return {}

    # Stage counts
    stage_counts = {"Stage 1": 0, "Stage 2": 0,
                    "Stage 3": 0, "Stage 4": 0, "Unclassified": 0}
    for row in rows:
        stage = row.get("stage") or "Unclassified"
        if stage in stage_counts:
            stage_counts[stage] += 1
        else:
            stage_counts["Unclassified"] += 1

    # MA breadth
    # WHY: explicit None guards + float() so a NULL ma column on
    # any row is treated as "no info" rather than counted as 0.
    # Without this, a single NULL row would be silently excluded
    # AND it makes the source of broken breadth (e.g. ma150 NULL
    # for the whole universe) easy to spot in the printout below.
    above_ma20 = sum(
        1 for r in rows
        if r.get("close") is not None
        and r.get("ma20") is not None
        and float(r["ma20"]) > 0
        and float(r["close"]) > float(r["ma20"])
    )
    above_ma50 = sum(
        1 for r in rows
        if r.get("close") is not None
        and r.get("ma50") is not None
        and float(r["ma50"]) > 0
        and float(r["close"]) > float(r["ma50"])
    )
    above_ma150 = sum(
        1 for r in rows
        if r.get("close") is not None
        and r.get("ma150") is not None
        and float(r["ma150"]) > 0
        and float(r["close"]) > float(r["ma150"])
    )
    # WHY: above_ma30w is the TRUE Weinstein breadth — the 30-week
    # MA is the trend filter Weinstein uses. SwingX condition 10
    # reads this column. Source: price_data.ma30w populated by
    # fetch_bhav_daily.py.
    above_ma30w = sum(
        1 for r in rows
        if r.get("close") is not None
        and r.get("ma30w") is not None
        and float(r["ma30w"]) > 0
        and float(r["close"]) > float(r["ma30w"])
    )

    # Diagnose silently-broken MA columns: if a MA is NULL for >90%
    # of the universe the breadth pct will be ~0 even when the
    # market is fine. Print so we notice if a fetch script regresses.
    null_ma150 = sum(
        1 for r in rows
        if r.get("ma150") is None or float(r.get("ma150") or 0) <= 0
    )
    null_ma30w = sum(
        1 for r in rows
        if r.get("ma30w") is None or float(r.get("ma30w") or 0) <= 0
    )
    if null_ma150 > total * 0.5:
        print(
            f"  WARNING: ma150 is NULL/0 for "
            f"{null_ma150}/{total} rows - "
            f"above_ma150_pct will be unreliable"
        )
    if null_ma30w > total * 0.5:
        print(
            f"  WARNING: ma30w is NULL/0 for "
            f"{null_ma30w}/{total} rows - "
            f"above_ma30w_pct will be unreliable"
        )

    # 52W highs/lows counts come from a dedicated is_latest snapshot (see main).
    return {
        "total": total,
        "stage1": stage_counts["Stage 1"],
        "stage2": stage_counts["Stage 2"],
        "stage3": stage_counts["Stage 3"],
        "stage4": stage_counts["Stage 4"],
        "unclassified": stage_counts["Unclassified"],
        "stage2_pct": round(stage_counts["Stage 2"] / total * 100, 1),
        "stage4_pct": round(stage_counts["Stage 4"] / total * 100, 1),
        "above_ma20": above_ma20,
        "above_ma50": above_ma50,
        "above_ma150": above_ma150,
        "above_ma30w": above_ma30w,
        "above_ma20_pct": round(above_ma20 / total * 100, 1),
        "above_ma50_pct": round(above_ma50 / total * 100, 1),
        "above_ma150_pct": round(above_ma150 / total * 100, 1),
        "above_ma30w_pct": round(above_ma30w / total * 100, 1),
        "new_52w_highs": 0,
        "new_52w_lows": 0,
        "highs_minus_lows": 0,
    }


# ─────────────────────────────────────────
# NIFTY TREND METRICS
# ─────────────────────────────────────────

def _nf_change(v):
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _nifty_trend_signal(up: int, down: int, w_chg: float | None) -> str:
    w = w_chg if w_chg is not None else 0.0
    if up >= 4:
        return "Strong Uptrend"
    if up >= 3 and w > 1.5:
        return "Recovering"
    if up >= 3:
        return "Bouncing"
    if up == 2 and w > 0:
        return "Attempting Recovery"
    if down >= 4:
        return "Weak Downtrend"
    if down >= 3 and w < -1.5:
        return "Pulling Back"
    if down >= 3:
        return "Under Pressure"
    if down == 2 and w < 0:
        return "Fading"
    return "Neutral"


def fetch_nifty_trend_metrics(today_nifty_close=None, trading_date=None):
    """Multi-day Nifty 50 trend, anchored on today's close.

    PREVIOUS BUG
      The function used to read change_1d from nifty_sectors. When this
      script ran before fetch_nifty_sectors had written today's row,
      the 'latest' nifty_sectors row was actually yesterday, so the
      streaks written into market_internals(date=today) reflected the
      day BEFORE today's close. Symptom in the table — a +0.52 % up
      day showing up=0 / down=2 because down=2 was the trailing streak
      as of yesterday, not after the up move printed.

    FIX
      Anchor the freshest change_1d on the live today_nifty_close
      passed in by the caller (already fetched from yfinance for
      market_internals' own nifty_close column) and only fall back to
      nifty_sectors for the older days. That removes the timing
      dependency between this script and fetch_nifty_sectors.

      Also: the nifty_sectors query is now bounded by trading_date.
      Without the bound, a workflow re-run on a future calendar day
      would see rows from after the resolved trading_date and treat
      them as 'today', poisoning the streak calculation. With the
      bound, only rows from the trading_date or earlier are visible.

    Streaks count consecutive positive / negative change_1d from today
    backward. change_3d and the 5-day change_1w are the *sum* of the
    last 3 and 5 daily percentages (approximation; not compounded).
    """
    default = {
        "consecutive_up": 0,
        "consecutive_down": 0,
        "change_1d": None,
        "change_3d": None,
        "change_1w": None,
        "market_trend": "Neutral",
    }
    # Pull 7 rows so once we prepend today's change we still have at
    # least 5 historical days for the 1w window. Bound by trading_date
    # when caller supplies it so the historical view aligns with the
    # row this run is about to upsert.
    try:
        q = (
            supabase.table("nifty_sectors")
            .select("date,change_1d,current_value")
            .eq("index_name", "Nifty 50")
        )
        if trading_date:
            q = q.lte("date", trading_date)
        res = (
            q.order("date", desc=True)
             .limit(7)
             .execute()
        )
        hist_data = res.data or []
    except Exception as e:
        print(f"  Nifty trend fetch failed: {e}")
        return default

    # Warn when the latest row we pulled is older than trading_date —
    # that means fetch_nifty_sectors hasn't written today's row yet,
    # so today's change/streak is being derived purely from the
    # live yfinance close + yesterday's stored close. Still correct,
    # but mark it so a stale entry in the column is obvious in logs.
    if trading_date and hist_data:
        latest_sector_date = str(hist_data[0].get("date") or "")[:10]
        if latest_sector_date and latest_sector_date < str(trading_date)[:10]:
            print(
                f"  ⚠️  nifty_sectors has no row for {trading_date} "
                f"(latest stored: {latest_sector_date}). "
                f"Using today_nifty_close from yfinance as the day's anchor."
            )

    if not hist_data and today_nifty_close is None:
        print("  Nifty trend: no history in nifty_sectors and no today_nifty_close")
        return default

    # ── Compute today's change_1d from the live close + the most
    # ── recent historical row. If today's row already exists in
    # ── nifty_sectors (i.e. fetch_nifty_sectors ran ahead of us)
    # ── we use that instead.
    today_change = None
    historical = hist_data
    today_close_f = _nf_change(today_nifty_close)
    if today_close_f is not None and hist_data:
        prev_close = _nf_change(hist_data[0].get("current_value"))
        if prev_close and prev_close != 0:
            today_change = round(((today_close_f - prev_close) / prev_close) * 100, 2)
        # If hist_data[0] is already today, swap it for our anchor
        # so we don't double-count today.
        # USE IST, NOT UTC — the cron runs at 12:00 UTC = 17:30 IST,
        # but a manual workflow_dispatch in IST evening could be at
        # 18:00 UTC where UTC date == IST date - 1, off-by-one'ing
        # the swap and double-counting today's row in the streak.
        today_iso = None
        try:
            ist = timezone(timedelta(hours=5, minutes=30))
            today_iso = datetime.now(ist).date().isoformat()
        except Exception:
            today_iso = None
        if today_iso and str(hist_data[0].get("date")) == today_iso:
            historical = hist_data[1:]
            # Prefer the value already on disk if it's there.
            today_change = _nf_change(hist_data[0].get("change_1d")) or today_change

    historical_changes = [
        x for x in (_nf_change(r.get("change_1d")) for r in historical)
        if x is not None
    ]
    changes = (
        ([today_change] if today_change is not None else [])
        + historical_changes
    )

    consec_up = 0
    for c in changes:
        if c > 0:
            consec_up += 1
        else:
            # Reset on zero or negative — direction change always
            # clears the up streak.
            break

    consec_down = 0
    for c in changes:
        if c < 0:
            consec_down += 1
        else:
            # Reset on zero or positive.
            break

    change_3d = round(sum(changes[:3]), 2) if len(changes) >= 3 else None
    change_1w = round(sum(changes[:5]), 2) if len(changes) >= 5 else None
    change_1d = changes[0] if changes else None

    market_trend = _nifty_trend_signal(consec_up, consec_down, change_1w)

    print(
        f"  Nifty trend: up={consec_up} down={consec_down} "
        f"1d={change_1d} 3d={change_3d} 5d_sum={change_1w} -> {market_trend}",
    )

    return {
        "consecutive_up": consec_up,
        "consecutive_down": consec_down,
        "change_1d": change_1d,
        "change_3d": change_3d,
        "change_1w": change_1w,
        "market_trend": market_trend,
    }


# ─────────────────────────────────────────
# VIX LEVEL CLASSIFICATION
# ─────────────────────────────────────────

def classify_vix(vix):
    if vix is None:
        return "unknown"
    if vix < 12:
        return "low"
    elif vix < 16:
        return "moderate"
    elif vix < 20:
        return "elevated"
    elif vix < 25:
        return "high"
    else:
        return "extreme"


# ─────────────────────────────────────────
# DIVERGENCE DETECTION
# ─────────────────────────────────────────

def detect_divergence(
    breadth,
    nifty_close,
    nifty_ath,
    prev,
    *,
    lows_rising_7d: bool = False,
    ma150_falling_7d: bool = False,
):
    """
    Stan Weinstein divergence: market at highs but 
    internals weakening.
    """
    signals = []
    severity = "none"

    if nifty_close is None or nifty_ath is None:
        return False, "none", "", "Nifty data unavailable"

    pct_from_ath = (nifty_close - nifty_ath) / nifty_ath * 100
    near_ath = pct_from_ath > -5  # within 5% of ATH

    # ── Signal 1: Stage 2 < 25% while market near ATH
    if near_ath and breadth["stage2_pct"] < 25:
        signals.append(
            f"Only {breadth['stage2_pct']}% of stocks in Stage 2 "
            f"while Nifty is {abs(pct_from_ath):.1f}% from ATH"
        )
        severity = "severe"

    elif near_ath and breadth["stage2_pct"] < 35:
        signals.append(
            f"Stage 2 stocks declining ({breadth['stage2_pct']}%) "
            f"as market holds near highs"
        )
        severity = "moderate" if severity == "none" else severity

    # ── Signal 2: More 52W lows than highs near ATH
    if near_ath and breadth["new_52w_lows"] > breadth["new_52w_highs"]:
        signals.append(
            f"More stocks hitting 52W lows ({breadth['new_52w_lows']}) "
            f"than highs ({breadth['new_52w_highs']}) "
            f"while Nifty near ATH — bearish divergence"
        )
        severity = "severe"

    # ── Signal 3: 52W lows expanding (even without ATH context)
    if breadth["new_52w_lows"] > 50:
        signals.append(
            f"{breadth['new_52w_lows']} stocks at 52W lows — "
            f"broad weakness beneath the surface"
        )
        severity = "moderate" if severity == "none" else severity

    # ── Signal 4: Stage 4 > 35% of market
    if breadth["stage4_pct"] > 35:
        signals.append(
            f"{breadth['stage4_pct']}% of stocks in Stage 4 downtrend — "
            f"majority in decline"
        )
        severity = "moderate" if severity == "none" else severity

    # ── Signal 5: Week over week Stage 2 declining
    if prev and breadth["stage2_pct"] < prev.get("stage2_pct", 100) - 5:
        drop = round(prev["stage2_pct"] - breadth["stage2_pct"], 1)
        signals.append(
            f"Stage 2 stocks dropped {drop}% in a week — "
            f"momentum deteriorating"
        )
        severity = "mild" if severity == "none" else severity

    # ── Signal 6: New highs contracting at market peak
    prev_highs = prev.get("new_52w_highs", 0) if prev else 0
    if near_ath and prev and breadth["new_52w_highs"] < prev_highs * 0.6:
        signals.append(
            f"New 52W highs contracting "
            f"({breadth['new_52w_highs']} vs "
            f"{prev.get('new_52w_highs', 0)} last week) "
            f"while market holds highs"
        )
        severity = "moderate" if severity == "none" else severity

    # ── Signal 7: 7d breadth — rising 52W lows + falling % above MA150
    if lows_rising_7d and ma150_falling_7d:
        signals.append(
            "7d breadth: new 52W lows rising while % above MA150 falls "
            "(participation narrowing)"
        )
        severity = "moderate" if severity == "none" else severity
    elif lows_rising_7d:
        signals.append(
            "7d breadth: new 52W lows count rising vs week-ago snapshot"
        )
        severity = "mild" if severity == "none" else severity
    elif ma150_falling_7d:
        signals.append(
            "7d breadth: % stocks above MA150 declining vs week-ago snapshot"
        )
        severity = "mild" if severity == "none" else severity

    divergence_active = len(signals) > 0
    divergence_type = (
        "ATH Divergence" if near_ath and divergence_active
        else "Breadth Deterioration" if divergence_active
        else ""
    )
    notes = " | ".join(signals) if signals else "No divergence detected"

    return divergence_active, severity, divergence_type, notes


# ─────────────────────────────────────────
# MARKET HEALTH SCORE
# ─────────────────────────────────────────

def calc_health_score(breadth, vix, nifty_close,
                      nifty_ath, divergence_severity):
    score = 50  # neutral starting point

    # ── Stage 2 breadth (most important — 30 points)
    s2 = breadth["stage2_pct"]
    if s2 > 55:   score += 30
    elif s2 > 45: score += 20
    elif s2 > 35: score += 10
    elif s2 > 25: score += 0
    elif s2 > 15: score -= 15
    else:         score -= 30

    # ── 52W highs vs lows (20 points)
    net = breadth["highs_minus_lows"]
    if net > 80:   score += 20
    elif net > 40: score += 12
    elif net > 0:  score += 5
    elif net > -30: score -= 5
    elif net > -60: score -= 12
    else:           score -= 20

    # ── MA150 breadth (15 points)
    ma150_pct = breadth["above_ma150_pct"]
    if ma150_pct > 65:  score += 15
    elif ma150_pct > 50: score += 8
    elif ma150_pct > 35: score += 0
    elif ma150_pct > 20: score -= 8
    else:                score -= 15

    # ── Stage 4 penalty (10 points)
    s4 = breadth["stage4_pct"]
    if s4 > 45:   score -= 10
    elif s4 > 35: score -= 6
    elif s4 > 25: score -= 3

    # ── VIX (10 points)
    if vix:
        if vix < 12:   score += 10
        elif vix < 15: score += 5
        elif vix < 20: score += 0
        elif vix < 25: score -= 8
        else:          score -= 15

    # ── Divergence penalty (up to 25 points)
    if divergence_severity == "severe":   score -= 25
    elif divergence_severity == "moderate": score -= 15
    elif divergence_severity == "mild":     score -= 7

    score = max(0, min(100, round(score)))

    # Phase classification
    if score >= 75:   phase = "Strong bull market"
    elif score >= 60: phase = "Bull market — mixed signals"
    elif score >= 45: phase = "Neutral — caution advised"
    elif score >= 30: phase = "Weakening — defensive stance"
    elif score >= 15: phase = "Bear market conditions"
    else:             phase = "Extreme weakness — high risk"

    return score, phase


# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────

def main():
    skip = _skip_reason_for_daily_update()
    if skip:
        print(skip)
        sys.exit(0)

    # WHY: Resolve the trading date from price_data instead of
    # date.today(). On weekends and NSE holidays (when run via
    # --force / workflow_dispatch) date.today() would stamp the
    # upsert row with today's calendar date even though the data
    # describes the previous trading day. Pulling the latest date
    # straight from price_data keeps the row's `date` column
    # consistent with the source data.
    latest_res = (
        supabase.table("price_data")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    if latest_res.data:
        _raw_latest = latest_res.data[0]["date"]
        trading_date = (
            _raw_latest if isinstance(_raw_latest, str)
            else _raw_latest.isoformat()
        )[:10]
    else:
        trading_date = TODAY

    print(f"\n{'='*50}")
    print(f"Market Internals — {TODAY}")
    print(f"Processing date:  {trading_date}")
    print(f"{'='*50}\n")

    # 1. Latest rows for breadth (MAs, stages)
    rows = fetch_latest_price_data()
    if not rows:
        print("No price data found. Run fetch_price_data.py first.")
        sys.exit(1)

    # 1b. Dedicated is_latest snapshot — 52W highs/lows + A/D (prev_close)
    all_latest = fetch_all_latest_price_rows_for_metrics()
    new_highs, new_lows, adv_snap, dec_snap, ad_snap = compute_52w_highs_lows_and_ad(
        all_latest,
    )

    # 1c. NSE-truthful 52W highs/lows — NSE-DIRECT ONLY.
    #
    # ARCHITECTURE NOTE
    #   We tried a 4-tier fallback (API -> MW52 -> history recompute ->
    #   is_latest snapshot count). Two production incidents showed the
    #   homegrown tiers produce WRONG numbers without anyone noticing:
    #     - 19 Jun 2026 broadcast shipped (highs=0, lows=2) — the
    #       is_latest snapshot tier under-counted because stale
    #       high_52w columns sat just above today's close.
    #     - The history recompute silently skipped any company whose
    #       365-day window was thin (new listings, pagination
    #       bail-outs). Skip rate could exceed 30 % without surfacing.
    #   The principle Robin set after the 19 Jun incident:
    #     "use NSE direct, low error. don't send wrong calculation."
    #
    # CURRENT FLOW — two tiers, both NSE-direct.
    #   Tier 1: NSE live API (live-analysis-52weekhighstock). One
    #           HTTP request, ~200 ms, no calculation. Numbers are
    #           exactly what nseindia.com displays. Rejects the
    #           silent-zero (0, 0) response as degraded.
    #   Tier 2: NSE MW52 CSV. Per-stock list, slower (zip + parse)
    #           but resilient to API rate-limits. Count of returned
    #           symbols == NSE's published count to within ±1.
    #
    # NO LOCAL FALLBACK. If both NSE tiers fail we ABORT — better
    # to skip today's row than to publish a wrong one to both the
    # Telegram broadcast AND the public frontend (which reads the
    # same row with no gate).
    source_used = "none"
    try:
        from fetch_52w_highs_lows import fetch_52w_counts
        api_high, api_low = fetch_52w_counts()
        if isinstance(api_high, int) and isinstance(api_low, int):
            if api_high == 0 and api_low == 0:
                print(
                    "  52W tier 1 (NSE live API): returned (0, 0) — "
                    "treating as degraded silent-zero response, trying tier 2."
                )
            else:
                print(
                    f"  52W tier 1 (NSE live API): highs={api_high} lows={api_low}"
                )
                if api_high != new_highs or api_low != new_lows:
                    print(
                        f"  52W: snapshot count ({new_highs}, {new_lows}) "
                        f"overridden by NSE API ({api_high}, {api_low})"
                    )
                new_highs, new_lows = api_high, api_low
                source_used = "nse_api"
        else:
            print("  52W tier 1 (NSE live API): unavailable, trying tier 2.")
    except Exception as e:
        print(f"  52W tier 1 (NSE live API): raised {e!r}, trying tier 2.")

    if source_used == "none":
        try:
            from fetch_bhav_daily import download_mw52_file, parse_mw52_file
            mw52_text = download_mw52_file(trading_date)
            if mw52_text:
                mw52_highs, mw52_lows = parse_mw52_file(mw52_text)
                if mw52_highs or mw52_lows:
                    rh, rl = len(mw52_highs), len(mw52_lows)
                    print(f"  52W tier 2 (NSE MW52 CSV): highs={rh} lows={rl}")
                    new_highs, new_lows = rh, rl
                    source_used = "mw52"
                else:
                    print("  52W tier 2 (NSE MW52 CSV): returned empty parse — both NSE tiers failed.")
            else:
                print("  52W tier 2 (NSE MW52 CSV): download failed — both NSE tiers failed.")
        except Exception as e:
            print(f"  52W tier 2 (NSE MW52 CSV): raised {e!r} — both NSE tiers failed.")

    # ── FINAL 52W DATA-QUALITY GATE ───────────────────────────────────
    # If neither NSE tier produced numbers, REFUSE to upsert. The old
    # homegrown fallbacks (history recompute + is_latest snapshot) are
    # gone — they were the source of multiple wrong-data incidents.
    #
    # Recovery is straightforward: re-run when NSE recovers, and the
    # standalone recovery step (.github/workflows/daily.yml step 4b)
    # also takes a second crack at the same NSE endpoint after this
    # exits.
    if source_used == "none":
        print(
            "  ❌ ABORT calc_market_internals: both NSE 52W sources "
            "unavailable (live API + MW52 CSV). NOT writing a "
            "market_internals row — better to leave yesterday's row "
            "in place than publish home-grown wrong numbers to the "
            "broadcast + public frontend. "
            "Recovery: re-run later when NSE recovers, or trigger "
            "`python scripts/fetch_52w_highs_lows.py --update` then "
            "re-run this script."
        )
        sys.exit(1)
    if new_highs == 0 and new_lows == 0:
        # Belt-and-braces: tier 1 already rejects (0, 0), tier 2 needs
        # non-empty parse. Anything still (0, 0) here means a defect
        # in the tier-1 reject or an NSE MW52 with truly zero symbols
        # (would be the first such day in NSE history). Refuse.
        print(
            f"  ❌ ABORT calc_market_internals: source='{source_used}' "
            f"returned (0, 0). Refusing to upsert."
        )
        sys.exit(1)
    used_prev_close = any(r.get("prev_close") is not None for r in all_latest)

    latest_date = (rows[0].get("date") or TODAY)
    if isinstance(latest_date, str):
        latest_date_str = latest_date[:10]
    else:
        latest_date_str = str(latest_date)

    company_ids = [str(r["company_id"]) for r in rows if r.get("company_id")]
    if used_prev_close:
        adv, dec, ad_ratio = adv_snap, dec_snap, ad_snap
        print(
            f"  52W snapshot: highs={new_highs} lows={new_lows} | "
            f"A/D (prev_close): {adv} up / {dec} down (ratio={ad_ratio})",
        )
    else:
        prev_closes = fetch_previous_close_by_company(latest_date_str, company_ids)
        adv, dec, ad_ratio = calc_advance_decline(rows, prev_closes)
        print(
            f"  52W snapshot: highs={new_highs} lows={new_lows} | "
            f"Advance/Decline (prior day map): {adv} up / {dec} down (ratio={ad_ratio})",
        )

    # ─────────────────────────────────────────
    # SCHEMA REQUIREMENT — run in Supabase once:
    #   alter table market_internals
    #     add column if not exists
    #       ad_line_cumulative numeric default 0;
    #   alter table market_internals
    #     add column if not exists
    #       hl_spread_10d_avg numeric default 0;
    # ─────────────────────────────────────────

    # 1c. Cumulative A/D line
    # WHY: Weinstein's primary breadth
    # indicator is the CUMULATIVE
    # advance/decline line — not just
    # today's ratio.
    # We maintain a running total by
    # adding today's net A/D to
    # yesterday's cumulative value.

    # Get yesterday's cumulative value
    yesterday_mi = supabase\
        .table('market_internals')\
        .select('ad_line_cumulative, date')\
        .lt('date', trading_date)\
        .order('date', desc=True)\
        .limit(1)\
        .execute()

    prev_cumulative = 0
    if yesterday_mi.data:
        prev_cumulative = float(
            yesterday_mi.data[0].get(
                'ad_line_cumulative') or 0)

    # Today's net A/D
    net_ad = adv - dec

    # Cumulative A/D line
    ad_line_cumulative = \
        prev_cumulative + net_ad

    # 1d. 52W High/Low spread + 10d avg
    # WHY: Weinstein uses new 52W highs
    # vs lows as primary breadth signal.
    # When new lows > new highs it's
    # a warning even if index is rising.

    hl_spread = new_highs - new_lows
    # Positive = healthy (more highs)
    # Negative = warning (more lows)
    # Deeply negative = broad weakness

    # 10-day moving average of spread
    # for smoothing
    # Get last 9 days of hl data
    hl_history = supabase\
        .table('market_internals')\
        .select('highs_minus_lows')\
        .lt('date', trading_date)\
        .order('date', desc=True)\
        .limit(9)\
        .execute()

    hl_values = [
        float(r.get('highs_minus_lows') or 0)
        for r in (hl_history.data or [])
    ]
    hl_values.append(hl_spread)
    hl_spread_10d_avg = round(
        sum(hl_values) / len(hl_values), 1)

    print(
        f"  A/D cumulative: {ad_line_cumulative:+.0f} "
        f"(net today: {net_ad:+d}) | "
        f"H-L spread: {hl_spread:+d} "
        f"(10d avg: {hl_spread_10d_avg:+.1f})",
    )

    # 2. Fetch Nifty and VIX
    nifty_close, nifty_ath, vix, vix_change = fetch_nifty_and_vix()

    # 3. Calculate breadth (52W counts filled from snapshot below)
    breadth = calc_breadth(rows)
    breadth["new_52w_highs"] = new_highs
    breadth["new_52w_lows"] = new_lows
    breadth["highs_minus_lows"] = new_highs - new_lows

    # 3b. 7-day breadth trend (prior rows + today for divergence)
    prior_internals = fetch_market_internals_prior_rows(6)
    lows_rising_7d, ma150_falling_7d = compute_breadth_7d_flags(
        prior_internals, breadth,
    )
    print(
        f"  7d breadth flags: new_lows_rising={lows_rising_7d} "
        f"above_ma150_falling={ma150_falling_7d}",
    )

    # 4. Previous week comparison
    prev = fetch_previous_internals(days_ago=7)
    stage2_wow = None
    highs_wow = None
    if prev:
        stage2_wow = round(
            breadth["stage2_pct"] - prev.get("stage2_pct", 0), 1)
        highs_wow = (breadth["new_52w_highs"]
                     - prev.get("new_52w_highs", 0))

    # 5. Nifty metrics
    nifty_pct_from_ath = None
    nifty_near_ath = False
    if nifty_close and nifty_ath:
        nifty_pct_from_ath = round(
            (nifty_close - nifty_ath) / nifty_ath * 100, 2)
        nifty_near_ath = nifty_pct_from_ath > -5

    # 5b. Nifty short-term trend (streaks, 3d change, regime label).
    # Pass trading_date so the nifty_sectors history is bounded —
    # rows from after trading_date won't be visible, and a warning
    # fires when today's row hasn't been written by fetch_nifty_sectors
    # yet so a missing row never silently passes through.
    nifty_trend = fetch_nifty_trend_metrics(
        today_nifty_close=nifty_close, trading_date=trading_date,
    )

    # 5c. Nifty % 1d — canonical source is nifty_sectors WHERE date
    # equals today's trading_date. The previous "compute from
    # market_internals.nifty_close history" path produced 0.0 % on days
    # when yfinance returned a stale close (today_close == prior_close
    # → diff = 0). nifty_change_1d_canonical() reads the value
    # directly from nifty_sectors with a strict date match, falls back
    # to the history calc and then yesterday's sectors row, and flags
    # each fallback so downstream consumers can tell when the number
    # is stale.
    nifty_change_1d, nifty_data_stale = nifty_change_1d_canonical(
        trading_date=trading_date,
        today_nifty=nifty_close,
    )

    # 6. VIX classification
    vix_level = classify_vix(vix)

    # 7. Divergence detection
    div_active, div_severity, div_type, div_notes = detect_divergence(
        breadth,
        nifty_close,
        nifty_ath,
        prev,
        lows_rising_7d=lows_rising_7d,
        ma150_falling_7d=ma150_falling_7d,
    )

    # 8. Health score
    health_score, market_phase = calc_health_score(
        breadth, vix, nifty_close, nifty_ath, div_severity)

    # 9. Print summary
    print(f"\n{'─'*50}")
    print(f"MARKET INTERNALS SUMMARY")
    print(f"{'─'*50}")
    print(f"Nifty 50:         {nifty_close:.0f}" if nifty_close else "Nifty 50: N/A")
    print(f"From ATH:         {nifty_pct_from_ath:.1f}%" if nifty_pct_from_ath else "")
    print(f"India VIX:        {vix:.1f} ({vix_level})" if vix else "VIX: N/A")
    print(f"\nStage 2:          {breadth['stage2']} stocks ({breadth['stage2_pct']}%)")
    print(f"Stage 4:          {breadth['stage4']} stocks ({breadth['stage4_pct']}%)")
    print(f"52W Highs:        {breadth['new_52w_highs']}")
    print(f"52W Lows:         {breadth['new_52w_lows']}")
    print(f"Above MA150:      {breadth['above_ma150_pct']}%")
    print(f"Above MA30W:      {breadth['above_ma30w_pct']}%  (Weinstein breadth)")
    print(f"\nHealth Score:     {health_score}/100")
    print(f"Market Phase:     {market_phase}")
    print(f"Nifty 1d % (idx): {nifty_change_1d}")
    print(f"Nifty Trend:      {nifty_trend['market_trend']} "
          f"(up={nifty_trend['consecutive_up']} "
          f"down={nifty_trend['consecutive_down']} "
          f"3d={nifty_trend['change_3d']} "
          f"5d_sum={nifty_trend['change_1w']})")
    if div_active:
        print(f"\n⚠️  DIVERGENCE: {div_type} ({div_severity})")
        print(f"   {div_notes}")
    else:
        print(f"\n✅ No divergence detected")
    print(f"{'─'*50}\n")

    # 10. Upsert to Supabase
    #
    # WHY (breadth guard): On weekends/holidays no fetch runs and
    # price_data has no rows dated TODAY. The is_latest rows are
    # still from the last trading day — perfectly valid — but
    # writing them under TODAY's date with full breadth would
    # poison SwingX, because it queries `market_internals` ordered
    # by date desc and the freshest row would have breadth derived
    # from a date that mismatches the row's own date column.
    # When TODAY has no price_data, we still upsert the row
    # (nifty/vix/health are fresh from yfinance) but DROP the
    # breadth fields from the payload so the last trading day's
    # breadth remains the latest non-zero values in the table.
    # Guard now targets `trading_date` (the resolved latest data
    # date) rather than wall-clock TODAY. With the new resolution
    # this branch only fires in the catastrophic case where
    # price_data is completely empty for the chosen date, which
    # shouldn't happen because trading_date came from price_data.
    # Keep the check anyway — cheap and a safety net.
    has_today_data = has_price_data_for_date(trading_date)
    if not has_today_data:
        print(
            f"  WARNING: No price_data rows for {trading_date} - "
            f"breadth fields will be omitted from upsert"
        )

    payload = {
        "date": trading_date,
        "nifty_close": nifty_close,
        "nifty_ath": nifty_ath,
        "nifty_pct_from_ath": nifty_pct_from_ath,
        "nifty_near_ath": nifty_near_ath,
        "new_52w_highs": breadth["new_52w_highs"],
        "new_52w_lows": breadth["new_52w_lows"],
        "highs_minus_lows": breadth["highs_minus_lows"],
        "stage1_count": breadth["stage1"],
        "stage2_count": breadth["stage2"],
        "stage3_count": breadth["stage3"],
        "stage4_count": breadth["stage4"],
        "unclassified_count": breadth["unclassified"],
        "total_stocks": breadth["total"],
        "stage2_pct": breadth["stage2_pct"],
        "stage4_pct": breadth["stage4_pct"],
        "above_ma20_count": breadth["above_ma20"],
        "above_ma50_count": breadth["above_ma50"],
        "above_ma150_count": breadth["above_ma150"],
        "above_ma30w_count": breadth["above_ma30w"],
        "above_ma20_pct": breadth["above_ma20_pct"],
        "above_ma50_pct": breadth["above_ma50_pct"],
        "above_ma150_pct": breadth["above_ma150_pct"],
        "above_ma30w_pct": breadth["above_ma30w_pct"],
        "india_vix": vix,
        "vix_change_pct": vix_change,
        "vix_level": vix_level,
        "divergence_active": div_active,
        "divergence_severity": div_severity,
        "divergence_type": div_type,
        "divergence_notes": div_notes,
        "market_health_score": health_score,
        "market_phase": market_phase,
        "stage2_pct_wow": stage2_wow,
        "new_highs_wow": highs_wow,
        "nifty_consecutive_up": nifty_trend["consecutive_up"],
        "nifty_consecutive_down": nifty_trend["consecutive_down"],
        "nifty_change_1d": nifty_change_1d,
        # True when nifty_change_1d did NOT come from today's
        # nifty_sectors row (history fallback OR yesterday's
        # sectors row). Add the column once via:
        #   ALTER TABLE market_internals
        #     ADD COLUMN IF NOT EXISTS nifty_data_stale boolean
        #     DEFAULT false;
        # The upsert tolerates a missing column on older deploys.
        "nifty_data_stale": bool(nifty_data_stale),
        "nifty_change_3d": nifty_trend["change_3d"],
        "nifty_change_1w": nifty_trend["change_1w"],
        "market_trend": nifty_trend["market_trend"],
        "advance_decline_ratio": ad_ratio,
        # Raw counts kept alongside the ratio — useful for charts
        # and downstream consumers that want the net flow directly
        # (BreadthLab page reads these for context next to the
        # cumulative A/D line).
        "advances": adv,
        "declines": dec,
        "breadth_7d_new_lows_rising": lows_rising_7d,
        "breadth_7d_above_ma150_falling": ma150_falling_7d,
        # Weinstein breadth additions
        "ad_line_cumulative":
            round(ad_line_cumulative, 0),
        "hl_spread_10d_avg":
            hl_spread_10d_avg,
    }

    # WHY: If we forced a run on a day with no fresh price_data
    # (weekend / holiday / pre-fetch run), drop the breadth-derived
    # keys so we don't write a "today" row whose breadth values
    # actually describe the previous trading day. SwingX will then
    # naturally fall back to the most recent real trading day.
    if not has_today_data:
        for k in (
            "new_52w_highs", "new_52w_lows", "highs_minus_lows",
            "stage1_count", "stage2_count", "stage3_count",
            "stage4_count", "unclassified_count", "total_stocks",
            "stage2_pct", "stage4_pct",
            "above_ma20_count", "above_ma50_count",
            "above_ma150_count", "above_ma30w_count",
            "above_ma20_pct", "above_ma50_pct",
            "above_ma150_pct", "above_ma30w_pct",
            "advance_decline_ratio",
            "advances",
            "declines",
            "breadth_7d_new_lows_rising",
            "breadth_7d_above_ma150_falling",
            # Weinstein additions: derived from today's breadth too,
            # so they must be dropped on non-trading days for the
            # same reason — otherwise cumulative A/D and the 10d
            # H-L average get written under TODAY's date while the
            # underlying counts describe yesterday's session.
            "ad_line_cumulative",
            "hl_spread_10d_avg",
        ):
            payload.pop(k, None)

    try:
        supabase.table("market_internals")\
            .upsert(payload, on_conflict="date")\
            .execute()
        print("✅ Saved to market_internals table")
    except Exception as e:
        print(f"❌ Save failed: {e}")


if __name__ == "__main__":
    main()