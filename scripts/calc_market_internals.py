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
        .select("company_id,close,ma20,ma50,ma150,"
                "stage,obv_slope,high_52w,low_52w,rsi")\
        .eq("is_latest", True)\
        .execute()
    print(f"  Found {len(res.data)} companies with price data")
    return res.data


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

    # 52W highs and lows
    # Near 52W high = within 2% of 52W high
    # Near 52W low = within 2% of 52W low
    new_highs = sum(1 for r in rows
                    if r.get("close") and r.get("high_52w")
                    and r["close"] >= r["high_52w"] * 0.98)
    new_lows = sum(1 for r in rows
                   if r.get("close") and r.get("low_52w")
                   and r["close"] <= r["low_52w"] * 1.02)

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
        "new_52w_highs": new_highs,
        "new_52w_lows": new_lows,
        "highs_minus_lows": new_highs - new_lows,
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

def detect_divergence(breadth, nifty_close, nifty_ath, prev):
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

    # 1. Fetch price data
    rows = fetch_latest_price_data()
    if not rows:
        print("No price data found. Run fetch_price_data.py first.")
        sys.exit(1)

    # 2. Fetch Nifty and VIX
    nifty_close, nifty_ath, vix, vix_change = fetch_nifty_and_vix()

    # 3. Calculate breadth
    breadth = calc_breadth(rows)

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

    # 6. VIX classification
    vix_level = classify_vix(vix)

    # 7. Divergence detection
    div_active, div_severity, div_type, div_notes = detect_divergence(
        breadth, nifty_close, nifty_ath, prev)

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