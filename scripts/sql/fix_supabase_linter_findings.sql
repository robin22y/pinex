-- ─────────────────────────────────────────────────────────────────
-- Supabase linter fix-up — three findings from the security advisor.
-- ─────────────────────────────────────────────────────────────────
--
-- Findings, in the order they appear in the linter CSV:
--
--   INFO  rls_enabled_no_policy  public.divergence_signals
--   INFO  rls_enabled_no_policy  public.stock_info_cache
--   ERROR security_definer_view  public.iqjet_access_with_email
--
-- "RLS enabled + no policies" silently denies every non-service-role
-- read — that's exactly why the IQjet /profile MarketPulse section
-- was returning empty for end users while showing data for Robin
-- (his admin queries hit edge functions running on service role,
-- which bypasses RLS). The linter flags it because the same shape
-- is almost always a bug.
--
-- "SECURITY DEFINER view" — pre-Postgres-15, all views run with the
-- creator's privileges. PG 15+ lets you flip a view to run with the
-- CALLER's privileges via WITH (security_invoker = true). The linter
-- promotes the latter because it makes RLS on the underlying table
-- meaningful when queried through the view.
--
-- Idempotent. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────


-- ── 1. divergence_signals — read for authenticated users ─────────
-- The signals are a single-row-per-day verdict on overall market
-- breadth (verdict, breadth_pct, A/D direction, stage 2/3 counts).
-- Both /iqjet (subscriber MarketPulse card) and /iqjet-desk (admin)
-- read it via the supabase-js client, which sends the user's
-- authenticated JWT. There's nothing user-specific in the table —
-- the same row is broadcast to everyone with access. Writers are
-- scripts/iqjet/calc_divergences.py running with the service role,
-- which bypasses RLS, so we only need a SELECT policy here.
DROP POLICY IF EXISTS divergence_signals_authenticated_select
  ON public.divergence_signals;
CREATE POLICY divergence_signals_authenticated_select
  ON public.divergence_signals
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY divergence_signals_authenticated_select
  ON public.divergence_signals IS
  'Daily market-breadth verdict is broadcast data — same row for every authenticated reader. Writes happen via service role from the nightly Python pipeline.';


-- ── 2. stock_info_cache — keep locked down, document intent ──────
-- Only the fetch-stock-info edge function ever touches this table,
-- and it does so via the service-role key (which bypasses RLS).
-- No anon, no authenticated, no frontend code ever queries it
-- directly. The "RLS on + no policies" state was therefore correct
-- on the security side; the linter still flags it because the
-- shape is overwhelmingly a misconfiguration in other projects.
--
-- Fix: add an explicit USING (false) SELECT policy. It changes
-- nothing about access — nothing was already visible — but it
-- documents to the linter that the lockdown is intentional, and
-- to a future reader that this table is service-role only.
DROP POLICY IF EXISTS stock_info_cache_no_direct_access
  ON public.stock_info_cache;
CREATE POLICY stock_info_cache_no_direct_access
  ON public.stock_info_cache
  FOR SELECT
  TO anon, authenticated
  USING (false);

COMMENT ON POLICY stock_info_cache_no_direct_access
  ON public.stock_info_cache IS
  'Service-role-only cache. Direct queries from anon / authenticated return zero rows by design — the fetch-stock-info edge function is the only access path.';


-- ── 3. iqjet_access_with_email — caller privileges ───────────────
-- The view joins iqjet_access (admin-RLS) with profiles (email
-- column). Without security_invoker, the view runs as its creator
-- (typically the migration runner), which would let any
-- authenticated session read every row — bypassing the
-- admin-only SELECT policy on iqjet_access entirely.
--
-- WITH (security_invoker = true) makes the view execute the
-- underlying SELECT as the caller, so the existing
-- iqjet_access_admin_select policy kicks in correctly: admin sees
-- every row, normal users see only their own.
--
-- CREATE OR REPLACE preserves dependents (the admin manager UI
-- selects from this view).
CREATE OR REPLACE VIEW public.iqjet_access_with_email
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.user_id,
  a.passcode,
  a.granted_by,
  a.granted_at,
  a.expires_at,
  a.is_active,
  a.last_used_at,
  a.notes,
  p.email AS user_email,
  CASE
    WHEN a.is_active = false                   THEN 'REVOKED'
    WHEN a.expires_at <= now()                 THEN 'EXPIRED'
    WHEN a.user_id IS NULL                     THEN 'PENDING'
    ELSE                                            'ACTIVE'
  END AS status
FROM public.iqjet_access a
LEFT JOIN public.profiles p ON p.id = a.user_id;

GRANT SELECT ON public.iqjet_access_with_email TO authenticated;

COMMENT ON VIEW public.iqjet_access_with_email IS
  'Admin convenience view. security_invoker = true so the iqjet_access RLS policies are evaluated against the calling user, not the view creator.';


-- ─────────────────────────────────────────────────────────────────
-- Verification — each query returns zero rows when the fix landed.
-- ─────────────────────────────────────────────────────────────────

SELECT 'divergence_signals SELECT policy missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'divergence_signals'
    AND cmd        = 'SELECT'
);

SELECT 'stock_info_cache SELECT policy missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'stock_info_cache'
    AND cmd        = 'SELECT'
);

SELECT 'iqjet_access_with_email is not security_invoker' AS issue
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'iqjet_access_with_email'
    AND c.reloptions @> ARRAY['security_invoker=true']
);
