"""Generate per-user Morning Briefs.

Reads market state (market_internals, nifty_sectors), changed
watchlist symbols (swing_conditions), and writes one row per user
into morning_briefs for today's date. The Home page reads this row
on the next login to render the personalised brief card.

Schema mapping vs the spec:
  - Watchlist source table is `watchlists` (plural).
  - Sectors source table is `nifty_sectors`.
  - market_internals exposes `stage2_pct` (= % of universe in
    Stage 2), used as the breadth indicator.
  - swing_conditions exposes `conditions_met` (0-5) — that's the
    criteria score we compare day-over-day.
  - Daily question rotates by day-of-year so every user sees the
    same question on a given day and the cycle repeats every 10
    days.

Run order: AFTER swing_conditions + market_internals are fresh
for the day. The daily pipeline (scripts/run_daily.py) calls
this script as its last data-emit step.

Usage:
  python scripts/generate_morning_briefs.py
"""
from __future__ import annotations
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

from db import log_event, supabase  # noqa: E402


# ─────────────────────────────────────────────────────────────────
# Question pool — 10 prompts rotated by day-of-year. Edit copy
# here; deploy is a single Python file change.
# ─────────────────────────────────────────────────────────────────
DAILY_QUESTIONS = [
    "Does your thesis on your top watchlist stock still hold today?",
    "One of your stocks had unusual activity yesterday. What do you observe?",
    "Breadth has been flat 3 days. What does that tell you about timing?",
    "Pick one stock you'd add today. Why this one over the others?",
    "Which sector is rotating in? Are you leaning into it or away?",
    "Has your conviction in your biggest position changed this week?",
    "Is the market giving you confirmation, or are you front-running price?",
    "If breadth drops 10% next week, which positions do you sell first?",
    "What's the difference between your watchlist now and a month ago?",
    "Are you reacting to news, or to your written rules?",
]


def market_character(breadth_pct: float | None) -> str:
    """Translate breadth into a four-bucket character label.

    Bucket thresholds match the brief spec:
       >= 60  STRONG
       >= 45  SELECTIVE
       >= 35  MIXED
       <  35  WEAK
    None → MIXED (safest default; never surface "WEAK" on missing data).
    """
    if breadth_pct is None:
        return "MIXED"
    if breadth_pct >= 60:
        return "STRONG"
    if breadth_pct >= 45:
        return "SELECTIVE"
    if breadth_pct >= 35:
        return "MIXED"
    return "WEAK"


def pick_daily_question(today: date) -> str:
    """Stable per-day pick — day-of-year mod 10 keeps everyone on
    the same prompt for the day. Cycle repeats every 10 days.
    """
    return DAILY_QUESTIONS[today.timetuple().tm_yday % len(DAILY_QUESTIONS)]


# ─────────────────────────────────────────────────────────────────
# Data fetchers — each isolated so a single failure (e.g. empty
# nifty_sectors history) doesn't bring down the whole run.
# ─────────────────────────────────────────────────────────────────

def fetch_latest_market_internals() -> dict[str, Any] | None:
    """Pull the most recent market_internals row. Returns None if
    the table is empty (first-run edge case).
    """
    try:
        res = (
            supabase.table("market_internals")
            .select("date,stage2_pct,above_ma150_pct,india_vix")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as exc:
        print(f"[morning_briefs] market_internals fetch failed: {exc}")
        return None


def fetch_top_sector() -> tuple[str | None, str | None]:
    """Identify the strongest sector for today's brief.

    Strategy:
      1. Read the latest 50 nifty_sectors rows ordered by trading_date
         desc, then stage2_count desc.
      2. Filter to rows with the most-recent trading_date.
      3. Top sector = max stage2_count among them.
      4. Trend hint comes from `change_1m`: positive → "rising",
         negative → "weakening", flat → "flat".
    """
    try:
        res = (
            supabase.table("nifty_sectors")
            .select("name,trading_date,stage2_count,change_1m")
            .order("trading_date", desc=True)
            .order("stage2_count", desc=True)
            .limit(50)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None, None
        latest_date = rows[0].get("trading_date")
        same_day = [r for r in rows if r.get("trading_date") == latest_date]
        if not same_day:
            return None, None
        top = max(same_day, key=lambda r: r.get("stage2_count") or 0)
        chg = top.get("change_1m")
        try:
            chg = float(chg) if chg is not None else 0.0
        except (TypeError, ValueError):
            chg = 0.0
        if chg > 0.5:
            trend = "rising"
        elif chg < -0.5:
            trend = "weakening"
        else:
            trend = "flat"
        return top.get("name"), trend
    except Exception as exc:
        print(f"[morning_briefs] nifty_sectors fetch failed: {exc}")
        return None, None


def fetch_recent_swing_conditions() -> dict[str, list[tuple[str, int]]]:
    """Build {symbol: [(trading_date, conditions_met), ...]} for
    the last ~2-3 trading days, used to detect day-over-day
    criteria-score changes per watchlist symbol.

    We pull the latest 3000 swing_conditions rows (≈ 1.5 days of
    universe at ~2000 stocks/day) — comfortably above any single
    user's watchlist size and well under PostgREST's hard 1000 cap
    per request.
    """
    out: dict[str, list[tuple[str, int]]] = {}
    try:
        # Three paginated requests; 1000 rows each.
        offset = 0
        page = 1000
        while offset < 3000:
            res = (
                supabase.table("swing_conditions")
                .select("symbol,trading_date,conditions_met")
                .order("trading_date", desc=True)
                .range(offset, offset + page - 1)
                .execute()
            )
            batch = res.data or []
            for r in batch:
                sym = (r.get("symbol") or "").upper()
                td = r.get("trading_date")
                score = r.get("conditions_met")
                if not sym or td is None or score is None:
                    continue
                out.setdefault(sym, []).append((td, int(score)))
            if len(batch) < page:
                break
            offset += page
        # Sort each per-symbol history desc by date.
        for sym in out:
            out[sym].sort(key=lambda t: t[0], reverse=True)
        return out
    except Exception as exc:
        print(f"[morning_briefs] swing_conditions fetch failed: {exc}")
        return out


def detect_changed_symbols(
    user_symbols: list[str],
    swing_by_symbol: dict[str, list[tuple[str, int]]],
) -> list[dict[str, Any]]:
    """For each watchlist symbol whose conditions_met changed between
    the latest and prior trading day, return {symbol, from, to}.
    """
    changed: list[dict[str, Any]] = []
    for sym in user_symbols:
        hist = swing_by_symbol.get(sym.upper())
        if not hist or len(hist) < 2:
            continue
        latest_date, latest_score = hist[0]
        prior_date, prior_score = hist[1]
        # Guard against same-day duplicates (shouldn't happen given
        # swing's unique constraint, but cheap to check).
        if latest_date == prior_date:
            continue
        if latest_score != prior_score:
            changed.append({
                "symbol": sym,
                "from": prior_score,
                "to": latest_score,
            })
    return changed


def fetch_users() -> list[dict[str, Any]]:
    """All profile rows, paginated. We DON'T filter on is_active /
    email_notifications here — the brief is generated even for
    inactive users so when they return, today's row exists. Cost
    is ~1 row per user per day; cheap.
    """
    rows: list[dict[str, Any]] = []
    offset = 0
    page = 1000
    while True:
        try:
            res = (
                supabase.table("profiles")
                .select("id")
                .order("id")
                .range(offset, offset + page - 1)
                .execute()
            )
        except Exception as exc:
            print(f"[morning_briefs] profiles fetch failed at offset={offset}: {exc}")
            break
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def fetch_watchlist_symbols(user_id: str) -> list[str]:
    """Watchlist rows for a single user. Empty list when the user
    has no watchlist (the brief still gets generated with
    watchlist_total=0).
    """
    try:
        res = (
            supabase.table("watchlists")
            .select("symbol")
            .eq("user_id", user_id)
            .execute()
        )
        rows = res.data or []
        return [r["symbol"] for r in rows if r.get("symbol")]
    except Exception as exc:
        print(f"[morning_briefs] watchlist fetch failed for {user_id}: {exc}")
        return []


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main() -> int:
    today = date.today()
    today_iso = today.isoformat()
    print(f"[morning_briefs] start {today_iso}")
    log_event("generate_morning_briefs_started", {"date": today_iso})

    # 1. Market state — same for every user, fetch once.
    mi = fetch_latest_market_internals() or {}
    breadth_pct_raw = mi.get("stage2_pct")
    try:
        breadth_pct = (
            round(float(breadth_pct_raw), 1)
            if breadth_pct_raw is not None
            else None
        )
    except (TypeError, ValueError):
        breadth_pct = None
    character = market_character(breadth_pct)
    print(f"[morning_briefs] breadth_pct={breadth_pct} character={character}")

    # 2. Top sector — same for every user.
    top_sector, top_sector_trend = fetch_top_sector()
    print(f"[morning_briefs] top_sector={top_sector} trend={top_sector_trend}")

    # 3. Daily question — stable for the day.
    daily_question = pick_daily_question(today)

    # 4. Swing condition history — fetched once, reused per user.
    swing_by_symbol = fetch_recent_swing_conditions()
    print(f"[morning_briefs] swing_conditions: {len(swing_by_symbol)} symbols indexed")

    # 5. Iterate users — write one brief each.
    users = fetch_users()
    print(f"[morning_briefs] processing {len(users)} users")

    generated = 0
    errors = 0

    for i, user in enumerate(users, start=1):
        uid = user.get("id")
        if not uid:
            continue
        try:
            symbols = fetch_watchlist_symbols(uid)
            changed = (
                detect_changed_symbols(symbols, swing_by_symbol)
                if symbols
                else []
            )
            # Cap changed_symbols at 5 — UI shows top few; row stays small.
            payload = {
                "user_id": uid,
                "brief_date": today_iso,
                "market_character": character,
                "breadth_pct": breadth_pct,
                "watchlist_total": len(symbols),
                "watchlist_changed": len(changed),
                "changed_symbols": changed[:5],
                "top_sector": top_sector,
                "top_sector_trend": top_sector_trend,
                "daily_question": daily_question,
            }
            (
                supabase.table("morning_briefs")
                .upsert(payload, on_conflict="user_id,brief_date")
                .execute()
            )
            generated += 1
            if i % 100 == 0:
                print(f"  [{i}/{len(users)}] generated={generated} errors={errors}")
        except Exception as exc:
            errors += 1
            print(f"  ! user {uid}: {exc}")

        # Gentle pacing — keeps each user's writes ~10 / second so
        # the daily run doesn't hammer Supabase's REST endpoint.
        time.sleep(0.1)

    print(
        f"[morning_briefs] done — generated={generated} errors={errors} "
        f"users_processed={len(users)}"
    )
    log_event("generate_morning_briefs_finished", {
        "date": today_iso,
        "generated": generated,
        "errors": errors,
        "users_processed": len(users),
        "breadth_pct": breadth_pct,
        "market_character": character,
        "top_sector": top_sector,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
