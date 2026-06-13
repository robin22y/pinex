"""
calc_breadth_intelligence.py — Daily market intelligence report.

For each trading day:
1. Fetch today's market metrics from market_internals + price_data
2. Fetch full 7-year history from same tables
3. Calculate similarity scores against all historical dates
4. Find top 5 most similar historical periods
5. Fetch outcomes 20/40/60 trading days after each similar period
6. Build structured prompt → Gemini 2.5 Flash
7. Store result in market_intelligence table

Admin-only. Never exposed to end users.

SCHEMA NOTES — read before tweaking SELECTs
  Live market_internals uses different column names than the spec assumed:
    spec name          → actual column on market_internals
    vix                → india_vix
    advance_count      → advances
    decline_count      → declines
    breadth_pct        → above_ma30w_pct
       (canonical breadth across the codebase — % of stocks
        above their 30-week MA, matches the Mansfield cycle frame.
        above_ma150_pct / above_ma50_pct are also available if you
        want a shorter-term reading.)
  Historical stage distribution lives directly on market_internals
  (stage1_count, stage2_count, stage3_count, stage4_count, stage2_pct,
  stage4_pct, total_stocks) — there's no need to scan price_data for it.
  We pull stage2_pct from the same _fetch_history rows used for
  similarity.

  The market_intelligence table's `breadth_pct` and `vix` columns
  (per Step 1 SQL) STORE the human-friendly names — we map at upsert
  time so downstream admin readers don't need to know about the
  rename.

Usage:
  python calc_breadth_intelligence.py              # live write
  python calc_breadth_intelligence.py --dry-run    # preview, no writes
  python calc_breadth_intelligence.py --date 2026-06-12  # specific date
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")
sys.path.insert(0, str(_script_dir))

from ai_config import get_ai_config  # noqa: E402
from db import log_event, supabase  # noqa: E402

logger.add(
    _script_dir / "logs" / "calc_breadth_intelligence_{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="14 days",
    level="INFO",
)

# Force UTF-8 on Windows console so non-ASCII names don't crash a print.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ── Gemini setup ────────────────────────────────────────────────────────────

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL") or get_ai_config(
    "gemini_pipeline_model", "gemini-2.5-flash",
)
GEMINI_URL = (
    "https://generativelanguage.googleapis.com"
    f"/v1beta/models/{GEMINI_MODEL}:generateContent"
    f"?key={GEMINI_KEY}"
)


# ── System prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a market structure analyst for PineX, an Indian equity platform.
You analyse NSE market breadth data using cycle analysis methodology.

Your job:
- Assess current market health using breadth, stage distribution, and advance/decline data
- Find patterns by comparing today's metrics to historical similar periods
- Identify strengths, weaknesses, rotation signals, and risk flags
- Give the admin actionable intelligence — not investment advice

Rules:
- Never use buy/sell/recommend language
- Speak in terms of data states and structural observations
- Be direct and specific — no hedging, no vague statements
- Flag divergences, extremes, and unusual readings explicitly
- Reference specific numbers from the data provided

Respond ONLY in valid JSON. No markdown, no preamble."""


# ── Fetch functions ──────────────────────────────────────────────────────────

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _fetch_today_internals(target_date: str) -> dict | None:
    """Fetch today's market_internals row."""
    res = (
        supabase.table("market_internals")
        .select(
            "date,nifty_close,india_vix,advances,declines,"
            "above_ma30w_pct,stage2_pct,stage4_pct,"
            "market_health_score,market_phase,market_trend"
        )
        .eq("date", target_date)
        .single()
        .execute()
    )
    return res.data


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _fetch_today_stage_counts(target_date: str) -> dict:
    """Fetch stage distribution for target date from price_data."""
    res = (
        supabase.table("price_data")
        .select("stage")
        .eq("date", target_date)
        .eq("is_latest", True)
        .execute()
    )
    rows = res.data or []
    total = len(rows)
    if total == 0:
        return {}
    counts = {"Stage 1": 0, "Stage 2": 0, "Stage 3": 0, "Stage 4": 0}
    for r in rows:
        s = str(r.get("stage") or "")
        if s in counts:
            counts[s] += 1
    return {
        "total": total,
        "stage1_count": counts["Stage 1"],
        "stage2_count": counts["Stage 2"],
        "stage3_count": counts["Stage 3"],
        "stage4_count": counts["Stage 4"],
        "stage1_pct": round(counts["Stage 1"] / total * 100, 1),
        "stage2_pct": round(counts["Stage 2"] / total * 100, 1),
        "stage3_pct": round(counts["Stage 3"] / total * 100, 1),
        "stage4_pct": round(counts["Stage 4"] / total * 100, 1),
    }


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _fetch_history() -> list[dict]:
    """
    Fetch full market_internals history — paginated.

    Includes stage2_pct so we don't need a separate price_data scan
    for the historical stage distribution.
    """
    all_rows: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        res = (
            supabase.table("market_internals")
            .select(
                "date,nifty_close,india_vix,advances,declines,"
                "above_ma30w_pct,stage2_pct"
            )
            .order("date", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = res.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def _fetch_nifty_return(
    from_date: str, trading_days: int, all_history: list[dict],
) -> float | None:
    """
    Calculate Nifty return N trading days after from_date.
    Uses the pre-fetched history list.
    """
    dates = [r for r in all_history if r["date"] > from_date]
    if len(dates) < trading_days:
        return None
    start_price = next(
        (r["nifty_close"] for r in all_history if r["date"] == from_date), None,
    )
    if not start_price:
        return None
    end_price = dates[trading_days - 1].get("nifty_close")
    if not end_price or not start_price:
        return None
    return round((end_price - start_price) / start_price * 100, 2)


# ── Similarity calculation ───────────────────────────────────────────────────

def _calc_similarity_score(
    hist: dict,
    hist_stage2_pct: float,
    today_breadth: float,
    today_stage2_pct: float,
    today_adr: float,
    today_vix: float,
) -> float:
    """
    Lower score = more similar to today.
    Weighted distance across 4 metrics.
    """
    hist_breadth = float(hist.get("above_ma30w_pct") or 0)
    hist_adv = float(hist.get("advances") or 0)
    hist_dec = float(hist.get("declines") or 1)
    hist_adr = hist_adv / hist_dec if hist_dec else 1
    hist_vix = float(hist.get("india_vix") or 15)

    score = (
        abs(hist_breadth - today_breadth) * 2.0
        + abs(hist_stage2_pct - today_stage2_pct) * 1.5
        + abs(hist_adr - today_adr) * 1.0
        + abs(hist_vix - today_vix) * 0.5
    )
    return score


def find_similar_periods(
    history: list[dict],
    stage_history: dict[str, dict],
    today_date: str,
    today_breadth: float,
    today_stage2_pct: float,
    today_adr: float,
    today_vix: float,
    top_n: int = 5,
) -> list[dict]:
    """Find top N most similar historical periods."""
    scored = []
    for row in history:
        d = row["date"]
        # Skip recent 60 days — too close to today
        if d >= (date.fromisoformat(today_date) - timedelta(days=60)).isoformat():
            continue
        stage2_pct = stage_history.get(d, {}).get("stage2_pct", 30.0)
        score = _calc_similarity_score(
            row, stage2_pct,
            today_breadth, today_stage2_pct,
            today_adr, today_vix,
        )
        scored.append((score, row, stage2_pct))

    scored.sort(key=lambda x: x[0])
    top = scored[:top_n]

    result = []
    for score, row, stage2_pct in top:
        result.append({
            "date": row["date"],
            "similarity_score": round(score, 2),
            "breadth_pct": row.get("above_ma30w_pct"),
            "stage2_pct": stage2_pct,
            "vix": row.get("india_vix"),
            "nifty_close": row.get("nifty_close"),
            "advance_count": row.get("advances"),
            "decline_count": row.get("declines"),
        })
    return result


# ── Prompt builder ───────────────────────────────────────────────────────────

def build_prompt(
    today_date: str,
    internals: dict,
    stage_counts: dict,
    similar_periods: list[dict],
    history: list[dict],
    recent_30: list[dict],
) -> str:
    """Build the Gemini user prompt."""

    adv = internals.get("advances", 0)
    dec = internals.get("declines", 0)
    adr = round(adv / dec, 2) if dec else 0

    similar_text = []
    for p in similar_periods:
        r20 = _fetch_nifty_return(p["date"], 20, history)
        r40 = _fetch_nifty_return(p["date"], 40, history)
        r60 = _fetch_nifty_return(p["date"], 60, history)
        similar_text.append(
            f"  {p['date']}: breadth={p['breadth_pct']}% stage2={p['stage2_pct']}% "
            f"vix={p['vix']} | Nifty after: 20d={r20}% 40d={r40}% 60d={r60}%"
        )

    recent_text = []
    for r in recent_30[-30:]:
        recent_text.append(
            f"  {r['date']}: breadth={r.get('above_ma30w_pct')}% "
            f"adv={r.get('advances')} dec={r.get('declines')} "
            f"vix={r.get('india_vix')} nifty={r.get('nifty_close')}"
        )

    return f"""Analyse Indian equity market structure for {today_date}.

TODAY'S METRICS:
Nifty Close: {internals.get('nifty_close')}
VIX: {internals.get('india_vix')}
Advance/Decline: {adv}/{dec} (ratio: {adr})
Breadth (% above 30W MA): {internals.get('above_ma30w_pct')}%
Stage Distribution:
  Stage 1 (Basing): {stage_counts.get('stage1_count')} stocks ({stage_counts.get('stage1_pct')}%)
  Stage 2 (Advancing): {stage_counts.get('stage2_count')} stocks ({stage_counts.get('stage2_pct')}%)
  Stage 3 (Topping): {stage_counts.get('stage3_count')} stocks ({stage_counts.get('stage3_pct')}%)
  Stage 4 (Declining): {stage_counts.get('stage4_count')} stocks ({stage_counts.get('stage4_pct')}%)

LAST 30 TRADING DAYS TREND:
{chr(10).join(recent_text)}

TOP 5 MOST SIMILAR HISTORICAL PERIODS (with Nifty outcomes):
{chr(10).join(similar_text)}

Respond with this exact JSON structure:
{{
  "market_pulse": "Bullish|Cautiously Bullish|Neutral|Cautious|Bearish",
  "one_line_summary": "Single sentence describing today's market structure",
  "strengths": ["list of 3-5 specific bullish structural observations"],
  "weaknesses": ["list of 3-5 specific bearish structural observations"],
  "key_divergences": ["list of any divergences between indicators"],
  "rotation_signals": ["list of sector/stage rotation signals if any"],
  "risk_flags": ["list of specific risk flags the admin should watch"],
  "historical_pattern_notes": "What the similar historical periods suggest about near-term direction",
  "breadth_reading": "Detailed reading of the breadth metric in context",
  "stage_distribution_reading": "What the stage counts tell us about market health",
  "admin_watch_items": ["3-5 specific things to monitor over next 5-10 days"],
  "data_quality_notes": "Any data anomalies or gaps worth flagging"
}}"""


# ── Gemini call ──────────────────────────────────────────────────────────────

def call_gemini(prompt: str) -> tuple[dict | None, int, int]:
    """Call Gemini and return (parsed_json, in_tokens, out_tokens)."""
    in_est = len(prompt) // 4

    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1500,
            "responseMimeType": "application/json",
        },
    }

    try:
        response = requests.post(
            GEMINI_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
    except Exception as exc:
        logger.error(f"Gemini request error: {exc}")
        return None, in_est, 0

    if response.status_code != 200:
        logger.error(f"Gemini HTTP {response.status_code}: {response.text[:200]}")
        return None, in_est, 0

    data = response.json()
    usage = data.get("usageMetadata") or {}
    in_tokens = int(usage.get("promptTokenCount") or in_est)
    out_tokens = int(usage.get("candidatesTokenCount") or 0)

    text = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )

    try:
        parsed = json.loads(text)
        return parsed, in_tokens, out_tokens
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e} — raw: {text[:300]}")
        return None, in_tokens, out_tokens


# ── Store result ─────────────────────────────────────────────────────────────

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def store_result(
    target_date: str,
    internals: dict,
    stage_counts: dict,
    similar_periods: list[dict],
    analysis: dict,
    raw_response: str,
    in_tokens: int,
    out_tokens: int,
) -> None:
    """
    Upsert into market_intelligence. The table column names (per Step 1
    SQL) are vix / breadth_pct / advance_decline_ratio — we map from the
    market_internals column names at write time so downstream readers
    don't need to know about the rename.
    """
    adv = internals.get("advances") or 0
    dec = internals.get("declines") or 1

    supabase.table("market_intelligence").upsert({
        "date": target_date,
        "market_pulse": analysis.get("market_pulse"),
        "breadth_pct": internals.get("above_ma30w_pct"),
        "stage2_pct": stage_counts.get("stage2_pct"),
        "advance_decline_ratio": round(adv / dec, 2) if dec else None,
        "vix": internals.get("india_vix"),
        "similar_periods": similar_periods,
        "analysis": analysis,
        "raw_response": raw_response,
        "model": GEMINI_MODEL,
        "in_tokens": in_tokens,
        "out_tokens": out_tokens,
    }, on_conflict="date").execute()


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--date", type=str, default=None)
    args = parser.parse_args()

    target_date = args.date or date.today().isoformat()
    dry_run = args.dry_run

    logger.info(f"calc_breadth_intelligence — {'DRY RUN' if dry_run else 'LIVE'} — {target_date}")

    # Step 1 — fetch today
    logger.info("Fetching today's internals...")
    internals = _fetch_today_internals(target_date)
    if not internals:
        logger.error(f"No market_internals row for {target_date} — aborting")
        return

    logger.info("Fetching today's stage counts...")
    stage_counts = _fetch_today_stage_counts(target_date)
    if not stage_counts:
        logger.error(f"No price_data for {target_date} — aborting")
        return

    # Step 2 — fetch history
    logger.info("Fetching full market history...")
    history = _fetch_history()
    logger.info(f"  {len(history)} historical days loaded")

    # Build the stage_history dict directly from the same history rows
    # (market_internals.stage2_pct is the per-date aggregate we'd have
    # spent thousands of price_data row reads to recompute).
    stage_history: dict[str, dict] = {}
    for r in history:
        s2 = r.get("stage2_pct")
        if s2 is not None:
            stage_history[r["date"]] = {"stage2_pct": float(s2)}
    logger.info(f"  {len(stage_history)} stage snapshots derived from history")

    # Step 3 — calculate similarity
    adv = float(internals.get("advances") or 0)
    dec = float(internals.get("declines") or 1)
    today_adr = adv / dec if dec else 1
    today_breadth = float(internals.get("above_ma30w_pct") or 0)
    today_stage2_pct = float(stage_counts.get("stage2_pct") or 0)
    today_vix = float(internals.get("india_vix") or 15)

    logger.info("Finding similar historical periods...")
    similar_periods = find_similar_periods(
        history, stage_history, target_date,
        today_breadth, today_stage2_pct,
        today_adr, today_vix,
    )
    for p in similar_periods:
        logger.info(f"  Similar: {p['date']} (score={p['similarity_score']})")

    # Step 4 — build prompt
    recent_30 = [r for r in history if r["date"] <= target_date][-30:]
    prompt = build_prompt(
        target_date, internals, stage_counts,
        similar_periods, history, recent_30,
    )
    logger.info(f"Prompt built — ~{len(prompt)//4} tokens estimated")

    if dry_run:
        logger.info("DRY RUN — skipping Gemini call")
        logger.info(f"Prompt preview:\n{prompt[:500]}...")
        return

    # Step 5 — call Gemini
    logger.info("Calling Gemini...")
    analysis, in_tokens, out_tokens = call_gemini(prompt)
    if not analysis:
        logger.error("Gemini returned no valid response — aborting")
        return

    logger.info(f"Gemini response: {in_tokens} in / {out_tokens} out tokens")
    logger.info(f"Market pulse: {analysis.get('market_pulse')}")
    logger.info(f"Summary: {analysis.get('one_line_summary')}")

    # Step 6 — store
    logger.info("Storing result...")
    store_result(
        target_date, internals, stage_counts,
        similar_periods, analysis, json.dumps(analysis),
        in_tokens, out_tokens,
    )
    logger.info("Stored ✅")

    # Step 7 — log event
    try:
        log_event("calc_breadth_intelligence_complete", {
            "date": target_date,
            "market_pulse": analysis.get("market_pulse"),
            "in_tokens": in_tokens,
            "out_tokens": out_tokens,
            "similar_periods_found": len(similar_periods),
        })
    except Exception as e:
        logger.warning(f"log_event failed: {e}")

    logger.info("calc_breadth_intelligence — done")


if __name__ == "__main__":
    main()
