"""
send_telegram_watchlist_alerts.py

Daily per-user Telegram DM. Runs at the very end of run_daily.py
(after generate_morning_briefs.py has written today's brief rows).

For each user with telegram_chat_id set, reads their morning_briefs
row for today's brief_date. If watchlist_changed > 0, formats a
short DM summarising the changes and posts it via Telegram's HTTP
sendMessage API. Silent on days where nothing changed — no spam.

Uses the raw Bot API (https://api.telegram.org/bot<TOKEN>/sendMessage)
instead of importing python-telegram-bot's Application here. That
library is built around a single polling loop; spinning up an
Application instance just to send a few hundred messages is wasteful
and clashes with the polling bot already running on Railway. A POST
is simpler and has zero coupling to the bot process.

Usage:
  python scripts/send_telegram_watchlist_alerts.py          # send live
  python scripts/send_telegram_watchlist_alerts.py --dry-run # print only
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

sys.path.insert(0, str(_script_dir))
from db import log_event, supabase  # noqa: E402


# ─────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
DASHBOARD_URL = "https://pinex.in/dashboard"
PAGE_SIZE = 1000
# 0.05s between sends keeps us under Telegram's stated 30 msgs/sec
# limit. Conservative — matters more for batches >500 users.
SEND_INTERVAL_SEC = 0.05


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def istdate_today() -> str:
    """The brief_date stored by generate_morning_briefs.py is
    date.today() on the machine running the pipeline (UTC or IST
    depending on host). run_daily.py runs in the same timezone
    as morning_briefs.py, so we mirror its date semantics."""
    return date.today().isoformat()


def fetch_linked_users() -> list[dict]:
    """All profiles with telegram_chat_id set. Paginated."""
    rows: list[dict] = []
    offset = 0
    while True:
        try:
            res = (
                supabase.table("profiles")
                .select("id, telegram_chat_id, telegram_username")
                .not_.is_("telegram_chat_id", "null")
                .order("id")
                .range(offset, offset + PAGE_SIZE - 1)
                .execute()
            )
        except Exception as exc:
            print(f"profiles fetch failed at offset {offset}: {exc}")
            break
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def fetch_brief_for_user(user_id: str, brief_date: str) -> dict | None:
    """Today's morning_briefs row for a single user. Returns None
    if no brief exists (e.g. user hasn't been included in today's
    generator run yet)."""
    try:
        res = (
            supabase.table("morning_briefs")
            .select("watchlist_changed, watchlist_total, changed_symbols, market_character, top_sector")
            .eq("user_id", user_id)
            .eq("brief_date", brief_date)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as exc:
        print(f"  ! brief fetch failed for {user_id}: {exc}")
        return None


# ─────────────────────────────────────────────────────────────────
# Message body
# ─────────────────────────────────────────────────────────────────

def format_message(brief: dict) -> str:
    """Build the DM text from a morning_briefs row.

    Layout:
        N stocks on your watchlist changed today.

        📈 SYMBOL · X/5 criteria (was Y/5)
        📉 SYMBOL · X/5 criteria (was Y/5)
        ...

        Open PineX: https://pinex.in/dashboard

        Educational data only · Not advice

    Caller has already verified watchlist_changed > 0.
    """
    n = int(brief.get("watchlist_changed") or 0)
    changes = brief.get("changed_symbols") or []
    # SEBI-safe heading — neutral data framing, not validation language.
    # Earlier the lead line read "N stocks on your watchlist changed
    # today" which read as a directional call; the new heading +
    # arrows + score deltas convey the same data without implying any
    # buy / sell stance.
    lines = ["📊 Criteria update on your watchlist:", ""]

    # Cap at 8 in the DM so a very-busy day doesn't produce a 2KB
    # message. Show count + "and N more" footer if truncated.
    shown = list(changes)[:8]
    for c in shown:
        if not isinstance(c, dict):
            continue
        sym = str(c.get("symbol") or "?").upper()
        try:
            frm = int(c.get("from") or 0)
            to = int(c.get("to") or 0)
        except (TypeError, ValueError):
            continue
        arrow = "📈" if to > frm else "📉" if to < frm else "·"
        lines.append(f"{arrow} {sym} · {to}/5 criteria (was {frm}/5)")
    if len(changes) > len(shown):
        lines.append(f"… and {len(changes) - len(shown)} more")

    # "Worth checking today" — discovery section appended to the same
    # DM. Pulls today's top 3 stocks meeting conditions_met >= 4 in
    # the user's watchlist sectors that aren't already on the
    # watchlist. Silent when there's no overlap or no eligible stocks
    # so the message stays tight on quiet days.
    sector_block = _build_sector_suggestions_block(brief.get("_user_id"))
    if sector_block:
        lines.append("")
        lines.append(sector_block)

    lines.append("")
    lines.append(f"Open PineX: {DASHBOARD_URL}")
    lines.append("")
    lines.append("Educational data only · Not advice")
    return "\n".join(lines)


def _build_sector_suggestions_block(user_id: str | None) -> str:
    """Return a "🔭 Worth checking today" suggestions block for one
    user, or '' if nothing qualifies. Three picks max — the user's
    watchlist sectors → today's top conditions_met >= 4 stocks NOT
    already on the watchlist. Defensive: every Supabase call is
    wrapped so a transient failure silently drops this optional
    section without poisoning the rest of the DM.
    """
    if not user_id:
        return ''
    try:
        # 1. Watchlist symbols + sectors.
        wl = (
            supabase.table('watchlist')
            .select('symbol,companies(symbol,sector)')
            .eq('user_id', user_id)
            .execute()
        )
        wl_rows = getattr(wl, 'data', None) or []
        watch_syms: set[str] = set()
        sectors: set[str] = set()
        for r in wl_rows:
            sym = (r.get('symbol') or (r.get('companies') or {}).get('symbol') or '').strip().upper()
            sec = ((r.get('companies') or {}).get('sector') or '').strip()
            if sym:
                watch_syms.add(sym)
            if sec:
                sectors.add(sec)
        if not watch_syms or not sectors:
            return ''

        # 2. Latest swing_conditions date.
        latest = (
            supabase.table('swing_conditions')
            .select('date')
            .order('date', desc=True)
            .limit(1)
            .execute()
        )
        latest_rows = getattr(latest, 'data', None) or []
        if not latest_rows:
            return ''
        latest_date = latest_rows[0].get('date')

        # 3. Top conditions in those sectors, excluding the watchlist.
        cand = (
            supabase.table('swing_conditions')
            .select('conditions_met,companies!inner(symbol,name,sector)')
            .eq('date', latest_date)
            .gte('conditions_met', 4)
            .in_('companies.sector', list(sectors))
            .order('conditions_met', desc=True)
            .limit(8)
            .execute()
        )
        rows = getattr(cand, 'data', None) or []
        picks: list[str] = []
        for r in rows:
            co = r.get('companies') or {}
            sym = (co.get('symbol') or '').upper()
            if not sym or sym in watch_syms:
                continue
            score = r.get('conditions_met') or 0
            picks.append(f"  {sym} — {score}/5 criteria")
            if len(picks) >= 3:
                break
        if not picks:
            return ''
        return "🔭 Worth checking today (in your sectors):\n" + "\n".join(picks)
    except Exception as exc:
        # Optional section — never let it break the main DM path.
        print(f"[telegram_alerts] sector suggestions failed for {user_id}: {exc}")
        return ''


# ─────────────────────────────────────────────────────────────────
# Send
# ─────────────────────────────────────────────────────────────────

def send_via_bot_api(chat_id: int, text: str) -> tuple[bool, str]:
    """POST to Telegram's sendMessage. Returns (ok, detail).
    detail is empty on success or a short error description."""
    if not TELEGRAM_BOT_TOKEN:
        return False, "TELEGRAM_BOT_TOKEN missing"
    try:
        res = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                # disable_web_page_preview keeps the embedded
                # pinex.in/dashboard link from generating an OG
                # card preview that pushes the actual data off
                # screen on mobile.
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        if res.status_code == 200:
            return True, ""
        # 403 = bot was blocked by the user; treat as soft skip.
        # 400 = malformed payload (rare here since we control it).
        return False, f"HTTP {res.status_code}: {res.text[:160]}"
    except Exception as exc:
        return False, str(exc)


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print recipients and message previews; send nothing.",
    )
    args = parser.parse_args()

    today = istdate_today()
    print(f"[tg_alerts] start {today} {'(DRY RUN)' if args.dry_run else '(LIVE)'}")

    if not args.dry_run and not TELEGRAM_BOT_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN missing — aborting.")
        log_event("telegram_watchlist_alerts_aborted", {"reason": "missing_token"})
        return 2

    users = fetch_linked_users()
    print(f"[tg_alerts] linked users: {len(users)}")

    if not users:
        log_event("telegram_watchlist_alerts_finished", {
            "date": today, "candidates": 0, "sent": 0, "skipped_no_change": 0, "errors": 0,
        })
        print("[tg_alerts] no linked users — nothing to send.")
        return 0

    sent = 0
    skipped_no_change = 0
    skipped_no_brief = 0
    errors = 0
    blocked = 0

    started = time.time()

    for i, u in enumerate(users, start=1):
        uid = u.get("id")
        chat_id = u.get("telegram_chat_id")
        if not uid or not chat_id:
            continue

        brief = fetch_brief_for_user(uid, today)
        if not brief:
            skipped_no_brief += 1
            continue

        n_changed = int(brief.get("watchlist_changed") or 0)
        if n_changed <= 0:
            skipped_no_change += 1
            continue

        # Pass the user_id into the formatter so the
        # "🔭 Worth checking today (in your sectors)" block can
        # resolve the user's watchlist + sectors. Threaded via the
        # brief dict (a single-use container) rather than a positional
        # arg so the existing signature stays backward-compatible.
        brief["_user_id"] = uid
        text = format_message(brief)

        if args.dry_run:
            print(f"  [{i}/{len(users)}] would send to chat_id={chat_id} ({n_changed} changes):")
            print("  " + text.replace("\n", "\n  "))
            sent += 1
            continue

        ok, detail = send_via_bot_api(int(chat_id), text)
        if ok:
            sent += 1
            print(f"  [{i}/{len(users)}] chat_id={chat_id} ✓ ({n_changed} changes)")
        else:
            # 403 = user blocked the bot. Worth tracking separately
            # so it doesn't drown out real errors in the count.
            if "403" in detail:
                blocked += 1
                print(f"  [{i}/{len(users)}] chat_id={chat_id} blocked")
            else:
                errors += 1
                print(f"  [{i}/{len(users)}] chat_id={chat_id} ✗ {detail}")
        time.sleep(SEND_INTERVAL_SEC)

    elapsed = round(time.time() - started, 1)
    print()
    print(
        f"[tg_alerts] done — sent={sent} skipped_no_change={skipped_no_change} "
        f"skipped_no_brief={skipped_no_brief} blocked={blocked} errors={errors} "
        f"elapsed={elapsed}s"
    )
    log_event("telegram_watchlist_alerts_finished", {
        "date": today,
        "candidates": len(users),
        "sent": sent,
        "skipped_no_change": skipped_no_change,
        "skipped_no_brief": skipped_no_brief,
        "blocked": blocked,
        "errors": errors,
        "elapsed_sec": elapsed,
        "dry_run": args.dry_run,
    })
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
