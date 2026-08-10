"""admin_alert.py — one-way Telegram notices to the operator, not to users.

    from admin_alert import preflight, send_admin_telegram
    preflight("validate_static_data")          # once, at startup
    send_admin_telegram("<b>Something happened</b>", source="validate_static_data")

WHY THIS IS SEPARATE FROM telegram_broadcast.py
  That module talks to SUBSCRIBERS and to the public channel: it formats
  market content, tracks who received what, and a bug there is visible to
  everyone. This one talks to a single operator chat about pipeline health.
  Mixing the two would put "your gate failed" one wrong argument away from
  the subscriber list, so the audiences stay in different files.

DELIVERY IS BEST-EFFORT, ALWAYS
  Every caller here is a data pipeline whose actual job is the data. A
  Telegram outage, a rotated token or an unset env var must never fail a
  build or abort a write that already succeeded, so nothing in this module
  raises: failures are logged and reported through the return value. The
  caller decides whether it cares, and in practice none of them do.

BUT NEVER SILENT
  Best-effort must not mean unnoticed. An alerting path that fails quietly
  is worse than none at all: it replaces "nobody is watching" with "someone
  is watching", and only the first of those is true. Every failure here
  goes to stderr at error level WITH Telegram's own response body, and
  inside GitHub Actions it also emits a ::error:: annotation so the step
  turns red rather than hiding a warning mid-log.

  preflight() exists for the same reason. It resolves the chat id via
  getChat before anything needs sending, so a misconfigured channel is
  discovered on an ordinary green run — not on the one day in six months
  that actually has something to report. Callers should invoke it once at
  startup and ignore the return value; its job is the log line.

  This is not hypothetical. Both alerts added in August 2026 were rejected
  with "chat not found" on their first live outing, because
  TELEGRAM_ADMIN_CHAT_ID held an @username and Telegram resolves those only
  for public channels. Nothing in the original code said so out loud.
"""
from __future__ import annotations

import os
import sys

import requests

TELEGRAM_TIMEOUT = 15

# Telegram rejects sendMessage over 4096 characters outright. Alerts that
# enumerate offenders can run long — 40 bad tickers with reasons is easily
# past it — so the body is trimmed rather than lost. The reserve leaves
# room for the truncation notice itself.
TELEGRAM_MAX_CHARS = 4096
TRUNCATION_RESERVE = 120


def _truncate(message: str) -> str:
    if len(message) <= TELEGRAM_MAX_CHARS:
        return message
    keep = TELEGRAM_MAX_CHARS - TRUNCATION_RESERVE
    return message[:keep] + "\n\n… truncated — see the full run log."


# ── Failing loudly ──────────────────────────────────────────────────────
# An alerting system that fails silently is worse than none: it converts
# "you will be told" into "you believe you will be told". Every failure
# path below therefore writes to stderr at error level, prints Telegram's
# own response body rather than just the status code, and — inside GitHub
# Actions — emits a ::error:: annotation so the step is visibly red instead
# of a warning buried 400 lines into a log nobody opens.
#
# It still does not RAISE. The callers are data pipelines whose real job is
# the data; a Telegram outage must not fail a build or undo a write that
# already succeeded. Loud, not fatal.
_IN_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"

# The first failure in a process gets the full diagnosis — env var state,
# the exact response, and what to do about it. Later ones are one-liners,
# so a run that alerts forty times does not bury the explanation.
_diagnosed = False


def _fail(source: str, headline: str, body: str = "", hint: str = "") -> None:
    global _diagnosed

    print(f"ERROR [{source}] admin alert: {headline}", file=sys.stderr)
    if body:
        print(f"       response: {body}", file=sys.stderr)

    if not _diagnosed:
        _diagnosed = True
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()
        print(
            "       TELEGRAM_BOT_TOKEN "
            f"{'set (' + str(len(token)) + ' chars)' if token else 'NOT SET'}, "
            f"TELEGRAM_ADMIN_CHAT_ID {repr(chat_id) if chat_id else 'NOT SET'}",
            file=sys.stderr,
        )
        if hint:
            print(f"       {hint}", file=sys.stderr)

    if _IN_ACTIONS:
        # Single line: Actions annotations do not render embedded newlines.
        detail = f"{headline}. {body}".replace("\n", " ").strip()
        print(f"::error title=Admin alert undeliverable::{detail}")


def _chat_id_hint(chat_id: str) -> str:
    """Why this particular chat_id is likely being rejected."""
    if chat_id.startswith("@"):
        return (
            f"{chat_id!r} is a username. Telegram resolves @handles only for "
            "public channels — for a private DM you need the NUMERIC chat id. "
            "Message the bot, then GET "
            "https://api.telegram.org/bot<TOKEN>/getUpdates and read "
            "result[].message.chat.id"
        )
    if not chat_id.lstrip("-").isdigit():
        return (
            f"{chat_id!r} is neither numeric nor an @handle — a chat id is "
            "normally a positive integer for a DM or a negative one for a group."
        )
    return ""


def preflight(source: str = "pipeline") -> bool:
    """Verify the bot can actually reach the configured chat, before it matters.

    Calls getChat, which resolves the id WITHOUT sending anything. Worth one
    request at startup: it turns "the alert you were relying on never
    arrived" into a red line in the log of the run that could still have
    told you. Returns True when the chat resolves.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()
    if not token or not chat_id:
        missing = " and ".join(
            n for n, v in (("TELEGRAM_BOT_TOKEN", token),
                           ("TELEGRAM_ADMIN_CHAT_ID", chat_id)) if not v
        )
        _fail(source, f"{missing} not set — alerts are disabled")
        return False

    try:
        response = requests.get(
            f"https://api.telegram.org/bot{token}/getChat",
            params={"chat_id": chat_id},
            timeout=TELEGRAM_TIMEOUT,
        )
    except requests.RequestException as exc:
        _fail(source, f"could not reach Telegram: {exc}")
        return False

    if response.status_code != 200:
        _fail(
            source,
            f"chat id {chat_id!r} is unreachable (HTTP {response.status_code})",
            response.text[:400],
            _chat_id_hint(chat_id),
        )
        return False

    return True


def send_admin_telegram(message: str, source: str = "pipeline") -> bool:
    """POST `message` to TELEGRAM_ADMIN_CHAT_ID. True when Telegram took it.

    `source` only labels the log line, so a failure in a 40-minute workflow
    is traceable to the step that raised it. HTML parse mode matches the
    rest of the project's Telegram output.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()
    if not token or not chat_id:
        missing = " and ".join(
            n for n, v in (
                ("TELEGRAM_BOT_TOKEN", token),
                ("TELEGRAM_ADMIN_CHAT_ID", chat_id),
            ) if not v
        )
        _fail(source, f"{missing} not set — message dropped")
        return False

    try:
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": _truncate(message),
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=TELEGRAM_TIMEOUT,
        )
    except requests.RequestException as exc:
        _fail(source, f"could not reach Telegram: {exc}")
        return False

    if response.status_code != 200:
        # Telegram puts the reason in the body — a bad chat_id, a revoked
        # token and malformed HTML are indistinguishable by status code.
        _fail(
            source,
            f"rejected with HTTP {response.status_code}",
            response.text[:400],
            _chat_id_hint(chat_id),
        )
        return False

    return True


def esc(text: object) -> str:
    """Escape for HTML parse mode.

    Company names and NSE remarks are not trusted to be markup-safe —
    "Rs. 10/- <> Re. 1/-" in a remarks field would otherwise make Telegram
    reject the whole message as malformed HTML and the alert would vanish.
    """
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
