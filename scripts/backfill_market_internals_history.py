"""Backfill market_internals for every historical trading day.

After Steps 2-4 of the Phase-1 runbook (fetch_bhav_daily --backfill,
fetch_nifty_history, compute_mansfield_rs), price_data + nifty_history
together contain ~5 years of everything we need to RECONSTRUCT the
market_internals table day by day — breadth, A/D line, H-L spread,
VIX, divergence flags, health score, market phase.

This script reads cached DB rows (no per-stock yfinance calls), loops
historical dates in order, and bulk-upserts one market_internals row
per day matching the schema the daily calc_market_internals.py writes.

Usage:
  python scripts/backfill_market_internals_history.py
  python scripts/backfill_market_internals_history.py --dry-run
  python scripts/backfill_market_internals_history.py --from=2024-01-01
  python scripts/backfill_market_internals_history.py --skip-vix
  python scripts/backfill_market_internals_history.py --skip-existing

Notes:
  --skip-existing  by default we overwrite existing rows (because the
                   historical aggregation is more accurate than what
                   the daily script wrote earlier). Add this flag to
                   leave existing rows alone and fill only new dates.
  --skip-vix       skip the one yfinance call for ^INDIAVIX history.
                   The vix / vix_level / vix_change_pct fields will
                   be null for backfilled rows.
  --from=YYYY-MM-DD   start from this date (default: oldest in
                      price_data).

Runtime: ~5-10 minutes for 5 years. One pass through price_data
date-by-date, in-memory rolling state for running totals.
"""
from __future__ import annotations
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

from db import bulk_upsert, log_event, supabase  # noqa: E402

# Reuse helpers from the daily script for identical formulas / outputs.
# The daily run and this backfill MUST agree on every formula or
# BreadthLab and downstream consumers will see seams.
from calc_market_internals import (  # noqa: E402
    classify_vix,
    calc_health_score,
    _nifty_trend_signal,
)


DRY_RUN       = "--dry-run" in sys.argv
SKIP_VIX      = "--skip-vix" in sys.argv
SKIP_EXISTING = "--skip-existing" in sys.argv
FROM_DATE = None
for arg in sys.argv[1:]:
    if arg.startswith("--from="):
        FROM_DATE = arg.split("=", 1)[1]


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        f = float(v)
        if f != f or f in (float("inf"), float("-inf")):
            return None
        return f
    except (TypeError, ValueError):
        return None


# ─────────────────────────────────────────────────────────────────
# Pre-load helper datasets (one shot each)
# ─────────────────────────────────────────────────────────────────

def load_nifty_history() -> pd.Series:
    """date → nifty_close, full series."""
    print("Loading nifty_history...")
    rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        res = (
            supabase.table("nifty_history")
            .select("date,close")
            .order("date")
            .range(offset, offset + page - 1)
            .execute()
        )
        batch = list(res.data or [])
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    if not rows:
        raise RuntimeError(
            "nifty_history is empty. Run scripts/fetch_nifty_history.py first.",
        )
    df = pd.DataFrame(rows)
    df["date"] = df["date"].astype(str).str.slice(0, 10)
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df.dropna(subset=["close"]).drop_duplicates("date", keep="last")
    df = df.sort_values("date").reset_index(drop=True)
    print(f"  {len(df)} Nifty daily rows "
          f"({df['date'].iloc[0]} → {df['date'].iloc[-1]})")
    return df.set_index("date")["close"]


def load_vix_history() -> pd.Series:
    """India VIX daily closes from yfinance — single call covers 5y."""
    if SKIP_VIX:
        return pd.Series(dtype=float)
    print("Fetching ^INDIAVIX history from yfinance...")
    try:
        hist = yf.Ticker("^INDIAVIX").history(period="5y")
        if hist is None or hist.empty:
            print("  WARNING: VIX history empty — fields will be null")
            return pd.Series(dtype=float)
        idx = pd.DatetimeIndex(hist.index)
        if idx.tz is not None:
            idx = idx.tz_localize(None)
        s = pd.Series(
            hist["Close"].astype(float).values,
            index=idx.normalize().strftime("%Y-%m-%d"),
        )
        s = s[~s.index.duplicated(keep="last")]
        s = s.sort_index()
        print(f"  {len(s)} VIX daily rows")
        return s
    except Exception as exc:
        print(f"  VIX fetch failed: {exc} — fields will be null")
        return pd.Series(dtype=float)


def load_distinct_dates(
    from_date: str | None,
    nifty: pd.Series,
) -> list[str]:
    """Sorted ascending list of trading dates to backfill.

    WHY: previously this queried `SELECT date FROM price_data
    ORDER BY date` and paginated, but with 1.57M rows that scans
    the whole table 1500+ times and Supabase rejects it with a
    statement timeout (code 57014).

    Switch to the trading-day set from `nifty_history`. Nifty 50
    trades every NSE-open day; any date there is a date we want
    a market_internals row for. Eliminates the heavy query.
    Any date in nifty but missing from price_data simply gets
    skipped further down (fetch_price_rows_for_date returns []).
    """
    # load_nifty_history stores the index as 'YYYY-MM-DD' strings
    # (set via df["date"] = df["date"].astype(str).str.slice(0, 10)
    # then set_index). str(d)[:10] safely handles both that case
    # AND the case where someone refactors load_nifty_history to
    # use a DatetimeIndex — str(Timestamp) is "YYYY-MM-DD HH:MM:SS",
    # so [:10] strips to the date portion in either case.
    dates = [str(d)[:10] for d in nifty.index]
    if from_date:
        dates = [d for d in dates if d >= from_date]
    dates = sorted(set(dates))
    print(f"Trading dates to process: {len(dates)} "
          f"(from nifty_history)"
          + (f" since {from_date}" if from_date else ""))
    return dates


def fetch_price_rows_for_date(target_date: str) -> list[dict]:
    """All price_data rows for one trading date (paginated)."""
    rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        res = (
            supabase.table("price_data")
            .select(
                "company_id,close,ma20,ma50,ma150,ma30w,stage,"
                "high_52w,low_52w",
            )
            .eq("date", target_date)
            .range(offset, offset + page - 1)
            .execute()
        )
        batch = list(res.data or [])
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


# ─────────────────────────────────────────────────────────────────
# Per-date breadth aggregation
# ─────────────────────────────────────────────────────────────────

def aggregate_breadth(rows: list[dict]) -> dict[str, Any]:
    """Same shape as calc_market_internals.calc_breadth + 52W counts."""
    total = len(rows)
    if total == 0:
        return {}
    stage_counts = {"Stage 1": 0, "Stage 2": 0, "Stage 3": 0, "Stage 4": 0, "Unclassified": 0}
    above_ma20 = above_ma50 = above_ma150 = above_ma30w = 0
    new_highs = new_lows = 0

    for r in rows:
        stage = r.get("stage") or "Unclassified"
        stage_counts[stage] = stage_counts.get(stage, 0) + 1

        close = _f(r.get("close"))
        if close is None:
            continue
        for ma_field, counter_key in (
            ("ma20", "above_ma20"),
            ("ma50", "above_ma50"),
            ("ma150", "above_ma150"),
            ("ma30w", "above_ma30w"),
        ):
            ma = _f(r.get(ma_field))
            if ma is not None and ma > 0 and close > ma:
                if counter_key == "above_ma20":   above_ma20 += 1
                elif counter_key == "above_ma50":  above_ma50 += 1
                elif counter_key == "above_ma150": above_ma150 += 1
                elif counter_key == "above_ma30w": above_ma30w += 1

        h52 = _f(r.get("high_52w"))
        l52 = _f(r.get("low_52w"))
        if h52 is not None and close >= h52 * 0.99:
            new_highs += 1
        if l52 is not None and close <= l52 * 1.01:
            new_lows += 1

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
        "new_52w_highs": new_highs,
        "new_52w_lows": new_lows,
        "highs_minus_lows": new_highs - new_lows,
    }


def compute_advance_decline(
    rows: list[dict],
    prev_closes: dict[str, float],
) -> tuple[int, int]:
    """A/D vs the carried-over previous-session close map."""
    adv = dec = 0
    for r in rows:
        cid = r.get("company_id")
        cur = _f(r.get("close"))
        if cid is None or cur is None:
            continue
        prev = prev_closes.get(str(cid))
        if prev is None:
            continue
        if cur > prev:
            adv += 1
        elif cur < prev:
            dec += 1
    return adv, dec


# ─────────────────────────────────────────────────────────────────
# Divergence detection (port from calc_market_internals.detect_divergence
# but simplified — no 7d breadth flags since those would require
# remote DB reads inside the inner loop. Will fill in approximate
# form using the running history we maintain.)
# ─────────────────────────────────────────────────────────────────

def detect_divergence_local(
    breadth: dict[str, Any],
    nifty_close: float | None,
    nifty_ath: float | None,
    prev_row: dict | None,
    lows_rising_7d: bool,
    ma150_falling_7d: bool,
) -> tuple[bool, str, str, str]:
    signals: list[str] = []
    severity = "none"

    if nifty_close is None or nifty_ath is None:
        return False, "none", "", "Nifty data unavailable"

    pct_from_ath = (nifty_close - nifty_ath) / nifty_ath * 100
    near_ath = pct_from_ath > -5

    if near_ath and breadth["stage2_pct"] < 25:
        signals.append(
            f"Only {breadth['stage2_pct']}% in Stage 2 while Nifty "
            f"{abs(pct_from_ath):.1f}% from ATH",
        )
        severity = "severe"
    elif near_ath and breadth["stage2_pct"] < 35:
        signals.append(
            f"Stage 2 declining ({breadth['stage2_pct']}%) near highs",
        )
        severity = "moderate" if severity == "none" else severity

    if near_ath and breadth["new_52w_lows"] > breadth["new_52w_highs"]:
        signals.append(
            f"More 52W lows ({breadth['new_52w_lows']}) than highs "
            f"({breadth['new_52w_highs']}) near ATH",
        )
        severity = "severe"

    if breadth["new_52w_lows"] > 50:
        signals.append(f"{breadth['new_52w_lows']} stocks at 52W lows")
        severity = "moderate" if severity == "none" else severity

    if breadth["stage4_pct"] > 35:
        signals.append(f"{breadth['stage4_pct']}% in Stage 4")
        severity = "moderate" if severity == "none" else severity

    if prev_row and breadth["stage2_pct"] < (prev_row.get("stage2_pct") or 100) - 5:
        drop = round((prev_row["stage2_pct"] or 0) - breadth["stage2_pct"], 1)
        signals.append(f"Stage 2 dropped {drop}% in a week")
        severity = "mild" if severity == "none" else severity

    if lows_rising_7d and ma150_falling_7d:
        signals.append("7d: lows rising + above_ma150 falling")
        severity = "moderate" if severity == "none" else severity
    elif lows_rising_7d:
        signals.append("7d: new 52W lows rising")
        severity = "mild" if severity == "none" else severity
    elif ma150_falling_7d:
        signals.append("7d: above_ma150 declining")
        severity = "mild" if severity == "none" else severity

    div_active = len(signals) > 0
    div_type = (
        "ATH Divergence" if near_ath and div_active
        else "Breadth Deterioration" if div_active
        else ""
    )
    notes = " | ".join(signals) if signals else "No divergence detected"
    return div_active, severity, div_type, notes


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main() -> int:
    print("backfill_market_internals_history")
    print("=" * 50)
    print(f"DRY_RUN={DRY_RUN}  SKIP_VIX={SKIP_VIX}  "
          f"SKIP_EXISTING={SKIP_EXISTING}  FROM={FROM_DATE}")
    started = time.time()

    nifty = load_nifty_history()
    vix = load_vix_history()
    dates = load_distinct_dates(FROM_DATE, nifty)
    if not dates:
        print("Nothing to backfill.")
        return 1

    # Existing rows — if SKIP_EXISTING is set we skip dates that
    # are already populated. Otherwise we overwrite (more accurate
    # aggregation from price_data than what the daily script may
    # have written earlier).
    existing_dates: set[str] = set()
    if SKIP_EXISTING:
        print("Loading existing market_internals dates...")
        offset = 0
        page = 1000
        while True:
            r = (
                supabase.table("market_internals")
                .select("date")
                .order("date")
                .range(offset, offset + page - 1)
                .execute()
            )
            b = list(r.data or [])
            for row in b:
                d = str(row.get("date") or "")[:10]
                if d:
                    existing_dates.add(d)
            if len(b) < page:
                break
            offset += page
        print(f"  {len(existing_dates)} dates already in market_internals")

    # Running state
    prev_closes: dict[str, float] = {}
    ad_line_cum = 0.0
    hl_history: list[float] = []
    nifty_ath_running: float | None = None
    prev_payload: dict | None = None
    week_ago_payload: dict | None = None  # ~5 sessions back
    payload_history: list[dict] = []  # tail of last 7 payloads

    # Streaks of nifty change_1d for trend signal
    nifty_changes_recent: list[float] = []

    batch: list[dict] = []
    BATCH_SIZE = 100
    n_done = 0
    n_skipped = 0
    n_errors = 0

    for i, d in enumerate(dates, start=1):
        if SKIP_EXISTING and d in existing_dates:
            n_skipped += 1
            continue
        try:
            rows = fetch_price_rows_for_date(d)
            if not rows:
                n_skipped += 1
                continue

            breadth = aggregate_breadth(rows)
            if not breadth:
                n_skipped += 1
                continue

            # A/D from carry-over map
            adv, dec = compute_advance_decline(rows, prev_closes)
            ad_ratio = round(adv / dec, 2) if dec > 0 else None
            net_ad = adv - dec
            ad_line_cum += net_ad

            # Update prev_closes for next iteration
            for r in rows:
                cid = r.get("company_id")
                cv = _f(r.get("close"))
                if cid is not None and cv is not None:
                    prev_closes[str(cid)] = cv

            # H-L spread + 10d avg
            hl_spread = breadth["highs_minus_lows"]
            hl_history.append(hl_spread)
            if len(hl_history) > 10:
                hl_history.pop(0)
            hl_10d_avg = round(sum(hl_history) / len(hl_history), 1)

            # Nifty close + ATH running max
            nifty_close = _f(nifty.get(d))
            if nifty_close is not None:
                if nifty_ath_running is None or nifty_close > nifty_ath_running:
                    nifty_ath_running = nifty_close
            pct_from_ath = None
            near_ath = False
            if nifty_close is not None and nifty_ath_running is not None and nifty_ath_running > 0:
                pct_from_ath = round((nifty_close - nifty_ath_running) / nifty_ath_running * 100, 2)
                near_ath = pct_from_ath > -5

            # Nifty 1d change
            prev_nifty = _f(prev_payload.get("nifty_close") if prev_payload else None)
            nifty_change_1d = None
            if nifty_close is not None and prev_nifty and prev_nifty > 0:
                nifty_change_1d = round((nifty_close - prev_nifty) / prev_nifty * 100, 2)

            # Streaks + 3d/1w sums
            if nifty_change_1d is not None:
                nifty_changes_recent.append(nifty_change_1d)
                if len(nifty_changes_recent) > 6:
                    nifty_changes_recent.pop(0)
            # Streaks count from the latest day backward
            tail = list(reversed(nifty_changes_recent))
            consec_up = 0
            for c in tail:
                if c > 0:
                    consec_up += 1
                else:
                    break
            consec_down = 0
            for c in tail:
                if c < 0:
                    consec_down += 1
                else:
                    break
            change_3d = round(sum(tail[:3]), 2) if len(tail) >= 3 else None
            change_1w = round(sum(tail[:5]), 2) if len(tail) >= 5 else None
            market_trend = _nifty_trend_signal(consec_up, consec_down, change_1w)

            # VIX
            vix_val = _f(vix.get(d)) if len(vix) else None
            vix_level = classify_vix(vix_val) if vix_val is not None else "unknown"

            # 7d breadth flags vs ~7 sessions ago (oldest in history tail)
            lows_rising_7d = False
            ma150_falling_7d = False
            if len(payload_history) >= 6:
                old = payload_history[0]
                lows_t = breadth["new_52w_lows"]
                lows_o = old.get("new_52w_lows")
                if isinstance(lows_o, (int, float)) and lows_t > lows_o:
                    lows_rising_7d = True
                ma150_t = breadth["above_ma150_pct"]
                ma150_o = old.get("above_ma150_pct")
                if isinstance(ma150_o, (int, float)) and ma150_t < ma150_o:
                    ma150_falling_7d = True

            # Week-ago payload (~5 sessions back) for WoW comparison
            week_ago_payload = payload_history[-5] if len(payload_history) >= 5 else None
            stage2_wow = None
            highs_wow = None
            if week_ago_payload:
                stage2_wow = round(
                    breadth["stage2_pct"] - (week_ago_payload.get("stage2_pct") or 0), 1,
                )
                highs_wow = breadth["new_52w_highs"] - (week_ago_payload.get("new_52w_highs") or 0)

            # Divergence
            div_active, div_sev, div_type, div_notes = detect_divergence_local(
                breadth, nifty_close, nifty_ath_running, week_ago_payload,
                lows_rising_7d, ma150_falling_7d,
            )

            # Health score
            health_score, market_phase = calc_health_score(
                breadth, vix_val, nifty_close, nifty_ath_running, div_sev,
            )

            payload = {
                "date": d,
                "nifty_close": nifty_close,
                "nifty_ath": nifty_ath_running,
                "nifty_pct_from_ath": pct_from_ath,
                "nifty_near_ath": near_ath,
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
                "india_vix": vix_val,
                "vix_level": vix_level,
                "divergence_active": div_active,
                "divergence_severity": div_sev,
                "divergence_type": div_type,
                "divergence_notes": div_notes,
                "market_health_score": health_score,
                "market_phase": market_phase,
                "stage2_pct_wow": stage2_wow,
                "new_highs_wow": highs_wow,
                "nifty_consecutive_up": consec_up,
                "nifty_consecutive_down": consec_down,
                "nifty_change_1d": nifty_change_1d,
                "nifty_change_3d": change_3d,
                "nifty_change_1w": change_1w,
                "market_trend": market_trend,
                "advance_decline_ratio": ad_ratio,
                "advances": adv,
                "declines": dec,
                "breadth_7d_new_lows_rising": lows_rising_7d,
                "breadth_7d_above_ma150_falling": ma150_falling_7d,
                "ad_line_cumulative": round(ad_line_cum, 0),
                "hl_spread_10d_avg": hl_10d_avg,
            }
            batch.append(payload)
            n_done += 1

            # Maintain payload tail (last 7 sessions for window queries)
            payload_history.append(payload)
            if len(payload_history) > 7:
                payload_history.pop(0)
            prev_payload = payload

            if len(batch) >= BATCH_SIZE:
                if not DRY_RUN:
                    bulk_upsert("market_internals", batch, "date")
                batch = []
                elapsed = time.time() - started
                pct = i / len(dates) * 100
                print(f"  [{i}/{len(dates)}] {d}  "
                      f"adv/dec={adv}/{dec}  ad_line={int(ad_line_cum):+d}  "
                      f"health={health_score}  ({elapsed:.0f}s · {pct:.0f}%)")

        except Exception as exc:
            n_errors += 1
            print(f"  ! {d}: {exc}")

    # Flush remainder
    if batch and not DRY_RUN:
        bulk_upsert("market_internals", batch, "date")

    elapsed = time.time() - started
    print()
    print("Done.")
    print(f"  Dates processed   : {n_done}")
    print(f"  Dates skipped     : {n_skipped}")
    print(f"  Dates errored     : {n_errors}")
    print(f"  Elapsed           : {elapsed:.0f}s")
    print(f"  Final A/D line    : {int(ad_line_cum):+d}")

    log_event("backfill_market_internals_finished", {
        "dry_run": DRY_RUN, "skip_vix": SKIP_VIX, "skip_existing": SKIP_EXISTING,
        "from_date": FROM_DATE, "dates_processed": n_done,
        "dates_skipped": n_skipped, "errors": n_errors,
        "elapsed_seconds": int(elapsed),
        "final_ad_line_cumulative": int(ad_line_cum),
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
