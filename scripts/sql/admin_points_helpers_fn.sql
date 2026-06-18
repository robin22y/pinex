-- ── admin point helpers: read RPCs + admin_grant_bonus ──────────────────
-- Companion to admin_award_points_fn.sql. Both files together let the
-- admin UI bypass the new RLS lockdown on points_transactions, user_points,
-- and profiles without re-opening anonymous reads.
--
-- WHY a separate file: admin_award_points was the first cut; these
-- helpers came in after we hit RLS-blocked SELECTs on the admin search
-- + activity-log paths. Keeping them in their own migration means you
-- can apply this one without re-running the earlier file.
--
-- ROUTING in the UI:
--   - admin_grant_bonus       — /admin/points BonusModal (per-user)
--   - admin_search_users      — PointsManager "Award selected" search
--   - admin_resolve_condition — PointsManager "Award by condition" preview
--   - admin_active_user_count — PointsManager "Award all" candidate count
--   - admin_recent_point_admin_ops — PointsManager Activity log
--   - admin_leaderboard       — /admin/points Leaderboard + High/Low tabs
--
-- All SECURITY DEFINER, gated by auth.email() = 'robin22y@gmail.com'.
-- Anon is revoked; authenticated is granted. The email check is what
-- keeps non-admin authenticated users from reading other users' data
-- through these.

DROP FUNCTION IF EXISTS public.admin_grant_bonus(uuid, integer, text);
DROP FUNCTION IF EXISTS public.admin_search_users(text, integer);
DROP FUNCTION IF EXISTS public.admin_all_active_user_ids();
DROP FUNCTION IF EXISTS public.admin_resolve_condition(text);
DROP FUNCTION IF EXISTS public.admin_active_user_count();
DROP FUNCTION IF EXISTS public.admin_recent_point_admin_ops(integer);
DROP FUNCTION IF EXISTS public.admin_leaderboard(integer);

-- ── admin_grant_bonus ──────────────────────────────────────────────────
-- Single-user award path used by AdminPoints.jsx BonusModal. Distinct
-- from admin_award_points because it preserves the legacy action_type
-- ='admin_bonus' label (the existing /admin/points UI text and the
-- activity-log filter both reference that string).
--
-- Returns the new total_points after the bump, so the caller can show
-- the user's new balance immediately in the UI.
CREATE OR REPLACE FUNCTION public.admin_grant_bonus(
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
  new_total integer;
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

  -- 1) Audit row. action_type='admin_bonus' preserves existing
  --    activity-log filters and admin UI copy.
  INSERT INTO public.points_transactions (user_id, points, action_type, notes)
  VALUES (p_user_id, p_points, 'admin_bonus', p_reason);

  -- 2) Bump totals; seed if no row exists yet.
  INSERT INTO public.user_points (user_id, total_points, lifetime_points, updated_at)
  VALUES (p_user_id, p_points, p_points, now())
  ON CONFLICT (user_id) DO UPDATE
    SET total_points    = public.user_points.total_points    + EXCLUDED.total_points,
        lifetime_points = public.user_points.lifetime_points + EXCLUDED.lifetime_points,
        updated_at      = now()
  RETURNING total_points INTO new_total;

  RETURN new_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_grant_bonus(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_grant_bonus(uuid, integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_grant_bonus(uuid, integer, text) TO authenticated;

-- ── admin_search_users ─────────────────────────────────────────────────
-- ILIKE search on email + full_name. Returns up to p_limit active +
-- non-banned profiles. UI uses this for the "Award selected" picker.
CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_query text,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  id        uuid,
  email     text,
  full_name text,
  plan      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
  q text;
BEGIN
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  q := '%' || coalesce(trim(p_query), '') || '%';
  RETURN QUERY
    SELECT p.id, p.email, p.full_name, p.plan
      FROM public.profiles p
     WHERE p.is_active = true
       AND p.banned    = false
       AND (p.email ILIKE q OR p.full_name ILIKE q)
     ORDER BY p.email
     LIMIT GREATEST(1, LEAST(coalesce(p_limit, 25), 100));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_search_users(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(text, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_search_users(text, integer) TO authenticated;

-- ── admin_all_active_user_ids ──────────────────────────────────────────
-- Returns every active + non-banned profile id. Used by the
-- "Award all users" path; admin_search_users caps at 100 (typeahead
-- only) so we need a separate function for bulk awards. No limit
-- here because the result feeds straight into admin_award_points
-- as a uuid[]; Postgres handles 10k-element arrays comfortably.
CREATE OR REPLACE FUNCTION public.admin_all_active_user_ids()
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
BEGIN
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  RETURN QUERY
    SELECT p.id FROM public.profiles p
     WHERE p.is_active = true AND p.banned = false
     ORDER BY p.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_all_active_user_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_all_active_user_ids() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_all_active_user_ids() TO authenticated;

-- ── admin_resolve_condition ────────────────────────────────────────────
-- Map a UI condition key to a set of profile ids. Each branch filters
-- on is_active + !banned at the candidate-pool stage so cleaned-up
-- users never appear in an award batch. Multi-condition AND is handled
-- client-side by intersecting two single-condition lists.
CREATE OR REPLACE FUNCTION public.admin_resolve_condition(p_condition text)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
  seven_days_ago timestamptz := now() - interval '7 days';
BEGIN
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  CASE p_condition
    WHEN 'inactive_7d' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
         WHERE p.is_active = true AND p.banned = false
           AND p.last_active_at IS NOT NULL
           AND p.last_active_at < seven_days_ago;
    WHEN 'streak_gt5' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
        JOIN public.user_points up ON up.user_id = p.id
       WHERE p.is_active = true AND p.banned = false
         AND coalesce(up.current_streak, 0) > 5;
    WHEN 'academy_complete' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
         WHERE p.is_active = true AND p.banned = false
           AND p.academy_completed = true;
    WHEN 'free_plan' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
         WHERE p.is_active = true AND p.banned = false
           AND (p.plan IS NULL OR p.plan = 'free');
    WHEN 'joined_week' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
         WHERE p.is_active = true AND p.banned = false
           AND p.created_at >= seven_days_ago;
    WHEN 'no_stock_views' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
         WHERE p.is_active = true AND p.banned = false
           AND NOT EXISTS (
             SELECT 1 FROM public.points_transactions pt
              WHERE pt.user_id = p.id
                AND pt.action_type = 'stock_view'
           );
    ELSE
      -- Unknown condition — return empty set rather than raise so the
      -- UI just shows "0 users matched" and the admin can pick another.
      RETURN;
  END CASE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_resolve_condition(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_condition(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_resolve_condition(text) TO authenticated;

-- ── admin_active_user_count ────────────────────────────────────────────
-- Returns the size of the "is_active = true AND banned = false"
-- pool. UI shows this in the "Award all" mode as the candidate count
-- and in the confirm dialog.
CREATE OR REPLACE FUNCTION public.admin_active_user_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
  c integer;
BEGIN
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  SELECT count(*) INTO c
    FROM public.profiles
   WHERE is_active = true AND banned = false;
  RETURN c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_active_user_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_active_user_count() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_active_user_count() TO authenticated;

-- ── admin_recent_point_admin_ops ───────────────────────────────────────
-- Activity log. Returns the most recent admin_award / admin_bonus /
-- admin_deduct rows, joined with profiles.email so the UI can show
-- who the operation hit without a second round-trip.
CREATE OR REPLACE FUNCTION public.admin_recent_point_admin_ops(
  p_limit integer DEFAULT 60
)
RETURNS TABLE (
  id           bigint,
  user_id      uuid,
  email        text,
  points       integer,
  action_type  text,
  notes        text,
  created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
BEGIN
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  RETURN QUERY
    SELECT pt.id, pt.user_id, p.email, pt.points, pt.action_type, pt.notes, pt.created_at
      FROM public.points_transactions pt
      LEFT JOIN public.profiles p ON p.id = pt.user_id
     WHERE pt.action_type IN ('admin_award', 'admin_bonus', 'admin_deduct')
     ORDER BY pt.created_at DESC
     LIMIT GREATEST(1, LEAST(coalesce(p_limit, 60), 200));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_recent_point_admin_ops(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_recent_point_admin_ops(integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_recent_point_admin_ops(integer) TO authenticated;

-- ── admin_leaderboard ──────────────────────────────────────────────────
-- Joined user_points + profiles, ordered by total_points DESC. Used by
-- /admin/points for all three reading tabs (Leaderboard, High
-- Performers, Low Performers) — the three tabs filter from the same
-- rows array in-memory, so one RPC call covers all of them.
--
-- Returns up to p_limit rows (default 500, capped at 5000). The UI
-- slices the top 200 client-side so 500 gives generous headroom for
-- the High/Low Performers filters without dragging a 5k row payload
-- across the wire.
CREATE OR REPLACE FUNCTION public.admin_leaderboard(
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  user_id               uuid,
  email                 text,
  full_name             text,
  last_active_at        timestamptz,
  academy_completed     boolean,
  academy_grandfathered boolean,
  total_points          integer,
  lifetime_points       integer,
  redeemed_points       integer,
  current_streak        integer,
  longest_streak        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.email(), ''));
BEGIN
  IF caller_email <> 'robin22y@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  RETURN QUERY
    SELECT up.user_id,
           p.email,
           p.full_name,
           p.last_active_at,
           p.academy_completed,
           p.academy_grandfathered,
           coalesce(up.total_points,    0)::integer AS total_points,
           coalesce(up.lifetime_points, 0)::integer AS lifetime_points,
           coalesce(up.redeemed_points, 0)::integer AS redeemed_points,
           coalesce(up.current_streak,  0)::integer AS current_streak,
           coalesce(up.longest_streak,  0)::integer AS longest_streak
      FROM public.user_points up
      LEFT JOIN public.profiles p ON p.id = up.user_id
     ORDER BY up.total_points DESC NULLS LAST
     LIMIT GREATEST(1, LEAST(coalesce(p_limit, 500), 5000));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_leaderboard(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_leaderboard(integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_leaderboard(integer) TO authenticated;
