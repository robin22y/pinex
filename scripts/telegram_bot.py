"""Telegram bot command handler for PineX updates."""

from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from db import log_event, supabase
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)


# ── /link conversation states ───────────────────────────────────
# WAITING_EMAIL = state after /link, before the user has replied
# with an email. ConversationHandler routes the next message-text
# they send through cmd_link_email which does the lookup + update
# + reply, then returns ConversationHandler.END.
WAITING_EMAIL = 0

# Lightweight RFC-ish email shape check. We intentionally don't
# verify deliverability or DNS — the lookup against profiles is
# the actual gate (a typo just means "not found" and the user is
# prompted to retry).
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


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


# ── Rate-limit gate for non-linked users ─────────────────────────
# Anonymous (un-linked) chats get this many data-query calls before
# the bot stops fulfilling /today /setups /sector /stock and points
# them at /link. Linked chats (profiles.telegram_chat_id matches)
# bypass the gate entirely. The counter lives in
# telegram_subscribers.query_count (added in
# scripts/sql/add_telegram_query_count.sql).
LIMIT_NON_LINKED_QUERIES = 3


async def _is_chat_linked(chat_id: int) -> bool:
    """True if this chat is bound to a PineX profile."""
    try:
        res = (
            supabase.table("profiles")
            .select("id")
            .eq("telegram_chat_id", chat_id)
            .limit(1)
            .execute()
        )
        return bool(getattr(res, "data", None))
    except Exception:
        # Fail open — a transient DB hiccup shouldn't lock real users out.
        return True


async def _check_and_increment_query_quota(chat_id: int) -> bool:
    """
    Returns True if the chat is allowed to run this query, False if it
    has hit the cap. Linked chats are always allowed; non-linked chats
    increment telegram_subscribers.query_count and are allowed while
    the pre-increment count was < LIMIT_NON_LINKED_QUERIES.

    Fails open on any DB error so a Supabase blip doesn't lock real
    users out of the bot — the rate limit isn't security-critical and
    the daily cost of accidentally allowing one extra free query is
    nothing compared to losing a user.
    """
    if await _is_chat_linked(chat_id):
        return True

    chat_id_str = str(chat_id)
    try:
        res = (
            supabase.table("telegram_subscribers")
            .select("query_count")
            .eq("chat_id", chat_id_str)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        current = int(rows[0].get("query_count") or 0) if rows else 0
    except Exception:
        return True

    if current >= LIMIT_NON_LINKED_QUERIES:
        return False

    try:
        supabase.table("telegram_subscribers").update({
            "query_count": current + 1,
        }).eq("chat_id", chat_id_str).execute()
    except Exception:
        # Increment failed — still let this one through. The next call
        # will retry; we never want a transient error to block service.
        pass
    return True


async def _send_quota_exceeded(update: Update) -> None:
    """Friendly stop message that nudges the user toward /link or signup."""
    await update.message.reply_text(
        f"You've used your {LIMIT_NON_LINKED_QUERIES} free queries.\n\n"
        "To keep going, link your PineX account — it's free.\n"
        "Tap /link to connect, or create an account at pinex.in/register\n\n"
        "Daily market pulse keeps arriving either way."
    )


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/start with optional deep-link payload.

    When the user opens t.me/pinex_Alerts_bot?start=<token>, Telegram
    passes the token as context.args[0]. We look it up in
    telegram_link_tokens (must be unused, not expired), bind the
    sender's chat_id to the token's user_id, and reply "Connected!"
    — one tap, no email re-entry.

    No payload (or invalid payload) → fall through to the regular
    welcome menu so /start alone still works.
    """
    chat = update.effective_chat
    user = update.effective_user

    # ── Deep-link branch ─────────────────────────────────────────
    payload = context.args[0] if context.args else None
    # Literal "help" payload — used by the public Pulse page's "Alerts
    # Bot" link (`t.me/pineX_Alerts_bot?start=help`) — is treated as a
    # friendly no-op so the user lands on the welcome menu instead of
    # the "this link expired" error path. Real account-link tokens are
    # 32-char hex strings, so a plain "help" literal can't collide.
    if payload == "help":
        payload = None
    if payload and chat and user:
        await asyncio.sleep(0.1)
        try:
            lookup = (
                supabase.table("telegram_link_tokens")
                .select("user_id, used_at, expires_at")
                .eq("token", payload)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            log_event("telegram_deeplink_lookup_error", {
                "chat_id": str(chat.id), "error": str(exc),
            })
            await update.message.reply_text(
                "Something went wrong connecting your account. "
                "Try generating a new link from your PineX account page."
            )
            return

        rows = getattr(lookup, "data", None) or []
        row = rows[0] if rows else None

        # Token must exist, be unused, and not expired.
        now_iso = datetime.utcnow().isoformat()
        is_valid = (
            row is not None
            and row.get("used_at") is None
            and (row.get("expires_at") is None or str(row["expires_at"]) > now_iso)
        )

        if not is_valid:
            log_event("telegram_deeplink_invalid_token", {
                "chat_id": str(chat.id),
                "token_present": row is not None,
                "already_used": bool(row and row.get("used_at")),
            })
            await update.message.reply_text(
                "This link has expired or already been used.\n\n"
                "Open your PineX account page and generate a fresh "
                "Connect Telegram link."
            )
            return

        # Bind chat to profile, mark token used.
        profile_id = row["user_id"]
        await asyncio.sleep(0.1)
        try:
            supabase.table("profiles").update({
                "telegram_chat_id": chat.id,
                "telegram_username": user.username or None,
                "telegram_linked_at": now_iso,
            }).eq("id", profile_id).execute()
            supabase.table("telegram_link_tokens").update({
                "used_at": now_iso,
            }).eq("token", payload).execute()
        except Exception as exc:
            log_event("telegram_deeplink_update_error", {
                "chat_id": str(chat.id),
                "profile_id": profile_id,
                "error": str(exc),
            })
            await update.message.reply_text(
                "Found your account but couldn't save the link. Try again from PineX."
            )
            return

        log_event("telegram_deeplink_succeeded", {
            "profile_id": profile_id,
            "chat_id": str(chat.id),
            "telegram_username": user.username or None,
        })
        await update.message.reply_text(
            "Connected.\n\n"
            "From now on you'll hear from us when something changes "
            "in your watchlist stocks.\n\n"
            "That's it. Nothing else unless you ask."
        )
        return

    # ── No payload → regular welcome menu ────────────────────────
    # Auto-subscribe on /start. Previously users had to explicitly run
    # /subscribe to be tracked — most never did, which left
    # telegram_subscribers empty and admin counts at zero even when the
    # bot had real users. Now /start = subscribed by default. Users
    # can still /unsubscribe to opt out.
    #
    # Wrapped in try/except so a Supabase hiccup doesn't break the
    # welcome flow — the user still sees the menu even if the upsert
    # fails. log_event runs separately so we always have an audit row.
    if chat and user:
        try:
            supabase.table("telegram_subscribers").upsert({
                "chat_id": str(chat.id),
                "username": _safe_text(getattr(user, "username", None)),
                "first_name": _safe_text(getattr(user, "first_name", None)),
                "created_at": datetime.utcnow().isoformat(),
            }, on_conflict="chat_id").execute()
        except Exception as exc:
            log_event("telegram_start_upsert_error", {
                "chat_id": str(chat.id),
                "error": str(exc),
            })
        # Audit row — useful for backfill if the table is ever missing
        # again (this row lands in usage_events regardless of whether
        # the upsert above succeeded). We also store username here
        # so future backfills can recover the display name.
        log_event("telegram_started", {
            "chat_id": str(chat.id),
            "username": getattr(user, "username", None),
            "first_name": getattr(user, "first_name", None),
        })

    text = (
        "Welcome to PineX Bot 🇮🇳\n"
        "I send you daily updates on Indian stocks — plain language, no jargon.\n\n"
        "What I'll send you:\n"
        "• Daily pulse when your watchlist stocks show unusual activity\n"
        "• Sunday weekly digest\n"
        "• Alerts when results are filed (if you have a PineX account)\n\n"
        "Commands:\n"
        "/link — connect this Telegram to your PineX account\n"
        "/subscribe — get daily market pulse (you're already subscribed!)\n"
        "/unsubscribe — stop notifications\n"
        "/today — see today's notable changes\n"
        "/setups — today's swing setups (top 10)\n"
        "/sector — sector strength (strongest/improving/weakening)\n"
        "/stock SYMBOL — quick summary of any stock\n"
        "/watchlist — changes in your watchlist (linked users only)\n"
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
    """Today's market snapshot — breadth, 52W highs/lows, Nifty, VIX, phase."""
    chat = update.effective_chat
    if chat and not await _check_and_increment_query_quota(chat.id):
        await _send_quota_exceeded(update)
        return

    try:
        # Fetch latest market_internals for today's snapshot
        mi_res = (
            supabase.table("market_internals")
            .select("nifty_close,nifty_change_1d,above_ma150_pct,stage2_pct,india_vix,new_52w_highs,new_52w_lows,advances,declines")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        mi = (getattr(mi_res, "data", None) or [{}])[0]

        if not mi or not mi.get("nifty_close"):
            await update.message.reply_text("Market data not available yet today.")
            return

        nifty = _safe_float(mi.get("nifty_close"))
        chg = _safe_float(mi.get("nifty_change_1d"))
        breadth = _safe_float(mi.get("above_ma150_pct"))
        stage2 = _safe_float(mi.get("stage2_pct"))
        vix = _safe_float(mi.get("india_vix"))
        highs = int(mi.get("new_52w_highs") or 0)
        lows = int(mi.get("new_52w_lows") or 0)
        advances = int(mi.get("advances") or 0)
        declines = int(mi.get("declines") or 0)

        # Determine market phase
        if breadth and breadth > 60 and (not vix or vix < 20):
            phase = "Strong bull market 📈"
        elif breadth and breadth > 50 and (not vix or vix < 25):
            phase = "Advancing market ↗"
        elif breadth and breadth < 40 and (vix or 0) > 20:
            phase = "Caution zone ⚠️"
        elif breadth and breadth < 30 and (vix or 0) > 25:
            phase = "Bear market 📉"
        else:
            phase = "Mixed signals 🔄"

        # Build message with safe formatting
        msg = "📊 Today's Market Snapshot\n\n"

        if nifty:
            if chg is not None:
                msg += f"Nifty: {nifty:,.0f} ({chg:+.2f}%)\n"
            else:
                msg += f"Nifty: {nifty:,.0f}\n"

        if breadth is not None:
            msg += f"Breadth: {breadth:.0f}% above 30W MA\n"

        if stage2 is not None:
            msg += f"Advancing criteria: {stage2:.0f}%\n"

        msg += "\n"
        msg += f"52W Highs: {highs}  ·  Lows: {lows}\n"

        if advances or declines:
            msg += f"A/D Ratio: {advances}/{declines}\n"

        msg += "\n"
        if vix is not None:
            msg += f"VIX: {vix:.1f}\n"

        msg += f"\nPhase: {phase}\n\n"
        msg += "Full details: pinex.in\n"
        msg += "EOD data only · Educational purposes"

        await update.message.reply_text(msg)
    except Exception as exc:
        import traceback
        print(f"[/today] ERROR: {exc}")
        print(traceback.format_exc())
        log_event("telegram_today_error", {"error": str(exc)})
        await update.message.reply_text("Market data unavailable. Try again soon.")


async def cmd_setups(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if chat and not await _check_and_increment_query_quota(chat.id):
        await _send_quota_exceeded(update)
        return
    today = datetime.now().strftime("%Y-%m-%d")
    # Schema: swing_conditions is keyed on company_id + date — no
    # `symbol` or `trading_date` columns. Embed companies(symbol)
    # via PostgREST foreign-table syntax so the symbol still rides
    # along with each row.
    s = (
        supabase.table("swing_conditions")
        .select(
            "conditions_met,breakout_52w,stage2_new_this_week,"
            "companies(symbol)"
        )
        .eq("date", today)
        .gte("conditions_met", 4)
        .order("conditions_met", desc=True)
        .limit(10)
        .execute()
    )
    rows = getattr(s, "data", None) or []
    lines = ["SwingX criteria (criteria met today):"]
    for r in rows:
        co = r.get("companies")
        if isinstance(co, dict):
            symbol = _safe_text(co.get("symbol"), "?")
        elif isinstance(co, list) and co:
            symbol = _safe_text((co[0] or {}).get("symbol"), "?")
        else:
            symbol = "?"
        met = int(r.get("conditions_met") or 0)
        flag = (
            "52W breakout" if r.get("breakout_52w")
            else ("Trend criteria met" if r.get("stage2_new_this_week") else "Setup")
        )
        emoji = "🔥" if met >= 5 else "⚡"
        lines.append(f"{emoji} {symbol} ({met}/5) — {flag}")
    if len(rows) == 0:
        lines.append("No stocks meeting 4/5 criteria today.")
    lines.append("Full details: pinex.in")
    lines.append("EOD data only · Educational purposes")
    await update.message.reply_text("\n".join(lines))


def _pct_health_icon(pct: float) -> str:
    """Health icon driven by breadth percentage, not the health text label.

    The sectors table also carries a `health` string (`strong`/`moderate`/
    `weak`) which can drift out of sync with stage2_pct over time (the
    label is upserted by calc_swing_conditions but the bucket thresholds
    are encoded separately there). For the /sector command we surface
    the breadth percentage directly to the user, so the icon is driven
    by the same number — guarantees the colour matches what the user
    reads in the next column.
    """
    if pct >= 60:
        return "🟢"
    if pct >= 40:
        return "🟡"
    return "🔴"


async def cmd_sector(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Two modes:

      /sector            → list every sector with breadth summary
      /sector <name>     → detail card for that one sector
                            (case-insensitive, multi-word safe)

    The split keeps the list cheap (single sectors-table fetch) and
    pushes the heavier join (top stocks per sector) into the detail
    branch only.

    Rate-limited for non-linked chats — see
    _check_and_increment_query_quota.
    """
    chat = update.effective_chat
    if chat and not await _check_and_increment_query_quota(chat.id):
        await _send_quota_exceeded(update)
        return
    if context.args:
        # Multi-word safe: "/sector Oil & Gas" arrives as
        # ["Oil", "&", "Gas"] — rejoin before lookup.
        await _sector_detail(update, " ".join(context.args))
    else:
        await _sector_list(update)


async def _sector_list(update: Update) -> None:
    """Sector Radar v2 — Leaders (30d) + Improvers (7d) + Today's changes."""
    # Get latest date
    latest = (
        supabase.table("sectors")
        .select("date")
        .not_.is_("date", "null")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    latest_date = (getattr(latest, "data", None) or [{}])[0].get("date")
    if not latest_date:
        await update.message.reply_text("Sector data is not available yet.")
        return

    # Get date 30 days ago
    try:
        latest_dt = datetime.fromisoformat(latest_date)
        thirty_days_ago = (latest_dt - timedelta(days=30)).isoformat()[:10]
    except Exception:
        thirty_days_ago = ""

    # Get date 7 days ago
    try:
        latest_dt = datetime.fromisoformat(latest_date)
        seven_days_ago = (latest_dt - timedelta(days=7)).isoformat()[:10]
    except Exception:
        seven_days_ago = ""

    # Latest sectors (today)
    latest_res = (
        supabase.table("sectors")
        .select("name,stage2_pct,total_companies")
        .eq("date", latest_date)
        .limit(30)
        .execute()
    )
    latest_rows = getattr(latest_res, "data", None) or []
    latest_map = {r.get("name"): float(r.get("stage2_pct") or 0) for r in latest_rows if r.get("name")}

    # 30-day historical average
    leaders_30d = []
    if thirty_days_ago:
        historical_res = (
            supabase.table("sectors")
            .select("name,stage2_pct")
            .gte("date", thirty_days_ago)
            .lte("date", latest_date)
            .limit(5000)
            .execute()
        )
        historical_rows = getattr(historical_res, "data", None) or []

        # Group by sector and average
        sector_sums = {}
        sector_counts = {}
        for r in historical_rows:
            name = r.get("name")
            pct = float(r.get("stage2_pct") or 0)
            if name:
                sector_sums[name] = sector_sums.get(name, 0) + pct
                sector_counts[name] = sector_counts.get(name, 0) + 1

        # Calculate averages and sort
        for name, total in sector_sums.items():
            avg = total / sector_counts.get(name, 1)
            leaders_30d.append((name, avg))
        leaders_30d.sort(key=lambda x: x[1], reverse=True)

    # 7-day change calculation
    improvers_7d = []
    if seven_days_ago:
        seven_res = (
            supabase.table("sectors")
            .select("name,stage2_pct")
            .eq("date", seven_days_ago)
            .limit(30)
            .execute()
        )
        seven_rows = getattr(seven_res, "data", None) or []
        seven_map = {r.get("name"): float(r.get("stage2_pct") or 0) for r in seven_rows if r.get("name")}

        for name, curr_pct in latest_map.items():
            prev_pct = seven_map.get(name, curr_pct)
            change = curr_pct - prev_pct
            improvers_7d.append((name, change, curr_pct, prev_pct))
        improvers_7d.sort(key=lambda x: x[1], reverse=True)

    # Today's movers (top 2 up, top 2 down)
    prev_res = (
        supabase.table("sectors")
        .select("date")
        .not_.is_("date", "null")
        .lt("date", latest_date)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    prev_date = (getattr(prev_res, "data", None) or [{}])[0].get("date")

    today_up = []
    today_down = []
    if prev_date:
        prev_sectors = (
            supabase.table("sectors")
            .select("name,stage2_pct")
            .eq("date", prev_date)
            .limit(30)
            .execute()
        )
        prev_rows = getattr(prev_sectors, "data", None) or []
        prev_map = {r.get("name"): float(r.get("stage2_pct") or 0) for r in prev_rows if r.get("name")}

        for name, curr_pct in latest_map.items():
            prev_pct = prev_map.get(name, curr_pct)
            change = curr_pct - prev_pct
            if change > 0:
                today_up.append((name, change))
            else:
                today_down.append((name, abs(change)))

        today_up.sort(key=lambda x: x[1], reverse=True)
        today_down.sort(key=lambda x: x[1], reverse=True)

    # Build message
    lines = [
        "📡 Sector Radar",
        "",
    ]

    # 30-Day Leaders
    if leaders_30d:
        lines.append("LEADERS (30 Days)")
        lines.append("")
        medals = ["🥇", "🥈", "🥉"]
        for i, (name, avg_pct) in enumerate(leaders_30d[:3]):
            lines.append(f"{medals[i]} {name}")
        lines.append("")
        lines.append("These sectors have maintained the")
        lines.append("strongest participation over the past month.")
        lines.append("")
        lines.append("─────────────────")
        lines.append("")

    # 7-Day Improvers
    if improvers_7d:
        lines.append("IMPROVING (7 Days)")
        lines.append("")
        for name, change, curr, prev in improvers_7d[:3]:
            if change > 0:
                lines.append(f"↑ {name}")
        lines.append("")
        lines.append("Participation has strengthened")
        lines.append("during the last week.")
        lines.append("")
        lines.append("─────────────────")
        lines.append("")

    # Today's Changes
    lines.append("TODAY")
    lines.append("")
    if today_up:
        for name, change in today_up[:2]:
            lines.append(f"↑ {name} +{change:.1f}%")
    if today_down:
        for name, change in today_down[:2]:
            lines.append(f"↓ {name} -{change:.1f}%")
    if not today_up and not today_down:
        lines.append("Minor changes across sectors")
    lines.append("")
    lines.append("Daily changes can be noisy.")
    lines.append("")
    lines.append("─────────────────")
    lines.append("")
    lines.append("Explore a sector:")
    lines.append("/sector Pharma")
    lines.append("")
    lines.append("EOD data only · Educational purposes only")

    await update.message.reply_text("\n".join(lines))


async def _sector_detail(update: Update, sector_arg: str) -> None:
    """Sector Radar Detail — current strength, trend, rank, historical context."""
    sector_arg = (sector_arg or "").strip()
    if not sector_arg:
        await _sector_list(update)
        return

    # Resolve canonical sector name (case-insensitive)
    sec_res = (
        supabase.table("sectors")
        .select(
            "name,stage2_count,total_companies,stage2_pct,date"
        )
        .ilike("name", sector_arg)
        .not_.is_("date", "null")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(sec_res, "data", None) or []
    if not rows:
        await update.message.reply_text(
            f"Sector \"{sector_arg}\" not found.\n\n"
            "Type /sector to see available sectors."
        )
        return

    sector = rows[0]
    canonical_name = sector.get("name") or sector_arg
    latest_date = sector.get("date")
    pct = float(sector.get("stage2_pct") or 0)
    stage2 = int(sector.get("stage2_count") or 0)
    total = int(sector.get("total_companies") or 0)

    # Calculate 7-day change
    seven_days_ago = ""
    change_7d = 0
    trend_label = "🟡 Stable"
    if latest_date:
        try:
            latest_dt = datetime.fromisoformat(latest_date)
            seven_dt = latest_dt - timedelta(days=7)
            seven_days_ago = seven_dt.isoformat()[:10]
        except Exception:
            pass

    if seven_days_ago:
        seven_res = (
            supabase.table("sectors")
            .select("stage2_pct")
            .ilike("name", sector_arg)
            .eq("date", seven_days_ago)
            .limit(1)
            .execute()
        )
        seven_rows = getattr(seven_res, "data", None) or []
        if seven_rows:
            pct_7d_ago = float(seven_rows[0].get("stage2_pct") or 0)
            change_7d = pct - pct_7d_ago

            # Determine trend label based on 7-day change
            if change_7d >= 5:
                trend_label = "🟢 Strongly Improving"
            elif change_7d >= 2:
                trend_label = "🟢 Improving"
            elif change_7d > -2:
                trend_label = "🟡 Stable"
            elif change_7d > -5:
                trend_label = "🔴 Weakening"
            else:
                trend_label = "🔴 Strongly Weakening"

    # Calculate 30-day position and rank
    rank_30d = 0
    rank_label = "Monitoring"
    if latest_date:
        try:
            latest_dt = datetime.fromisoformat(latest_date)
            thirty_dt = latest_dt - timedelta(days=30)
            thirty_days_ago = thirty_dt.isoformat()[:10]
        except Exception:
            thirty_days_ago = ""

        if thirty_days_ago:
            historical_res = (
                supabase.table("sectors")
                .select("name,stage2_pct")
                .gte("date", thirty_days_ago)
                .lte("date", latest_date)
                .limit(5000)
                .execute()
            )
            historical_rows = getattr(historical_res, "data", None) or []

            # Calculate 30-day averages
            sector_sums = {}
            sector_counts = {}
            for r in historical_rows:
                name = r.get("name")
                pct_val = float(r.get("stage2_pct") or 0)
                if name:
                    sector_sums[name] = sector_sums.get(name, 0) + pct_val
                    sector_counts[name] = sector_counts.get(name, 0) + 1

            # Rank this sector
            sector_avgs = []
            for name, total in sector_sums.items():
                avg = total / sector_counts.get(name, 1)
                sector_avgs.append((name, avg))
            sector_avgs.sort(key=lambda x: x[1], reverse=True)

            for i, (name, avg_pct) in enumerate(sector_avgs):
                if name and name.lower() == canonical_name.lower():
                    rank_30d = i + 1
                    break

            if rank_30d > 0:
                rank_label = f"#{rank_30d} of {len(sector_avgs)} sectors"

    # Current strength interpretation
    strength_desc = ""
    if pct >= 60:
        strength_desc = "Strong participation across the sector."
    elif pct >= 40:
        strength_desc = "Moderate participation in advancing conditions."
    else:
        strength_desc = "Limited participation in advancing conditions."

    lines = [
        f"💊 {canonical_name}",
        "",
        "Current Strength",
        "",
        f"{stage2} of {total} stocks",
        f"remain in advancing conditions.",
        f"{pct:.0f}% participation",
        "",
        "─────────────────",
        "",
        "Trend",
        "",
        trend_label,
        "",
        f"7 Day Change: {change_7d:+.1f}%",
        "Participation has " + ("expanded" if change_7d > 0 else "contracted" if change_7d < 0 else "remained stable"),
        "during the past week.",
        "",
        "─────────────────",
        "",
        "30 Day Position",
        "",
        rank_label,
        "Leadership " + ("remains strong." if rank_30d <= 10 else "is moderate."),
        "",
        "─────────────────",
        "",
        "Market Context",
        "",
        strength_desc,
        "",
        f"More: pinex.in/sectors/{canonical_name.lower()}",
        "",
        "EOD data only · Educational purposes only",
    ]

    # Remove empty lines for cleaner output
    lines = [l for l in lines if l or l == ""]
    await update.message.reply_text("\n".join(lines))


# Stage label map — mirrors generate_descriptions._PHASE_LABELS so the
# bot's /stock command shows the same human-readable phase name the
# StockDetail page does. Case-insensitive lookup via .lower() in the
# helper below; both "Stage 2" and "stage2" variants exist on the
# live price_data table.
_STAGE_TO_PHASE = {
    "stage 1": "Basing",
    "stage1":  "Basing",
    "stage 2": "Advancing",
    "stage2":  "Advancing",
    "stage 3": "Topping",
    "stage3":  "Topping",
    "stage 4": "Declining",
    "stage4":  "Declining",
}


def _stage_to_phase(stage_raw: str | None) -> str:
    if not stage_raw:
        return "Unclassified"
    return _STAGE_TO_PHASE.get(stage_raw.strip().lower(), stage_raw.strip())


def _trim_to_two_sentences(text: str) -> str:
    """Keep at most the first 2 sentences (period-delimited) of a
    Gemini-generated narrative. Used by /stock so a long narrative
    doesn't dominate the small Telegram message frame."""
    if not text:
        return ""
    sentences = [s.strip() for s in text.split(".") if s.strip()]
    if not sentences:
        return ""
    out = ". ".join(sentences[:2]).strip()
    if not out.endswith("."):
        out += "."
    return out


async def cmd_stock(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Quick summary of a single stock — new format per UX rework.

    Renders in three sections:
    1. Current State — emoji + phase name (Advancing/Declining/etc)
    2. What PineX sees — bullet points of observed conditions
    3. Context — plain observation (narrative snippet)

    Uses SEBI-safe vocabulary: advancing/declining/improving/weakening
    (never buy/sell/entry/exit/target/opportunity).
    """
    if not context.args:
        await update.message.reply_text(
            "Usage: /stock SYMBOL\n"
            "Example: /stock RELIANCE"
        )
        return
    chat = update.effective_chat
    if chat and not await _check_and_increment_query_quota(chat.id):
        await _send_quota_exceeded(update)
        return
    symbol = context.args[0].upper().strip()

    # Resolve symbol → company
    company_res = (
        supabase.table("companies")
        .select("id,name,symbol,sector")
        .eq("symbol", symbol)
        .limit(1)
        .execute()
    )
    company_rows = getattr(company_res, "data", None) or []
    if not company_rows:
        await update.message.reply_text(
            f"{symbol} not found on PineX.\n"
            "Check the ticker and try again.\n"
            "Example: /stock RELIANCE"
        )
        return
    company = company_rows[0]
    company_id = company.get("id")

    # Latest stage from price_data
    price_res = (
        supabase.table("price_data")
        .select("stage")
        .eq("company_id", company_id)
        .eq("is_latest", True)
        .limit(1)
        .execute()
    )
    price_row = (getattr(price_res, "data", None) or [{}])[0]
    stage_raw = price_row.get("stage")
    phase_label = _stage_to_phase(stage_raw)

    # Latest swing_conditions for criteria and flags
    swing_res = (
        supabase.table("swing_conditions")
        .select(
            "conditions_met,condition_stage2,breakout_52w,stage2_new_this_week"
        )
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    swing_row = (getattr(swing_res, "data", None) or [{}])[0]
    conditions_met = swing_row.get("conditions_met")
    breakout_52w = bool(swing_row.get("breakout_52w"))
    stage2_new = bool(swing_row.get("stage2_new_this_week"))

    # Stock description (narrative) — optional
    desc_res = (
        supabase.table("stock_descriptions")
        .select("narrative,whats_happening,phase,trading_date")
        .eq("symbol", symbol)
        .order("trading_date", desc=True)
        .limit(1)
        .execute()
    )
    desc_row = (getattr(desc_res, "data", None) or [{}])[0]
    narrative = _trim_to_two_sentences(_safe_text(desc_row.get("narrative"), ""))

    # Emit phase emoji based on stage
    phase_emoji = {
        "Basing": "🟡",
        "Advancing": "📈",
        "Topping": "🔝",
        "Declining": "📉",
        "Unclassified": "❓",
    }.get(phase_label, "•")

    # Build new-format message
    lines = [
        f"{company['symbol']} — {company['name']}",
        "",
        f"Current State",
        f"{phase_emoji} {phase_label}",
        "",
        "What PineX sees",
    ]

    # Bullet points of observed conditions
    bullets = []
    if conditions_met is not None:
        bullets.append(f"{int(conditions_met)} of 5 criteria met")
    if breakout_52w:
        bullets.append("52-week high reached")
    if stage2_new:
        bullets.append("Trend criteria met this week")
    if not bullets:
        bullets.append("Monitoring for criteria")

    for b in bullets:
        lines.append(f"• {b}")

    # Context section with narrative if available
    if narrative:
        lines.append("")
        lines.append("Context")
        lines.append(narrative)

    lines.append("")
    lines.append(f"pinex.in/stock/{company['symbol']}")
    lines.append("EOD data only · Educational purposes")

    await update.message.reply_text("\n".join(lines))


async def cmd_watchlist(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show changes in the user's watchlist — entries/exits only, no raw data.

    For linked users: queries watchlist table + price_data to show
    what changed since the last check. Four categories:
    - Entered advancing (Stage 2 criteria met recently)
    - Weakening (moved from advancing to other phases)
    - Strength improving (breadth/criteria gaining)
    - No major change

    For non-linked users: friendly reminder to link.
    """
    chat = update.effective_chat
    if not chat:
        return

    # Check if linked
    is_linked = await _is_chat_linked(chat.id)
    if not is_linked:
        await update.message.reply_text(
            "Link your PineX account to see your watchlist changes.\n\n"
            "/link — connect your account\n"
            "/subscribe — get daily updates"
        )
        return

    # Get profile for this chat
    profile_res = (
        supabase.table("profiles")
        .select("id")
        .eq("telegram_chat_id", chat.id)
        .limit(1)
        .execute()
    )
    profile_rows = getattr(profile_res, "data", None) or []
    if not profile_rows:
        await update.message.reply_text("Could not load your profile. Try /link again.")
        return
    user_id = profile_rows[0].get("id")

    # Fetch user's watchlist
    wl_res = (
        supabase.table("watchlists")
        .select("symbol")
        .eq("user_id", user_id)
        .limit(100)
        .execute()
    )
    watchlist_symbols = [r.get("symbol") for r in (getattr(wl_res, "data", None) or []) if r.get("symbol")]
    if not watchlist_symbols:
        await update.message.reply_text(
            "Your watchlist is empty.\n"
            "Add stocks on pinex.in to track changes."
        )
        return

    # Get latest price_data for watchlist stocks
    price_res = (
        supabase.table("price_data")
        .select("company_id,companies!inner(symbol),stage,rs_vs_nifty")
        .eq("is_latest", True)
        .in_("companies.symbol", watchlist_symbols)
        .limit(100)
        .execute()
    )
    price_rows = getattr(price_res, "data", None) or []

    # Categorize stocks
    entered_advancing = []
    weakening = []
    improving = []
    stable = []

    for r in price_rows:
        co = r.get("companies")
        sym = None
        if isinstance(co, dict):
            sym = co.get("symbol")
        elif isinstance(co, list) and co:
            sym = (co[0] or {}).get("symbol")

        if not sym:
            continue

        stage = (r.get("stage") or "").lower()
        rs = _safe_float(r.get("rs_vs_nifty"))

        # Simple heuristic: if stage2, it "entered advancing"
        # if stage4, it's "weakening", if improving RS it's "improving"
        if "stage 2" in stage or "stage2" in stage:
            entered_advancing.append(sym)
        elif "stage 4" in stage or "stage4" in stage:
            weakening.append(sym)
        elif rs and rs > 0:
            improving.append(sym)
        else:
            stable.append(sym)

    lines = [
        "📌 Watchlist Changes",
        "",
    ]

    if entered_advancing:
        lines.append("Entered advancing")
        for sym in entered_advancing[:5]:
            lines.append(f"📈 {sym}")
        if len(entered_advancing) > 5:
            lines.append(f"... +{len(entered_advancing) - 5} more")
        lines.append("")

    if weakening:
        lines.append("Weakening")
        for sym in weakening[:3]:
            lines.append(f"📉 {sym}")
        if len(weakening) > 3:
            lines.append(f"... +{len(weakening) - 3} more")
        lines.append("")

    if improving:
        lines.append("Strength improving")
        for sym in improving[:3]:
            lines.append(f"⬆️  {sym}")
        if len(improving) > 3:
            lines.append(f"... +{len(improving) - 3} more")
        lines.append("")

    if not entered_advancing and not weakening and not improving:
        lines.append("No major changes in your watchlist today.")
        lines.append("")

    lines.append("Full details: pinex.in")
    lines.append("EOD data only · Educational purposes")

    await update.message.reply_text("\n".join(lines))


async def cmd_link_start(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> int:
    """Entry point for /link — prompt the user for their PineX email."""
    await update.message.reply_text(
        "To connect your PineX account:\n\n"
        "Reply with the email address you used to sign up on pinex.in\n\n"
        "Example: yourname@gmail.com"
    )
    return WAITING_EMAIL


async def cmd_link_email(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receive the email, look it up in profiles, link the chat_id.

    Always returns ConversationHandler.END so a single /link → email
    exchange completes the dialogue. If the lookup fails the user is
    asked to retry via /link rather than re-entering the state (keeps
    the handler tree shallow).
    """
    message = update.message
    chat = update.effective_chat
    user = update.effective_user
    if message is None or chat is None or user is None:
        return ConversationHandler.END

    email = (message.text or "").strip().lower()

    # Format guard — fast fail before hitting the DB on obvious typos.
    if not _EMAIL_RE.match(email):
        await message.reply_text(
            "That doesn't look like an email. Try again with /link"
        )
        return ConversationHandler.END

    # ── Look up the profile by email ───────────────────────────────
    # sleep(0.1) honours the project convention of pacing Supabase
    # calls; asyncio.sleep is non-blocking so the bot can serve other
    # users in parallel.
    await asyncio.sleep(0.1)
    try:
        lookup = (
            supabase.table("profiles")
            .select("id, email")
            .eq("email", email)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        await message.reply_text(
            "Something went wrong looking up your account. Try /link again in a moment."
        )
        log_event("telegram_link_lookup_error", {
            "email": email,
            "chat_id": str(chat.id),
            "error": str(exc),
        })
        return ConversationHandler.END

    rows = getattr(lookup, "data", None) or []
    if not rows:
        await message.reply_text(
            "We couldn't find that email in PineX.\n\n"
            "Double check the email you used to sign up at pinex.in\n\n"
            "Try again with /link"
        )
        log_event("telegram_link_not_found", {
            "email": email,
            "chat_id": str(chat.id),
        })
        return ConversationHandler.END

    profile_id = rows[0].get("id")

    # ── Link the chat to the profile ───────────────────────────────
    await asyncio.sleep(0.1)
    try:
        supabase.table("profiles").update({
            "telegram_chat_id": chat.id,
            "telegram_username": (user.username or None),
            "telegram_linked_at": datetime.utcnow().isoformat(),
        }).eq("id", profile_id).execute()
    except Exception as exc:
        await message.reply_text(
            "Found your account but couldn't save the link. Try /link again."
        )
        log_event("telegram_link_update_error", {
            "profile_id": profile_id,
            "chat_id": str(chat.id),
            "error": str(exc),
        })
        return ConversationHandler.END

    await message.reply_text(
        "Connected.\n\n"
        "From now on you'll hear from us when something changes "
        "in your watchlist stocks.\n\n"
        "That's it. Nothing else unless you ask."
    )
    log_event("telegram_link_succeeded", {
        "profile_id": profile_id,
        "chat_id": str(chat.id),
        "telegram_username": user.username or None,
    })
    return ConversationHandler.END


async def cmd_link_cancel(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> int:
    """Optional /cancel fallback so a half-finished /link can be aborted
    without leaving the conversation stuck waiting for a reply."""
    await update.message.reply_text("Link cancelled. Run /link again whenever you're ready.")
    return ConversationHandler.END


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
    app.add_handler(CommandHandler("watchlist", cmd_watchlist))

    # /link conversation — entry on /link command, single state
    # WAITING_EMAIL receives the user's next text message, looks up
    # the email in profiles, and links telegram_chat_id +
    # telegram_username + telegram_linked_at. /cancel aborts.
    link_conv = ConversationHandler(
        entry_points=[CommandHandler("link", cmd_link_start)],
        states={
            WAITING_EMAIL: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, cmd_link_email),
            ],
        },
        fallbacks=[CommandHandler("cancel", cmd_link_cancel)],
        # 5-minute idle timeout — if the user opens /link then walks
        # away, the next thing they type doesn't get treated as an
        # email out of context.
        conversation_timeout=300,
    )
    app.add_handler(link_conv)

    print("PineX telegram bot started. Press Ctrl+C to stop.")
    app.run_polling()


if __name__ == "__main__":
    main()
