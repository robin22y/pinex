"""
calc_market_internals.py
Calculates market breadth, stage distribution,
52W highs/lows, and divergence signals daily.
Runs after fetch_price_data.py completes.
"""

import os
import sys
import time
from datetime import date, datetime, timedelta

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
    """Get today's latest row per company."""
    print("Fetching latest price data...")
    res = supabase.table("price_data")\
        .select("company_id,date,close,ma20,ma50,ma150,"
                "stage,obv_slope,high_52w,low_52w,rsi")\
        .eq("is_latest", True)\
        .execute()
    print(f"  Found {len(res.data)} companies with price data")
    return res.data


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
    """All is_latest rows: close / 52W / optional prev_close (for A/D)."""
    for cols in ("close,high_52w,low_52w,prev_close", "close,high_52w,low_52w"):
        try:
            res = (
                supabase.table("price_data")
                .select(cols)
                .eq("is_latest", True)
                .execute()
            )
            return list(res.data or [])
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
    """(today - yesterday) / yesterday * 100 using market_internals.nifty_close."""
    if today_nifty is None:
        return None
    prev = fetch_prior_nifty_close_for_1d()
    if prev is None or prev <= 0:
        return None
    return round((float(today_nifty) - prev) / prev * 100, 2)


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
    """Fetch Nifty 50 and India VIX from yfinance."""
    print("Fetching Nifty 50 and VIX...")
    
    nifty_close = None
    nifty_ath = None
    vix = None
    vix_change = None

    try:
        nifty = yf.Ticker("^NSEI")
        nifty_hist = nifty.history(period="2y")
        if not nifty_hist.empty:
            nifty_close = float(nifty_hist["Close"].iloc[-1])
            nifty_ath = float(nifty_hist["Close"].max())
            print(f"  Nifty 50: {nifty_close:.0f} | ATH: {nifty_ath:.0f}")
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
    above_ma20 = sum(1 for r in rows
                     if r.get("close") and r.get("ma20")
                     and r["close"] > r["ma20"])
    above_ma50 = sum(1 for r in rows
                     if r.get("close") and r.get("ma50")
                     and r["close"] > r["ma50"])
    above_ma150 = sum(1 for r in rows
                      if r.get("close") and r.get("ma150")
                      and r["close"] > r["ma150"])

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
        "above_ma20_pct": round(above_ma20 / total * 100, 1),
        "above_ma50_pct": round(above_ma50 / total * 100, 1),
        "above_ma150_pct": round(above_ma150 / total * 100, 1),
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


def fetch_nifty_trend_metrics():
    """Multi-day Nifty 50 trend from nifty_sectors history.

    Pulls the last 6 rows (newest first). Streaks count consecutive positive /
    negative ``change_1d`` from the latest day backward. ``change_3d`` and the
    5-day ``change_1w`` used for the trend ladder are the *sum* of the last 3
    and 5 daily percentage changes (approximation; not compounded).
    """
    default = {
        "consecutive_up": 0,
        "consecutive_down": 0,
        "change_1d": None,
        "change_3d": None,
        "change_1w": None,
        "market_trend": "Neutral",
    }
    try:
        res = (
            supabase.table("nifty_sectors")
            .select("date,change_1d,current_value")
            .eq("index_name", "Nifty 50")
            .order("date", desc=True)
            .limit(6)
            .execute()
        )
        hist_data = res.data or []
    except Exception as e:
        print(f"  Nifty trend fetch failed: {e}")
        return default

    if not hist_data:
        print("  Nifty trend: no history in nifty_sectors yet")
        return default

    changes = [
        x for x in (_nf_change(r.get("change_1d")) for r in hist_data)
        if x is not None
    ]

    consec_up = 0
    for c in changes:
        if c > 0:
            consec_up += 1
        else:
            break

    consec_down = 0
    for c in changes:
        if c < 0:
            consec_down += 1
        else:
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

    print(f"\n{'='*50}")
    print(f"Market Internals — {TODAY}")
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

    # 5b. Nifty short-term trend (streaks, 3d change, regime label)
    nifty_trend = fetch_nifty_trend_metrics()

    # 5c. Nifty % 1d from stored market_internals closes (preferred for row)
    nifty_change_1d = compute_nifty_change_1d_from_internals(nifty_close)
    if nifty_change_1d is None:
        nifty_change_1d = nifty_trend.get("change_1d")

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
    payload = {
        "date": TODAY,
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
        "above_ma20_pct": breadth["above_ma20_pct"],
        "above_ma50_pct": breadth["above_ma50_pct"],
        "above_ma150_pct": breadth["above_ma150_pct"],
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
        "nifty_change_3d": nifty_trend["change_3d"],
        "nifty_change_1w": nifty_trend["change_1w"],
        "market_trend": nifty_trend["market_trend"],
        "advance_decline_ratio": ad_ratio,
        "breadth_7d_new_lows_rising": lows_rising_7d,
        "breadth_7d_above_ma150_falling": ma150_falling_7d,
    }

    try:
        supabase.table("market_internals")\
            .upsert(payload, on_conflict="date")\
            .execute()
        print("✅ Saved to market_internals table")
    except Exception as e:
        print(f"❌ Save failed: {e}")


if __name__ == "__main__":
    main()