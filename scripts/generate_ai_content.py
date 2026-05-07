"""AI content generator with strict cost/regeneration controls."""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timedelta
from typing import Any

import anthropic

from db import log_event, supabase

MODEL = os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-20241022")
MODEL_FALLBACKS = [
    m.strip()
    for m in os.environ.get(
        "CLAUDE_MODEL_FALLBACKS",
        "claude-3-5-sonnet-20241022,claude-3-5-haiku-20241022",
    ).split(",")
    if m.strip()
]
MAX_TOKENS_SHORT = 120
MAX_TOKENS_MED = 220
USD_PER_M_INPUT = float(os.environ.get("CLAUDE_USD_PER_M_INPUT", "3.0"))
USD_PER_M_OUTPUT = float(os.environ.get("CLAUDE_USD_PER_M_OUTPUT", "15.0"))
USD_TO_INR = float(os.environ.get("USD_TO_INR", "83.0"))
DAILY_SPEND_ALERT_INR = 200.0

if "CLAUDE_API_KEY" not in os.environ:
    raise ValueError("CLAUDE_API_KEY is required")

client = anthropic.Anthropic(api_key=os.environ["CLAUDE_API_KEY"])


def _safe_log(event_type: str, metadata: dict[str, Any]) -> None:
    try:
        log_event(event_type, metadata)
    except Exception as exc:
        print(f"warning: log_event failed [{event_type}] -> {exc}")


def _extract_text(resp: Any) -> str:
    blocks = getattr(resp, "content", None) or []
    out: list[str] = []
    for b in blocks:
        txt = getattr(b, "text", None)
        if txt:
            out.append(str(txt).strip())
    return " ".join(x for x in out if x).strip()


def _usage_dict(resp: Any) -> dict[str, int]:
    usage = getattr(resp, "usage", None)
    if not usage:
        return {"input_tokens": 0, "output_tokens": 0}
    return {
        "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
    }


def _call_claude(system_prompt: str, user_prompt: str, *, max_tokens: int) -> tuple[str, dict[str, int]]:
    models_to_try: list[str] = []
    if MODEL:
        models_to_try.append(MODEL)
    for candidate in MODEL_FALLBACKS:
        if candidate not in models_to_try:
            models_to_try.append(candidate)

    last_exc: Exception | None = None
    for model_name in models_to_try:
        try:
            resp = client.messages.create(
                model=model_name,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            text = _extract_text(resp)
            usage = _usage_dict(resp)
            return text, usage
        except Exception as exc:
            last_exc = exc
            if "not_found_error" in str(exc) or "model:" in str(exc):
                continue
            raise

    assert last_exc is not None
    raise last_exc


def _append_usage(acc: dict[str, int], u: dict[str, int]) -> None:
    acc["input_tokens"] += int(u.get("input_tokens", 0))
    acc["output_tokens"] += int(u.get("output_tokens", 0))


def _estimate_inr(usage: dict[str, int]) -> float:
    usd = (
        (usage["input_tokens"] / 1_000_000.0) * USD_PER_M_INPUT
        + (usage["output_tokens"] / 1_000_000.0) * USD_PER_M_OUTPUT
    )
    return usd * USD_TO_INR


def _company_by_symbol(symbol: str) -> dict[str, Any] | None:
    res = (
        supabase.table("companies")
        .select("id,symbol,name,sector,description,description_approved")
        .eq("symbol", symbol)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _first_present_key(row: dict[str, Any] | None, candidates: list[str]) -> str | None:
    if not row:
        return None
    for key in candidates:
        if key in row:
            return key
    return None


def _latest_financial(company_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    try:
        res = (
            supabase.table("financials")
            .select("*")
            .eq("company_id", company_id)
            .order("updated_at", desc=True)
            .limit(2)
            .execute()
        )
    except Exception:
        try:
            res = (
                supabase.table("financials")
                .select("*")
                .eq("company_id", company_id)
                .order("created_at", desc=True)
                .limit(2)
                .execute()
            )
        except Exception:
            res = (
                supabase.table("financials")
                .select("*")
                .eq("company_id", company_id)
                .limit(2)
                .execute()
            )
    rows = getattr(res, "data", None) or []
    if not rows:
        return None, None
    return rows[0], (rows[1] if len(rows) > 1 else None)


def _latest_delivery_unusual(symbol: str, only_unusual: bool) -> dict[str, Any] | None:
    q = (
        supabase.table("delivery_data")
        .select("symbol,trading_date,delivery_pct,vs_30d_avg,is_unusual,ai_insight")
        .eq("symbol", symbol)
        .order("trading_date", desc=True)
        .limit(1)
    )
    if only_unusual:
        q = q.eq("is_unusual", True)
    res = q.execute()
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _latest_shareholding(company_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    try:
        res = (
            supabase.table("shareholding")
            .select("*")
            .eq("company_id", company_id)
            .order("updated_at", desc=True)
            .limit(2)
            .execute()
        )
    except Exception:
        try:
            res = (
                supabase.table("shareholding")
                .select("*")
                .eq("company_id", company_id)
                .order("created_at", desc=True)
                .limit(2)
                .execute()
            )
        except Exception:
            res = (
                supabase.table("shareholding")
                .select("*")
                .eq("company_id", company_id)
                .limit(2)
                .execute()
            )
    rows = getattr(res, "data", None) or []
    if not rows:
        return None, None
    return rows[0], (rows[1] if len(rows) > 1 else None)


def _latest_quarterly_changes(company_id: str) -> dict[str, Any] | None:
    res = (
        supabase.table("quarterly_changes")
        .select("company_id,current_quarter,headline,changes,ai_summary,watch_next")
        .eq("company_id", company_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def generate_company_description(symbol: str, name: str, sector: str, financial_summary: dict[str, Any]) -> tuple[str, dict[str, int]]:
    revenue = financial_summary.get("revenue")
    system = (
        "You write plain language company descriptions for Indian retail investors "
        "with no finance background. Maximum 80 words. No jargon."
    )
    user = (
        f"Write a description of {name} ({symbol}).\n"
        f"Sector: {sector}\n"
        f"Recent revenue: {revenue} crore\n"
        "What they do, who their customers are, what drives revenue.\n"
        "End with: what single factor affects this company most.\n"
        "Rules: Class 8 reading level. No EBITDA/CAGR/QoQ. No buy/sell language."
    )
    return _call_claude(system, user, max_tokens=MAX_TOKENS_MED)


def generate_financial_insight(symbol: str, current_q: dict[str, Any], prev_q: dict[str, Any]) -> tuple[str, dict[str, int]]:
    system = "You write concise factual financial result lines. No opinion or recommendation."
    user = (
        f"One sentence for {symbol} quarterly results. Maximum 20 words.\n"
        f"Current: Revenue ₹{current_q.get('revenue')}cr, PAT ₹{current_q.get('net_profit')}cr, Margin {current_q.get('margin')}%\n"
        f"Previous: Revenue ₹{prev_q.get('revenue')}cr, PAT ₹{prev_q.get('net_profit')}cr, Margin {prev_q.get('margin')}%\n"
        "State what changed factually. No opinion. No recommendation.\n"
        "Example: Revenue grew for 8th straight quarter though margins dipped slightly first time."
    )
    return _call_claude(system, user, max_tokens=MAX_TOKENS_SHORT)


def generate_delivery_insight(symbol: str, pct: Any, vs_avg: Any) -> tuple[str, dict[str, int]]:
    system = "You explain delivery data in plain language. No recommendation."
    user = (
        f"One sentence about delivery data for {symbol}. Maximum 20 words.\n"
        f"Today: {pct}% delivery. vs 30-day average: {vs_avg}x\n"
        "Explain what this means simply. No recommendation.\n"
        "Example: Delivery nearly double normal today — more investors taking actual ownership than usual."
    )
    return _call_claude(system, user, max_tokens=MAX_TOKENS_SHORT)


def generate_shareholding_insight(symbol: str, curr_sh: dict[str, Any], prev_sh: dict[str, Any]) -> tuple[str, dict[str, int]]:
    system = "You write one factual line about shareholding movement. No recommendation."
    user = (
        f"One sentence about shareholding change for {symbol}. 20 words max.\n"
        f"Promoter: {prev_sh.get('promoter_pct')}% → {curr_sh.get('promoter_pct')}%\n"
        f"FII: {prev_sh.get('fii_pct')}% → {curr_sh.get('fii_pct')}%\n"
        "Most significant change only. Factual. No recommendation."
    )
    return _call_claude(system, user, max_tokens=MAX_TOKENS_SHORT)


def generate_change_summary(symbol: str, changes_list: list[dict[str, Any]], headline: str) -> tuple[str, str, dict[str, int]]:
    system = "You write strict 3-line factual summaries for retail users."
    user = (
        f"Three lines for {symbol} quarterly change summary.\n"
        f"Headline: {headline}\n"
        f"Changes detected: {changes_list}\n\n"
        "Format EXACTLY:\n"
        "Line 1: Most important change — one sentence, max 15 words.\n"
        "Line 2: What this means for the business — one sentence, max 15 words.\n"
        "Line 3: Prefix with WATCH: — specific measurable thing to monitor next quarter.\n\n"
        "Rules: Plain language. No jargon. No buy/sell. Factual only.\n"
        "Example Line 3: WATCH: Whether margins recover above 15% next quarter."
    )
    text, usage = _call_claude(system, user, max_tokens=MAX_TOKENS_MED)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 3:
        # fallback hard split by period if model collapses lines
        parts = [p.strip() for p in text.split(".") if p.strip()]
        lines = [parts[0] + "." if len(parts) > 0 else text, parts[1] + "." if len(parts) > 1 else "", "WATCH: " + (parts[2] + "." if len(parts) > 2 else "Next quarter trend versus this quarter.")]
    summary = "\n".join(lines[:3])
    watch_next = lines[2] if len(lines) > 2 else "WATCH: Next quarter trend versus this quarter."
    return summary, watch_next, usage


def generate_sector_overview(sector_name: str, stats: dict[str, Any]) -> tuple[str, dict[str, int]]:
    system = "You write two-sentence sector explainers in plain language for Indian retail investors."
    user = (
        f"Two sentences about the {sector_name} sector for Indian retail investors.\n"
        f"Stats: {stats.get('stage2_count')} of {stats.get('total_companies')} companies in Stage 2, "
        f"{stats.get('obv_rising_count')} with rising OBV, {stats.get('revenue_growing_count')} with growing revenue.\n"
        "What is driving this sector? What is the main risk?\n"
        "Plain language. No jargon. No buy/sell."
    )
    return _call_claude(system, user, max_tokens=MAX_TOKENS_MED)


def _run_for_symbol(symbol: str, *, full_mode: bool, daily_only: bool, usage_totals: dict[str, int]) -> None:
    company = _company_by_symbol(symbol)
    if not company:
        return
    company_id = company.get("id")
    name = str(company.get("name") or symbol)
    sector = str(company.get("sector") or "Unknown")

    # Function 1: company description (only when missing)
    if full_mode and not daily_only and company.get("description") in (None, ""):
        latest_fin, _ = _latest_financial(str(company_id))
        fin_summary = {"revenue": latest_fin.get("revenue") if latest_fin else None}
        text, usage = generate_company_description(symbol, name, sector, fin_summary)
        _append_usage(usage_totals, usage)
        supabase.table("companies").update(
            {"description": text, "description_approved": False, "updated_at": datetime.utcnow().isoformat()},
        ).eq("id", company_id).execute()

    # Function 2: financial insight (only latest quarter and only when ai_insight is null)
    if full_mode and not daily_only:
        cur_fin, prev_fin = _latest_financial(str(company_id))
        if cur_fin and prev_fin and not cur_fin.get("ai_insight"):
            text, usage = generate_financial_insight(symbol, cur_fin, prev_fin)
            _append_usage(usage_totals, usage)
            quarter_key = _first_present_key(cur_fin, ["quarter_name", "quarter", "quarter_label", "period"])
            q = supabase.table("financials").update({"ai_insight": text, "updated_at": datetime.utcnow().isoformat()}).eq("company_id", company_id)
            if quarter_key:
                q = q.eq(quarter_key, cur_fin.get(quarter_key))
            q.execute()

    # Function 3: delivery insight (only unusual + ai_insight null)
    d = _latest_delivery_unusual(symbol, only_unusual=True)
    if d and not d.get("ai_insight"):
        text, usage = generate_delivery_insight(symbol, d.get("delivery_pct"), d.get("vs_30d_avg"))
        _append_usage(usage_totals, usage)
        supabase.table("delivery_data").update(
            {"ai_insight": text, "updated_at": datetime.utcnow().isoformat()},
        ).eq("symbol", symbol).eq("trading_date", d.get("trading_date")).execute()

    if daily_only:
        return

    # Function 4: shareholding insight (latest quarter only, if empty)
    cur_sh, prev_sh = _latest_shareholding(str(company_id))
    if cur_sh and prev_sh and not cur_sh.get("ai_insight"):
        text, usage = generate_shareholding_insight(symbol, cur_sh, prev_sh)
        _append_usage(usage_totals, usage)
        quarter_key = _first_present_key(cur_sh, ["quarter_name", "quarter", "quarter_label", "period"])
        q = supabase.table("shareholding").update({"ai_insight": text, "updated_at": datetime.utcnow().isoformat()}).eq("company_id", company_id)
        if quarter_key:
            q = q.eq(quarter_key, cur_sh.get(quarter_key))
        q.execute()

    # Function 5: change summary (latest quarterly_changes row if ai_summary missing)
    qc = _latest_quarterly_changes(str(company_id))
    if qc and not qc.get("ai_summary"):
        headline = str(qc.get("headline") or "")
        changes_list = qc.get("changes") or []
        summary, watch_next, usage = generate_change_summary(symbol, changes_list, headline)
        _append_usage(usage_totals, usage)
        supabase.table("quarterly_changes").update(
            {"ai_summary": summary, "watch_next": watch_next, "updated_at": datetime.utcnow().isoformat()},
        ).eq("company_id", company_id).eq("current_quarter", qc.get("current_quarter")).execute()


def _run_sector_overviews(usage_totals: dict[str, int]) -> None:
    cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    res = (
        supabase.table("sectors")
        .select(
            "sector,trading_date,stage2_count,total_companies,obv_rising_count,revenue_growing_count,ai_overview,overview_updated_at",
        )
        .order("trading_date", desc=True)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    # keep latest per sector
    latest_by_sector: dict[str, dict[str, Any]] = {}
    for r in rows:
        s = str(r.get("sector") or "")
        if s and s not in latest_by_sector:
            latest_by_sector[s] = r

    for sector, row in latest_by_sector.items():
        updated_at = row.get("overview_updated_at")
        stale = (not updated_at) or (str(updated_at) < cutoff)
        if row.get("ai_overview") and not stale:
            continue
        stats = {
            "stage2_count": row.get("stage2_count"),
            "total_companies": row.get("total_companies"),
            "obv_rising_count": row.get("obv_rising_count"),
            "revenue_growing_count": row.get("revenue_growing_count"),
        }
        text, usage = generate_sector_overview(sector, stats)
        _append_usage(usage_totals, usage)
        supabase.table("sectors").update(
            {
                "ai_overview": text,
                "overview_updated_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            },
        ).eq("sector", sector).eq("trading_date", row.get("trading_date")).execute()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--daily-only", action="store_true")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--symbol", type=str, default=None)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    daily_only = bool(args.daily_only)
    full_mode = bool(args.full) or bool(args.symbol)  # symbol mode runs all relevant funcs for one company

    usage_totals = {"input_tokens": 0, "output_tokens": 0}
    started = datetime.utcnow().isoformat()
    _safe_log("generate_ai_content_started", {"started_at": started, "daily_only": daily_only, "full": full_mode, "symbol": args.symbol})

    if args.symbol:
        _run_for_symbol(args.symbol.strip().upper(), full_mode=True, daily_only=daily_only, usage_totals=usage_totals)
    else:
        # Symbol universe from companies table
        res = supabase.table("companies").select("symbol").execute()
        symbols = [str(r.get("symbol") or "").strip().upper() for r in (getattr(res, "data", None) or []) if r.get("symbol")]
        if args.limit and args.limit > 0:
            symbols = symbols[: args.limit]
        for sym in symbols:
            _run_for_symbol(sym, full_mode=full_mode, daily_only=daily_only, usage_totals=usage_totals)

        # Function 6 sectors only in full mode (not daily-only)
        if full_mode and not daily_only:
            _run_sector_overviews(usage_totals)

    spend_inr = _estimate_inr(usage_totals)
    ended = datetime.utcnow().isoformat()
    summary = {
        "started_at": started,
        "ended_at": ended,
        "input_tokens": usage_totals["input_tokens"],
        "output_tokens": usage_totals["output_tokens"],
        "estimated_spend_inr": spend_inr,
        "daily_only": daily_only,
        "full": full_mode,
        "symbol": args.symbol,
    }
    print(summary)
    _safe_log("generate_ai_content_finished", summary)

    if spend_inr > DAILY_SPEND_ALERT_INR:
        alert = {
            "alert": "daily_spend_threshold_exceeded",
            "threshold_inr": DAILY_SPEND_ALERT_INR,
            "estimated_spend_inr": spend_inr,
        }
        print(alert)
        _safe_log("generate_ai_content_spend_alert", alert)


if __name__ == "__main__":
    main()

