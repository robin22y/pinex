-- ════════════════════════════════════════════════════════════════════════
-- add_referral_visit_gate.sql
--
-- Anti-farm gate for the 100-pt referral_register award.
--
-- Why
--   The points_config row for referral_register already documents:
--     "Awarded once per referred user — frontend MUST gate on the
--      referred user having visited 3+ times (anti-farm)."
--   But the gate didn't exist anywhere — there was no visit counter on
--   profiles and no place in the codebase that fired the award. The
--   100 pts was theoretical.
--
--   Without a gate, the cheapest farm is: create N throwaway invites,
--   sign up with N throwaway emails, never come back, collect N × 100.
--   The 3-distinct-day rule turns each fake referral into a 3-day chore
--   while remaining invisible to real users.
--
-- What this migration ships
--   1. profiles.visit_count       (int, default 0)
--      profiles.last_visit_day    (date)
--      Both columns added IF NOT EXISTS so the migration is rerunnable.
--
--   2. record_visit_and_claim_referral() RPC — SECURITY DEFINER:
--        - Atomically bumps visit_count on the FIRST call per IST day
--          (subsequent same-day calls are no-ops, so spamming reload
--          doesn't farm the gate down to "3 reloads").
--        - If the new count is >= 3 AND the caller has an
--          invited_by_user in auth.users.raw_user_meta_data AND the
--          inviter hasn't been credited for this invitee yet, awards
--          100 pts (or the points_config value, whichever is set)
--          to the inviter and marks the matching invites row as
--          'accepted'.
--        - Idempotent: the points_transactions lookup keys on
--          (inviter_id, action_type='referral_register', notes
--          containing the invitee's UUID) so a re-run on day 4 won't
--          re-award.
--        - Returns the new visit_count + whether a claim happened, so
--          the frontend can emit a toast for the INVITER on the rare
--          coincidence they're online at the moment.
--
-- Trigger / event timeline
--   Day 1: invitee signs up via /invite/CODE → AuthContext IIFE fires
--           record_visit_and_claim_referral() → visit_count goes 0→1,
--           gate returns awarded=false reason=visits_lt_3.
--   Day 2: visit_count 1→2, same result.
--   Day 3: visit_count 2→3 → gate matches → inviter gets +100.
--
--   Within a single day, the IIFE is gated by the existing
--   pinex_session_active sessionStorage flag in AuthContext, so even
--   if the user navigates around, the RPC only fires once per browser
--   session. Doubly-safe given the in-RPC same-day check.
--
-- Timezone
--   The "distinct day" check uses Asia/Kolkata midnight, matching the
--   rest of the daily-economy (daily_login, streak rollovers).
--
-- Rollback
--   Drop the function. The visit_count + last_visit_day columns are
--   safe to leave behind even if the gate is reverted; they're just
--   integers and dates with no fan-out elsewhere.
--
-- Apply
--   Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS visit_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_visit_day date;

-- 2. RPC ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.record_visit_and_claim_referral();

CREATE OR REPLACE FUNCTION public.record_visit_and_claim_referral()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_today           date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_existing_day    date;
  v_count_before    integer;
  v_count_after     integer;
  v_inviter_id      uuid;
  v_invitee_email   text;
  v_cfg_value       integer;
  v_cfg_active      boolean;
  v_award_points    integer;
  v_already_awarded boolean;
BEGIN
  -- Auth gate ───────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_signed_in');
  END IF;

  -- Read current state. Lock the row so two near-simultaneous calls
  -- from different tabs don't both bump the counter.
  SELECT COALESCE(visit_count, 0), last_visit_day
    INTO v_count_before, v_existing_day
    FROM public.profiles
   WHERE id = v_uid
   FOR UPDATE;

  -- Same-day call → don't bump. This is the load-bearing line: the
  -- "3 visits" gate counts DISTINCT DAYS, not reloads. Without this
  -- a fake invitee could open the app three times in a minute and
  -- pop the gate.
  IF v_existing_day IS NOT NULL AND v_existing_day >= v_today THEN
    v_count_after := v_count_before;
  ELSE
    v_count_after := v_count_before + 1;
    UPDATE public.profiles
       SET visit_count    = v_count_after,
           last_visit_day = v_today
     WHERE id = v_uid;
  END IF;

  -- Below the 3-visit gate → nothing to claim. Return the new count so
  -- the frontend can show a progress hint if it ever wants to.
  IF v_count_after < 3 THEN
    RETURN jsonb_build_object(
      'visit_count', v_count_after,
      'awarded',     false,
      'reason',      'visits_lt_3'
    );
  END IF;

  -- Resolve inviter from the auth.users metadata stamped by
  -- accept-invite.js. The metadata is set at invite-email time and
  -- survives the signup, so it's available on day 1 already.
  SELECT (raw_user_meta_data->>'invited_by_user')::uuid, email
    INTO v_inviter_id, v_invitee_email
    FROM auth.users
   WHERE id = v_uid;

  IF v_inviter_id IS NULL THEN
    RETURN jsonb_build_object(
      'visit_count', v_count_after,
      'awarded',     false,
      'reason',      'no_inviter'
    );
  END IF;

  -- Idempotency: have we already awarded this referral?
  -- Key off the invitee UUID in `notes` — clean, no extra column,
  -- searchable from the admin log.
  SELECT EXISTS (
    SELECT 1 FROM public.points_transactions
     WHERE user_id     = v_inviter_id
       AND action_type = 'referral_register'
       AND notes LIKE  '%invitee:' || v_uid::text || '%'
  ) INTO v_already_awarded;

  IF v_already_awarded THEN
    RETURN jsonb_build_object(
      'visit_count', v_count_after,
      'awarded',     false,
      'reason',      'already_awarded',
      'inviter_id',  v_inviter_id
    );
  END IF;

  -- Resolve the points amount from config (so the rebalance script
  -- can re-tune without touching this RPC). Fall back to 100, which
  -- is the published value if config has been deactivated.
  SELECT points_value, is_active
    INTO v_cfg_value, v_cfg_active
    FROM public.points_config
   WHERE action_type = 'referral_register'
   LIMIT 1;

  IF v_cfg_active IS TRUE AND v_cfg_value IS NOT NULL AND v_cfg_value > 0 THEN
    v_award_points := v_cfg_value;
  ELSE
    v_award_points := 100;
  END IF;

  -- Award to the INVITER (not the caller). SECURITY DEFINER lets us
  -- bypass the RLS that would otherwise block one user from inserting
  -- into another's points ledger.
  INSERT INTO public.points_transactions (user_id, points, action_type, notes)
  VALUES (
    v_inviter_id,
    v_award_points,
    'referral_register',
    'invitee:' || v_uid::text
  );

  INSERT INTO public.user_points (user_id, total_points, lifetime_points, updated_at)
  VALUES (v_inviter_id, v_award_points, v_award_points, now())
  ON CONFLICT (user_id) DO UPDATE
    SET total_points    = public.user_points.total_points    + EXCLUDED.total_points,
        lifetime_points = public.user_points.lifetime_points + EXCLUDED.lifetime_points,
        updated_at      = now();

  -- Close out the invite row so the admin UI shows it as accepted
  -- and the inviter's "credits remaining" view is honest. Match on
  -- (inviter_id, invitee_email) — both columns are populated by
  -- InviteAccept.jsx at invite time.
  UPDATE public.invites
     SET status = 'accepted'
   WHERE inviter_id = v_inviter_id
     AND lower(invitee_email) = lower(v_invitee_email)
     AND status = 'pending';

  RETURN jsonb_build_object(
    'visit_count', v_count_after,
    'awarded',     true,
    'points',      v_award_points,
    'inviter_id',  v_inviter_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_visit_and_claim_referral() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_visit_and_claim_referral() FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_visit_and_claim_referral() TO authenticated;
