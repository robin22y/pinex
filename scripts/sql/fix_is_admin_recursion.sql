-- ════════════════════════════════════════════════════════════════════════
-- fix_is_admin_recursion.sql
--
-- Fixes a critical RLS recursion that surfaces as 500s on every
-- write to profiles AND on RPCs that read tables with RLS policies
-- referencing is_admin().
--
-- ROOT CAUSE
--   is_admin() runs as SECURITY INVOKER and queries public.profiles.
--   The profiles RLS policy "Admins read all profiles" CALLS is_admin()
--   from its USING clause. Every SELECT on profiles then evaluates
--   that policy, which calls is_admin(), which SELECTs profiles, which
--   evaluates the policy again, which calls is_admin() — INFINITE
--   RECURSION. Postgres detects it and aborts with an error,
--   surfaced to the client as 500.
--
--   This blew up specifically on UPDATEs to profiles because the
--   "users cannot self-upgrade plan" policy has a WITH CHECK that
--   does:
--     NOT (plan IS DISTINCT FROM (
--       SELECT profiles_1.plan FROM profiles profiles_1
--       WHERE profiles_1.id = auth.uid()
--     ))
--   That nested SELECT triggers the recursion on every profile
--   UPDATE, including the harmless visit_count / last_active_at
--   bump from AuthContext on every hydrate.
--
-- THE FIX
--   Add SECURITY DEFINER + STABLE to is_admin(). With SECURITY
--   DEFINER the function runs as its owner (typically postgres /
--   supabase_admin) which BYPASSES RLS for the inner SELECT. The
--   policy that calls is_admin() still gets the right answer
--   (`auth.uid()` still resolves to the calling user) but the
--   nested profiles SELECT no longer re-triggers the policy.
--
--   STABLE marks the function as side-effect-free with the same
--   result inside a single statement, letting Postgres cache the
--   result across RLS policy evaluations within one query.
--
-- SAFETY OF SECURITY DEFINER
--   The function only reads ONE column (role) for ONE user
--   (auth.uid()). It returns a boolean. There's no SQL injection
--   surface (no user input concatenated into SQL). search_path is
--   pinned to '' and the table is fully qualified as public.profiles
--   so a malicious profiles table in a non-public schema cannot
--   hijack the lookup.
--
-- APPLY
--   Run once in Supabase SQL editor. Idempotent — CREATE OR REPLACE
--   safely re-declares the function.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ── Smoke test ───────────────────────────────────────────────────
-- After applying, this UPDATE should succeed (it did 500 before).
-- The test only fires if you uncomment it.
--
-- UPDATE public.profiles
-- SET last_active_at = now()
-- WHERE id = '227869fb-9483-4436-886f-0451b7915f84';
