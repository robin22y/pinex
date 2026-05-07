"""Telegram bot command handler for StockIQ updates."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from db import log_event, supabase
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes


def _fmt_date(dt_value: Any) -> str:
    if not dt_value:
        return "-"
    try:
        if isinstance(dt_value, datetime):
            dt = dt_value
        else:
            text = str(dt_value).replace("Z", "+00:00")
            dt = datetime.fromisoformat(text)
        return dt.strftime("%d %b")
    except Exception:
        return str(dt_value)


def _safe_text(value: Any, fallback: str = "") -> str:
    txt = str(value or "").strip()
    return txt if txt else fallback


def _status_icon(status: str) -> str:
    s = status.lower()
    if s in ("strong", "green"):
        return "🟢"
    if s in ("weak", "red"):
        return "🔴"
    return "🟡"


async def cmd_start(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        "Welcome to StockIQ Bot 🇮🇳\n"
        "I send you daily updates on Indian stocks — plain language, no jargon.\n\n"
        "What I'll send you:\n"
        "• Daily pulse when your watchlist stocks show unusual activity\n"
        "• Sunday weekly digest\n"
        "• Alerts when results are filed (if you have a StockIQ account)\n\n"
        "Commands:\n"
        "/subscribe — get daily market pulse\n"
        "/unsubscribe — stop notifications\n"
        "/today — see today's notable changes\n"
        "/setups — today's swing setups (top 10)\n"
        "/sector — sector health overview\n"
        "/stock SYMBOL — quick summary of any stock\n"
        "/help — show this menu"
    )
    await update.message.reply_text(text)


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await cmd_start(update, context)


async def cmd_subscribe(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    user = update.effective_user
    if not chat:
        return

    payload = {
        "chat_id": str(chat.id),
        "username": _safe_text(getattr(user, "username", None)),
        "first_name": _safe_text(getattr(user, "first_name", None)),
        "created_at": datetime.utcnow().isoformat(),
    }
    supabase.table("telegram_subscribers").upsert(payload, on_conflict="chat_id").execute()
    log_event("telegram_subscribed", {"chat_id": str(chat.id)})
    await update.message.reply_text("Subscribed! You will receive daily updates.")


async def cmd_unsubscribe(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if not chat:
        return
    supabase.table("telegram_subscribers").delete().eq("chat_id", str(chat.id)).execute()
    log_event("telegram_unsubscribed", {"chat_id": str(chat.id)})
    await update.message.reply_text("Unsubscribed. You can re-subscribe anytime with /subscribe")


async def cmd_today(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=7)).isoformat()
    qc = (
        supabase.table("quarterly_changes")
        .select("company_id,headline,changes,updated_at")
        .gte("updated_at", since)
        .order("updated_at", desc=True)
        .limit(400)
        .execute()
    )
    rows = getattr(qc, "data", None) or []
    rows = [
        r for r in rows
        if isinstance(r.get("changes"), list)
        and any(bool(c.get("is_first_time")) for c in r.get("changes") or [])
    ][:10]

    company_ids = [r.get("company_id") for r in rows if r.get("company_id")]
    company_map: dict[str, dict[str, Any]] = {}
    if company_ids:
        c = (
            supabase.table("companies")
            .select("id,name,symbol")
            .in_("id", company_ids)
            .execute()
        )
        company_map = {str(x["id"]): x for x in (getattr(c, "data", None) or [])}

    lines = ["Notable changes today:"]
    for r in rows:
        company = company_map.get(str(r.get("company_id")), {})
        name = _safe_text(company.get("name"), "Company")
        symbol = _safe_text(company.get("symbol"), "")
        headline = _safe_text(r.get("headline")).replace("_", " ")
        if symbol:
            lines.append(f"⚠️ {name} — {headline}")
            lines.append(f"Full analysis: stockiq.in/stock/{symbol}")
        else:
            lines.append(f"⚠️ {name} — {headline}")

    if len(lines) == 1:
        lines.append("No first-time notable changes in the last 7 days.")
    await update.message.reply_text("\n".join(lines[:30]))


async def cmd_setups(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    s = (
        supabase.table("swing_conditions")
        .select("symbol,conditions_met,breakout_52w,stage2_new_this_week")
        .eq("trading_date", today)
        .gte("conditions_met", 4)
        .order("conditions_met", desc=True)
        .limit(10)
        .execute()
    )
    rows = getattr(s, "data", None) or []
    lines = ["Today's swing setups (conditions met):"]
    for r in rows:
        symbol = _safe_text(r.get("symbol"), "?")
        met = int(r.get("conditions_met") or 0)
        flag = "52W breakout" if r.get("breakout_52w") else ("Stage 2 entry" if r.get("stage2_new_this_week") else "Setup")
        emoji = "🔥" if met >= 5 else "⚡"
        lines.append(f"{emoji} {symbol} ({met}/5) — {flag}")
    if len(rows) == 0:
        lines.append("No setups meeting 4/5 conditions today.")
    lines.append("Full details: stockiq.in")
    lines.append("These are technical conditions only. Not trade recommendations.")
    await update.message.reply_text("\n".join(lines))


async def cmd_sector(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
    latest = (
        supabase.table("sectors")
        .select("trading_date")
        .order("trading_date", desc=True)
        .limit(1)
        .execute()
    )
    latest_date = (getattr(latest, "data", None) or [{}])[0].get("trading_date")
    if not latest_date:
        await update.message.reply_text("Sector data is not available yet.")
        return

    res = (
        supabase.table("sectors")
        .select("sector,health,stage2_count,total_companies,total_count")
        .eq("trading_date", latest_date)
        .order("stage2_count", desc=True)
        .limit(10)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    lines = ["Sector pulse today:"]
    for r in rows:
        stage2 = int(r.get("stage2_count") or 0)
        total = int(r.get("total_companies") or r.get("total_count") or 0)
        icon = _status_icon(_safe_text(r.get("health"), "neutral"))
        lines.append(f"{icon} {_safe_text(r.get('sector'), 'Sector')} — {stage2}/{total} in Stage 2")
    lines.append("Full details: stockiq.in")
    await update.message.reply_text("\n".join(lines))


async def cmd_stock(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text("Usage: /stock SYMBOL")
        return
    symbol = context.args[0].upper().strip()

    company_res = (
        supabase.table("companies")
        .select("id,name,symbol")
        .eq("symbol", symbol)
        .limit(1)
        .execute()
    )
    company_rows = getattr(company_res, "data", None) or []
    if not company_rows:
        await update.message.reply_text(f"No company found for {symbol}")
        return
    company = company_rows[0]
    company_id = company.get("id")

    latest_price_date_res = (
        supabase.table("price_data")
        .select("trading_date")
        .eq("symbol", symbol)
        .order("trading_date", desc=True)
        .limit(1)
        .execute()
    )
    latest_price_date = (getattr(latest_price_date_res, "data", None) or [{}])[0].get("trading_date")
    stage = "-"
    if latest_price_date:
        price_res = (
            supabase.table("price_data")
            .select("stage")
            .eq("symbol", symbol)
            .eq("trading_date", latest_price_date)
            .limit(1)
            .execute()
        )
        stage = _safe_text((getattr(price_res, "data", None) or [{}])[0].get("stage"), "-")

    change_res = (
        supabase.table("quarterly_changes")
        .select("headline")
        .eq("company_id", company_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    change = _safe_text((getattr(change_res, "data", None) or [{}])[0].get("headline"), "No major changes")
    change = change.replace("_", " ")

    delivery_res = (
        supabase.table("delivery_data")
        .select("delivery_pct,vs_30d_avg")
        .eq("symbol", symbol)
        .order("trading_date", desc=True)
        .limit(1)
        .execute()
    )
    delivery_row = (getattr(delivery_res, "data", None) or [{}])[0]
    delivery_pct = delivery_row.get("delivery_pct")
    vs_30d = delivery_row.get("vs_30d_avg")
    delivery_line = "Delivery today: N/A"
    if delivery_pct is not None:
        if vs_30d is not None:
            delivery_line = f"Delivery today: {float(delivery_pct):.1f}% ({float(vs_30d):.1f}x normal)"
        else:
            delivery_line = f"Delivery today: {float(delivery_pct):.1f}% (normal)"

    sh_res = (
        supabase.table("shareholding")
        .select("promoter_pct")
        .eq("company_id", company_id)
        .order("quarter_name", desc=True)
        .limit(1)
        .execute()
    )
    sh_row = (getattr(sh_res, "data", None) or [{}])[0]
    promoter = sh_row.get("promoter_pct")
    promoter_line = "Promoter: N/A"
    if promoter is not None:
        promoter_line = f"Promoter: {float(promoter):.1f}% stable"

    lines = [
        f"{company['symbol']} — {company['name']}",
        f"Stage: {stage} {'⚠️' if '4' in stage else ''}".strip(),
        f"What changed: {change}",
        delivery_line,
        promoter_line,
        f"Full analysis: stockiq.in/stock/{company['symbol']}",
    ]
    await update.message.reply_text("\n".join(lines))


def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN is missing in scripts/.env")

    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("subscribe", cmd_subscribe))
    app.add_handler(CommandHandler("unsubscribe", cmd_unsubscribe))
    app.add_handler(CommandHandler("today", cmd_today))
    app.add_handler(CommandHandler("setups", cmd_setups))
    app.add_handler(CommandHandler("sector", cmd_sector))
    app.add_handler(CommandHandler("stock", cmd_stock))

    print("telegram_bot started. Press Ctrl+C to stop.")
    app.run_polling()


if __name__ == "__main__":
    main()
