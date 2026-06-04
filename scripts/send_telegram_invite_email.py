"""
send_telegram_invite_email.py

ONE-TIME outreach: email existing PineX users who haven't linked their
Telegram account yet, inviting them to do so. Personal tone, from
robin@pinex.in, plain-text feel.

Targets: profiles WHERE telegram_chat_id IS NULL.
Skips:   anyone already emailed in a prior run of this script
         (tracked in scripts/.sent_telegram_invite_emails.log).

USAGE:
  # Dry run — print recipient list + email preview, send nothing
  python scripts/send_telegram_invite_email.py

  # Actually send (real Resend API call)
  python scripts/send_telegram_invite_email.py --send

  # Target a single user by email (still respects --send / dry-run)
  python scripts/send_telegram_invite_email.py --user=robin22y@gmail.com
  python scripts/send_telegram_invite_email.py --user=robin22y@gmail.com --send

Requires:
  RESEND_API_KEY in scripts/.env (already wired for re-engagement)

Idempotent: the local log file is updated on each successful send so
re-running with --send never double-sends to anyone. Delete the log
file to reset (not recommended unless you actually want to re-send).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

# Project conventions: same path setup as send_reengagement_email.py
sys.path.insert(0, str(Path(__file__).parent))
from db import log_event, supabase  # noqa: E402
from dotenv import load_dotenv      # noqa: E402

load_dotenv(Path(__file__).parent / ".env")

# ─────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
# Bot handle — read from env so renames are a single-line change.
# Default matches src/lib/siteMeta.js TELEGRAM_BOT_USERNAME; if you
# change one, change the other (or set TELEGRAM_BOT_USERNAME in
# scripts/.env to override here without touching code).
TELEGRAM_BOT_USERNAME = os.environ.get(
    "TELEGRAM_BOT_USERNAME", "pinex_Alerts_bot"
).lstrip("@")
TELEGRAM_BOT_HANDLE = f"@{TELEGRAM_BOT_USERNAME}"
# Personal "from" — distinct from the noreply@ used by the daily
# re-engagement emails so this lands in personal inbox tone, not
# in a transactional folder rule.
FROM_EMAIL = "Robin from PineX <robin@pinex.in>"
REPLY_TO = "robin@pinex.in"
SUBJECT = "A better way to follow your stocks"

# Local dedup log — one email per line. Created on first --send run.
SENT_LOG_PATH = Path(__file__).parent / ".sent_telegram_invite_emails.log"

# Sleep between sends — keeps us well under Resend's 10 req/s limit
# and is more polite to inboxes than blasting.
SEND_INTERVAL_SEC = 0.5

PAGE_SIZE = 1000


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def first_name_from_full(full: str | None) -> str:
    """Extract the first whitespace-separated word from full_name.
    Falls back to "there" so the greeting never reads as "Hi ,".
    """
    if not full:
        return "there"
    first = str(full).strip().split()
    if not first:
        return "there"
    return first[0]


def load_sent_log() -> set[str]:
    """Return the set of lowercase emails we've already sent to.
    Missing file → empty set (first run).
    """
    if not SENT_LOG_PATH.exists():
        return set()
    try:
        with SENT_LOG_PATH.open("r", encoding="utf-8") as f:
            return {
                line.strip().lower()
                for line in f
                if line.strip() and not line.strip().startswith("#")
            }
    except Exception as exc:
        print(f"WARNING: could not read sent log: {exc}")
        return set()


def append_sent_log(email: str) -> None:
    """Append one email + ISO timestamp to the dedup log. CSV-ish
    so it's also human-readable: `email,timestamp`.
    """
    try:
        if not SENT_LOG_PATH.exists():
            with SENT_LOG_PATH.open("w", encoding="utf-8") as f:
                f.write("# send_telegram_invite_email.py dedup log\n")
                f.write("# email,sent_at_iso\n")
        with SENT_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(f"{email.lower()},{datetime.utcnow().isoformat()}\n")
    except Exception as exc:
        print(f"WARNING: could not write sent log for {email}: {exc}")


def fetch_unlinked_users(user_filter: str | None = None) -> list[dict]:
    """Paginated read of profiles where telegram_chat_id is null AND
    email is present. If `user_filter` is set, restrict to that one
    email (useful for previewing the rendered body in isolation).

    We DON'T filter on is_active here — this is a one-time outreach,
    and a dormant user who never linked Telegram is exactly who we
    want to reach.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        try:
            q = (
                supabase.table("profiles")
                .select("id, email, full_name, telegram_chat_id")
                .is_("telegram_chat_id", "null")
                .neq("email", "")
            )
            if user_filter:
                q = q.eq("email", user_filter.strip().lower())
            res = q.range(offset, offset + PAGE_SIZE - 1).execute()
        except Exception as exc:
            print(f"profiles fetch failed at offset {offset}: {exc}")
            break
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    # Final filter — strip any rows without a real email (defence-
    # in-depth; the .neq above should already exclude empty strings).
    return [r for r in rows if r.get("email")]


# ─────────────────────────────────────────────────────────────────
# Email body — plain-text + tiny HTML mirror
# ─────────────────────────────────────────────────────────────────
# Keeping both formats so Gmail/Outlook can pick their preferred one.
# The HTML version is just <p> blocks for paragraph breaks — no
# branded header / coloured buttons. Matches the "plain text feel"
# in the spec.

PLAIN_BODY = """\
Hi {first_name},

I've been thinking about how to make
PineX more useful without being noisy.

The one thing I can do right now —
message you on Telegram when something
changes in your watchlist stocks.

Not daily updates.
Not market news.

Only when your specific stocks move.

If that sounds useful:

Open {bot_handle} on Telegram
and send /link

Takes 30 seconds.
Nothing changes if you skip this.

Robin
PineX

---
pinex.in · Educational tool · Not investment advice
"""


def render_plain(first_name: str) -> str:
    return PLAIN_BODY.format(
        first_name=first_name,
        bot_handle=TELEGRAM_BOT_HANDLE,
    )


def render_html(first_name: str) -> str:
    """Minimal HTML mirror — paragraph per blank-line group. Inline
    styles only; no <link rel="stylesheet"> that Gmail strips."""
    plain = render_plain(first_name)
    # Split on blank lines into paragraphs; preserve in-paragraph
    # line breaks as <br>. Plain font, modest measure, dark text on
    # default white background so the "from-Robin's-inbox" feel
    # carries to inboxes that always render HTML (Gmail iOS).
    paragraphs = [
        p.strip()
        for p in plain.split("\n\n")
        if p.strip()
    ]
    body_html = "\n".join(
        f'<p style="margin: 0 0 14px; line-height: 1.55;">'
        f'{para.replace(chr(10), "<br>")}'
        f'</p>'
        for para in paragraphs
    )
    return (
        '<div style="font-family: -apple-system, BlinkMacSystemFont, '
        '\'Segoe UI\', Roboto, sans-serif; color: #1a1a1a; '
        'font-size: 15px; max-width: 560px; margin: 0; padding: 0;">'
        + body_html
        + '</div>'
    )


# ─────────────────────────────────────────────────────────────────
# Send
# ─────────────────────────────────────────────────────────────────

def send_via_resend(to_email: str, first_name: str) -> tuple[bool, str]:
    """Returns (ok, detail). detail is empty on success, error msg
    on failure (status code text or exception)."""
    if not RESEND_API_KEY:
        return False, "RESEND_API_KEY missing in scripts/.env"
    try:
        res = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": FROM_EMAIL,
                "reply_to": REPLY_TO,
                "to": [to_email],
                "subject": SUBJECT,
                "text": render_plain(first_name),
                "html": render_html(first_name),
            },
            timeout=15,
        )
        if res.status_code in (200, 201):
            return True, ""
        return False, f"HTTP {res.status_code}: {res.text[:200]}"
    except Exception as exc:
        return False, str(exc)


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--send",
        action="store_true",
        help="Actually send. Without this flag the script does a dry run "
             "(prints the recipient list + an example body and exits).",
    )
    parser.add_argument(
        "--user",
        type=str,
        default=None,
        help="Restrict to a single email address (useful for testing).",
    )
    args = parser.parse_args()

    dry_run = not args.send
    print(
        f"[telegram_invite] start "
        f"{'DRY RUN' if dry_run else 'LIVE SEND'}"
        f"{' (user filter: ' + args.user + ')' if args.user else ''}"
    )

    if not dry_run and not RESEND_API_KEY:
        print("ERROR: RESEND_API_KEY is missing in scripts/.env — aborting.")
        return 2

    # ── 1. Targets ───────────────────────────────────────────────
    candidates = fetch_unlinked_users(args.user)
    print(f"  candidates from DB: {len(candidates)}")

    # Dedup vs prior runs
    already_sent = load_sent_log()
    to_send = [
        u for u in candidates
        if (u.get("email") or "").strip().lower() not in already_sent
    ]
    skipped_prev = len(candidates) - len(to_send)
    print(f"  already-sent (skipped via log): {skipped_prev}")
    print(f"  to send now: {len(to_send)}")

    if not to_send:
        print("[telegram_invite] nothing to send — exiting.")
        return 0

    # ── 2. Preview always — body of the FIRST recipient ──────────
    sample = to_send[0]
    sample_first = first_name_from_full(sample.get("full_name"))
    print()
    print("=" * 60)
    print(f"PREVIEW (first recipient: {sample.get('email')})")
    print(f"Subject: {SUBJECT}")
    print(f"From:    {FROM_EMAIL}")
    print("-" * 60)
    print(render_plain(sample_first))
    print("=" * 60)
    print()

    if dry_run:
        # Compact recipient list — first 20 + count.
        print("Would send to:")
        for u in to_send[:20]:
            print(f"  • {u.get('email')}  (first_name={first_name_from_full(u.get('full_name'))!r})")
        if len(to_send) > 20:
            print(f"  … and {len(to_send) - 20} more.")
        print()
        print(f"[telegram_invite] DRY RUN done — would have sent {len(to_send)} emails.")
        print("Re-run with --send to actually deliver.")
        return 0

    # ── 3. Live send loop ────────────────────────────────────────
    sent = 0
    errors = 0
    started = time.time()
    for i, u in enumerate(to_send, start=1):
        email = (u.get("email") or "").strip()
        if not email:
            continue
        first = first_name_from_full(u.get("full_name"))
        ok, detail = send_via_resend(email, first)
        if ok:
            append_sent_log(email)
            sent += 1
            print(f"  [{i}/{len(to_send)}] {email} ✓")
        else:
            errors += 1
            print(f"  [{i}/{len(to_send)}] {email} ✗ {detail}")
        time.sleep(SEND_INTERVAL_SEC)

    elapsed = round(time.time() - started, 1)
    print()
    print(f"[telegram_invite] LIVE SEND done — sent={sent} errors={errors} elapsed={elapsed}s")
    log_event("telegram_invite_email_finished", {
        "sent": sent,
        "errors": errors,
        "skipped_prev": skipped_prev,
        "elapsed_sec": elapsed,
        "user_filter": args.user,
    })
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
