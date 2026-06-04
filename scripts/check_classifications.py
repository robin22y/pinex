"""
check_classifications.py — nightly confirmation pass

For every unconfirmed user_classifications row, pulls the symbol's
swing_conditions history since classified_at and applies a phase-
specific confirmation rule. On confirmation: updates the row
(was_correct, days_to_confirmation, etc) and inserts a row into
pending_wow_moments so the frontend can celebrate the user once.
On 45-day expiry: marks the row was_correct=false but writes no
wow moment.

Confirmation rules (per user spec):

  Advancing — confirmed on the first day inside the 45-day window
              where conditions_met >= 4.

  Topping   — confirmed on the first day inside the 45-day window
              where conditions_met <= 2.

  Basing    — confirmed when conditions_met < 3 for at least 14
              CONSECUTIVE days within the 45-day window. Confirmed
              at the END of the 14-day streak.

  Declining — confirmed when conditions_met <= 2 for at least 14
              CONSECUTIVE days within the 45-day window.

was_early:  the user called the phase BEFORE the criteria supported
            it. Per-phase definition:
              Advancing  — criteria_score_at_classification < 4
              Topping    — criteria_score_at_classification > 2
              Basing     — criteria_score_at_classification >= 3
              Declining  — criteria_score_at_classification > 2
            Null score → treated as "early" (we have no proof
            otherwise).

Expiry:     after 45 calendar days with no confirmation, the row is
            marked was_correct=false, included_in_accuracy=true.
            No wow moment.

Lag:        we don't check rows classified in the LAST 3 days —
            there isn't enough fresh data to evaluate yet, so it's
            wasted DB work.

Usage:
  python scripts/check_classifications.py
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

sys.path.insert(0, str(_script_dir))
from db import log_event, supabase  # noqa: E402


# ── Tunables ─────────────────────────────────────────────────────

EXPIRY_DAYS = 45         # past this with no confirmation → expired
SUSTAINED_DAYS = 14      # consecutive-day window for Basing/Declining
LAG_DAYS = 3             # skip rows classified less than this ago
PAGE_SIZE = 1000


# ── Per-phase rules ──────────────────────────────────────────────
# Each rule has:
#   eval_fn(history) -> {day_index, score} OR None
#   was_early_fn(score_at_classification) -> bool
# eval_fn walks the (already-windowed) history in trading-date order
# and returns the index of the day the call was confirmed.

def _eval_first_hit(history, predicate):
    """First day where predicate(conditions_met) is true. Used by
    Advancing + Topping where ANY day in window confirms."""
    for i, row in enumerate(history):
        s = row.get("conditions_met")
        if s is None:
            continue
        if predicate(s):
            return {"day_index": i, "score": s}
    return None


def _eval_sustained(history, predicate, length):
    """Predicate must hold for `length` consecutive days. Confirms
    on the day the streak completes (so days_to_confirmation =
    classified→streak-end span). NULL conditions_met breaks the
    streak — we don't extrapolate over missing data."""
    streak = 0
    for i, row in enumerate(history):
        s = row.get("conditions_met")
        if s is None:
            streak = 0
            continue
        if predicate(s):
            streak += 1
            if streak >= length:
                return {"day_index": i, "score": s}
        else:
            streak = 0
    return None


PHASE_RULES: dict[str, tuple[Callable, Callable]] = {
    "Advancing": (
        lambda h: _eval_first_hit(h, lambda s: s >= 4),
        lambda score: score is None or score < 4,
    ),
    "Topping": (
        lambda h: _eval_first_hit(h, lambda s: s <= 2),
        lambda score: score is None or score > 2,
    ),
    "Basing": (
        lambda h: _eval_sustained(h, lambda s: s < 3, SUSTAINED_DAYS),
        lambda score: score is None or score >= 3,
    ),
    "Declining": (
        lambda h: _eval_sustained(h, lambda s: s <= 2, SUSTAINED_DAYS),
        lambda score: score is None or score > 2,
    ),
}


# ── Helpers ──────────────────────────────────────────────────────

def _parse_ts(iso: str) -> datetime:
    """Tolerant timestamp parser — handles Z-suffix + timezone-aware
    strings emitted by Supabase / Postgres."""
    if not iso:
        return None
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))


def _days_between(iso_classified: str, iso_or_date_then) -> int:
    """Calendar-day diff between classification and confirmation
    timestamps. Tolerant of either ISO timestamp strings or pure
    date strings (swing_conditions.trading_date is a date)."""
    a = _parse_ts(iso_classified)
    b = (_parse_ts(iso_or_date_then) if isinstance(iso_or_date_then, str)
         else iso_or_date_then)
    if not a or not b:
        return 0
    return max(0, (b.date() - a.date()).days)


# ── Data fetchers ────────────────────────────────────────────────

def fetch_pending_classifications() -> list[dict]:
    """All unconfirmed rows classified more than LAG_DAYS ago."""
    cutoff = (datetime.utcnow() - timedelta(days=LAG_DAYS)).isoformat()
    rows: list[dict] = []
    offset = 0
    while True:
        try:
            res = (
                supabase.table("user_classifications")
                .select(
                    "id, user_id, symbol, company_id, classified_phase, "
                    "classification, classified_at, "
                    "criteria_score_at_classification"
                )
                .is_("confirmed_at", "null")
                .lte("classified_at", cutoff)
                .order("classified_at")
                .range(offset, offset + PAGE_SIZE - 1)
                .execute()
            )
        except Exception as exc:
            print(f"  ! fetch error at offset {offset}: {exc}")
            break
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def fetch_history(symbol: str, since_date: str) -> list[dict]:
    """Trading-date-ordered swing_conditions for `symbol` from
    `since_date` (inclusive) onward. Capped at EXPIRY_DAYS + 30
    rows for safety; we only look at the first EXPIRY_DAYS for
    confirmation anyway."""
    try:
        res = (
            supabase.table("swing_conditions")
            .select("trading_date, conditions_met")
            .eq("symbol", symbol)
            .gte("trading_date", since_date)
            .order("trading_date")
            .limit(EXPIRY_DAYS + 30)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        print(f"  ! history fetch for {symbol} failed: {exc}")
        return []


def fetch_company_name(company_id: str | None) -> str | None:
    """Best-effort name lookup for the wow moment row. Falls back to
    None on any failure — the row's `symbol` is the durable
    identifier; `company_name` is just display sugar."""
    if not company_id:
        return None
    try:
        res = (
            supabase.table("companies")
            .select("name")
            .eq("id", company_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0]["name"] if rows else None
    except Exception:
        return None


# ── Decision per row ─────────────────────────────────────────────

def evaluate(row: dict, history: list[dict]) -> dict:
    """Decide what happens to a single classification row.

    Returns one of:
      {"action": "confirm", day_index, score}
      {"action": "expire"}
      {"action": "pending"}   # not yet confirmed, not yet expired
      {"action": "skip", reason}  # malformed / no rule
    """
    phase = row.get("classified_phase") or row.get("classification")
    rule = PHASE_RULES.get(phase)
    if not rule:
        return {"action": "skip", "reason": f"no rule for phase={phase!r}"}
    eval_fn, _ = rule

    # Restrict to the 45-day window (history may include extra rows
    # because we fetched a slightly larger buffer).
    window = history[:EXPIRY_DAYS]
    result = eval_fn(window)
    if result:
        return {
            "action": "confirm",
            "day_index": result["day_index"],
            "score": result["score"],
        }

    # No confirmation in the window. Has the row aged past 45 days?
    classified = _parse_ts(row["classified_at"])
    if classified is None:
        return {"action": "skip", "reason": "unparseable classified_at"}
    age_days = (datetime.utcnow() - classified.replace(tzinfo=None)).days
    if age_days >= EXPIRY_DAYS:
        return {"action": "expire"}
    return {"action": "pending"}


# ── Main ────────────────────────────────────────────────────────

def main() -> int:
    print(f"[check_classifications] start {datetime.utcnow().isoformat()}")
    log_event("check_classifications_started", {})

    candidates = fetch_pending_classifications()
    print(f"[check_classifications] {len(candidates)} unconfirmed candidate{'s' if len(candidates) != 1 else ''}")

    confirmed_count = 0
    expired_count = 0
    pending_count = 0
    skipped_count = 0
    errors = 0
    started = time.time()
    now_iso = datetime.utcnow().isoformat()

    for i, row in enumerate(candidates, start=1):
        try:
            classified_at_iso = row["classified_at"]
            classified_date = _parse_ts(classified_at_iso).date().isoformat()
            phase = row.get("classified_phase") or row.get("classification")
            history = fetch_history(row["symbol"], classified_date)
            verdict = evaluate(row, history)

            if verdict["action"] == "confirm":
                conf_row = history[verdict["day_index"]]
                conf_date = conf_row["trading_date"]
                score_at_conf = verdict["score"]
                days_elapsed = _days_between(classified_at_iso, conf_date)
                score_at_cls = row.get("criteria_score_at_classification")
                _, was_early_fn = PHASE_RULES[phase]
                was_early = bool(was_early_fn(score_at_cls))

                # Mark the classification confirmed.
                supabase.table("user_classifications").update({
                    "confirmed_at": now_iso,
                    "confirmed_phase": phase,
                    "criteria_score_at_confirmation": score_at_conf,
                    "days_to_confirmation": days_elapsed,
                    "was_correct": True,
                    "included_in_accuracy": True,
                }).eq("id", row["id"]).execute()

                # Insert the wow moment for the frontend to celebrate.
                supabase.table("pending_wow_moments").insert({
                    "user_id": row["user_id"],
                    "classification_id": row["id"],
                    "symbol": row["symbol"],
                    "company_name": fetch_company_name(row.get("company_id")),
                    "classified_phase": phase,
                    "classified_at": classified_at_iso,
                    "criteria_score_at_classification": score_at_cls,
                    "criteria_score_now": score_at_conf,
                    "days_elapsed": days_elapsed,
                    "was_early": was_early,
                }).execute()

                confirmed_count += 1
                early_tag = " (early)" if was_early else ""
                print(f"  [{i}/{len(candidates)}] ✓ {row['symbol']} {phase} confirmed in {days_elapsed}d{early_tag}")

            elif verdict["action"] == "expire":
                supabase.table("user_classifications").update({
                    "confirmed_at": now_iso,
                    "confirmed_phase": None,
                    "was_correct": False,
                    "included_in_accuracy": True,
                }).eq("id", row["id"]).execute()
                expired_count += 1
                print(f"  [{i}/{len(candidates)}] · {row['symbol']} {phase} expired")

            elif verdict["action"] == "skip":
                skipped_count += 1
                print(f"  [{i}/{len(candidates)}] ? {row.get('symbol', '?')} skipped — {verdict.get('reason', 'unknown')}")

            else:
                pending_count += 1

            time.sleep(0.1)
        except Exception as exc:
            errors += 1
            print(f"  ! [{i}/{len(candidates)}] {row.get('symbol', '?')}: {exc}")

    elapsed = round(time.time() - started, 1)
    print(
        f"[check_classifications] done — checked={len(candidates)} "
        f"confirmed={confirmed_count} expired={expired_count} "
        f"pending={pending_count} skipped={skipped_count} "
        f"errors={errors} elapsed={elapsed}s"
    )
    log_event("check_classifications_finished", {
        "checked": len(candidates),
        "confirmed": confirmed_count,
        "expired": expired_count,
        "pending": pending_count,
        "skipped": skipped_count,
        "errors": errors,
        "elapsed_sec": elapsed,
    })
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
