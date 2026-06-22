"""IQjet · Pillar 1 — daily Telegram post.

Reads today's divergence_signals row + the matching market_internals row,
formats a single Telegram message per the IQjet build brief, and sends
it to TELEGRAM_CHANNEL_ID. Runs in the daily pipeline AFTER
calc_divergences.py.

The post is intentionally observational — it lists the data points and
which divergences fired, ending on a "paste this into your AI to
understand what it means" line. No buy/sell/hold language at this layer;
that lives downstream in the verdict the user's own AI produces from
this payload.

Run from scripts/ dir:   python iqjet/post_iqjet_telegram.py
Pipeline integration:    invoked by run_daily.py after the existing
                         telegram_channel step.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from db import log_event, supabase  # noqa: E402
from loguru import logger  # noqa: E402
from telegram_broadcast import _send_message  # noqa: E402


# ── Loaders ─────────────────────────────────────────────────────────────
def _latest_divergence_row() -> dict[str, Any] | None:
    res = (
        supabase.table("divergence_signals")
        .select("*")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _market_internals_for(d: str) -> dict[str, Any] | None:
    """Today's full market_internals row, so the post can include
    advancing/declining/stage4 numbers that aren't denormalised onto
    divergence_signals."""
    res = (
        supabase.table("market_internals")
        .select("*")
        .eq("date", d)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _market_internals_one_week_back(d: str) -> dict[str, Any] | None:
    """The row ~5 trading days before `d`. Used to compute the WoW
    deltas shown in the post (advancing-stocks-then-vs-now, etc.)."""
    res = (
        supabase.table("market_internals")
        .select("*")
        .lt("date", d)
        .order("date", desc=True)
        .limit(6)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    # The 5th-newest row is ~5 trading days back; fall back to the
    # oldest available if there aren't 5 yet (fresh DB).
    if not rows:
        return None
    return rows[-1] if len(rows) >= 5 else rows[-1]


# ── Formatter ───────────────────────────────────────────────────────────
def _fmt_int(v: Any) -> str:
    try:
        return f"{int(v):,}"
    except (TypeError, ValueError):
        return "?"


def _fmt_pct(v: Any, decimals: int = 0) -> str:
    try:
        return f"{float(v):.{decimals}f}%"
    except (TypeError, ValueError):
        return "?"


def _fmt_num(v: Any) -> str:
    try:
        return f"{float(v):,.0f}"
    except (TypeError, ValueError):
        return "?"


def build_post(
    div_row: dict[str, Any],
    today_mi: dict[str, Any] | None,
    last_week_mi: dict[str, Any] | None,
) -> str:
    """Compose the Telegram message text per the brief's template."""
    d = div_row["date"]
    # "12 Jun 2026" reads better than the ISO date in chat.
    try:
        date_label = datetime.strptime(d, "%Y-%m-%d").strftime("%d %b %Y")
    except Exception:                                     # noqa: BLE001
        date_label = d

    verdict = div_row.get("verdict") or "UNKNOWN"
    nifty   = div_row.get("nifty_close")
    breadth = div_row.get("breadth_pct")
    ad_dir  = (div_row.get("ad_line_direction") or "unknown").lower()
    s2_now  = div_row.get("stage2_count")
    s3_now  = div_row.get("stage3_count")

    # Nifty 1-day change comes from market_internals (not denormalised
    # onto divergence_signals — the field would only ever be useful for
    # this Telegram post and the dashboard already has the raw value).
    nifty_chg_1d = today_mi.get("nifty_change_1d") if today_mi else None

    # WoW context for the breadth/advance numbers — gives the reader
    # something to anchor "is this changing?" against.
    breadth_prev_week = (
        last_week_mi.get("above_ma30w_pct") if last_week_mi else None
    )
    advancing_now = today_mi.get("advances") if today_mi else None
    advancing_prev_week = (
        last_week_mi.get("advances") if last_week_mi else None
    )

    # Topping = stage 3 count. Brief calls it "Topping stocks" so we
    # match that wording.
    topping_now = s3_now
    topping_prev_week = (
        last_week_mi.get("stage3_count") if last_week_mi else None
    )

    n_fired = len(div_row.get("divergences_detected") or [])

    lines: list[str] = []
    lines.append(f"\U0001F50D IQjet Market Pulse — {date_label}")
    lines.append("")
    lines.append(f"Verdict: *{verdict}*")
    lines.append("")
    lines.append("What the data shows:")
    if nifty_chg_1d is not None:
        lines.append(f"- Nifty: {_fmt_num(nifty)} ({nifty_chg_1d:+.1f}%)")
    else:
        lines.append(f"- Nifty: {_fmt_num(nifty)}")

    if breadth_prev_week is not None:
        lines.append(
            f"- Stocks above 30W MA: {_fmt_pct(breadth)} "
            f"(was {_fmt_pct(breadth_prev_week)} last week)"
        )
    else:
        lines.append(f"- Stocks above 30W MA: {_fmt_pct(breadth)}")

    lines.append(f"- A/D Line: {ad_dir.title()}")

    if advancing_prev_week is not None:
        lines.append(
            f"- Advancing stocks: {_fmt_int(advancing_now)} "
            f"(was {_fmt_int(advancing_prev_week)} last week)"
        )
    elif advancing_now is not None:
        lines.append(f"- Advancing stocks: {_fmt_int(advancing_now)}")

    if topping_prev_week is not None:
        lines.append(
            f"- Topping stocks (Stage 3): {_fmt_int(topping_now)} "
            f"(was {_fmt_int(topping_prev_week)} last week)"
        )
    elif topping_now is not None:
        lines.append(f"- Topping stocks (Stage 3): {_fmt_int(topping_now)}")

    lines.append("")
    lines.append(f"Divergences detected: *{n_fired}*")
    if n_fired:
        for d_item in (div_row.get("divergences_detected") or [])[:5]:
            label = d_item.get("label") if isinstance(d_item, dict) else str(d_item)
            if label:
                lines.append(f"  · {label}")

    lines.append("")
    lines.append("Paste this into your AI to understand what it means.")
    lines.append("")
    lines.append("IQjet — pinex.in/iqjet")

    return "\n".join(lines)


# ── Send ────────────────────────────────────────────────────────────────
def main() -> int:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    channel = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()
    if not token or not channel:
        logger.error("[iqjet] TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID missing")
        return 1

    div_row = _latest_divergence_row()
    if not div_row:
        logger.error(
            "[iqjet] no divergence_signals row to post — "
            "did calc_divergences.py run today?"
        )
        return 1

    d = div_row["date"]
    today_mi = _market_internals_for(d)
    last_week_mi = _market_internals_one_week_back(d)
    text = build_post(div_row, today_mi, last_week_mi)

    ok, err = _send_message(token, channel, text)
    if not ok:
        logger.error(f"[iqjet] Telegram send failed: {err}")
        log_event(
            "iqjet_telegram_failed",
            {"date": d, "verdict": div_row.get("verdict"), "error": err},
        )
        return 1

    logger.info(
        f"[iqjet] posted {d}  verdict={div_row.get('verdict')}  "
        f"divergences={len(div_row.get('divergences_detected') or [])}"
    )
    log_event(
        "iqjet_telegram_sent",
        {
            "date":          d,
            "verdict":       div_row.get("verdict"),
            "n_divergences": len(div_row.get("divergences_detected") or []),
            "chars":         len(text),
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
