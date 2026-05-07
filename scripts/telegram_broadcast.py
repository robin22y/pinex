"""Scheduled Telegram broadcast helpers for StockIQ."""

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


def _safe_float(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _today_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _send_message(token: str, chat_id: str, text: str) -> tuple[bool, str | None]:
    url = f"{BASE_URL}/bot{token}/sendMessage"
    try:
        res = requests.post(
            url,
            json={
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": True,
            },
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


def _company_map_by_symbol(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    res = (
        supabase.table("companies")
        .select("id,symbol,name,sector")
        .in_("symbol", symbols)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return {str(r.get("symbol")): r for r in rows if r.get("symbol")}


def _broadcast(token: str, text: str, targets: list[str], event_type: str) -> dict[str, Any]:
    sent = 0
    failed = 0
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
    payload = {"sent": sent, "failed": failed, "elapsed_sec": elapsed, "targets": len(targets)}
    if errors:
        payload["errors"] = errors[:20]
    log_event(event_type, payload)
    return payload


def _build_daily_pulse() -> str:
    today = _today_iso()

    swing_res = (
        supabase.table("swing_conditions")
        .select("symbol,conditions_met,breakout_52w,stage2_new_this_week")
        .eq("trading_date", today)
        .gte("conditions_met", 4)
        .order("conditions_met", desc=True)
        .limit(100)
        .execute()
    )
    swing_rows = getattr(swing_res, "data", None) or []
    swing_symbols = [str(r.get("symbol")) for r in swing_rows if r.get("symbol")]

    delivery_res = (
        supabase.table("delivery_data")
        .select("symbol,vs_30d_avg")
        .eq("trading_date", today)
        .gt("vs_30d_avg", 1.8)
        .order("vs_30d_avg", desc=True)
        .limit(100)
        .execute()
    )
    delivery_rows = getattr(delivery_res, "data", None) or []
    delivery_symbols = [str(r.get("symbol")) for r in delivery_rows if r.get("symbol")]

    qc_res = (
        supabase.table("quarterly_changes")
        .select("company_id,headline,changes,updated_at")
        .gte("updated_at", (datetime.now(UTC) - timedelta(days=7)).isoformat())
        .order("updated_at", desc=True)
        .limit(300)
        .execute()
    )
    qc_rows = getattr(qc_res, "data", None) or []
    first_time_rows = [
        r for r in qc_rows
        if isinstance(r.get("changes"), list)
        and any(bool(c.get("is_first_time")) for c in (r.get("changes") or []))
    ]

    company_ids = [r.get("company_id") for r in first_time_rows if r.get("company_id")]
    company_map_by_id: dict[str, dict[str, Any]] = {}
    if company_ids:
        c_res = (
            supabase.table("companies")
            .select("id,symbol,name")
            .in_("id", company_ids)
            .execute()
        )
        c_rows = getattr(c_res, "data", None) or []
        company_map_by_id = {str(r.get("id")): r for r in c_rows if r.get("id")}

    symbol_map = _company_map_by_symbol(list({*swing_symbols, *delivery_symbols}))

    breakout_top = []
    for r in swing_rows:
        if not r.get("breakout_52w"):
            continue
        sym = str(r.get("symbol") or "")
        if not sym:
            continue
        name = str(symbol_map.get(sym, {}).get("name") or sym)
        breakout_top.append(f"• {name} ({sym})")
        if len(breakout_top) >= 3:
            break

    unusual_top = []
    for r in delivery_rows[:3]:
        sym = str(r.get("symbol") or "")
        if not sym:
            continue
        name = str(symbol_map.get(sym, {}).get("name") or sym)
        unusual_top.append(f"• {name} ({sym})")

    first_time_top = []
    for r in first_time_rows[:2]:
        comp = company_map_by_id.get(str(r.get("company_id")), {})
        sym = str(comp.get("symbol") or "")
        name = str(comp.get("name") or "Company")
        headline = str(r.get("headline") or "").replace("_", " ")
        if sym:
            first_time_top.append(f"• {name} ({sym}) — {headline}")
        else:
            first_time_top.append(f"• {name} — {headline}")

    lines = [
        f"StockIQ Morning Pulse — {datetime.now().strftime('%d %b %Y')}",
        "",
        f"🚀 Breaking out today: {sum(1 for r in swing_rows if r.get('breakout_52w'))} stocks",
        *(breakout_top or ["• No major breakouts yet"]),
        "",
        f"⚡ Unusual delivery: {len(delivery_rows)} stocks",
        *(unusual_top or ["• No unusual delivery spikes"]),
        "",
        f"📊 Swing setups: {len(swing_rows)} stocks with 4+ conditions",
        "",
        f"🔄 First-time events this week: {len(first_time_rows)}",
        *(first_time_top or ["• No first-time events yet"]),
        "",
        "Full details → stockiq.in",
    ]
    return "\n".join(lines)


def send_daily_pulse() -> dict[str, Any]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN missing.")
    subs = _subscribers()
    chat_ids = [str(s.get("chat_id")) for s in subs if s.get("chat_id")]
    text = _build_daily_pulse()
    return _broadcast(token, text, chat_ids, "telegram_daily_pulse_sent")


def _build_weekly_digest() -> str:
    now = datetime.now(UTC)
    week_ago = (now - timedelta(days=7)).isoformat()
    today = _today_iso()

    swing_latest = (
        supabase.table("swing_conditions")
        .select("symbol,stage2_new_this_week")
        .eq("trading_date", today)
        .execute()
    )
    swing_rows = getattr(swing_latest, "data", None) or []
    stage2_count = sum(1 for r in swing_rows if r.get("stage2_new_this_week"))

    # Stage 4 entries + first-time decline proxy from quarterly changes types.
    qc_res = (
        supabase.table("quarterly_changes")
        .select("company_id,headline,changes,updated_at")
        .gte("updated_at", week_ago)
        .order("updated_at", desc=True)
        .limit(500)
        .execute()
    )
    qc_rows = getattr(qc_res, "data", None) or []

    first_time_decline = 0
    entered_stage4 = 0
    notable: list[dict[str, Any]] = []
    for r in qc_rows:
        changes = r.get("changes") or []
        if not isinstance(changes, list):
            continue
        for c in changes:
            typ = str(c.get("type") or "").lower()
            if c.get("is_first_time") and ("decline" in typ or "compression" in typ):
                first_time_decline += 1
            if "stage4" in typ:
                entered_stage4 += 1
        if any(bool(c.get("is_first_time")) for c in changes):
            notable.append(r)

    latest_sector_date_res = (
        supabase.table("sectors")
        .select("trading_date")
        .order("trading_date", desc=True)
        .limit(1)
        .execute()
    )
    latest_sector_date = (getattr(latest_sector_date_res, "data", None) or [{}])[0].get("trading_date")
    sectors_rows: list[dict[str, Any]] = []
    if latest_sector_date:
        sectors_res = (
            supabase.table("sectors")
            .select("sector,stage2_count,total_companies,health")
            .eq("trading_date", latest_sector_date)
            .execute()
        )
        sectors_rows = getattr(sectors_res, "data", None) or []

    top_sector = None
    watch_sector = None
    if sectors_rows:
        top_sector = max(sectors_rows, key=lambda x: int(x.get("stage2_count") or 0))
        weak = [s for s in sectors_rows if str(s.get("health") or "").lower() in ("weak", "red")]
        watch_sector = weak[0] if weak else min(sectors_rows, key=lambda x: int(x.get("stage2_count") or 0))

    company_ids = [r.get("company_id") for r in notable[:5] if r.get("company_id")]
    company_map_by_id: dict[str, dict[str, Any]] = {}
    if company_ids:
        c_res = (
            supabase.table("companies")
            .select("id,name,symbol")
            .in_("id", company_ids)
            .execute()
        )
        c_rows = getattr(c_res, "data", None) or []
        company_map_by_id = {str(r.get("id")): r for r in c_rows if r.get("id")}

    notable_lines: list[str] = []
    for r in notable[:5]:
        c = company_map_by_id.get(str(r.get("company_id")), {})
        sym = str(c.get("symbol") or "")
        name = str(c.get("name") or "Company")
        headline = str(r.get("headline") or "").replace("_", " ")
        notable_lines.append(f"• {name} ({sym}) — {headline}")

    lines = [
        f"StockIQ Weekly Digest — Week ending {datetime.now().strftime('%d %b %Y')}",
        "",
        "This week across NSE:",
        f"📈 Stage 2 confirmations: {stage2_count} new companies",
        f"⚠️ First-time earnings decline: {first_time_decline} companies",
        f"🔴 Entered Stage 4: {entered_stage4} companies",
        "",
        f"Top sector: {top_sector['sector']} ({int(top_sector.get('stage2_count') or 0)} in Stage 2)" if top_sector else "Top sector: -",
        f"Watch sector: {watch_sector['sector']} (deteriorating signals)" if watch_sector else "Watch sector: -",
        "",
        "Notable changes:",
        *(notable_lines or ["• No major first-time events this week"]),
        "",
        "Have a good investing week 🇮🇳",
        "stockiq.in",
    ]
    return "\n".join(lines)


def send_weekly_digest() -> dict[str, Any]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN missing.")
    subs = _subscribers()
    chat_ids = [str(s.get("chat_id")) for s in subs if s.get("chat_id")]
    text = _build_weekly_digest()
    return _broadcast(token, text, chat_ids, "telegram_weekly_digest_sent")


def send_results_alert(symbol: str, company_name: str) -> dict[str, Any]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN missing.")

    symbol = symbol.upper().strip()
    if not symbol:
        raise ValueError("symbol is required")

    # Optional linking feature: telegram_subscribers.user_id mapped to watchlist.user_id.
    subs = _subscribers()
    eligible_chat_ids: list[str] = []
    if subs:
        linked_user_ids = [s.get("user_id") for s in subs if s.get("user_id")]
        watch_user_ids: set[str] = set()
        if linked_user_ids:
            wl_res = (
                supabase.table("watchlist")
                .select("user_id")
                .eq("symbol", symbol)
                .in_("user_id", linked_user_ids)
                .execute()
            )
            watch_rows = getattr(wl_res, "data", None) or []
            watch_user_ids = {str(r.get("user_id")) for r in watch_rows if r.get("user_id")}

        for s in subs:
            user_id = s.get("user_id")
            chat_id = s.get("chat_id")
            if user_id and str(user_id) in watch_user_ids and chat_id:
                eligible_chat_ids.append(str(chat_id))

    text = (
        f"📊 Results just filed: {company_name} ({symbol})\n"
        f"Analysis ready: stockiq.in/stock/{symbol}\n"
        "(Updated within the last 30 minutes)"
    )
    return _broadcast(token, text, eligible_chat_ids, "telegram_results_alert_sent")


def main() -> None:
    parser = argparse.ArgumentParser(description="StockIQ Telegram broadcast helpers.")
    parser.add_argument("command", nargs="?", choices=["daily", "weekly", "results"], help="Which broadcast to run")
    parser.add_argument("--daily", action="store_true", help="Run daily pulse")
    parser.add_argument("--weekly", action="store_true", help="Run weekly digest")
    parser.add_argument("--results", default="", help="Run results alert for SYMBOL")
    parser.add_argument("--symbol", default="", help="Symbol for results alert")
    parser.add_argument("--company-name", default="", help="Company name for results alert")
    args = parser.parse_args()

    command = args.command
    result_symbol = args.symbol
    if args.daily:
        command = "daily"
    elif args.weekly:
        command = "weekly"
    elif args.results:
        command = "results"
        result_symbol = args.results

    if command == "daily":
        out = send_daily_pulse()
        print(f"daily pulse done: sent={out['sent']} failed={out['failed']}")
        return
    if command == "weekly":
        out = send_weekly_digest()
        print(f"weekly digest done: sent={out['sent']} failed={out['failed']}")
        return

    if command == "results":
        symbol = (result_symbol or "").strip().upper()
        if not symbol:
            raise SystemExit("--results SYMBOL (or --symbol SYMBOL) is required for results")

        company_name = args.company_name.strip()
        if not company_name:
            c = (
                supabase.table("companies")
                .select("name")
                .eq("symbol", symbol)
                .limit(1)
                .execute()
            )
            rows = getattr(c, "data", None) or []
            company_name = str(rows[0].get("name") or symbol) if rows else symbol

        out = send_results_alert(symbol, company_name)
        print(f"results alert done: sent={out['sent']} failed={out['failed']}")
        return

    raise SystemExit("Provide one of: daily/weekly/results or --daily/--weekly/--results SYMBOL")


if __name__ == "__main__":
    main()
