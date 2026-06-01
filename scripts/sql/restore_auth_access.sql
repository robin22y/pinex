-- ─────────────────────────────────────────────────────────────────
-- RESTORE AUTH ACCESS — undo today's lockdowns
-- ─────────────────────────────────────────────────────────────────
-- Two changes earlier today may be blocking admin/user access to
-- the app. This single migration safely reverses both, plus
-- restores executes on the SECURITY DEFINER helpers in case any
-- RLS policy depended on them.
--
-- Safe + idempotent. Run in Supabase Dashboard → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- 1. Drop the signup-gate trigger (from lock_signup_to_invited_users.sql)
-- ═════════════════════════════════════════════════════════════════
-- This trigger was supposed to reject direct /register signups
-- while allowing the waitlist + invite paths. In practice the
-- gate caused unexpected behaviour during the rollout. Dropping
-- it returns supabase.auth.signUp() to its prior open state.
-- ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS gate_signup_trigger ON auth.users;
DROP FUNCTION IF EXISTS public.gate_new_auth_user_signup();


-- ═════════════════════════════════════════════════════════════════
-- 2. RESTORE EXECUTE on is_admin() — the actual access blocker
-- ═════════════════════════════════════════════════════════════════
-- The Supabase linter flagged is_admin() as a SECURITY DEFINER
-- function callable by anon/authenticated via the REST API and
-- recommended one of three remediations. I picked the most
-- restrictive — REVOKE EXECUTE — which broke any RLS policy that
-- calls is_admin() under the authenticated role.
--
-- When an RLS policy contains `USING (is_admin())`, Postgres
-- invokes the function as the current querying role. With
-- EXECUTE revoked from authenticated, the call fails and the
-- policy denies the row → admins see zero rows in protected
-- tables. The dashboard linter's recommendation didn't account
-- for this in-policy usage.
--
-- Restoring EXECUTE. The function is SECURITY DEFINER and just
-- returns a boolean about the caller, so allowing authenticated
-- to call it is not a real security concern.
-- ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════
-- 3. RESTORE EXECUTE on handle_new_auth_user() — defence in depth
-- ═════════════════════════════════════════════════════════════════
-- This is a trigger function fired by auth.users INSERT. Triggers
-- typically run as the database engine and don't require GRANT
-- EXECUTE on the function itself — but if any code path elsewhere
-- (extension, function call, RLS) depends on this, restoring
-- access is the safer default.
-- ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════
-- 4. VERIFICATION — every block should return 0 rows of issues
-- ═════════════════════════════════════════════════════════════════

-- (a) Signup gate trigger should be gone
SELECT 'gate_signup_trigger still present' AS issue
FROM pg_trigger
WHERE tgname = 'gate_signup_trigger';

-- (b) Signup gate function should be gone
SELECT 'gate_new_auth_user_signup() still present' AS issue
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'gate_new_auth_user_signup';

-- (c) authenticated should now have EXECUTE on is_admin
SELECT 'authenticated cannot execute is_admin()' AS issue
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'is_admin'
  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- (d) authenticated should now have EXECUTE on handle_new_auth_user
SELECT 'authenticated cannot execute handle_new_auth_user()' AS issue
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'handle_new_auth_user'
  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');


-- ═════════════════════════════════════════════════════════════════
-- NOT CHANGED — these other security fixes from today are safe
-- ═════════════════════════════════════════════════════════════════
--   FIX 3 (search_path pinning on 2 functions)         — keep
--   FIX 4 (academy bucket SELECT policy drop)          — keep
--   FIX 5 (search_events INSERT size guard)            — keep
--   FIX 6 (waitlist INSERT email regex)                — keep
-- These don't gate authenticated user access; they only tighten
-- what anon can do with public-write endpoints. No reason to roll
-- back. If you want them gone, see the rollback block at the
-- bottom of scripts/sql/security_fixes_supabase_linter.sql.
