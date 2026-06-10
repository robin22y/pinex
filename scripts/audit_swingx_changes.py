"""audit_swingx_changes.py — admin-only day-over-day SwingX diff.

Runs in the daily pipeline AFTER calc_swing_conditions has written
today's swing_conditions rows. Computes the symbol set that crosses
the canonical SwingX threshold (conditions_met >= 4) for today and
the previous trading day, then reports:

    ENTRIES  = today_set − yesterday_set   (newly qualifying)
    EXITS    = yesterday_set − today_set   (dropped out)

The output is for ADMIN ONLY — used for quality control on the daily
PineX list. Two sinks:

  1. usage_events row of event_type='swingx_admin_diff' with
     metadata containing entries[], exits[], counts, and trading
     dates. Always written. The admin dashboard can read this.

  2. Telegram DM to TELEGRAM_ADMIN_CHAT_ID (env var) if set.
     Distinct from TELEGRAM_CHANNEL_ID so the public channel never
     sees the per-symbol diff. Silent skip if the env var is absent.

Stock NAMES are intentionally not published to the public channel.

Run:
  python scripts/audit_swingx_changes.py
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")
sys.path.insert(0, str(_script_dir))

from db import log_event, supabase  # noqa: E402

SWING_TABLE = "swing_conditions"
SWINGX_THRESHOLD = 4   # canonical SwingX cohort: conditions_met >= 4

# Force UTF-8 on Windows console so non-ASCII names never crash a print.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


def _qualifying_symbols_for_date(trading_date: str) -> dict[str, str]:
    """Return {symbol → company_name} for stocks with
    conditions_met >= SWINGX_THRESHOLD on `trading_date`. Paginated
    because PostgREST caps at 1,000 rows per response and the
    universe is ~2,100."""
    out: dict[str, str] = {}
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table(SWING_TABLE)
            .select("conditions_met,companies!inner(symbol,name)")
            .eq("date", trading_date)
            .gte("conditions_met", SWINGX_THRESHOLD)
            .range(start, start + page - 1)
            .execute()
        )
        batch = getattr(res, "data", None) or []
        for r in batch:
            co = r.get("companies") or {}
            sym = (co.get("symbol") or "").strip()
            name = (co.get("name") or "").strip()
            if sym:
                out[sym] = name
        if len(batch) < page:
            break
        start += page
    return out


def _most_recent_swing_date(before: str | None = None) -> str | None:
    """Latest `date` in swing_conditions (optionally strictly < `before`).
    Used so we always compare today against the previous TRADING day,
    not the previous calendar day (skips weekends + holidays)."""
    q = (
        supabase.table(SWING_TABLE)
        .select("date")
        .order("date", desc=True)
        .limit(1)
    )
    if before:
        q = q.lt("date", before)
    res = q.execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        return None
    return rows[0].get("date")


def _send_admin_telegram(message: str) -> bool:
    """POST the message to TELEGRAM_ADMIN_CHAT_ID via the bot token.
    Returns True on HTTP 200, False otherwise. No-op (returns False)
    when either env var is missing."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
    if not token or not chat_id:
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=15,
        )
        return r.status_code == 200
    except requests.RequestException as exc:
        print(f"[audit_swingx] admin telegram send failed: {exc}")
        return False


def _format_admin_message(
    today: str,
    yesterday: str,
    entries: list[tuple[str, str]],
    exits: list[tuple[str, str]],
    today_count: int,
    yest_count: int,
) -> str:
    """HTML-formatted Telegram message body — admin-only.

    Lists every entry + exit by symbol. Caps the per-section line
    count at 50 to keep one message under Telegram's 4096-char limit
    on volatile days; the metadata row stored in usage_events keeps
    the full list for audit."""
    cap = 50
    def _fmt(rows: list[tuple[str, str]]) -> str:
        shown = rows[:cap]
        lines = [f"• <code>{sym}</code> {name}".rstrip() for sym, name in shown]
        tail = f"\n…and {len(rows) - cap} more" if len(rows) > cap else ""
        return "\n".join(lines) + tail if lines else "<i>(none)</i>"

    return (
        f"🔬 <b>SwingX cohort diff (admin only)</b>\n"
        f"Today {today}: {today_count} stocks\n"
        f"Prev  {yesterday}: {yest_count} stocks\n"
        f"\n"
        f"🟢 <b>Entered ({len(entries)})</b>\n{_fmt(entries)}\n"
        f"\n"
        f"🔴 <b>Exited ({len(exits)})</b>\n{_fmt(exits)}"
    )


def main() -> None:
    today = _most_recent_swing_date()
    if not today:
        print("[audit_swingx] no swing_conditions rows in the table — skipping")
        log_event("swingx_admin_diff_skipped", {"reason": "no_swing_rows"})
        return

    yesterday = _most_recent_swing_date(before=today)
    today_map = _qualifying_symbols_for_date(today)
    yest_map = _qualifying_symbols_for_date(yesterday) if yesterday else {}

    today_set = set(today_map.keys())
    yest_set = set(yest_map.keys())

    entered_syms = sorted(today_set - yest_set)
    exited_syms = sorted(yest_set - today_set)

    entries = [(s, today_map.get(s, "")) for s in entered_syms]
    exits = [(s, yest_map.get(s, "")) for s in exited_syms]

    print(
        f"[audit_swingx] today={today} ({len(today_set)} stocks) "
        f"prev={yesterday} ({len(yest_set)} stocks) "
        f"entered={len(entries)} exited={len(exits)}",
    )

    log_event(
        "swingx_admin_diff",
        {
            "trading_date":      today,
            "prev_trading_date": yesterday,
            "today_count":       len(today_set),
            "prev_count":        len(yest_set),
            "entries_count":     len(entries),
            "exits_count":       len(exits),
            "entries":           [{"symbol": s, "name": n} for s, n in entries],
            "exits":             [{"symbol": s, "name": n} for s, n in exits],
            "threshold":         SWINGX_THRESHOLD,
            "generated_at":      datetime.now(UTC).isoformat(),
        },
    )

    # Only DM if there's anything to report — quiet days shouldn't
    # spam the admin inbox.
    if not entries and not exits:
        print("[audit_swingx] no changes — skipping admin DM")
        return

    message = _format_admin_message(
        today, yesterday or "(n/a)", entries, exits,
        len(today_set), len(yest_set),
    )
    sent = _send_admin_telegram(message)
    if sent:
        print("[audit_swingx] admin Telegram DM sent")
    elif not os.environ.get("TELEGRAM_ADMIN_CHAT_ID"):
        print(
            "[audit_swingx] TELEGRAM_ADMIN_CHAT_ID not set — "
            "usage_events row written only",
        )
    else:
        print("[audit_swingx] admin Telegram DM failed (see error above)")


if __name__ == "__main__":
    main()
