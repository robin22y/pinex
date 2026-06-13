"""
calc_streaks.py — daily login points + streak tracking.

Runs as the LAST step of the daily pipeline (after every other script
has written its data and the user-facing reads have settled). For each
active profile:

  1. Ensure a user_points row exists (idempotent upsert).
  2. Detect whether the user logged in TODAY (last_active_at::date ==
     today).
  3. Update current_streak / longest_streak / last_streak_date per
     the streak rules below.
  4. Award the daily-login points (action_type = 'daily_login') —
     once per UTC day per user.
  5. Award milestone bonuses (3 / 7 / 14 / 30 / 100 days) when the new
     streak hits one — once per milestone per user, ever.

STREAK RULES
  logged_in_today + last_streak_date == today    → already processed,
                                                   leave alone.
  logged_in_today + last_streak_date == yesterday → current + 1
  logged_in_today + last_streak_date <  yesterday → reset to 1
  logged_in_today + last_streak_date is null     → 1
  !logged_in_today + last_streak_date <  yesterday → reset to 0
  !logged_in_today + last_streak_date == yesterday → leave (still
                                                     have today to
                                                     log in)
  !logged_in_today + last_streak_date is null     → no-op

IDEMPOTENCY
  Re-running on the same UTC day is safe:
    - Streak: gated on last_streak_date == today.
    - daily_login award: gated on a points_transactions row with
      (user_id, action_type='daily_login', created_at::date = today).
    - Milestone award: gated on a points_transactions row with
      (user_id, action_type=<MILESTONES[n]>) ever existing.

POINTS PIPELINE (per-user)
  1. Fetch points_config.points_value for action_type (active rows).
  2. Fetch points_offers active right now matching action_type
     (or with NULL action_type — applies to all).
  3. final = round(base × best_multiplier + best_bonus).
  4. INSERT points_transactions; UPDATE user_points totals.

SLEEPS
  0.05 s between users to keep Supabase disk IO comfortable across a
  ~2,000-profile sweep.

PRINTS A SUMMARY + LOGS calc_streaks_complete USAGE EVENT.

Usage:
  python scripts/calc_streaks.py             # live write
  python scripts/calc_streaks.py --dry-run   # preview, no writes
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")
sys.path.insert(0, str(_script_dir))

from db import log_event, supabase  # noqa: E402

logger.add(
    "logs/calc_streaks_{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="7 days",
    level="INFO",
)

# Force UTF-8 on Windows console.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ── Constants ──────────────────────────────────────────────────────────────

DAILY_LOGIN_ACTION = "daily_login"
DAILY_LOGIN_FALLBACK_POINTS = 2  # used if points_config is empty / inactive

# Streak milestones — action_type for each is the value. The tx row's
# action_type makes the idempotency check below trivial: if any row
# with action_type=<MILESTONES[n]> exists for the user, skip.
MILESTONES: dict[int, str] = {
    3:   "streak_3_days",
    7:   "streak_7_days",
    14:  "streak_14_days",
    30:  "streak_30_days",
    100: "streak_100_days",
}
MILESTONE_FALLBACK_POINTS: dict[str, int] = {
    "streak_3_days":   10,
    "streak_7_days":   25,
    "streak_14_days":  50,
    "streak_30_days": 100,
    "streak_100_days": 500,
}

# Pace between per-user DB operations. Conservative — matches the
# 0.05 s sleep guard the user requested after the backfill incident.
SLEEP_BETWEEN_USERS = 0.05


# ── Helpers ────────────────────────────────────────────────────────────────


def _today_utc() -> date:
    """UTC date — the pipeline runs at 12:00 UTC (17:30 IST), so this
    aligns with "today" for both UTC and IST users."""
    return datetime.now(timezone.utc).date()


def _parse_iso_date(raw: Any) -> date | None:
    """profiles.last_active_at is timestamptz; user_points.last_streak_date
    is date. Both arrive as strings from PostgREST. Tolerant of either."""
    if not raw:
        return None
    s = str(raw)
    try:
        # Try full ISO timestamp first (timestamptz).
        if "T" in s or " " in s:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).date()
        # Bare date string.
        return date.fromisoformat(s[:10])
    except (ValueError, TypeError):
        return None


# ── Step 1 — read every non-deactivated profile ────────────────────────────


def fetch_all_profiles() -> list[dict[str, Any]]:
    """Paginated read of every active profile (is_active = True).
    1000 per round-trip — PostgREST's hard max-rows cap."""
    rows: list[dict[str, Any]] = []
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table("profiles")
            .select("id,email,last_active_at")
            .eq("is_active", True)
            .order("created_at")
            .range(start, start + page - 1)
            .execute()
        )
        batch = getattr(res, "data", None) or []
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


# ── Step 2 — ensure user_points row exists ─────────────────────────────────


def fetch_existing_points_user_ids() -> set[str]:
    """Set of user_ids that already have a user_points row. Paginated."""
    out: set[str] = set()
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table("user_points")
            .select("user_id")
            .range(start, start + page - 1)
            .execute()
        )
        batch = getattr(res, "data", None) or []
        for r in batch:
            uid = r.get("user_id")
            if uid:
                out.add(str(uid))
        if len(batch) < page:
            break
        start += page
    return out


def ensure_points_rows(missing_user_ids: list[str], dry_run: bool) -> int:
    """Insert empty user_points rows for any user that doesn't have one.
    Uses .upsert with ON CONFLICT DO NOTHING semantics so concurrent
    inserts elsewhere (e.g. ensureUserPoints in the JS bundle) can't
    race us into a duplicate-key error."""
    if not missing_user_ids:
        return 0
    rows = [{"user_id": uid} for uid in missing_user_ids]
    if dry_run:
        return len(rows)
    inserted = 0
    # Chunk to keep payloads small.
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        try:
            supabase.table("user_points").upsert(chunk, on_conflict="user_id").execute()
            inserted += len(chunk)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"ensure_points_rows chunk {i} failed: {exc}")
    return inserted


# ── Step 7 — points award helper (mirror of pointsAwarder.js) ──────────────


def _fetch_points_config(action_type: str) -> int | None:
    """Return points_value for action_type when active, else None."""
    try:
        res = (
            supabase.table("points_config")
            .select("points_value,is_active")
            .eq("action_type", action_type)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if not rows:
            return None
        row = rows[0]
        if not row.get("is_active"):
            return None
        v = row.get("points_value")
        return int(v) if v is not None else None
    except Exception:
        return None


def _fetch_active_offers() -> list[dict[str, Any]]:
    """One round-trip to grab every currently-active offer. We filter
    client-side by action_type (NULL = applies to all)."""
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        res = (
            supabase.table("points_offers")
            .select("action_type,multiplier,bonus_points")
            .eq("is_active", True)
            .lte("starts_at", now_iso)
            .gte("ends_at", now_iso)
            .execute()
        )
        return getattr(res, "data", None) or []
    except Exception:
        return []


def _apply_offers(base_points: int, action_type: str, offers: list[dict]) -> int:
    """Pick the best multiplier + best bonus across applicable offers,
    same shape as the JS awarder. Returns the rounded final points."""
    best_mult = 1.0
    best_bonus = 0
    for o in offers:
        a = o.get("action_type")
        if a and a != action_type:
            continue
        m = float(o.get("multiplier") or 1)
        b = int(o.get("bonus_points") or 0)
        if m > best_mult:
            best_mult = m
        if b > best_bonus:
            best_bonus = b
    return max(0, round(base_points * best_mult + best_bonus))


def award_points(
    user_id: str,
    action_type: str,
    notes: str | None,
    offers_cache: list[dict[str, Any]],
    fallback_points: int,
    dry_run: bool,
) -> int:
    """End-to-end award: config lookup → offer apply → insert tx →
    bump user_points totals. Returns the points awarded (0 on failure
    or in dry-run mode)."""
    base = _fetch_points_config(action_type)
    if base is None:
        base = fallback_points
    final_pts = _apply_offers(int(base), action_type, offers_cache)
    if final_pts <= 0:
        return 0
    if dry_run:
        return final_pts

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table("points_transactions").insert({
            "user_id":     user_id,
            "points":      final_pts,
            "action_type": action_type,
            "notes":       notes,
        }).execute()

        # Read current totals; bump them. Per-user atomic only — not
        # a single transaction across the table. Matches the existing
        # award_retroactive_points.py pattern.
        up = (
            supabase.table("user_points")
            .select("total_points,lifetime_points")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        cur = (getattr(up, "data", None) or [{}])[0]
        supabase.table("user_points").update({
            "total_points":    int(cur.get("total_points") or 0) + final_pts,
            "lifetime_points": int(cur.get("lifetime_points") or 0) + final_pts,
            "updated_at":      now_iso,
        }).eq("user_id", user_id).execute()
        return final_pts
    except Exception as exc:  # noqa: BLE001
        logger.error(f"award_points failed for {user_id} / {action_type}: {exc}")
        return 0


# ── Daily-login idempotency check ──────────────────────────────────────────


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _query_daily_login(user_id: str, today_str: str) -> list:
    res = (
        supabase.table("points_transactions")
        .select("id")
        .eq("user_id", user_id)
        .eq("action_type", DAILY_LOGIN_ACTION)
        .gte("created_at", today_str)
        .limit(1)
        .execute()
    )
    return res.data or []


def has_daily_login_today(user_id: str, today: date) -> bool:
    """True if a daily_login tx row already exists today for this user."""
    try:
        rows = _query_daily_login(user_id, today.isoformat())
        return len(rows) > 0
    except Exception:
        # If the check fails, default to "yes already awarded" so we
        # don't accidentally double-award when read is broken.
        return True


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _query_milestone(user_id: str, action_type: str) -> list:
    res = (
        supabase.table("points_transactions")
        .select("id")
        .eq("user_id", user_id)
        .eq("action_type", action_type)
        .limit(1)
        .execute()
    )
    return res.data or []


def has_milestone_ever(user_id: str, action_type: str) -> bool:
    """True if this user ever received this specific milestone bonus.
    Milestones are per-milestone-once-per-user (a 7-day streak hit
    today can only earn streak_7_days once, regardless of how many
    times the user achieves 7-day streaks)."""
    try:
        rows = _query_milestone(user_id, action_type)
        return len(rows) > 0
    except Exception:
        return True


# ── Step 4 — read current streak state ─────────────────────────────────────


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _query_streak_state(user_id: str) -> list:
    res = (
        supabase.table("user_points")
        .select("current_streak,longest_streak,last_streak_date")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data or []


def fetch_streak_state(user_id: str) -> dict[str, Any]:
    """Return {current_streak, longest_streak, last_streak_date} for
    the user. Defaults all to 0 / None on missing row or read error."""
    try:
        rows = _query_streak_state(user_id)
        if not rows:
            return {"current_streak": 0, "longest_streak": 0, "last_streak_date": None}
        r = rows[0]
        # Preserved from the pre-retry-split version — process_user
        # compares state["last_streak_date"] against `date` objects
        # (== today / == yesterday) and does arithmetic on the
        # streak counters, so returning raw PostgREST rows would
        # silently break every streak path.
        return {
            "current_streak":   int(r.get("current_streak") or 0),
            "longest_streak":   int(r.get("longest_streak") or 0),
            "last_streak_date": _parse_iso_date(r.get("last_streak_date")),
        }
    except Exception:
        return {"current_streak": 0, "longest_streak": 0, "last_streak_date": None}


# ── Step 5 — streak update ─────────────────────────────────────────────────


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _patch_streak(user_id: str, payload: dict) -> None:
    supabase.table("user_points").update(payload).eq("user_id", user_id).execute()


def update_streak(
    user_id: str,
    new_streak: int,
    new_longest: int,
    last_streak_date: date | None,
    dry_run: bool,
) -> bool:
    """Patch user_points with the new streak fields. Returns True on
    success."""
    if dry_run:
        return True
    try:
        payload = {
            "current_streak":   new_streak,
            "longest_streak":   new_longest,
            "last_streak_date": last_streak_date.isoformat() if last_streak_date else None,
            "updated_at":       datetime.now(timezone.utc).isoformat(),
        }
        _patch_streak(user_id, payload)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error(f"update_streak failed for {user_id}: {exc}")
        return False


# ── Main per-user loop ─────────────────────────────────────────────────────


def process_user(
    profile: dict[str, Any],
    today: date,
    yesterday: date,
    offers_cache: list[dict[str, Any]],
    dry_run: bool,
) -> dict[str, int]:
    """Apply the full streak + points pipeline for one user. Returns a
    per-user delta dict the main loop sums into the summary counters."""
    delta = {
        "logged_in_today": 0,
        "daily_login_awarded": 0,
        "daily_login_points": 0,
        "streak_incremented": 0,
        "streak_started": 0,
        "streak_broken": 0,
        "milestone_hit": 0,
        "milestone_points": 0,
        "errors": 0,
    }
    uid = profile.get("id")
    if not uid:
        return delta

    last_active_dt = _parse_iso_date(profile.get("last_active_at"))
    logged_in_today = last_active_dt == today

    state = fetch_streak_state(str(uid))
    current = state["current_streak"]
    longest = state["longest_streak"]
    last_streak_dt = state["last_streak_date"]

    new_streak = current
    new_last_streak_dt = last_streak_dt
    streak_changed = False

    if logged_in_today:
        delta["logged_in_today"] = 1
        if last_streak_dt == today:
            # Already processed today — leave streak alone, but the
            # daily-login award check below still runs (defensive in
            # case the points write failed last run).
            pass
        elif last_streak_dt == yesterday:
            new_streak = current + 1
            new_last_streak_dt = today
            streak_changed = True
            delta["streak_incremented"] = 1
        else:
            # Either no prior streak or a gap of ≥ 2 days → fresh start.
            new_streak = 1
            new_last_streak_dt = today
            streak_changed = True
            if current > 0 and last_streak_dt is not None:
                delta["streak_broken"] = 1
            delta["streak_started"] = 1
    else:
        # Not logged in today. Reset to 0 if the last streak day was
        # more than 1 day ago (the user missed yesterday too).
        if last_streak_dt is not None and last_streak_dt < yesterday and current > 0:
            new_streak = 0
            new_last_streak_dt = last_streak_dt   # leave date as the last actual streak day
            streak_changed = True
            delta["streak_broken"] = 1
        # Else: still in their grace window (yesterday) — no-op.

    new_longest = max(longest, new_streak)

    if streak_changed:
        update_streak(str(uid), new_streak, new_longest, new_last_streak_dt, dry_run)
        time.sleep(SLEEP_BETWEEN_USERS)

    # Daily-login points — only when logged in today AND not already
    # awarded today. Idempotency via the points_transactions check.
    if logged_in_today and not has_daily_login_today(str(uid), today):
        pts = award_points(
            user_id=str(uid),
            action_type=DAILY_LOGIN_ACTION,
            notes="Daily login",
            offers_cache=offers_cache,
            fallback_points=DAILY_LOGIN_FALLBACK_POINTS,
            dry_run=dry_run,
        )
        if pts > 0:
            delta["daily_login_awarded"] = 1
            delta["daily_login_points"] = pts
        time.sleep(SLEEP_BETWEEN_USERS)

    # Milestone bonuses — only on streak_changed AND new_streak hits a
    # milestone AND the user has never received that milestone before.
    if streak_changed and new_streak in MILESTONES:
        action = MILESTONES[new_streak]
        if not has_milestone_ever(str(uid), action):
            pts = award_points(
                user_id=str(uid),
                action_type=action,
                notes=f"{new_streak}-day streak milestone",
                offers_cache=offers_cache,
                fallback_points=MILESTONE_FALLBACK_POINTS.get(action, 0),
                dry_run=dry_run,
            )
            if pts > 0:
                delta["milestone_hit"] = 1
                delta["milestone_points"] = pts
            time.sleep(SLEEP_BETWEEN_USERS)

    return delta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="preview without writing")
    args = parser.parse_args()
    dry_run = bool(args.dry_run)

    today = _today_utc()
    yesterday = today - timedelta(days=1)

    logger.info(f"calc_streaks.py — {'DRY RUN' if dry_run else 'LIVE RUN'} — today={today.isoformat()}")

    profiles = fetch_all_profiles()
    logger.info(f"Profiles fetched (is_active=True): {len(profiles)}")

    # Ensure user_points rows exist for every active profile.
    existing_uids = fetch_existing_points_user_ids()
    missing = [str(p["id"]) for p in profiles if p.get("id") and str(p["id"]) not in existing_uids]
    inserted = ensure_points_rows(missing, dry_run)
    logger.info(f"user_points rows ensured (inserted {inserted} new)")

    # Snapshot active offers ONCE so we don't fetch per-user.
    offers_cache = _fetch_active_offers()
    logger.info(f"Active points_offers cached: {len(offers_cache)}")

    counters = {
        "processed":            0,
        "logged_in_today":      0,
        "daily_login_awarded":  0,
        "daily_login_points":   0,
        "streak_incremented":   0,
        "streak_started":       0,
        "streak_broken":        0,
        "milestone_hit":        0,
        "milestone_points":     0,
        "errors":               0,
    }

    for p in profiles:
        if not p.get("id"):
            continue
        try:
            delta = process_user(p, today, yesterday, offers_cache, dry_run)
            for k in delta:
                counters[k] += delta[k]
            counters["processed"] += 1
        except Exception as exc:  # noqa: BLE001
            counters["errors"] += 1
            logger.error(f"process_user failed for {p.get('email') or p.get('id')}: {exc}")
        time.sleep(SLEEP_BETWEEN_USERS)

    logger.info("Summary")
    logger.info(f"  Users processed:           {counters['processed']}")
    logger.info(f"  Logged in today:           {counters['logged_in_today']}")
    logger.info(f"  Daily-login awards:        {counters['daily_login_awarded']}  ({counters['daily_login_points']} pts)")
    logger.info(f"  Streak incremented:        {counters['streak_incremented']}")
    logger.info(f"  Streak started fresh:      {counters['streak_started']}")
    logger.info(f"  Streak broken / reset:     {counters['streak_broken']}")
    logger.info(f"  Milestone bonuses awarded: {counters['milestone_hit']}  ({counters['milestone_points']} pts)")
    if counters["errors"]:
        logger.info(f"  Errors:                    {counters['errors']}")
    if dry_run:
        logger.info("(DRY RUN — nothing written.)")

    if counters.get("errors", 0) > 0:
        logger.warning(f"calc_streaks completed with {counters['errors']} errors")

    # Pipeline observability — same usage_events pattern other scripts use.
    if not dry_run:
        try:
            log_event(
                "calc_streaks_complete",
                {
                    "processed":           counters["processed"],
                    "logged_in_today":     counters["logged_in_today"],
                    "daily_login_awarded": counters["daily_login_awarded"],
                    "daily_login_points":  counters["daily_login_points"],
                    "streak_incremented":  counters["streak_incremented"],
                    "streak_started":      counters["streak_started"],
                    "streak_broken":       counters["streak_broken"],
                    "milestone_hit":       counters["milestone_hit"],
                    "milestone_points":    counters["milestone_points"],
                    "errors":              counters["errors"],
                    "date":                today.isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"log_event failed: {exc}")


if __name__ == "__main__":
    main()
