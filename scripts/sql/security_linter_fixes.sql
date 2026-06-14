-- ── Supabase security linter fixes ──────────────────────────────────────
-- Addresses the 11 WARN-level findings from the Supabase database linter.
--
-- This file was REWRITTEN after a pre-flight codebase audit, because
-- the naive fix ("revoke / scope to service_role") would have broken
-- live read + write paths. The audit found:
--   * mv_home_stocks: read via anon client by Home.jsx, Lab.jsx,
--     ResearchAssistant.jsx — three large pages.
--   * user_points: written via anon client by pointsAwarder.js
--     (UPDATE) and userBootstrap.js (UPSERT) — every signup + every
--     points-earning action.
--   * points_transactions: written via anon client by pointsAwarder.js
--     INSERT. A prior migration (security_restrict_points_transactions_insert.sql)
--     already added a tight per-user INSERT policy keyed on the
--     action_type whitelist — but the overly-permissive
--     "service writes transactions" policy currently lets anyone
--     through, defeating that earlier restriction.
--   * referrals: read by AdminEngagement.jsx (admin role only). No
--     client-side writes — those happen in handle_new_auth_user
--     (trigger) or service-role contexts.
--
-- The migration below keeps every legitimate flow working AND closes
-- the privilege-escalation surface the linter found.
--
-- Run in the Supabase SQL editor. Idempotent.
--
-- ── Pre-check before running ──
-- The is_admin() flip from SECURITY DEFINER → SECURITY INVOKER means
-- is_admin() will read public.profiles as the calling user. Confirm
-- there's an RLS SELECT policy on profiles that lets a user see their
-- own row:
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'profiles';
-- A USING (id = auth.uid()) SELECT policy must exist. Without it,
-- is_admin() returns FALSE for every caller after this migration and
-- every admin gate closes silently.


-- ── 1. function_search_path_mutable ────────────────────────────────────
-- Pin search_path to '' so unqualified object references inside these
-- functions can't be hijacked by a same-named object in a higher-
-- priority schema. Verify the function bodies use fully-qualified
-- names (public.<table>) — if not, this will break them.
ALTER FUNCTION public.admin_most_watched(p_window_days integer)
  SET search_path = '';
ALTER FUNCTION public.update_52w_high_low()
  SET search_path = '';


-- ── 2. materialized_view_in_api ────────────────────────────────────────
-- mv_home_stocks is intentionally readable by anon + authenticated:
-- it carries the NSE stock universe (symbol, sector, MA30W, RS, etc.)
-- that the public Home, Pulse, and Lab pages all render — no PII,
-- no user-scoped data. The linter flags any matview exposed via
-- PostgREST regardless of content; this is a deliberate
-- accepted-risk decision, not an oversight.
--
-- Audit trail:
--   * src/pages/Home.jsx          — 3 paginated reads (loadUniverse)
--   * src/pages/Lab.jsx           — 3 paginated reads
--   * src/components/ResearchAssistant.jsx — target-stock lookup
--
-- If you ever want to clear this warning, the path is to (a) create
-- a SECURITY DEFINER RPC that returns the matview rows, (b) REVOKE
-- SELECT on the matview from anon + authenticated, (c) repoint the
-- 7 callers above at the new RPC. Out of scope for this migration.


-- ── 3. rls_policy_always_true ──────────────────────────────────────────
-- All three "service writes …" policies were declared without a role
-- restriction, which collapses to PUBLIC. Effect: anyone with an anon
-- JWT bypasses RLS on writes. Each fix below scopes the bypass to
-- service_role (which is the actual intent of these policies) AND
-- preserves the legitimate client-side write paths via a separate
-- ownership-aware policy.

-- 3a. points_transactions ─────────────────────────────────────────────
-- A prior migration (security_restrict_points_transactions_insert.sql)
-- already added "client insert points_transactions" — a tight INSERT
-- policy that enforces user_id = auth.uid() AND action_type ∈
-- whitelist. Once the overly-permissive "service writes" policy is
-- scoped to service_role, that earlier policy becomes the only path
-- for browser-originated inserts (the whitelist is enforced) and
-- service-role JWTs still bypass cleanly.
DROP POLICY IF EXISTS "service writes transactions" ON public.points_transactions;
CREATE POLICY "service writes transactions"
  ON public.points_transactions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 3b. user_points ─────────────────────────────────────────────────────
-- pointsAwarder.update() bumps user_points.total_points + lifetime
-- after each points event. userBootstrap.upsert() seeds a row on
-- signup. Both write only their own row (user_id = auth.uid()).
-- The "users write own points" policy lets these continue; the
-- "service writes points" policy scoped to service_role keeps the
-- admin / cron paths unaffected.
DROP POLICY IF EXISTS "service writes points" ON public.user_points;
DROP POLICY IF EXISTS "users write own points" ON public.user_points;
CREATE POLICY "service writes points"
  ON public.user_points
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
CREATE POLICY "users write own points"
  ON public.user_points
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3c. referrals ───────────────────────────────────────────────────────
-- No client-side writes exist in src/. The single client read is
-- AdminEngagement.jsx → SELECT * (admin dashboard list). Scope
-- writes to service_role; add an admin-only SELECT policy so the
-- AdminEngagement query keeps working under the calling admin's
-- anon JWT.
DROP POLICY IF EXISTS "service writes referrals" ON public.referrals;
DROP POLICY IF EXISTS "admins read referrals" ON public.referrals;
CREATE POLICY "service writes referrals"
  ON public.referrals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
CREATE POLICY "admins read referrals"
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (public.is_admin());


-- ── 4 + 5. SECURITY DEFINER functions exposed to anon + authenticated ──

-- handle_new_auth_user is a trigger function on auth.users — not
-- intended as an RPC. Revoking EXECUTE on the public RPC surface
-- doesn't affect the trigger firing (triggers run with the table-
-- owner's role, not the caller's). Safe to revoke from PUBLIC.
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user()
  FROM PUBLIC, anon, authenticated;

-- admin_most_watched — admin-only data. Revoke from anon. KEEP
-- EXECUTE from authenticated because the admin pages call this via
-- the user's own anon-keyed Supabase client (no service-role on the
-- client). The function MUST contain its own is_admin() guard inside
-- the body; verify it does before deploying. If not, add:
--   IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
-- as the first statement in the function body.
REVOKE EXECUTE ON FUNCTION public.admin_most_watched(p_window_days integer)
  FROM PUBLIC, anon;

-- is_admin — called from RLS policies, so EXECUTE must stay
-- reachable. Flipping from SECURITY DEFINER → SECURITY INVOKER
-- removes the privilege-escalation surface (auth.uid() inside the
-- function still resolves to the caller's UID; the inner SELECT on
-- profiles becomes subject to profiles RLS — see pre-check at the
-- top of this file).
ALTER FUNCTION public.is_admin() SECURITY INVOKER;


-- ── Verification ───────────────────────────────────────────────────────
-- After running, re-run the Supabase database linter. Expected
-- residual: ONE WARN — materialized_view_in_api on mv_home_stocks —
-- which is the accepted-risk decision documented in section 2. All
-- other 10 findings should clear.
--
-- Sanity check the points + referrals tables aren't broken:
--   * Sign up a new user → user_points row should appear (userBootstrap).
--   * Trigger a daily_question award → points_transactions row +
--     user_points totals bump (pointsAwarder).
--   * Load /admin/engagement → referrals list should still render.
