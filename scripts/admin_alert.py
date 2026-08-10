"""admin_alert.py — one-way Telegram notices to the operator, not to users.

    from admin_alert import send_admin_telegram
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

  The corollary is that a silent no-op is possible — when the env vars are
  missing there is nobody to tell. Callers running in CI should say so in
  their own log output rather than assume the message landed.
"""
from __future__ import annotations

import os

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
        print(f"[{source}] admin alert skipped — {missing} not set")
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
        print(f"[{source}] admin alert failed to send: {exc}")
        return False

    if response.status_code != 200:
        # Telegram puts the reason in the body — a bad chat_id and a revoked
        # token look identical from the status code alone.
        print(
            f"[{source}] admin alert rejected: HTTP {response.status_code} "
            f"{response.text[:200]}"
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
