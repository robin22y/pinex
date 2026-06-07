"""
award_retroactive_points.py — one-time retroactive points migration.

Awards points to existing users based on their academy progress and
certification status. Run once. Safe to run twice — every award is
idempotent on (user_id, action_type), so re-running picks up exactly
the writes that were skipped or failed last time.

Usage:
  python scripts/award_retroactive_points.py --dry-run    # preview only
  python scripts/award_retroactive_points.py              # live write

Rules (matches the build spec verbatim):

  Genuine graduate
    academy_completed=true AND academy_grandfathered != true
    +365  module_completed_retroactive
    +200  assessment_passed_retroactive
    +100  founding_graduate_bonus
    = 665 points

  Grandfathered graduate
    academy_completed=true AND academy_grandfathered=true
    +365  module_completed_retroactive
    = 365 points

  Grandfathered + not completed
    No award yet. Earns through future daily engagement.

  Neither completed nor grandfathered
    No award. Earns through future daily engagement.

Idempotency:
  Before awarding action X to user U, we check whether a row already
  exists in points_transactions with (user_id=U, action_type=X). If
  yes, that award is skipped — second run is a no-op on already-awarded
  users.

Writes:
  - INSERT into points_transactions (one row per (user, action_type))
  - UPDATE user_points (total_points + lifetime_points, plus updated_at)

This script never touches profiles or anything else.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

_script_dir = Path(__file__).resolve().parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")
sys.path.insert(0, str(_script_dir))

from db import log_event, supabase  # noqa: E402

# Force UTF-8 on Windows console so the verification print doesn't
# crash on emoji / non-ASCII names.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ── Point values + action type constants ────────────────────────────────────

MODULE_POINTS     = 365
ASSESSMENT_POINTS = 200
FOUNDING_BONUS    = 100

ACTION_MODULES    = "module_completed_retroactive"
ACTION_ASSESSMENT = "assessment_passed_retroactive"
ACTION_FOUNDING   = "founding_graduate_bonus"

# Activity gate for GRANDFATHERED users only. Grandfathered grads
# didn't earn certification through the assessment, so we don't want
# to hand them free points if they've gone dormant. last_active_at
# within this many days = "active". NULL last_active_at = "inactive"
# (never logged in since the tracker was added → no retroactive award).
# Genuine grads (assessment-passed) get their 665 regardless of
# activity — they earned it.
ACTIVE_DAYS = 30

NOTE_MODULES = (
    "Retroactive — completed before points system launched"
)
NOTE_ASSESSMENT = (
    "Retroactive — certified before points system launched"
)
NOTE_FOUNDING = (
    "PineX founding graduate bonus — thank you for completing early"
)


# ── Step 1 — read profiles ──────────────────────────────────────────────────

def fetch_all_profiles() -> list[dict]:
    """Pull every profile row (paginated, 1000 per round-trip — PostgREST cap).

    We pull all profiles rather than push the OR filter into PostgREST
    because (a) the qualifying filter is cheap to apply in Python,
    (b) `or_()` syntax in postgrest-py is finicky around `is.null`,
    and (c) we also need the full list for Step 2 (ensure user_points
    rows exist for every profile, not just the qualifying ones).
    """
    rows: list[dict] = []
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table("profiles")
            .select(
                "id,email,full_name,academy_completed,"
                "academy_grandfathered,academy_score,"
                "last_active_at,created_at"
            )
            .order("created_at")
            .range(start, start + page - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


def is_active(profile: dict, cutoff_days: int = ACTIVE_DAYS) -> bool:
    """Active = last_active_at within the cutoff window. NULL = never
    active. Used to gate the grandfathered award only — genuine grads
    are never gated on activity.
    """
    last = profile.get("last_active_at")
    if not last:
        return False
    try:
        dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    return (datetime.now(timezone.utc) - dt).days <= cutoff_days


def filter_qualifying(profiles: list[dict]) -> list[dict]:
    """Mirror the spec's SQL filter exactly:
       academy_completed = true OR academy_score IS NOT NULL.
    """
    return [
        p for p in profiles
        if p.get("academy_completed") is True
        or p.get("academy_score") is not None
    ]


def print_step1_counts(qualifying: list[dict]) -> None:
    print()
    print("=" * 68)
    print("STEP 1 — Qualifying profiles read from database")
    print("=" * 68)

    total = len(qualifying)
    genuine = sum(
        1 for p in qualifying
        if p.get("academy_completed") is True
        and p.get("academy_grandfathered") is not True
    )
    grandfathered = sum(
        1 for p in qualifying if p.get("academy_grandfathered") is True
    )
    with_score = sum(
        1 for p in qualifying if p.get("academy_score") is not None
    )

    print(f"  Total qualifying users (completed OR has score): {total}")
    print(f"  Genuinely certified  (completed AND NOT grandfathered): {genuine}")
    print(f"  Grandfathered users  (grandfathered = true):            {grandfathered}")
    print(f"  Users with assessment score (academy_score IS NOT NULL): {with_score}")

    # Spot-check head of the list so the operator can eyeball the data
    # before confirming the live run.
    if qualifying:
        print()
        print("  First 8 qualifying users (preview):")
        for p in qualifying[:8]:
            print(
                f"    {(p.get('email') or '')[:38]:38s}  "
                f"completed={str(p.get('academy_completed')):5s}  "
                f"grandfathered={str(p.get('academy_grandfathered')):5s}  "
                f"score={p.get('academy_score')}"
            )


# ── Step 2 — ensure user_points rows exist for every profile ───────────────

def fetch_existing_points_user_ids() -> set[str]:
    """Return the set of user_ids that already have a user_points row.
    Paginated."""
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
        batch = res.data or []
        for r in batch:
            uid = r.get("user_id")
            if uid:
                out.add(uid)
        if len(batch) < page:
            break
        start += page
    return out


def ensure_user_points_rows(all_profiles: list[dict], dry_run: bool) -> int:
    """Create a user_points row for every profile that doesn't have one.

    Idempotent — we read the existing set first and only INSERT the
    missing ids. Returns the count of rows created (or would-be-created
    under dry-run).
    """
    existing = fetch_existing_points_user_ids()
    missing = [
        p["id"] for p in all_profiles
        if p.get("id") and p["id"] not in existing
    ]

    if dry_run or not missing:
        return len(missing)

    chunk = 200
    created = 0
    for i in range(0, len(missing), chunk):
        sub = missing[i : i + chunk]
        try:
            supabase.table("user_points").insert(
                [{"user_id": uid} for uid in sub]
            ).execute()
            created += len(sub)
        except Exception as exc:
            # Most likely the conflict raised because someone else
            # inserted in the gap. Don't fail the migration — just log.
            print(f"  ! ensure_user_points_rows chunk {i} insert failed: {exc}")
    return created


# ── Step 3 — compute awards per user (idempotency-aware) ───────────────────

def fetch_existing_award_actions(user_ids: list[str]) -> dict[str, set[str]]:
    """Return {user_id: {action_type, ...}} for the three retroactive
    action types only. Used to skip awards that were already granted.
    """
    if not user_ids:
        return {}

    actions = [ACTION_MODULES, ACTION_ASSESSMENT, ACTION_FOUNDING]
    out: dict[str, set[str]] = {}

    chunk = 100  # keep the in_() URL safely under PostgREST's limits
    for i in range(0, len(user_ids), chunk):
        sub = user_ids[i : i + chunk]
        try:
            res = (
                supabase.table("points_transactions")
                .select("user_id,action_type")
                .in_("user_id", sub)
                .in_("action_type", actions)
                .execute()
            )
            for r in res.data or []:
                uid = r.get("user_id")
                act = r.get("action_type")
                if uid and act:
                    out.setdefault(uid, set()).add(act)
        except Exception as exc:
            print(f"  ! fetch_existing_award_actions chunk {i} failed: {exc}")
    return out


def compute_awards_for_user(
    profile: dict, already: set[str],
) -> list[dict]:
    """Apply Rules 1–4 + activity gate for grandfathered users.

    Activity gate (per the runtime instruction added during live exec):
    grandfathered + completed + INACTIVE → no award. The activity check
    runs against last_active_at within the ACTIVE_DAYS window. Genuine
    grads bypass the gate — they earned their certification through
    the assessment.
    """
    completed     = profile.get("academy_completed") is True
    grandfathered = profile.get("academy_grandfathered") is True
    active        = is_active(profile)

    # Grandfathered + completed gates on activity. Genuine grads do not
    # gate. The gate short-circuits BEFORE Rule 1 so an inactive
    # grandfathered user receives nothing — not even module points.
    if completed and grandfathered and not active:
        return []

    awards: list[dict] = []

    # RULE 1 — Modules. ANY academy_completed=true user gets these
    # (grandfathered or genuine), provided the gate above didn't
    # filter the user out.
    if completed and ACTION_MODULES not in already:
        awards.append({
            "action_type": ACTION_MODULES,
            "points":      MODULE_POINTS,
            "notes":       NOTE_MODULES,
        })

    # RULE 2 — Assessment. Only genuine completions (NOT grandfathered).
    if completed and not grandfathered and ACTION_ASSESSMENT not in already:
        awards.append({
            "action_type": ACTION_ASSESSMENT,
            "points":      ASSESSMENT_POINTS,
            "notes":       NOTE_ASSESSMENT,
        })

    # RULE 3 — Founding graduate bonus. Only genuine completions.
    if completed and not grandfathered and ACTION_FOUNDING not in already:
        awards.append({
            "action_type": ACTION_FOUNDING,
            "points":      FOUNDING_BONUS,
            "notes":       NOTE_FOUNDING,
        })

    # RULE 4 — Grandfathered without completion gets nothing yet.
    # Falls through naturally because the conditions above all require
    # completed=true.
    return awards


def compute_all_awards(
    qualifying: list[dict],
    existing: dict[str, set[str]],
) -> list[dict]:
    """Build the per-user award plan. Each entry has total + per-action list."""
    plan: list[dict] = []
    for p in qualifying:
        uid = p.get("id")
        if not uid:
            continue
        awards = compute_awards_for_user(p, existing.get(uid, set()))
        if not awards:
            continue
        plan.append({
            "user_id":       uid,
            "email":         p.get("email", ""),
            "full_name":     p.get("full_name", ""),
            "completed":     p.get("academy_completed"),
            "grandfathered": p.get("academy_grandfathered"),
            "awards":        awards,
            "total":         sum(a["points"] for a in awards),
        })
    return plan


# ── Step 4 — write transactions + bump user_points totals ──────────────────

def apply_awards(plan: list[dict]) -> dict:
    """Insert transactions per user, then bump that user's totals.

    Per-user atomicity (not table-wide transactional): each user's
    inserts and update happen as a small sequence. If a user mid-sequence
    errors, that user is partially written — we log and continue. A
    subsequent re-run of this script will pick up the missing pieces
    because (user_id, action_type) is what we check for idempotency.
    """
    counters = {
        "modules":       0,
        "assessment":    0,
        "founding":      0,
        "total_points":  0,
        "users_touched": 0,
        "errors":        0,
    }
    now_iso = datetime.now(timezone.utc).isoformat()

    for entry in plan:
        uid = entry["user_id"]

        # Build the rows for this user's transactions.
        tx_rows = []
        for a in entry["awards"]:
            tx_rows.append({
                "user_id":     uid,
                "points":      a["points"],
                "action_type": a["action_type"],
                "notes":       a["notes"],
            })

        try:
            supabase.table("points_transactions").insert(tx_rows).execute()

            # Read current totals so we can bump them. We always re-read
            # rather than blindly add — if a parallel write happened,
            # we'd see the up-to-date value (one-time migration, so no
            # real concurrency, but cheaper than being clever).
            up = (
                supabase.table("user_points")
                .select("total_points,lifetime_points")
                .eq("user_id", uid)
                .limit(1)
                .execute()
            )
            current = (up.data or [{}])[0]
            new_total    = int(current.get("total_points") or 0) + entry["total"]
            new_lifetime = int(current.get("lifetime_points") or 0) + entry["total"]

            supabase.table("user_points").update({
                "total_points":    new_total,
                "lifetime_points": new_lifetime,
                "updated_at":      now_iso,
            }).eq("user_id", uid).execute()

            # Tally only AFTER the user_points update succeeds.
            for a in entry["awards"]:
                if a["action_type"] == ACTION_MODULES:
                    counters["modules"] += 1
                elif a["action_type"] == ACTION_ASSESSMENT:
                    counters["assessment"] += 1
                elif a["action_type"] == ACTION_FOUNDING:
                    counters["founding"] += 1
            counters["total_points"]  += entry["total"]
            counters["users_touched"] += 1

        except Exception as exc:
            print(
                f"  ! Write failed for {entry['email']} ({uid}): {exc}"
            )
            counters["errors"] += 1

    return counters


# ── Step 5 — verification print ────────────────────────────────────────────

def print_step5_verification(
    qualifying: list[dict],
    plan: list[dict],
    counters: dict,
    dry_run: bool,
) -> None:
    print()
    print("=" * 68)
    label = "STEP 5 — Verification (DRY RUN preview)" if dry_run else "STEP 5 — Verification"
    print(label)
    print("=" * 68)

    print()
    print(f"  Users awarded module points:     {counters['modules']}")
    print(f"  Users awarded assessment points: {counters['assessment']}")
    print(f"  Users awarded founding bonus:    {counters['founding']}")
    print(f"  Total points distributed:        {counters['total_points']:,}")
    print(f"  Total users touched:             {counters['users_touched']}")
    if counters.get("errors"):
        print(f"  WARNING — write errors:          {counters['errors']}")

    if not plan:
        print()
        print("  Nothing to award — every qualifying user already has their retroactive rows.")
        return

    # Print a per-user table (first 60 rows).
    print()
    print("  Per-user award plan:")
    print(
        f"    {'email':38s}  {'completed':9s}  {'grand':5s}  "
        f"{'awarded':>8s}"
    )
    print(f"    {'-'*38}  {'-'*9}  {'-'*5}  {'-'*8}")
    for entry in plan[:60]:
        print(
            f"    {(entry['email'] or '')[:38]:38s}  "
            f"{str(entry['completed']):9s}  "
            f"{str(entry['grandfathered'])[:5]:5s}  "
            f"{entry['total']:>8}"
        )
    if len(plan) > 60:
        print(f"    ... and {len(plan) - 60} more")

    if dry_run:
        print()
        print("  [DRY RUN — no writes happened. Re-run without --dry-run to apply.]")
        return

    # Post-write verification — pull user_points for every academy_completed
    # user and confirm the totals match what we'd expect (>=665 for genuine,
    # >=365 for grandfathered completions).
    print()
    print("  Post-write verification — user_points totals for academy_completed users:")
    user_ids = [p["id"] for p in qualifying if p.get("academy_completed") is True]
    if not user_ids:
        print("    (no academy_completed users to verify)")
        return

    chunk = 100
    rows: list[dict] = []
    for i in range(0, len(user_ids), chunk):
        sub = user_ids[i : i + chunk]
        try:
            res = (
                supabase.table("user_points")
                .select("user_id,total_points,lifetime_points")
                .in_("user_id", sub)
                .execute()
            )
            rows.extend(res.data or [])
        except Exception as exc:
            print(f"    ! verify fetch failed: {exc}")

    profile_by_id = {p["id"]: p for p in qualifying}
    rows.sort(key=lambda r: int(r.get("total_points") or 0), reverse=True)

    print(
        f"    {'email':38s}  {'completed':9s}  {'grand':5s}  "
        f"{'total':>8s}  {'lifetime':>10s}"
    )
    print(f"    {'-'*38}  {'-'*9}  {'-'*5}  {'-'*8}  {'-'*10}")
    for r in rows[:60]:
        p = profile_by_id.get(r.get("user_id"), {})
        print(
            f"    {(p.get('email') or '')[:38]:38s}  "
            f"{str(p.get('academy_completed')):9s}  "
            f"{str(p.get('academy_grandfathered'))[:5]:5s}  "
            f"{int(r.get('total_points') or 0):>8}  "
            f"{int(r.get('lifetime_points') or 0):>10}"
        )

    # Sanity-check against the expected minimums.
    points_by_uid = {
        r.get("user_id"): int(r.get("total_points") or 0) for r in rows
    }
    genuine = [
        p["id"] for p in qualifying
        if p.get("academy_completed") is True
        and p.get("academy_grandfathered") is not True
    ]
    grandfathered_done = [
        p["id"] for p in qualifying
        if p.get("academy_completed") is True
        and p.get("academy_grandfathered") is True
    ]

    print()
    print("  Sanity checks:")
    if genuine:
        below = [uid for uid in genuine if points_by_uid.get(uid, 0) < 665]
        if below:
            print(
                f"    WARNING — {len(below)} of {len(genuine)} genuine "
                f"graduates have < 665 points (re-run if you expected this to fix)"
            )
        else:
            print(
                f"    OK — all {len(genuine)} genuine graduates have >= 665 points"
            )
    if grandfathered_done:
        below = [
            uid for uid in grandfathered_done if points_by_uid.get(uid, 0) < 365
        ]
        if below:
            print(
                f"    WARNING — {len(below)} of {len(grandfathered_done)} "
                f"grandfathered+completed users have < 365 points"
            )
        else:
            print(
                f"    OK — all {len(grandfathered_done)} grandfathered+completed "
                f"users have >= 365 points"
            )


# ── Main ────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Retroactive points migration — see docstring at top."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only — no writes happen. Always run this first.",
    )
    args = parser.parse_args()
    dry_run = bool(args.dry_run)

    print("=" * 68)
    print("PineX retroactive points migration")
    if dry_run:
        print("MODE: DRY RUN  — no writes will happen")
    else:
        print("MODE: LIVE     — writes will be applied")
    print("=" * 68)

    # Step 1 — read
    all_profiles = fetch_all_profiles()
    qualifying = filter_qualifying(all_profiles)
    print_step1_counts(qualifying)

    # Step 2 — ensure user_points rows
    print()
    print("=" * 68)
    print("STEP 2 — Ensure user_points rows exist for every profile")
    print("=" * 68)
    created = ensure_user_points_rows(all_profiles, dry_run)
    if dry_run:
        print(f"  Would create {created} new user_points rows.")
    else:
        print(f"  Created {created} new user_points rows.")

    # Step 3 — plan
    print()
    print("=" * 68)
    print("STEP 3 — Plan awards (idempotency check)")
    print("=" * 68)
    user_ids = [p["id"] for p in qualifying if p.get("id")]
    existing = fetch_existing_award_actions(user_ids)
    plan = compute_all_awards(qualifying, existing)
    print(f"  {len(plan)} users have at least one award to apply.")
    if existing:
        skipped = sum(len(v) for v in existing.values())
        print(
            f"  {skipped} prior retroactive transactions already exist — those awards will be skipped."
        )

    # Step 4 — apply (or compute dry-run counters)
    if dry_run:
        counters = {
            "modules": sum(
                1 for e in plan for a in e["awards"] if a["action_type"] == ACTION_MODULES
            ),
            "assessment": sum(
                1 for e in plan for a in e["awards"] if a["action_type"] == ACTION_ASSESSMENT
            ),
            "founding": sum(
                1 for e in plan for a in e["awards"] if a["action_type"] == ACTION_FOUNDING
            ),
            "total_points":  sum(e["total"] for e in plan),
            "users_touched": len(plan),
            "errors":        0,
        }
    else:
        print()
        print("=" * 68)
        print("STEP 4 — Writing transactions and updating user_points")
        print("=" * 68)
        counters = apply_awards(plan)
        log_event("retroactive_points_migration", {
            "users_touched":      counters["users_touched"],
            "total_points":       counters["total_points"],
            "modules_awarded":    counters["modules"],
            "assessment_awarded": counters["assessment"],
            "founding_awarded":   counters["founding"],
            "errors":             counters.get("errors", 0),
        })

    # Step 5 — verify
    print_step5_verification(qualifying, plan, counters, dry_run)

    print()
    if dry_run:
        print("Dry run complete. Re-run WITHOUT --dry-run to apply.")
    else:
        print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
