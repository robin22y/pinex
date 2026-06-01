-- ─────────────────────────────────────────────────────────────────
-- Supabase database-linter security fixes (June 2026)
-- ─────────────────────────────────────────────────────────────────
-- This migration applies six findings flagged by the Supabase
-- database linter. Each section explains WHY the fix is needed and
-- HOW it changes runtime behaviour.
--
-- Idempotent: re-running this file is safe (uses IF EXISTS / DO
-- blocks that introspect rather than guessing signatures).
--
-- To apply: copy-paste into Supabase Dashboard → SQL Editor and run.
-- Verification queries at the bottom confirm each fix landed.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- FIX 1 — Revoke direct REST execution of is_admin()
-- ═════════════════════════════════════════════════════════════════
-- LINTER: anon_security_definer_function_executable
--
-- is_admin() is a SECURITY DEFINER helper meant to be called by
-- RLS policies (which run as service_role and bypass GRANT checks).
-- It was inadvertently callable from the REST API at
-- /rest/v1/rpc/is_admin by anon and authenticated roles.
--
-- The frontend never calls this directly — it derives admin status
-- from profile.role (see src/context/useAuth.js). Revoking EXECUTE
-- from anon/authenticated removes the public surface area while
-- leaving the function fully usable inside RLS policies.
-- ─────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated, public;


-- ═════════════════════════════════════════════════════════════════
-- FIX 2 — Revoke direct REST execution of handle_new_auth_user()
-- ═════════════════════════════════════════════════════════════════
-- LINTER: anon_security_definer_function_executable
--
-- handle_new_auth_user() is a trigger function fired automatically
-- by auth.users INSERT. It should NEVER be invoked directly via
-- RPC — calling it manually bypasses the auth flow.
--
-- Triggers run regardless of GRANT, so revoking REST execute
-- has no operational impact on the signup pipeline.
-- ─────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM anon, authenticated, public;


-- ═════════════════════════════════════════════════════════════════
-- FIX 3 — Pin search_path on functions flagged as mutable
-- ═════════════════════════════════════════════════════════════════
-- LINTER: function_search_path_mutable
--
-- A function with a mutable search_path can be tricked into
-- resolving table/function references to a malicious schema
-- planted by an attacker with CREATE on any schema in the path.
-- Pinning the path to `public, pg_catalog` makes resolution
-- deterministic.
--
-- DO block walks pg_proc so we don't need to know the exact
-- parameter signatures of the functions (which may have multiple
-- overloads).
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_symbol_watcher_count', 'update_52w_high_low')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, pg_catalog',
      rec.sig
    );
    RAISE NOTICE 'Pinned search_path on %', rec.sig;
  END LOOP;
END $$;


-- ═════════════════════════════════════════════════════════════════
-- FIX 4 — Drop broad SELECT policy on academy storage bucket
-- ═════════════════════════════════════════════════════════════════
-- LINTER: public_bucket_allows_listing
--
-- The `public_read_academy` policy on storage.objects grants SELECT
-- to all rows in the academy bucket. For PUBLIC buckets this is
-- unnecessary — Supabase serves object URLs without consulting
-- storage.objects RLS. The only thing the broad SELECT enables is
-- file LISTING via the storage API, which is rarely the intent.
--
-- After this fix: direct file URLs (https://<project>.supabase.co/
-- storage/v1/object/public/academy/<filename>) continue to work.
-- Listing the bucket contents from the client returns empty/403,
-- which is the desired behaviour.
--
-- TEST AFTER APPLYING: open any /academy/* file URL the app uses;
-- it should still load. If a file doesn't load, the bucket is not
-- actually public — see the rollback at the bottom of this file.
-- ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS public_read_academy ON storage.objects;


-- ═════════════════════════════════════════════════════════════════
-- FIX 5 — Tighten search_events INSERT policy
-- ═════════════════════════════════════════════════════════════════
-- LINTER: rls_policy_always_true
--
-- The old policy used WITH CHECK (true), accepting any payload
-- from anon. That's by design — search analytics must accept
-- anonymous inserts — but there was no payload validation, so a
-- bot could spam multi-megabyte rows.
--
-- New policy keeps anon insert OPEN but adds bounds:
--   - query string must be 1..200 chars
--   - this matches a normal search input length
-- ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can insert search events" ON public.search_events;

CREATE POLICY "Anon insert with size guard" ON public.search_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(coalesce(query, '')) BETWEEN 1 AND 200
  );


-- ═════════════════════════════════════════════════════════════════
-- FIX 6 — Tighten waitlist INSERT policy
-- ═════════════════════════════════════════════════════════════════
-- LINTER: rls_policy_always_true
--
-- Same shape as #5 — anon can sign up for the waitlist by design,
-- but the old policy allowed any payload. New policy:
--   - email must be present and look like an email
--   - email must be ≤ 200 chars (sanity bound)
-- Spam signups with garbage email values now fail at insert time.
-- ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS public_insert_waitlist ON public.waitlist;

CREATE POLICY public_insert_waitlist ON public.waitlist
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND char_length(email) BETWEEN 5 AND 200
    AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );


-- ═════════════════════════════════════════════════════════════════
-- NOT FIXED — intentional exceptions documented for the linter
-- ═════════════════════════════════════════════════════════════════
-- materialized_view_in_api: public.mv_home_stocks
--   Intentional. mv_home_stocks contains aggregated NSE market data
--   (price, MA, RS, volume, OBV, stage) — all derived from publicly
--   available end-of-day market data. The Home and Lab pages fetch
--   the full universe via supabase.from('mv_home_stocks') and the
--   exposure is fundamental to the product's purpose. No PII; no
--   user-specific data; nothing to hide. Linter warning can be
--   dismissed in the Supabase dashboard.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION — run these after the migration to confirm fixes
-- ═════════════════════════════════════════════════════════════════
-- Expected: each query returns 0 rows. If any return rows, that
-- specific fix did not land (e.g. a column or policy already
-- changed since this script was written).
-- ─────────────────────────────────────────────────────────────────

-- 1+2: anon should NOT have execute on the two SECURITY DEFINER fns
SELECT proname AS still_executable_by_anon
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_admin', 'handle_new_auth_user')
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 3: both functions should have an explicit search_path set
SELECT p.proname AS still_mutable_search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_symbol_watcher_count', 'update_52w_high_low')
  AND p.proconfig IS NULL;  -- proconfig holds SET search_path = ...

-- 4: academy bucket should no longer have a broad SELECT policy
SELECT policyname AS academy_listing_policy_still_present
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename  = 'objects'
  AND policyname = 'public_read_academy';

-- 5+6: the two tightened INSERT policies should now have a
-- non-trivial WITH CHECK expression (not just "true")
SELECT tablename, policyname AS still_using_with_check_true
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('search_events', 'waitlist')
  AND cmd = 'INSERT'
  AND with_check = 'true';


-- ═════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed) — paste any block back to restore prior state
-- ═════════════════════════════════════════════════════════════════
-- -- Restore academy listing policy (if direct file URLs broke):
-- CREATE POLICY public_read_academy ON storage.objects
--   FOR SELECT USING (bucket_id = 'academy');
--
-- -- Restore search_events open insert:
-- DROP POLICY IF EXISTS "Anon insert with size guard" ON public.search_events;
-- CREATE POLICY "Anyone can insert search events" ON public.search_events
--   FOR INSERT TO anon, authenticated WITH CHECK (true);
--
-- -- Restore waitlist open insert:
-- DROP POLICY IF EXISTS public_insert_waitlist ON public.waitlist;
-- CREATE POLICY public_insert_waitlist ON public.waitlist
--   FOR INSERT TO anon, authenticated WITH CHECK (true);
--
-- -- Restore anon EXECUTE (NOT recommended):
-- GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO anon, authenticated;
-- ─────────────────────────────────────────────────────────────────
