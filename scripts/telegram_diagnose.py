"""Diagnose (and optionally fix) the PineX Telegram bot.

The Railway-hosted long-poll bot (`scripts/telegram_bot.py`) becomes
unresponsive when:

  1. A webhook is set on the bot token. Telegram refuses to serve
     `getUpdates` (polling) while a webhook is configured — every
     poll returns 409 Conflict and the bot looks frozen. The
     symptom is identical to "bot crashed" but the bot process is
     fine; it just can't fetch updates.

  2. A second polling process is running with the same token (e.g.
     someone left `python telegram_bot.py` running on their laptop
     after Railway took over). Telegram returns 409 Conflict to
     whoever lost the race; effectively both pollers drop updates.

  3. The token was regenerated via BotFather without updating
     Railway's TELEGRAM_BOT_TOKEN env var — getMe returns 401.

  4. The Railway service is genuinely stopped or crash-looping.
     getMe works fine (Telegram's side is healthy), but
     getWebhookInfo shows a large `pending_update_count` because
     no one is consuming the queue.

This script checks each in order, prints a verdict, and offers a
one-shot fix for case 1.

Usage:
  cd scripts/                           # so `.env` is found by load_dotenv
  python telegram_diagnose.py           # read-only diagnosis
  python telegram_diagnose.py --fix-webhook
                                        # delete any webhook so polling
                                        # can resume immediately
  python telegram_diagnose.py --test-send 123456789 --message "ping"
                                        # send a one-off message to confirm
                                        # the bot can post (bypasses polling)
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import requests

# Windows consoles default to cp1252, which can't encode the
# checkmarks / arrows below. Force UTF-8 on Python 3.7+ so the
# diagnostic prints cleanly everywhere.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    pass


TG_BASE = "https://api.telegram.org"


def _api(token: str, method: str, params: dict | None = None) -> tuple[int, dict]:
    url = f"{TG_BASE}/bot{token}/{method}"
    r = requests.post(url, json=params or {}, timeout=15)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {"raw": r.text}


def get_me(token: str) -> dict | None:
    status, body = _api(token, "getMe")
    if status != 200 or not body.get("ok"):
        desc = body.get("description") or body.get("raw") or f"HTTP {status}"
        print(f"  ✗ getMe failed: {desc}")
        if status == 401:
            print("    → token rejected. Re-generate via @BotFather and")
            print("      update TELEGRAM_BOT_TOKEN on Railway + scripts/.env.")
        return None
    me = body.get("result", {})
    print(f"  ✓ getMe ok — @{me.get('username')} ({me.get('first_name')})")
    return me


def get_webhook_info(token: str) -> dict | None:
    status, body = _api(token, "getWebhookInfo")
    if status != 200 or not body.get("ok"):
        print(f"  ✗ getWebhookInfo failed: {body.get('description') or status}")
        return None
    info = body.get("result", {})
    url = info.get("url") or ""
    pending = info.get("pending_update_count", 0)
    if url:
        print(f"  🚨 WEBHOOK IS SET — url={url}")
        print(f"     pending_update_count={pending}")
        print("     This BLOCKS polling. Re-run with --fix-webhook to clear.")
    else:
        print("  ✓ no webhook set (polling is allowed)")
        if pending > 50:
            print(f"  ⚠ pending_update_count={pending} — updates piling up")
            print("    (no one is polling — check Railway service status)")
        else:
            print(f"  · pending_update_count={pending}")
    last_err = info.get("last_error_message")
    if last_err:
        print(f"  · last_error_message: {last_err!r}")
    return info


def detect_polling_conflict(token: str) -> None:
    # offset=-1 grabs only the newest update without consuming the
    # backlog, but it still triggers Telegram's 409 check when a
    # competing poller exists. timeout=0 keeps it instant.
    status, body = _api(token, "getUpdates", {"offset": -1, "timeout": 0})
    if status == 409:
        print(f"  🚨 409 Conflict on getUpdates: {body.get('description')}")
        print("     Another process is polling this bot. Stop the duplicate")
        print("     (laptop instance? second Railway service?) and the live")
        print("     bot resumes within ~30 seconds.")
    elif status == 200 and body.get("ok"):
        n = len(body.get("result", []))
        print(f"  ✓ getUpdates ok — {n} update(s) at head of queue")
    else:
        print(f"  · getUpdates returned {status}: {body.get('description') or '(no body)'}")


def delete_webhook(token: str) -> bool:
    print("\n[fix-webhook] Calling deleteWebhook(drop_pending_updates=True) …")
    status, body = _api(token, "deleteWebhook", {"drop_pending_updates": True})
    if status == 200 and body.get("ok"):
        print("  ✓ webhook cleared. Polling will resume on the next Railway")
        print("    getUpdates cycle (a few seconds). Drop_pending=True wiped")
        print("    the backlog so the bot doesn't fire 500 old replies.")
        return True
    print(f"  ✗ deleteWebhook failed: {body.get('description') or status}")
    return False


def test_send(token: str, chat_id: str, message: str) -> bool:
    print(f"\n[test-send] sendMessage → chat {chat_id}…")
    status, body = _api(token, "sendMessage", {
        "chat_id": chat_id,
        "text": message,
        "disable_web_page_preview": True,
    })
    if status == 200 and body.get("ok"):
        mid = body.get("result", {}).get("message_id")
        print(f"  ✓ delivered (message_id={mid})")
        return True
    print(f"  ✗ sendMessage failed: {body.get('description') or status}")
    if status == 403:
        print("    → user hasn't started the bot (or has blocked it).")
        print("      They must /start the bot at least once before it can DM them.")
    elif status == 400 and "chat not found" in str(body.get("description", "")).lower():
        print("    → chat_id is not a number the bot has seen. Confirm the user")
        print("      sent /start to the bot from this chat.")
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fix-webhook", action="store_true",
                    help="Delete any configured webhook so polling resumes.")
    ap.add_argument("--test-send", metavar="CHAT_ID",
                    help="Send a test message to CHAT_ID via sendMessage.")
    ap.add_argument("--message", default="PineX bot diagnostic ping ✓",
                    help='Test message body (default: "PineX bot diagnostic ping ✓").')
    args = ap.parse_args()

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("✗ TELEGRAM_BOT_TOKEN missing in env / scripts/.env", file=sys.stderr)
        return 2

    print(f"== PineX Telegram bot diagnostic ==")
    print(f"   token: …{token[-6:]} (suffix only)")
    print()

    print("[1/3] getMe")
    me = get_me(token)
    if not me:
        return 1

    print("\n[2/3] getWebhookInfo")
    info = get_webhook_info(token) or {}

    print("\n[3/3] polling conflict check")
    detect_polling_conflict(token)

    if args.fix_webhook:
        if info.get("url"):
            delete_webhook(token)
        else:
            print("\n[fix-webhook] No webhook set — nothing to clear.")

    if args.test_send:
        test_send(token, args.test_send, args.message)

    print()
    print("Done. If the bot is still unresponsive:")
    print("  · Railway: check the service logs — look for a crash on startup")
    print("    or '409 Conflict' lines (another poller is alive).")
    print("  · Confirm TELEGRAM_BOT_TOKEN on Railway matches BotFather's current value.")
    print("  · Try `python telegram_diagnose.py --test-send <your_chat_id>` —")
    print("    if THAT works, the bot CAN send; the issue is purely on the")
    print("    receive side (polling).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
