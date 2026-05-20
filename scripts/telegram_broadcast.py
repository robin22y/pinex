"""Scheduled Telegram broadcast helpers for PineX.

Sections included in the daily pulse:
  1. Market summary (Nifty, VIX, breadth, 52W H/L)
  2. Top sector movers (1D)
  3. Stage 2 breakouts (new this week)
  4. 50 DMA crossovers (above / below)
  5. Institutional activity (FII ↑, DII ↑, Promoter ↑)
  6. Screener summary (high delivery, RS leaders)

Usage:
  python telegram_broadcast.py daily        # send to all subscribers
  python telegram_broadcast.py channel      # send to TELEGRAM_CHANNEL_ID
  python telegram_broadcast.py weekly
  python telegram_broadcast.py results --symbol SYMBOL
"""

from __future__ import annotations

import argparse
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import requests

from db import log_event, supabase

BASE_URL = "https://api.telegram.org"
MAX_SENDS_PER_SEC = 30.0
SEND_INTERVAL_SEC = 1.0 / MAX_SENDS_PER_SEC


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _today_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _fmt_pct(v: float | None, sign: bool = True) -> str:
    if v is None:
        return "—"
    s = f"+{v:.1f}%" if (sign and v >= 0) else f"{v:.1f}%"
    return s


def _send_message(token: str, chat_id: str, text: str) -> tuple[bool, str | None]:
    url = f"{BASE_URL}/bot{token}/sendMessage"
    try:
        res = requests.post(
            url,
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown", "disable_web_page_preview": True},
            timeout=15,
        )
        if res.status_code == 200:
            return True, None
        return False, f"http_{res.status_code}:{res.text[:180]}"
    except Exception as exc:
        return False, str(exc)


def _subscribers() -> list[dict[str, Any]]:
    res = supabase.table("telegram_subscribers").select("*").execute()
    return getattr(res, "data", None) or []


def _company_map_by_id(ids: list[str]) -> dict[str, dict[str, Any]]:
    if not ids:
        return {}
    res = (
        supabase.table("companies")
        .select("id,symbol,name,sector")
        .in_("id", ids)
        .limit(5000)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return {str(r["id"]): r for r in rows if r.get("id")}


def _broadcast(token: str, text: str, targets: list[str], event_type: str) -> dict[str, Any]:
    sent = failed = 0
    errors: list[dict[str, str]] = []
    start = time.time()
    for chat_id in targets:
        ok, err = _send_message(token, chat_id, text)
        if ok:
            sent += 1
        else:
            failed += 1
            errors.append({"chat_id": str(chat_id), "error": err or "unknown"})
        time.sleep(SEND_INTERVAL_SEC)
    elapsed = round(time.time() - start, 2)
    payload: dict[str, Any] = {"sent": sent, "failed": failed, "elapsed_sec": elapsed, "targets": len(targets)}
    if errors:
        payload["errors"] = errors[:20]
    log_event(event_type, payload)
    return payload


# ── Section builders ──────────────────────────────────────────────────────────

def _section_market_summary() -> str:
    res = (
        supabase.table("market_internals")
        .select("date,nifty_close,nifty_change_1d,india_vix,above_ma150_pct,new_52w_highs,new_52w_lows,stage2_pct")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    row = (getattr(res, "data", None) or [{}])[0]

    nifty = _safe_float(row.get("nifty_close"))
    chg1d = _safe_float(row.get("nifty_change_1d"))
    vix = _safe_float(row.get("india_vix"))
    breadth = _safe_float(row.get("above_ma150_pct"))
    hi = row.get("new_52w_highs")
    lo = row.get("new_52w_lows")

    nifty_str = f"{nifty:,.0f}" if nifty else "—"
    chg_str = f" ({_fmt_pct(chg1d)})" if chg1d is not None else ""
    vix_str = f"{vix:.1f}" if vix else "—"
    vix_emoji = "🔴" if (vix or 0) > 20 else "🟡" if (vix or 0) > 15 else "🟢"
    breadth_str = f"{breadth:.1f}%" if breadth is not None else "—"
    breadth_bar = "▰" * int((breadth or 0) / 10) + "░" * (10 - int((breadth or 0) / 10))
    hi_str = str(hi) if hi is not None else "—"
    lo_str = str(lo) if lo is not None else "—"

    return (
        "📊 MARKET\n"
        f"Nifty 50: {nifty_str}{chg_str}  ·  VIX: {vix_str} {vix_emoji}\n"
        f"Breadth (30W MA): {breadth_str}  {breadth_bar}\n"
        f"52W Highs: {hi_str}  ·  52W Lows: {lo_str}"
    )


def _section_sector_movers() -> str:
    latest_res = (
        supabase.table("nifty_sectors")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    latest_date = (getattr(latest_res, "data", None) or [{}])[0].get("date")
    res = (
        supabase.table("nifty_sectors")
        .select("display_name,index_name,change_1d")
        .eq("date", latest_date)
        .execute()
    ) if latest_date else type("R", (), {"data": []})()
    rows = getattr(res, "data", None) or []
    rows = [r for r in rows if r.get("change_1d") is not None]
    rows.sort(key=lambda r: float(r["change_1d"]), reverse=True)

    if not rows:
        return ""

    def short_name(r: dict) -> str:
        name = r.get("display_name") or r.get("index_name") or ""
        return name.replace("Nifty ", "").replace("NIFTY ", "").strip()

    top3 = rows[:3]
    bot3 = [r for r in rows[-3:] if float(r["change_1d"]) < 0][::-1]

    up_parts = [f"{short_name(r)} {_fmt_pct(_safe_float(r['change_1d']))}" for r in top3 if float(r["change_1d"]) > 0]
    dn_parts = [f"{short_name(r)} {_fmt_pct(_safe_float(r['change_1d']))}" for r in bot3 if float(r["change_1d"]) < 0]

    lines = ["📈 SECTORS (1D)"]
    if up_parts:
        lines.append("↑ " + "  ·  ".join(up_parts))
    if dn_parts:
        lines.append("↓ " + "  ·  ".join(dn_parts))
    return "\n".join(lines)


def _section_stage2_breakouts(_today: str) -> str:
    # High-conviction Stage 2 stocks sorted by RS vs Nifty
    sig_date_res = (
        supabase.table("delivery_signals")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    sig_date = (getattr(sig_date_res, "data", None) or [{}])[0].get("date")
    if not sig_date:
        return ""

    hc_res = (
        supabase.table("delivery_signals")
        .select("company_id")
        .eq("date", sig_date)
        .eq("high_conviction", True)
        .limit(50)
        .execute()
    )
    hc_ids = {r["company_id"] for r in (getattr(hc_res, "data", None) or []) if r.get("company_id")}

    if not hc_ids:
        return ""

    price_res = (
        supabase.table("price_data")
        .select("company_id,rs_vs_nifty")
        .eq("is_latest", True)
        .in_("company_id", list(hc_ids))
        .order("rs_vs_nifty", desc=True)
        .limit(15)
        .execute()
    )
    rows = getattr(price_res, "data", None) or []

    if not rows:
        return ""

    ids = [r["company_id"] for r in rows if r.get("company_id")]
    co_map = _company_map_by_id(ids)
    symbols = [co_map.get(str(i), {}).get("symbol", "?") for i in ids]
    count = len(symbols)
    display = " · ".join(symbols[:6])
    suffix = f" +{count - 6} more" if count > 6 else ""

    return f"⚡ SWINGX SETUPS ({count} stocks)\n{display}{suffix}"


def _section_50dma_crossovers() -> str:
    latest_date_res = (
        supabase.table("delivery_signals")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    latest_date = (getattr(latest_date_res, "data", None) or [{}])[0].get("date")
    if not latest_date:
        return ""

    above_res = (
        supabase.table("delivery_signals")
        .select("company_id")
        .eq("date", latest_date)
        .eq("breakout_50dma", True)
        .limit(50)
        .execute()
    )
    below_res = (
        supabase.table("delivery_signals")
        .select("company_id")
        .eq("date", latest_date)
        .eq("breakdown_50dma", True)
        .limit(50)
        .execute()
    )

    above_ids = [r["company_id"] for r in (getattr(above_res, "data", None) or []) if r.get("company_id")]
    below_ids = [r["company_id"] for r in (getattr(below_res, "data", None) or []) if r.get("company_id")]

    all_ids = list({*above_ids, *below_ids})
    co_map = _company_map_by_id(all_ids)

    def symbols_str(ids: list[str], limit: int = 6) -> str:
        syms = [co_map.get(i, {}).get("symbol", "?") for i in ids[:limit]]
        rest = len(ids) - limit
        s = " · ".join(syms)
        return s + (f" +{rest} more" if rest > 0 else "")

    if not above_ids and not below_ids:
        return ""

    lines = ["📉📈 50 DMA CROSSOVERS"]
    if above_ids:
        lines.append(f"🔼 Above ({len(above_ids)}): {symbols_str(above_ids)}")
    if below_ids:
        lines.append(f"🔽 Below ({len(below_ids)}): {symbols_str(below_ids)}")
    return "\n".join(lines)


def _section_institutional_activity() -> str:
    cutoff = (datetime.now() - timedelta(days=120)).strftime("%Y-%m-%d")
    res = (
        supabase.table("shareholding")
        .select("company_id,quarter,promoter_pct,fii_pct,dii_pct")
        .gte("quarter", cutoff[:7])
        .order("quarter", desc=True)
        .limit(5000)
        .execute()
    )
    rows = getattr(res, "data", None) or []

    by_company: dict[str, list[dict]] = {}
    for r in rows:
        cid = str(r.get("company_id") or "")
        if cid:
            by_company.setdefault(cid, []).append(r)

    fii_up: list[tuple[str, float]] = []
    dii_up: list[tuple[str, float]] = []
    pro_up: list[tuple[str, float]] = []

    for cid, entries in by_company.items():
        entries.sort(key=lambda x: str(x.get("quarter") or ""), reverse=True)
        if len(entries) < 2:
            continue
        latest, prev = entries[0], entries[1]
        fii_l, fii_p = _safe_float(latest.get("fii_pct")), _safe_float(prev.get("fii_pct"))
        dii_l, dii_p = _safe_float(latest.get("dii_pct")), _safe_float(prev.get("dii_pct"))
        pro_l, pro_p = _safe_float(latest.get("promoter_pct")), _safe_float(prev.get("promoter_pct"))

        if fii_l is not None and fii_p is not None and (fii_l - fii_p) >= 1.0:
            fii_up.append((cid, fii_l - fii_p))
        if dii_l is not None and dii_p is not None and (dii_l - dii_p) >= 1.0:
            dii_up.append((cid, dii_l - dii_p))
        if pro_l is not None and pro_p is not None and (pro_l - pro_p) >= 0.5:
            pro_up.append((cid, pro_l - pro_p))

    fii_up.sort(key=lambda x: x[1], reverse=True)
    dii_up.sort(key=lambda x: x[1], reverse=True)
    pro_up.sort(key=lambda x: x[1], reverse=True)

    if not fii_up and not dii_up and not pro_up:
        return ""

    all_ids = list({cid for cid, _ in fii_up[:8] + dii_up[:8] + pro_up[:8]})
    co_map = _company_map_by_id(all_ids)

    def fmt_list(items: list[tuple[str, float]], limit: int = 4) -> str:
        parts = []
        for cid, delta in items[:limit]:
            sym = co_map.get(cid, {}).get("symbol", "?")
            parts.append(f"{sym} +{delta:.1f}%")
        rest = len(items) - limit
        s = " · ".join(parts)
        return s + (f" +{rest} more" if rest > 0 else "")

    lines = ["💹 INSTITUTIONAL ACTIVITY (latest quarter)"]
    if fii_up:
        lines.append(f"FII ↑ ({len(fii_up)}): {fmt_list(fii_up)}")
    if dii_up:
        lines.append(f"DII ↑ ({len(dii_up)}): {fmt_list(dii_up)}")
    if pro_up:
        lines.append(f"Promoter ↑ ({len(pro_up)}): {fmt_list(pro_up)}")
    return "\n".join(lines)


def _section_screener_summary(today: str) -> str:
    # delivery_data uses company_id (no symbol column)
    delivery_res = (
        supabase.table("delivery_data")
        .select("company_id,vs_30d_avg")
        .eq("date", today)
        .gt("vs_30d_avg", 2.0)
        .order("vs_30d_avg", desc=True)
        .limit(30)
        .execute()
    )
    delivery_rows = getattr(delivery_res, "data", None) or []

    # high conviction stocks from delivery_signals (latest date)
    sig_date_res = (
        supabase.table("delivery_signals")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    sig_date = (getattr(sig_date_res, "data", None) or [{}])[0].get("date")
    rs_rows: list[dict] = []
    if sig_date:
        hc_res = (
            supabase.table("delivery_signals")
            .select("company_id,avg_delivery_30d")
            .eq("date", sig_date)
            .eq("high_conviction", True)
            .order("avg_delivery_30d", desc=True)
            .limit(30)
            .execute()
        )
        rs_rows = getattr(hc_res, "data", None) or []

    if not delivery_rows and not rs_rows:
        return ""

    # Lookup symbols for all company_ids
    del_ids = [r["company_id"] for r in delivery_rows if r.get("company_id")]
    rs_ids = [r["company_id"] for r in rs_rows if r.get("company_id")]
    co_map = _company_map_by_id(list({*del_ids, *rs_ids}))

    lines = ["⚡ SCREENER"]
    if delivery_rows:
        top_del = " · ".join(
            f"{co_map.get(str(r['company_id']), {}).get('symbol', '?')} ({float(r['vs_30d_avg']):.1f}x)"
            for r in delivery_rows[:4]
            if r.get("company_id") and r.get("vs_30d_avg")
        )
        lines.append(f"High delivery ({len(delivery_rows)} stocks): {top_del}")
    if rs_rows:
        top_rs = " · ".join(
            co_map.get(str(r["company_id"]), {}).get("symbol", "?")
            for r in rs_rows[:5]
            if r.get("company_id")
        )
        lines.append(f"High conviction ({len(rs_rows)} stocks): {top_rs}")
    return "\n".join(lines)


# ── Full daily message ────────────────────────────────────────────────────────

def _build_daily_pulse() -> str:
    """
    Build daily market update message.
    Returns English text.
    Claude Haiku writes the message.
    Falls back to plain text if API fails.
    """
    import requests as req
    from datetime import date as _date

    # ── Fetch market internals ──────────
    try:
        mkt_res = (
            supabase
            .table("market_internals")
            .select(
                "date, nifty_close, "
                "nifty_change_1d, "
                "above_ma150_pct, "
                "stage2_pct, "
                "india_vix, "
                "new_52w_highs, "
                "new_52w_lows"
            )
            .order("date", desc=True)
            .limit(2)
            .execute()
        )
        market = getattr(mkt_res, "data", None) or []
    except Exception as e:
        print(f"market_internals error: {e}")
        market = []

    latest = market[0] if market else {}
    prev   = market[1] if len(market) > 1 else {}

    nifty      = float(latest.get("nifty_close")      or 0)
    nifty_chg  = float(latest.get("nifty_change_1d")  or 0)
    breadth    = float(latest.get("above_ma150_pct")   or 0)
    breadth_p  = float(prev.get("above_ma150_pct")     or 0)
    stage2_pct = float(latest.get("stage2_pct")        or 0)
    vix        = float(latest.get("india_vix")         or 0)
    highs      = int(latest.get("new_52w_highs")       or 0)
    lows       = int(latest.get("new_52w_lows")        or 0)
    breadth_chg = round(breadth - breadth_p, 1)

    # ── Fetch SwingX stocks ─────────────
    count_2a = count_2b = 0
    try:
        sx_res = supabase.rpc("get_home_stocks").execute()
        all_stocks = getattr(sx_res, "data", None) or []

        # Count Stage 2A vs 2B across all stocks
        count_2a = sum(1 for s in all_stocks if (s.get("weinstein_substage") or "").startswith("2A"))
        count_2b = sum(1 for s in all_stocks if (s.get("weinstein_substage") or "").startswith("2B"))

        swingx = [s for s in all_stocks if s.get("high_conviction")]
        swingx.sort(
            key=lambda x: float(x.get("rs_vs_nifty") or -999),
            reverse=True,
        )
        swingx = swingx[:8]
    except Exception as e:
        print(f"SwingX fetch error: {e}")
        swingx = []

    # ── Fetch weeks_in_stage2 for SwingX stocks ─
    weeks_map: dict = {}
    if swingx:
        cids = [s["id"] for s in swingx if s.get("id")]
        if cids:
            try:
                date_res = (
                    supabase.table("delivery_signals")
                    .select("date")
                    .order("date", desc=True)
                    .limit(1)
                    .execute()
                )
                sig_date = ((getattr(date_res, "data", None) or [{}])[0]).get("date", "")
                if sig_date:
                    wks_res = (
                        supabase.table("delivery_signals")
                        .select("company_id, weeks_in_stage2")
                        .in_("company_id", cids)
                        .eq("date", sig_date)
                        .execute()
                    )
                    for r in (getattr(wks_res, "data", None) or []):
                        if r.get("weeks_in_stage2") is not None:
                            weeks_map[r["company_id"]] = r["weeks_in_stage2"]
            except Exception as e:
                print(f"weeks_in_stage2 fetch error: {e}")

    # ── Build sector breakdown (no individual stock names — SEBI compliance) ───
    from collections import Counter
    sector_counts = Counter(
        s.get("sector", "Other")
        for s in swingx
        if s.get("sector")
    )
    top_sectors = ", ".join(
        f"{sector} ({count})"
        for sector, count in sector_counts.most_common(4)
    )
    stock_lines = f"Top sectors: {top_sectors}" if top_sectors else "Sectors: Mixed"

    today_str = _date.today().strftime("%d %b %Y")

    # ── Claude prompt ───────────────────
    prompt = f"""Write a daily market update for PineX — an Indian stock market intelligence platform on Telegram.

Date: {today_str}

MARKET DATA:
Nifty 50: {nifty:,.0f} ({nifty_chg:+.1f}% today)
NSE Breadth: {breadth:.0f}% above 30W MA (was {breadth_p:.0f}% yesterday, {breadth_chg:+.1f}%)
Stocks in uptrend phase: {stage2_pct:.0f}%
India VIX: {vix:.1f}
52W Highs today: {highs}
52W Lows today: {lows}

STAGE BREAKDOWN:
Stage 2A stocks (early uptrend): {count_2a}
Stage 2B stocks (extended uptrend): {count_2b}

SWINGX TODAY: {len(swingx)} stocks aligned
{stock_lines}
(Do NOT name individual stocks)

WRITING RULES — follow strictly:
1. Max 220 words total
2. OPENING must be exactly this format (substitute real numbers):
   "{count_2a} stocks in Stage 2A today — the earliest phase of a Weinstein uptrend. {count_2b} stocks in Stage 2B (extended). Full list at pinex.in"
3. Then one sentence on Nifty level and today's direction
4. One sentence on breadth — is it improving or narrowing?
5. NEVER mention any stock names or symbols (SEBI compliance)
6. Mention top sectors only: e.g. "Healthcare and Pharma leading the aligned stocks today"
7. Always end with curiosity gap: "Full list of X aligned stocks available at pinex.in"
8. Example format: "8 stocks in early uptrend today. Pharma and Healthcare leading. Full aligned list at pinex.in"
9. End with one market structure observation (VIX or breadth trend)
10. Second-to-last line must be exactly: "Data for educational purposes only. Not investment advice."
11. NEVER use: buy, sell, bullish, bearish, opportunity, target, breakout, hot stocks, must watch
12. NEVER predict future price movement
13. Tone: calm, factual, neutral — like reading a weather report — describe what IS, not what WILL BE
14. Use plain English
15. Maximum 2 emojis total
16. Last line: "pinex.in"

Format:
- No markdown bold or headers
- Plain text only
- Telegram-friendly line breaks"""

    # ── Call Claude Haiku ───────────────
    claude_key = os.environ.get("CLAUDE_API_KEY", "").strip()

    if claude_key:
        try:
            r = req.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": claude_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5",
                    "max_tokens": 400,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=30,
            )
            data = r.json()
            text = (data.get("content") or [{}])[0].get("text", "").strip()
            if text:
                print("Claude message ✅")
                return text
            print("Empty Claude response")
        except Exception as e:
            print(f"Claude error: {e}")

    # ── Plain text fallback ─────────────
    print("Using plain text fallback")
    bsign = "+" if breadth_chg >= 0 else ""
    lines = [
        f"📊 PineX Daily — {today_str}",
        "",
        f"{count_2a} stocks in Stage 2A today — the earliest phase of a Weinstein uptrend. "
        f"{count_2b} stocks in Stage 2B (extended). Full list at pinex.in",
        "",
        f"Nifty: {nifty:,.0f} ({nifty_chg:+.1f}% today)",
        f"Breadth: {breadth:.0f}% above 30W MA ({bsign}{breadth_chg:.1f}%)",
        f"VIX: {vix:.1f}  52W H:{highs} L:{lows}",
        "",
        f"SwingX aligned: {len(swingx)} stocks",
    ]
    for s in swingx[:5]:
        lines.append("")
        lines.append(_stock_line(s))
    lines += [
        "",
        "Data for educational purposes only. Not investment advice.",
        "pinex.in",
    ]
    return "\n".join(lines)


def _translate_to_malayalam(english_text: str) -> str:
    """
    Translate English market update to Malayalam using Gemini Flash Lite.
    Stock symbols and numbers stay English.
    """
    import requests as req

    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()

    if not gemini_key:
        print("GEMINI_API_KEY not set — skipping Malayalam")
        return ""

    prompt = f"""Translate this Indian stock market update to Malayalam.

STRICT RULES:
1. Keep ALL stock symbols in English: SYRMA, NIFTY, KALPATARU, RELIANCE etc
2. Keep ALL numbers in digits: 23644, 18.8, 30%, +2.1% etc
3. Keep ₹ symbol as is
4. Keep % symbol as is
5. Keep these words in English: SwingX, Stage 2, VIX, RS, NSE, BSE, Nifty, Sensex, EMS, IT, FMCG, pinex.in
6. Translate everything else naturally into everyday Malayalam
7. Do NOT do word-for-word translation — make it sound natural in Malayalam
8. The disclaimer line MUST be exactly: "ഈ വിവരങ്ങൾ പഠനത്തിന് മാത്രം. നിക്ഷേപ ഉപദേശമല്ല."
9. Keep the same line breaks and paragraph structure
10. Keep emojis as they are
11. Do not add or remove any information
12. pinex.in stays as pinex.in

English text:
{english_text}

Return ONLY the Malayalam translation. No explanation. No preamble."""

    try:
        url = (
            "https://generativelanguage.googleapis.com/v1beta"
            "/models/gemini-2.5-flash-lite:generateContent"
            f"?key={gemini_key}"
        )
        r = req.post(
            url,
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "maxOutputTokens": 600,
                    "temperature": 0.2,
                },
            },
            timeout=30,
        )
        data = r.json()
        text = (
            data
            .get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )

        if not text:
            print("Empty Gemini response")
            print(str(data)[:300])
            return ""

        # Fix common wrong translations of the disclaimer
        wrong = [
            "വിദ്യാഭ്യാസ ആവശ്യങ്ങൾക്ക് മാത്രം",
            "വിദ്യാഭ്യാസ ആവശ്യത്തിന് മാത്രം",
            "വിദ്യാഭ്യാസ ഉദ്ദേശ്യങ്ങൾക്ക് മാത്രം",
            "വിദ്യാഭ്യാസ ആവശ്യം",
        ]
        for w in wrong:
            text = text.replace(w, "പഠനത്തിന് മാത്രം")

        print("Malayalam translation ✅")
        return text

    except Exception as e:
        print(f"Gemini error: {e}")
        return ""


# ── Weekly digest ─────────────────────────────────────────────────────────────

def _build_weekly_digest() -> str:
    # Stage 2 count from market_internals (latest row)
    mi_res = (
        supabase.table("market_internals")
        .select("date,stage2_count,stage2_pct,above_ma150_pct,new_52w_highs,new_52w_lows")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    mi = (getattr(mi_res, "data", None) or [{}])[0]
    stage2_count = int(mi.get("stage2_count") or 0)
    stage2_pct = _safe_float(mi.get("stage2_pct"))
    breadth = _safe_float(mi.get("above_ma150_pct"))
    hi = mi.get("new_52w_highs") or 0
    lo = mi.get("new_52w_lows") or 0

    # Stage 4 count: query price_data is_latest=True, stage='Stage 4'
    s4_res = (
        supabase.table("price_data")
        .select("company_id", count="exact")
        .eq("is_latest", True)
        .eq("stage", "Stage 4")
        .execute()
    )
    stage4_count = getattr(s4_res, "count", None) or len(getattr(s4_res, "data", None) or [])

    # Top sector movers this week from nifty_sectors
    latest_sector_date_res = (
        supabase.table("nifty_sectors")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    latest_sector_date = (getattr(latest_sector_date_res, "data", None) or [{}])[0].get("date")
    top_sector_str = watch_sector_str = "-"
    if latest_sector_date:
        sectors_res = (
            supabase.table("nifty_sectors")
            .select("display_name,index_name,change_1w")
            .eq("date", latest_sector_date)
            .execute()
        )
        sectors_rows = [r for r in (getattr(sectors_res, "data", None) or []) if r.get("change_1w") is not None]
        sectors_rows.sort(key=lambda r: float(r["change_1w"]), reverse=True)

        def _sname(r: dict) -> str:
            return (r.get("display_name") or r.get("index_name") or "").replace("Nifty ", "").replace("NIFTY ", "").strip()

        if sectors_rows:
            best = sectors_rows[0]
            top_sector_str = f"{_sname(best)} ({_fmt_pct(_safe_float(best['change_1w']))} this week)"
        worst = [r for r in sectors_rows if float(r["change_1w"]) < 0]
        if worst:
            w = worst[-1]
            watch_sector_str = f"{_sname(w)} ({_fmt_pct(_safe_float(w['change_1w']))} this week)"

    # Top SwingX stocks (high_conviction, latest date)
    sig_date_res = (
        supabase.table("delivery_signals")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    sig_date = (getattr(sig_date_res, "data", None) or [{}])[0].get("date")
    swingx_line = ""
    if sig_date:
        hc_res = (
            supabase.table("delivery_signals")
            .select("company_id,avg_delivery_30d")
            .eq("date", sig_date)
            .eq("high_conviction", True)
            .order("avg_delivery_30d", desc=True)
            .limit(8)
            .execute()
        )
        hc_rows = getattr(hc_res, "data", None) or []
        if hc_rows:
            ids = [r["company_id"] for r in hc_rows if r.get("company_id")]
            co_map = _company_map_by_id(ids)
            syms = " · ".join(co_map.get(str(i), {}).get("symbol", "?") for i in ids[:6])
            rest = len(ids) - 6
            swingx_line = f"⚡ SwingX ({len(hc_rows)} setups): {syms}" + (f" +{rest} more" if rest > 0 else "")

    lines = [
        f"*PineX Weekly — {datetime.now().strftime('%d %b %Y')}*",
        "",
        "*Market breadth*",
        f"Stage 2 stocks: {stage2_count} ({_fmt_pct(stage2_pct) if stage2_pct else '—'})",
        f"Stage 4 stocks: {stage4_count}",
        f"Above 30W MA: {_fmt_pct(breadth, sign=False) if breadth else '—'}",
        f"52W Highs: {hi}  ·  52W Lows: {lo}",
        "",
        "*Sectors (1W)*",
        f"↑ Best: {top_sector_str}",
        f"↓ Watch: {watch_sector_str}",
    ]
    if swingx_line:
        lines += ["", swingx_line]
    lines += [
        "",
        "Have a good investing week 🇮🇳",
        "pinex.in",
    ]
    return "\n".join(lines)


# ── Send helpers ──────────────────────────────────────────────────────────────

def send_daily_pulse() -> dict[str, Any]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN missing.")

    print("GEMINI_API_KEY set:", bool(os.environ.get("GEMINI_API_KEY")))

    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        print("Warning: GEMINI_API_KEY not set")
        print("Malayalam will be skipped")

    channel = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()

    if channel:
        if channel.startswith("https://t.me/"):
            channel = "@" + channel[len("https://t.me/"):]
        elif channel.startswith("t.me/"):
            channel = "@" + channel[len("t.me/"):]
        targets = [channel]
    else:
        print("TELEGRAM_CHANNEL_ID not set — falling back to subscribers")
        subs = _subscribers()
        targets = [str(s["chat_id"]) for s in subs if s.get("chat_id")]

    if not targets:
        print("No targets to send to")
        return {"sent_en": 0, "sent_ml": 0, "failed": 0, "channel": ""}

    # Build English message
    text_en = _build_daily_pulse()

    print("English message preview:")
    print("─" * 40)
    print(text_en)
    print("─" * 40)

    # Send English
    sent_en = failed_en = 0
    for chat_id in targets:
        ok, err = _send_message(token, chat_id, text_en)
        if ok:
            sent_en += 1
        else:
            failed_en += 1
            print(f"EN send failed ({chat_id}): {err}")
        time.sleep(SEND_INTERVAL_SEC)

    # Translate and send Malayalam
    sent_ml = 0
    text_ml = _translate_to_malayalam(text_en)

    if text_ml:
        print("Malayalam message preview:")
        print("─" * 40)
        print(text_ml)
        print("─" * 40)
        time.sleep(2)
        for chat_id in targets:
            ok, err = _send_message(token, chat_id, text_ml)
            if ok:
                sent_ml += 1
            else:
                print(f"ML send failed ({chat_id}): {err}")
            time.sleep(SEND_INTERVAL_SEC)
    else:
        print("Malayalam translation unavailable — skipping")

    results: dict[str, Any] = {
        "sent_en": sent_en,
        "sent_ml": sent_ml,
        "failed": failed_en,
        "channel": targets[0] if len(targets) == 1 else f"{len(targets)} subscribers",
    }
    log_event("telegram_daily_pulse_sent", results)
    print(f"Daily pulse done: EN={sent_en} ML={sent_ml} failed={failed_en}")
    return results


def send_to_channel() -> dict[str, Any]:
    """Send daily pulse to TELEGRAM_CHANNEL_ID (e.g. @pinexin or a numeric ID)."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    channel = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN missing.")
    if not channel:
        raise ValueError("TELEGRAM_CHANNEL_ID missing.")
    # Normalise: t.me/pinexin → @pinexin; already @pinexin or numeric stays as-is
    if channel.startswith("t.me/"):
        channel = "@" + channel[len("t.me/"):]
    elif channel.startswith("https://t.me/"):
        channel = "@" + channel[len("https://t.me/"):]
    text = _build_daily_pulse()
    return _broadcast(token, text, [channel], "telegram_channel_pulse_sent")


def send_weekly_digest() -> dict[str, Any]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN missing.")
    subs = _subscribers()
    chat_ids = [str(s["chat_id"]) for s in subs if s.get("chat_id")]
    text = _build_weekly_digest()
    return _broadcast(token, text, chat_ids, "telegram_weekly_digest_sent")


def send_results_alert(symbol: str, company_name: str) -> dict[str, Any]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN missing.")

    symbol = symbol.upper().strip()
    subs = _subscribers()
    eligible_chat_ids: list[str] = []
    linked_user_ids = [s.get("user_id") for s in subs if s.get("user_id")]
    watch_user_ids: set[str] = set()
    if linked_user_ids:
        wl_res = (
            supabase.table("watchlists")
            .select("user_id")
            .eq("symbol", symbol)
            .in_("user_id", linked_user_ids)
            .execute()
        )
        watch_user_ids = {str(r["user_id"]) for r in (getattr(wl_res, "data", None) or []) if r.get("user_id")}

    for s in subs:
        if s.get("user_id") and str(s["user_id"]) in watch_user_ids and s.get("chat_id"):
            eligible_chat_ids.append(str(s["chat_id"]))

    text = (
        f"📊 Results filed: {company_name} ({symbol})\n"
        f"Analysis ready: pinex.in/stock/{symbol}\n"
        "(Updated within the last 30 minutes)"
    )
    return _broadcast(token, text, eligible_chat_ids, "telegram_results_alert_sent")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="PineX Telegram broadcast helpers.")
    parser.add_argument(
        "command",
        nargs="?",
        choices=["daily", "channel", "weekly", "results", "preview"],
        help="daily=subscribers, channel=TELEGRAM_CHANNEL_ID, weekly, results, preview=print only",
    )
    parser.add_argument("--daily", action="store_true")
    parser.add_argument("--channel", action="store_true")
    parser.add_argument("--weekly", action="store_true")
    parser.add_argument("--results", default="")
    parser.add_argument("--symbol", default="")
    parser.add_argument("--company-name", default="")
    args = parser.parse_args()

    command = args.command
    if args.daily:
        command = "daily"
    elif args.channel:
        command = "channel"
    elif args.weekly:
        command = "weekly"
    elif args.results:
        command = "results"

    if command == "preview":
        print(_build_daily_pulse())
        return

    if command == "daily":
        out = send_daily_pulse()
        print(f"daily pulse: sent_en={out['sent_en']} sent_ml={out['sent_ml']} failed={out['failed']}")
        return

    if command == "channel":
        out = send_to_channel()
        print(f"channel pulse: sent={out['sent']} failed={out['failed']}")
        return

    if command == "weekly":
        out = send_weekly_digest()
        print(f"weekly digest: sent={out['sent']} failed={out['failed']}")
        return

    if command == "results":
        symbol = (args.symbol or args.results).strip().upper()
        if not symbol:
            raise SystemExit("--symbol SYMBOL required for results")
        company_name = args.company_name.strip()
        if not company_name:
            c = supabase.table("companies").select("name").eq("symbol", symbol).limit(1).execute()
            rows = getattr(c, "data", None) or []
            company_name = str(rows[0].get("name") or symbol) if rows else symbol
        out = send_results_alert(symbol, company_name)
        print(f"results alert: sent={out['sent']} failed={out['failed']}")
        return

    raise SystemExit("Provide: daily / channel / weekly / results / preview")


if __name__ == "__main__":
    main()
