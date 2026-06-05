"""
generate_descriptions.py
Daily Gemini-powered generator of plain-English cycle descriptions
for every symbol with swing_conditions on the latest trading date.

For each stock we build a small context (phase, criteria score, days in
phase, sector + sector breadth, what changed today) and ask Gemini 2.5
Flash Lite to return a strict JSON object with:
    narrative
    malayalam_line
    whats_happening
    why_this_phase
    what_changes
    broader_cycle

Results are upserted into stock_descriptions on (symbol, trading_date).
The four cycle-narrative columns map 1-to-1 to the accordions in
src/pages/StockDetail.jsx (CYCLE_ACCORDIONS) — keep them aligned.

Flags:
  --test            Process only 10 stocks; print output, no DB writes.
  --symbol SYMBOL   Single-stock dry run (no DB write). Implies test-style output.
  --full            Force regenerate descriptions for EVERY stock with a
                    swing_conditions row today, ignoring the
                    "criteria-changed-since-last-description" filter.
                    Auto-enabled on Sundays (weekly refresh) so stale
                    descriptions for stocks whose criteria sat still all
                    week still get a fresh narrative.

Default (delta-only) behaviour:
  Compare today's conditions_met to the criteria_score on each stock's
  most recent stock_descriptions row. Regenerate ONLY when:
    - no description has ever been written, OR
    - today's score differs from the last description's score
  Saves ~85% of Gemini calls on a normal weekday.

Conventions mirrored from existing scripts:
  - .env loaded from scripts/.env via python-dotenv
  - supabase + log_event imported from local db module
  - Gemini called via REST with the GEMINI_API_KEY env var
  - log_event() summary at the end
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

# Force UTF-8 on stdout/stderr so test-mode JSON dumps that contain
# Malayalam glyphs print on Windows (cp1252 default) without
# UnicodeEncodeError. Python 3.7+ supports reconfigure(); guard
# defensively for unusual stream types (e.g. some CI capture buffers).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from db import log_event, supabase
from nse_holidays import is_nse_holiday

load_dotenv(Path(__file__).parent / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
# Flash Lite for descriptions — quality is sufficient for plain-English
# phase prose. Flash (full) is reserved for Academy content where the
# longer, more nuanced writing pays for the extra cost. Override via
# the GEMINI_MODEL env var if you want to A/B test.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com"
    f"/v1beta/models/{GEMINI_MODEL}:generateContent"
    f"?key={GEMINI_KEY}"
)

DESCRIPTIONS_TABLE = "stock_descriptions"
SWING_TABLE = "swing_conditions"
PRICE_TABLE = "price_data"
COMPANIES_TABLE = "companies"
SECTORS_TABLE = "sectors"
CRITERIA_CHANGES_TABLE = "criteria_changes"

BATCH_SIZE = 50
BATCH_SLEEP_SEC = 1

# Rough Gemini Flash Lite heuristic: ~Rs 0.005 per 1k tokens
# (input+output combined). Flash Lite is roughly 1/2 the cost of Flash
# per token. Tunable from .env if Google's pricing shifts. The
# cost-guard ceiling stays at Rs 300/day — gives headroom to switch
# back to full Flash temporarily without redeploying the script.
INR_PER_1K_TOKENS = float(os.environ.get("GEMINI_INR_PER_1K_TOKENS", "0.005"))
COST_GUARD_INR = float(os.environ.get("GEMINI_COST_GUARD_INR", "300.0"))

# Token estimator constant (chars per token, rough): used only as a fallback
# when the Gemini response doesn't return usageMetadata.
CHARS_PER_TOKEN = 4.0

SYSTEM_PROMPT = (
    "You write plain English descriptions of stock market cycle positions "
    "for Indian retail traders. Your readers have basic English and speak "
    "Malayalam or Hindi at home. Write like a knowledgeable friend "
    "explaining clearly. Never give investment advice. Never give buy/sell "
    "signals. Never give price targets or stop losses. Always describe what "
    "IS — never what WILL BE. Keep every sentence short. Maximum 3 "
    "sentences per answer."
)


# ---------------------------------------------------------------------------
# Helpers: phase label, dates
# ---------------------------------------------------------------------------

_PHASE_LABELS = {
    "stage1": "Basing",
    "stage 1": "Basing",
    "stage2": "Advancing",
    "stage 2": "Advancing",
    "stage3": "Topping",
    "stage 3": "Topping",
    "stage4": "Declining",
    "stage 4": "Declining",
}


def _phase_label(stage: str | None) -> str:
    if not stage:
        return "Unknown"
    key = stage.strip().lower()
    return _PHASE_LABELS.get(key, stage.strip().title())


def _today_iso() -> str:
    return datetime.now().date().isoformat()


def _latest_trading_date() -> str:
    """Latest date present in swing_conditions, falling back to today.

    NOTE: column name on the live table is `date`, not `trading_date`.
    The variable name `trading_date` is kept throughout this script as
    a semantic label for the value — only the SQL column references
    change.
    """
    try:
        res = (
            supabase.table(SWING_TABLE)
            .select("date")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if rows:
            td = rows[0].get("date")
            if td:
                return str(td)[:10]
    except Exception as exc:
        print(f"latest_trading_date fallback (today) — error: {exc}")
    return _today_iso()


# ---------------------------------------------------------------------------
# Helpers: data fetching
# ---------------------------------------------------------------------------


def _paginated_select(
    table: str,
    select: str,
    *,
    eq: dict[str, Any] | None = None,
    in_filter: tuple[str, list[str]] | None = None,
    page: int = 1000,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        q = supabase.table(table).select(select)
        if eq:
            for k, v in eq.items():
                q = q.eq(k, v)
        if in_filter:
            col, values = in_filter
            if not values:
                return rows
            q = q.in_(col, values)
        try:
            res = q.range(start, start + page - 1).execute()
        except Exception as exc:
            print(f"_paginated_select error [{table}]: {exc}")
            return rows
        batch = getattr(res, "data", None) or []
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


def fetch_swing_rows(trading_date: str) -> list[dict[str, Any]]:
    # swing_conditions stores company_id + date (no symbol column).
    # Embed companies(symbol) via PostgREST foreign-table syntax so we
    # can lift the symbol onto each row — matches the pattern used in
    # calc_swing_conditions._paginated_fetch_for_date.
    rows = _paginated_select(
        SWING_TABLE,
        "company_id,conditions_met,stage2_new_this_week,date,"
        "condition_stage2,condition_delivery_above_avg,condition_near_ma20,"
        "condition_rsi_healthy,condition_volume_contracting,"
        "companies(symbol)",
        eq={"date": trading_date},
    )
    # Flatten companies.symbol → row.symbol so downstream code (which
    # does swing_row.get("symbol")) doesn't need to know about the join.
    # PostgREST returns the embedded relation as either a dict (one-to-one)
    # or a one-element list depending on schema; handle both.
    for r in rows:
        co = r.get("companies")
        if isinstance(co, dict):
            r["symbol"] = co.get("symbol")
        elif isinstance(co, list) and co:
            r["symbol"] = (co[0] or {}).get("symbol")
        else:
            r["symbol"] = None
    return rows


def fetch_companies_map(symbols: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    # Chunk symbols to keep URL length sane.
    chunk = 200
    for i in range(0, len(symbols), chunk):
        sub = symbols[i : i + chunk]
        rows = _paginated_select(
            COMPANIES_TABLE,
            "symbol,name,sector",
            in_filter=("symbol", sub),
        )
        for r in rows:
            sym = str(r.get("symbol") or "").strip().upper()
            if sym:
                out[sym] = r
    return out


def _resolve_company_ids(symbols: list[str]) -> dict[str, str]:
    """Resolve {symbol → company_id} via the companies table.

    Mirrors calc_swing_conditions._get_company_ids_by_symbol post the
    company_id schema fix — but scoped to a caller-supplied symbol
    list (cheaper than scanning all 2125 rows). Used by callers that
    need to query tables keyed on company_id (price_data,
    swing_conditions) when they only know the symbol upfront.
    """
    out: dict[str, str] = {}
    if not symbols:
        return out
    chunk = 200
    for i in range(0, len(symbols), chunk):
        sub = symbols[i : i + chunk]
        rows = _paginated_select(
            COMPANIES_TABLE,
            "id,symbol",
            in_filter=("symbol", sub),
        )
        for r in rows:
            sym = str(r.get("symbol") or "").strip().upper()
            cid = str(r.get("id") or "").strip()
            if sym and cid:
                out[sym] = cid
    return out


def fetch_latest_price_map(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Phase + optional 30W trend status for each symbol from price_data (is_latest).

    Schema fact: price_data is keyed on company_id (uuid), NOT
    symbol. The previous select ``symbol,stage,…`` + ``in_filter
    ("symbol", …)`` referenced a column that doesn't exist on the
    live table → PostgREST 400 → empty map → every description
    generated without the phase / above_ma context. We pre-resolve
    symbol → company_id via the companies table (mirroring
    calc_swing_conditions.py post-fix) then walk price_data by
    company_id, flattening the symbol back onto each output row so
    the rest of the script keeps indexing by symbol as before.
    """
    out: dict[str, dict[str, Any]] = {}
    id_by_symbol = _resolve_company_ids(symbols)
    if not id_by_symbol:
        return out
    sym_by_id = {v: k for k, v in id_by_symbol.items()}

    company_ids = list(id_by_symbol.values())
    chunk = 200
    for i in range(0, len(company_ids), chunk):
        sub = company_ids[i : i + chunk]
        # Narrow select to the two columns _build_context actually
        # reads (weinstein_substage, stage). The legacy select
        # included `above_ma30w` and `above_ma150` — those columns
        # don't exist on the live price_data table (PGRST 42703)
        # AND nothing downstream consumes them, so they were dead
        # fields that broke the whole query.
        rows = _paginated_select(
            PRICE_TABLE,
            "company_id,stage,weinstein_substage",
            eq={"is_latest": True},
            in_filter=("company_id", sub),
        )
        for r in rows:
            cid = str(r.get("company_id") or "").strip()
            sym = sym_by_id.get(cid)
            if not sym:
                continue
            r["symbol"] = sym
            out[sym] = r
    return out


def fetch_sector_breadth_map(trading_date: str) -> dict[str, float]:
    """Map sector → breadth % (we use sectors.stage2_pct = % stage2 in sector).

    Schema fact: the live sectors table uses `name` (not `sector`),
    `date` (not `trading_date`), and `stage2_pct` (not `health_pct`).
    The prior query referenced three columns that don't exist on the
    table → PostgREST 400 → empty breadth map → every Gemini prompt
    rendered `sector participation: 0% of sector stocks above
    long-term trend`, dragging the narrative quality.
    """
    rows = _paginated_select(
        SECTORS_TABLE,
        "name,stage2_pct,date",
        eq={"date": trading_date},
    )
    out: dict[str, float] = {}
    for r in rows:
        sec = str(r.get("name") or "").strip()
        if not sec:
            continue
        pct = r.get("stage2_pct")
        try:
            out[sec] = float(pct) if pct is not None else 0.0
        except (TypeError, ValueError):
            out[sec] = 0.0
    return out


def fetch_criteria_changes_map(
    symbols: list[str], trading_date: str
) -> dict[str, dict[str, Any]]:
    """Optional table — if it doesn't exist, return empty mapping silently.

    Expected shape per row: {symbol, trading_date, gained: [str], lost: [str]}.
    We derive days_in_phase as days since the *most recent* change before today.
    """
    out: dict[str, dict[str, Any]] = {}
    try:
        # probe existence cheaply
        supabase.table(CRITERIA_CHANGES_TABLE).select("symbol").limit(1).execute()
    except Exception:
        return out  # table absent

    # Pull last ~60 days of changes for the symbols, then bucket by symbol.
    chunk = 200
    for i in range(0, len(symbols), chunk):
        sub = symbols[i : i + chunk]
        rows = _paginated_select(
            CRITERIA_CHANGES_TABLE,
            "symbol,trading_date,gained,lost",
            in_filter=("symbol", sub),
        )
        for r in rows:
            sym = str(r.get("symbol") or "").strip().upper()
            if not sym:
                continue
            bucket = out.setdefault(sym, {"history": []})
            bucket["history"].append(r)

    today_dt = datetime.fromisoformat(trading_date).date()
    for sym, info in out.items():
        history = sorted(
            info.get("history", []),
            key=lambda r: str(r.get("trading_date") or ""),
            reverse=True,
        )
        gained_today: list[str] = []
        lost_today: list[str] = []
        score_changed_today = False
        days_since_change: int | None = None
        for r in history:
            td = str(r.get("trading_date") or "")[:10]
            if not td:
                continue
            if td == trading_date:
                gained_today = list(r.get("gained") or [])
                lost_today = list(r.get("lost") or [])
                if gained_today or lost_today:
                    score_changed_today = True
            else:
                try:
                    prev_dt = datetime.fromisoformat(td).date()
                    days_since_change = (today_dt - prev_dt).days
                except ValueError:
                    continue
                break
        info["gained_today"] = gained_today
        info["lost_today"] = lost_today
        info["score_changed_today"] = score_changed_today
        info["days_since_change"] = days_since_change
    return out


# ---------------------------------------------------------------------------
# Helpers: days_in_phase fallback
# ---------------------------------------------------------------------------


def _days_in_phase_fallback(
    symbol: str,
    current_score: int,
    trading_date: str,
) -> int | None:
    """If criteria_changes is unavailable, look back at swing_conditions and
    find the most recent date where conditions_met != current_score.
    Returns days since that date, or None.

    swing_conditions has no `symbol` column — it's keyed by `company_id`.
    Resolve symbol → company_id via a one-off companies query, then walk
    the per-company history by `date`. One extra round-trip per fallback
    call; acceptable on a fallback path that only fires when
    criteria_changes is missing.
    """
    try:
        co_res = (
            supabase.table("companies")
            .select("id")
            .eq("symbol", symbol)
            .limit(1)
            .execute()
        )
        co_rows = getattr(co_res, "data", None) or []
        if not co_rows:
            return None
        company_id = co_rows[0].get("id")
        if not company_id:
            return None
        res = (
            supabase.table(SWING_TABLE)
            .select("date,conditions_met")
            .eq("company_id", company_id)
            .order("date", desc=True)
            .limit(60)
            .execute()
        )
        rows = getattr(res, "data", None) or []
    except Exception:
        return None
    if not rows:
        return None

    last_change_date: str | None = None
    for row in rows:
        td = str(row.get("date") or "")[:10]
        score = row.get("conditions_met")
        if not td or score is None:
            continue
        try:
            score_i = int(score)
        except (TypeError, ValueError):
            continue
        if score_i != current_score:
            last_change_date = td
            break
    if not last_change_date:
        return None
    try:
        today_dt = datetime.fromisoformat(trading_date).date()
        prev_dt = datetime.fromisoformat(last_change_date).date()
        return max(0, (today_dt - prev_dt).days)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Gemini call
# ---------------------------------------------------------------------------


_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def _strip_fences(text: str) -> str:
    cleaned = _JSON_FENCE_RE.sub("", text.strip()).strip()
    # If the model wrapped JSON in stray prose, grab the first {...} block.
    if not cleaned.startswith("{"):
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            cleaned = m.group(0)
    return cleaned


def _build_user_prompt(ctx: dict[str, Any]) -> str:
    # When the sectors table has no row for this stock's sector
    # (sector_breadth_known=False), omit the participation number
    # from the context block AND switch the broader_cycle instruction
    # so Gemini doesn't fabricate a "0%" / "none participating" claim
    # from what is actually a data gap.
    sector_known = bool(ctx.get("sector_breadth_known", True))
    if sector_known:
        breadth_line = (
            f"Sector participation: {ctx['sector_breadth_pct']:.0f}% of sector "
            "stocks above long-term trend"
        )
        broader_instruction = (
            "broader_cycle: How does this stock fit into the broader market right "
            "now? Mention the sector by name and weave the sector participation "
            "percentage into a natural sentence. Keep it simple.\n\n"
        )
    else:
        breadth_line = "Sector participation: data unavailable for this sector"
        broader_instruction = (
            "broader_cycle: Describe how this stock fits the broader market "
            "without referencing any sector breadth percentage — sector data "
            "is unavailable for this stock. Mention the sector by name and "
            "the general market mood only. Do not invent a percentage. Keep "
            "it simple.\n\n"
        )

    return (
        f"Stock: {ctx['symbol']}\n"
        f"Sector: {ctx['sector']}\n"
        f"Current phase: {ctx['phase_label']}\n"
        f"Criteria met: {ctx['criteria_score']} out of 5\n"
        f"Days in this phase: {ctx['days_in_phase']}\n"
        f"{breadth_line}\n"
        f"Score changed today: {ctx['score_changed_today']}\n"
        f"Criteria gained today: {ctx['criteria_gained']}\n"
        f"Criteria lost today: {ctx['criteria_lost']}\n\n"
        "Generate a JSON response with these exact keys:\n\n"
        "narrative: 2-3 sentences describing where this stock is in its "
        "cycle. Start with \"Yes.\" or \"Right now\" for advancing. Use plain "
        "simple English. No numbers. No prices. No jargon.\n\n"
        "malayalam_line: One short phrase in Malayalam describing the phase. "
        "Examples:\n"
        "  Advancing: \"ഇപ്പോൾ ഒരു നല്ല Uptrend ൽ ആണ്\"\n"
        "  Basing: \"Base build ചെയ്യുന്നു\"\n"
        "  Topping: \"Trend മാറുന്നു\"\n"
        "  Declining: \"Downtrend ൽ ആണ്\"\n\n"
        "whats_happening: Describe what is happening with this stock right "
        "now in its cycle. 2-3 sentences. Plain English. No prices. No "
        "numbers in the prose. Treat the reader as a curious friend.\n\n"
        "why_this_phase: Explain WHY this stock is in this phase — what the "
        "criteria are actually showing. Simple language. Reference the "
        "criteria-met count and the day-count in this phase as plain words, "
        "never as numeric values in the prose. No buy/sell language.\n\n"
        "what_changes: What would need to change in the data for this stock "
        "to move into a different phase? Be specific about CRITERIA — never "
        "about prices, targets, stoplosses or support/resistance levels. "
        "Frame it as 'if X criterion turns / fails, the phase tilts toward Y'.\n\n"
        + broader_instruction +
        "Return ONLY valid JSON. No markdown. No explanation. No preamble. "
        "Just the JSON object."
    )


def call_gemini(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, int, int]:
    """Call Gemini and return (parsed_json, input_tokens, output_tokens).

    Tokens come from usageMetadata when available, otherwise a character-based
    estimate. Returns (None, in_est, out_est) on failure so the caller can
    still account for tokens spent on the failed request.
    """
    user_prompt = _build_user_prompt(ctx)
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 600,
            "responseMimeType": "application/json",
        },
    }

    in_est = int(len(user_prompt + SYSTEM_PROMPT) / CHARS_PER_TOKEN)
    out_est = 0

    try:
        response = requests.post(
            GEMINI_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=45,
        )
    except Exception as exc:
        print(f"gemini request error [{ctx['symbol']}]: {exc}")
        return None, in_est, 0

    if response.status_code != 200:
        snippet = response.text[:200].replace("\n", " ")
        print(
            f"gemini http {response.status_code} [{ctx['symbol']}]: {snippet}"
        )
        return None, in_est, 0

    try:
        data = response.json()
    except ValueError as exc:
        print(f"gemini json decode [{ctx['symbol']}]: {exc}")
        return None, in_est, 0

    usage = data.get("usageMetadata") or {}
    if usage:
        in_est = int(usage.get("promptTokenCount") or in_est)
        out_est = int(usage.get("candidatesTokenCount") or 0)

    try:
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
    except (KeyError, IndexError, AttributeError):
        text = ""

    if not text:
        return None, in_est, out_est

    if not out_est:
        out_est = int(len(text) / CHARS_PER_TOKEN)

    cleaned = _strip_fences(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        print(f"gemini json parse [{ctx['symbol']}]: {exc} | raw: {cleaned[:200]}")
        return None, in_est, out_est

    if not isinstance(parsed, dict):
        return None, in_est, out_est

    return parsed, in_est, out_est


# ---------------------------------------------------------------------------
# Upsert + context build
# ---------------------------------------------------------------------------


REQUIRED_KEYS = (
    "narrative",
    "malayalam_line",
    "whats_happening",
    "why_this_phase",
    "what_changes",
    "broader_cycle",
)

# Map swing_conditions boolean columns → human criteria labels.
_CRITERION_LABEL = {
    "condition_stage2": "Stage 2 trend",
    "condition_delivery_above_avg": "Delivery above average",
    "condition_near_ma20": "Near 20-day MA",
    "condition_rsi_healthy": "Healthy RSI",
    "condition_volume_contracting": "Contracting volume",
}


def _build_context(
    swing_row: dict[str, Any],
    company: dict[str, Any] | None,
    price_row: dict[str, Any] | None,
    sector_breadth: dict[str, float],
    changes_info: dict[str, Any] | None,
    trading_date: str,
) -> dict[str, Any]:
    symbol = str(swing_row.get("symbol") or "").strip().upper()
    criteria_score = int(swing_row.get("conditions_met") or 0)

    stage = None
    if price_row:
        stage = price_row.get("weinstein_substage") or price_row.get("stage")
    phase_label = _phase_label(stage)

    sector = (company or {}).get("sector") or "Unknown"
    # sector_breadth_known distinguishes "sector is in the map with
    # value 0.0" (real signal — write "0% of stocks above trend")
    # from "sector isn't in the map at all" (data unavailable — the
    # sectors table hasn't aggregated this sector yet, e.g. Oil &
    # Gas before today's calc_swing_conditions fix lands). The
    # Gemini prompt branches on this flag so we never invent a
    # "none participating" claim from a silent dict miss.
    sector_breadth_known = sector in sector_breadth
    breadth_pct = float(sector_breadth.get(sector, 0.0))

    if changes_info:
        gained = list(changes_info.get("gained_today") or [])
        lost = list(changes_info.get("lost_today") or [])
        score_changed_today = bool(changes_info.get("score_changed_today"))
        days_in_phase = changes_info.get("days_since_change")
    else:
        gained, lost = [], []
        score_changed_today = False
        days_in_phase = None

    if days_in_phase is None:
        days_in_phase = _days_in_phase_fallback(symbol, criteria_score, trading_date)
    if days_in_phase is None:
        days_in_phase = 0

    return {
        "symbol": symbol,
        "phase": stage or "",
        "phase_label": phase_label,
        "criteria_score": criteria_score,
        "days_in_phase": int(days_in_phase),
        "sector": sector,
        "sector_breadth_pct": breadth_pct,
        "sector_breadth_known": sector_breadth_known,
        "score_changed_today": score_changed_today,
        "criteria_gained": gained,
        "criteria_lost": lost,
    }


def _normalize_result(parsed: dict[str, Any]) -> dict[str, Any] | None:
    out: dict[str, Any] = {}
    for k in REQUIRED_KEYS:
        v = parsed.get(k)
        if v is None:
            return None
        if not isinstance(v, str):
            v = str(v)
        v = v.strip()
        if not v:
            return None
        out[k] = v
    return out


def upsert_description(
    symbol: str,
    trading_date: str,
    ctx: dict[str, Any],
    result: dict[str, Any],
) -> bool:
    row = {
        "symbol": symbol,
        "trading_date": trading_date,
        "phase": ctx["phase"],
        "phase_label": ctx["phase_label"],
        "criteria_score": ctx["criteria_score"],
        "days_in_phase": ctx["days_in_phase"],
        "sector": ctx["sector"],
        "sector_breadth_pct": ctx["sector_breadth_pct"],
        "score_changed_today": ctx["score_changed_today"],
        "criteria_gained": ctx["criteria_gained"],
        "criteria_lost": ctx["criteria_lost"],
        "narrative": result["narrative"],
        "malayalam_line": result["malayalam_line"],
        # Four cycle-narrative columns — each maps to one accordion
        # in src/pages/StockDetail.jsx CYCLE_ACCORDIONS. If you rename
        # an accordion, rename the column AND update the Gemini prompt
        # framing above together.
        "whats_happening": result["whats_happening"],
        "why_this_phase": result["why_this_phase"],
        "what_changes": result["what_changes"],
        "broader_cycle": result["broader_cycle"],
        # datetime.utcnow() is deprecated in 3.12+; the timezone-aware
        # form below is the forward-compatible replacement.
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        supabase.table(DESCRIPTIONS_TABLE).upsert(
            row, on_conflict="symbol,trading_date"
        ).execute()
        return True
    except Exception as exc:
        print(f"upsert error [{DESCRIPTIONS_TABLE}] {symbol}: {exc}")
        return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate daily Gemini cycle descriptions."
    )
    p.add_argument(
        "--test",
        action="store_true",
        help="Process only 10 stocks and print output without writing to DB.",
    )
    p.add_argument(
        "--symbol",
        type=str,
        default=None,
        help="Single-stock dry run (no DB write).",
    )
    p.add_argument(
        "--full",
        action="store_true",
        help=(
            "Regenerate descriptions for EVERY stock with a swing_conditions "
            "row today (no delta filtering). Auto-enabled on Sundays."
        ),
    )
    return p.parse_args()


def _is_sunday_ist() -> bool:
    """True when 'today' in IST is a Sunday. We always read the wall clock
    in IST (UTC + 5:30) regardless of where the script runs from, so the
    weekly-refresh trigger lines up with the actual calendar Sunday in
    the user's timezone instead of UTC."""
    # datetime.utcnow() is deprecated in 3.12+; the timezone-aware
    # form below is the forward-compatible replacement (adding a
    # naive timedelta to a tz-aware datetime still works fine).
    now_ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    return now_ist.weekday() == 6


def fetch_latest_descriptions_map(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Return {symbol: latest_stock_descriptions_row} for the symbols we're
    about to process. Used by the delta filter to skip stocks whose
    criteria_score hasn't moved since the last description we wrote.

    One row per symbol — the most recent by trading_date. Implemented as
    a single bulk read of (symbol, trading_date, criteria_score) for all
    requested symbols, then in-Python deduped to keep the newest per
    symbol. PostgREST has no DISTINCT ON, so we do the reduction here.
    """
    out: dict[str, dict[str, Any]] = {}
    if not symbols:
        return out
    chunk = 200
    for i in range(0, len(symbols), chunk):
        sub = symbols[i : i + chunk]
        rows = _paginated_select(
            DESCRIPTIONS_TABLE,
            "symbol,trading_date,criteria_score",
            in_filter=("symbol", sub),
        )
        for r in rows:
            sym = str(r.get("symbol") or "").strip().upper()
            if not sym:
                continue
            td = str(r.get("trading_date") or "")
            prev = out.get(sym)
            if not prev or str(prev.get("trading_date") or "") < td:
                out[sym] = r
    return out


def _needs_regeneration(
    swing_row: dict[str, Any],
    latest_desc: dict[str, Any] | None,
    today: str,
) -> bool:
    """Decide whether this stock needs a fresh Gemini call.

    Regenerate when:
      - we've never described this stock before, OR
      - the most recent description is older than today AND today's
        conditions_met differs from the description's criteria_score
      - the most recent description is from today already → still skip
        (we don't double-pay for the same day's score)
    """
    if not latest_desc:
        return True
    # Already described today — skip regardless of score (idempotent re-runs).
    if str(latest_desc.get("trading_date") or "") == today:
        return False
    try:
        prev_score = int(latest_desc.get("criteria_score"))
        today_score = int(swing_row.get("conditions_met") or 0)
    except (TypeError, ValueError):
        return True  # bad data → safest to regenerate
    return prev_score != today_score


def main() -> int:
    args = parse_args()

    # Holiday early-exit. --test / --symbol / --full bypass so dev
    # runs work on holidays. Live nightly runs skip cleanly with a
    # log_event so we can see in metrics that the day was a holiday
    # rather than the script silently no-op'd.
    if not (args.test or args.symbol or args.full):
        today_iso = datetime.now().date().isoformat()
        if is_nse_holiday(today_iso):
            print(f"NSE holiday today ({today_iso}). Skipping.")
            log_event("pipeline_skipped", {
                "reason": "nse_holiday",
                "date": today_iso,
                "script": "generate_descriptions",
            })
            return 0

    if not GEMINI_KEY:
        print("ERROR: GEMINI_API_KEY not set. Add to scripts/.env.")
        return 1

    trading_date = _latest_trading_date()
    print(f"generate_descriptions — trading_date={trading_date} model={GEMINI_MODEL}")

    swing_rows = fetch_swing_rows(trading_date)
    if not swing_rows:
        print("No swing_conditions rows for the latest trading_date — nothing to do.")
        log_event(
            "generate_descriptions",
            {
                "date": trading_date,
                "generated": 0,
                "skipped": 0,
                "errors": 0,
                "total_tokens": 0,
                "est_cost_inr": 0.0,
                "note": "no_swing_rows",
            },
        )
        return 0

    # Symbol filter for --symbol mode.
    if args.symbol:
        wanted = args.symbol.strip().upper()
        swing_rows = [r for r in swing_rows if str(r.get("symbol") or "").upper() == wanted]
        if not swing_rows:
            print(f"--symbol {wanted}: not present in swing_conditions for {trading_date}.")
            return 1

    if args.test and not args.symbol:
        swing_rows = swing_rows[:10]

    # ── Delta filter ─────────────────────────────────────────────
    # Default: only regenerate stocks where today's conditions_met
    # differs from the criteria_score on their most recent
    # stock_descriptions row (or where no description exists yet).
    # --full overrides. --test and --symbol bypass the filter so
    # debugging always runs the full Gemini path.
    full_mode = bool(args.full) or _is_sunday_ist()
    if full_mode and not args.test and not args.symbol:
        print(
            "[full-mode] regenerating EVERY stock — "
            f"{'--full flag set' if args.full else 'Sunday weekly refresh'}"
        )

    candidate_symbols = [str(r.get("symbol") or "").strip().upper() for r in swing_rows]
    candidate_symbols = [s for s in candidate_symbols if s]

    if not full_mode and not args.test and not args.symbol:
        latest_desc = fetch_latest_descriptions_map(candidate_symbols)
        before = len(swing_rows)
        swing_rows = [
            r for r in swing_rows
            if _needs_regeneration(
                r, latest_desc.get(str(r.get("symbol") or "").upper()), trading_date,
            )
        ]
        after = len(swing_rows)
        print(
            f"[delta-mode] regenerating {after} of {before} stocks "
            f"(skipped {before - after} unchanged since last description)"
        )

    symbols = [str(r.get("symbol") or "").strip().upper() for r in swing_rows]
    symbols = [s for s in symbols if s]

    if not symbols:
        print("Nothing to regenerate today — all swing rows match prior descriptions.")
        log_event(
            "generate_descriptions",
            {
                "date": trading_date,
                "generated": 0,
                "skipped": 0,
                "errors": 0,
                "total_tokens": 0,
                "est_cost_inr": 0.0,
                "note": "no_changes",
                "full_mode": full_mode,
            },
        )
        return 0

    print(f"Symbols to process: {len(symbols)}")

    companies = fetch_companies_map(symbols)
    prices = fetch_latest_price_map(symbols)
    sector_breadth = fetch_sector_breadth_map(trading_date)
    changes_map = fetch_criteria_changes_map(symbols, trading_date)

    generated = 0
    skipped = 0
    errors = 0
    total_in_tokens = 0
    total_out_tokens = 0

    dry_run = bool(args.test or args.symbol)

    for index, swing_row in enumerate(swing_rows, 1):
        symbol = str(swing_row.get("symbol") or "").strip().upper()
        if not symbol:
            skipped += 1
            continue

        ctx = _build_context(
            swing_row=swing_row,
            company=companies.get(symbol),
            price_row=prices.get(symbol),
            sector_breadth=sector_breadth,
            changes_info=changes_map.get(symbol),
            trading_date=trading_date,
        )

        parsed, in_tok, out_tok = call_gemini(ctx)
        total_in_tokens += in_tok
        total_out_tokens += out_tok

        # Cost guard — check after each call.
        total_tokens = total_in_tokens + total_out_tokens
        est_cost = (total_tokens / 1000.0) * INR_PER_1K_TOKENS
        if est_cost > COST_GUARD_INR:
            msg = (
                f"cost guard tripped at {symbol}: est_cost_inr={est_cost:.2f} "
                f"> {COST_GUARD_INR:.2f} (tokens={total_tokens})"
            )
            print(f"STOP: {msg}")
            log_event(
                "generate_descriptions_cost_guard",
                {
                    "date": trading_date,
                    "generated": generated,
                    "skipped": skipped,
                    "errors": errors,
                    "total_tokens": total_tokens,
                    "est_cost_inr": round(est_cost, 4),
                    "stopped_at_symbol": symbol,
                },
            )
            return 2

        if not parsed:
            errors += 1
            print(f"[{index}/{len(swing_rows)}] {symbol} — call failed")
            continue

        result = _normalize_result(parsed)
        if not result:
            errors += 1
            print(f"[{index}/{len(swing_rows)}] {symbol} — missing required keys")
            continue

        if dry_run:
            print(f"\n[{index}/{len(swing_rows)}] {symbol} ({ctx['phase_label']})")
            print(json.dumps({"context": ctx, "result": result}, indent=2, ensure_ascii=False))
            generated += 1
        else:
            ok = upsert_description(symbol, trading_date, ctx, result)
            if ok:
                generated += 1
                if index % 25 == 0:
                    print(
                        f"  [{index}/{len(swing_rows)}] generated={generated} "
                        f"errors={errors} tokens={total_in_tokens + total_out_tokens}"
                    )
            else:
                errors += 1

        # Batch sleep between groups of BATCH_SIZE.
        if index % BATCH_SIZE == 0 and index < len(swing_rows):
            time.sleep(BATCH_SLEEP_SEC)

    total_tokens = total_in_tokens + total_out_tokens
    est_cost = round((total_tokens / 1000.0) * INR_PER_1K_TOKENS, 4)

    print("\nDone")
    print(f"   trading_date: {trading_date}")
    print(f"   generated:    {generated}")
    print(f"   skipped:      {skipped}")
    print(f"   errors:       {errors}")
    print(f"   in_tokens:    {total_in_tokens}")
    print(f"   out_tokens:   {total_out_tokens}")
    print(f"   est_cost_inr: {est_cost}")
    print(f"   dry_run:      {dry_run}")

    log_event(
        "generate_descriptions",
        {
            "date": trading_date,
            "generated": generated,
            "skipped": skipped,
            "errors": errors,
            "total_tokens": total_tokens,
            "input_tokens": total_in_tokens,
            "output_tokens": total_out_tokens,
            "est_cost_inr": est_cost,
            "dry_run": dry_run,
            # full_mode = true for Sunday refresh OR explicit --full;
            # admins can grep usage_events for weekly-vs-daily costs.
            "full_mode": full_mode,
        },
    )

    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
