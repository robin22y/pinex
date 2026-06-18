-- ── admin_award_points + admin_deduct_points ────────────────────────────
-- Server-side bulk point operations for the admin PointsManager UI.
--
-- SCHEMA NOTE — this codebase already runs on:
--   • points_transactions(user_id, points, action_type, notes, ...)
--   • user_points(user_id, total_points, lifetime_points, ...)
--
-- The user's brief referenced point_events + profiles.points_balance. Those
-- DO NOT exist in this DB (probed against live Supabase). All existing
-- earning paths — awardPoints() in src/lib/pointsAwarder.js, the welcome
-- bonus, streak bonuses, academy modules, and the per-user admin bonus in
-- src/pages/admin/AdminPoints.jsx — write to the two tables above. This
-- migration keeps that contract.
--
-- WHY SERVER-SIDE — a "give all 2,125 users +50 points" operation done from
-- the browser would be 2 * 2,125 = 4,250 round trips. A single RPC call
-- batches both the INSERT into points_transactions and the UPDATE on
-- user_points server-side. Frontend stays a single supabase.rpc() call.
--
-- AUTH MODEL — both functions verify `auth.email()` matches the
-- ADMIN_EMAIL hardcoded inside the function body. Email allowlist matches
-- the existing src/lib/isAdmin.js check, so a UI bypass attempt still
-- fails the server check. SECURITY DEFINER bypasses RLS on the target
-- tables; the email gate is what keeps the function safe.
--
-- IDEMPOTENCE — both functions are NOT idempotent: re-running an award
-- gives N more points. That's the desired behaviour for "Award everyone
-- +50 for the launch" — the admin chooses when to fire. The activity log
-- (read from points_transactions where action_type IN ('admin_award',
-- 'admin_deduct')) surfaces duplicate fires.

-- Drop any prior versions so signature changes don't collide.
DROP FUNCTION IF EXISTS public.admin_award_points(uuid[], integer, text);
DROP FUNCTION IF EXISTS public.admin_deduct_points(uuid, integer, text);

-- ── admin_award_points ──────────────────────────────────────────────────
-- Awards p_points to every user in p_user_ids. Inserts one
-- points_transactions row per user (action_type='admin_award'), then
-- bumps user_points.total_points + lifetime_points by p_points for each
-- row that exists. Brand-new users without a user_points row get one
-- created with total/lifetime = p_points so they're not stranded.
--
-- Returns the number of users actually credited (matches the count of
-- p_user_ids that resolved to a real auth.users row — banned/deleted
-- ids are silently skipped because the INSERT/UPDATE filters on the
-- caller-provided array).
CREATE OR REPLACE FUNCTION public.admin_award_points(
  p_user_ids uuid[],
  p_points   integer,
  p_reason   text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
  awarded_count integer := 0;
BEGIN
  -- Admin allowlist — matches src/lib/isAdmin.js.
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  -- Sanity: positive amount, non-empty array, short reason cap.
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'p_points must be > 0';
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_user_ids must be non-empty';
  END IF;
  IF char_length(coalesce(p_reason, '')) = 0 THEN
    RAISE EXCEPTION 'p_reason required for audit trail';
  END IF;

  -- 1) Audit-trail row per user. notes carries the human reason verbatim
  --    so the activity log can show it later.
  INSERT INTO public.points_transactions (user_id, points, action_type, notes)
  SELECT unnest(p_user_ids), p_points, 'admin_award', p_reason;

  -- 2) Bump existing user_points rows.
  UPDATE public.user_points
     SET total_points    = coalesce(total_points, 0)    + p_points,
         lifetime_points = coalesce(lifetime_points, 0) + p_points,
         updated_at      = now()
   WHERE user_id = ANY(p_user_ids);

  -- 3) Seed user_points for any user that didn't already have a row.
  --    LEFT JOIN by user_id, only insert where the row is missing.
  INSERT INTO public.user_points (user_id, total_points, lifetime_points, updated_at)
  SELECT u.uid, p_points, p_points, now()
    FROM unnest(p_user_ids) AS u(uid)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.user_points up WHERE up.user_id = u.uid
   );

  awarded_count := array_length(p_user_ids, 1);
  RETURN awarded_count;
END;
$$;

-- Lock down execution: anon must never call this; authenticated callers
-- pass through the email check inside the function. Frontend additionally
-- gates the UI on isAdmin().
REVOKE EXECUTE ON FUNCTION public.admin_award_points(uuid[], integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_award_points(uuid[], integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_award_points(uuid[], integer, text) TO authenticated;

-- ── admin_deduct_points ─────────────────────────────────────────────────
-- Moderation tool. Inserts a NEGATIVE points_transactions row
-- (action_type='admin_deduct') and decrements user_points.total_points,
-- floored at 0 so a user can never go negative. lifetime_points is NOT
-- decreased — it's the historical record of everything ever earned.
--
-- Returns the integer balance AFTER the deduct, or NULL if the user
-- didn't have a user_points row to begin with (admin then knows the
-- target probably has zero balance and there's nothing to take).
CREATE OR REPLACE FUNCTION public.admin_deduct_points(
  p_user_id uuid,
  p_points  integer,
  p_reason  text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
  new_balance integer;
BEGIN
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'p_points must be > 0';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;
  IF char_length(coalesce(p_reason, '')) = 0 THEN
    RAISE EXCEPTION 'p_reason required for audit trail';
  END IF;

  -- Audit row carries the NEGATIVE value so the activity log reads
  -- naturally — sum(points) over admin_award + admin_deduct = net.
  INSERT INTO public.points_transactions (user_id, points, action_type, notes)
  VALUES (p_user_id, -p_points, 'admin_deduct', p_reason);

  -- Floor at 0. lifetime_points untouched — that's the historical
  -- "total ever earned" stat and shouldn't drop on a moderation event.
  UPDATE public.user_points
     SET total_points = GREATEST(0, coalesce(total_points, 0) - p_points),
         updated_at   = now()
   WHERE user_id = p_user_id
   RETURNING total_points INTO new_balance;

  RETURN new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_deduct_points(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_deduct_points(uuid, integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_deduct_points(uuid, integer, text) TO authenticated;
