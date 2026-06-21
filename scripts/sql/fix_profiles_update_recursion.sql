-- Emergency recovery for normal-user profile 500s.
--
-- Symptom:
--   Non-admin users see PostgREST 500 responses on PATCH/SELECT public.profiles.
--   Admin users can still use the app.
--
-- Cause:
--   The "users cannot self-upgrade plan" UPDATE policy runs on public.profiles
--   and its WITH CHECK reads public.profiles again. That nested read evaluates
--   the same profiles RLS policies again, which can recurse and fail for normal
--   authenticated users.
--
-- Fix:
--   1. Keep public.is_admin() as SECURITY DEFINER so admin policies can safely
--      check profiles.role without re-entering profiles RLS.
--   2. Keep direct browser updates to profiles.plan and profiles.role blocked.
--   3. Replace the recursive UPDATE policy with a non-recursive own-row policy.
--
-- Run this in Supabase SQL Editor. Deploying frontend code alone will not fix
-- an already-broken RLS policy in production.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
REVOKE UPDATE (plan, role) ON public.profiles FROM authenticated;

DROP POLICY IF EXISTS "users cannot self-upgrade plan" ON public.profiles;
DROP POLICY IF EXISTS "users update own profile nonrecursive" ON public.profiles;

CREATE POLICY "users update own profile nonrecursive"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "users read own profile" ON public.profiles;

CREATE POLICY "users read own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

COMMIT;
