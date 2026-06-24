-- ════════════════════════════════════════════════════════════════════════
-- repair_bonus_rpc_grants.sql
--
-- Fixes the 403 (Forbidden) responses on:
--   POST /rest/v1/rpc/award_user_bonus
--   POST /rest/v1/rpc/record_visit_and_claim_referral
--
-- Why this is needed
--   Both RPCs are SECURITY DEFINER functions. PostgREST returns:
--     - 404 (PGRST202)  when a function is missing from the schema cache
--     - 403 (42501)     when the function EXISTS but the calling role
--                       lacks EXECUTE — "permission denied for function"
--   The browser hits these as the `authenticated` role. A 403 therefore
--   means the `GRANT EXECUTE ... TO authenticated` was never applied to
--   this project (or was wiped by a later DROP/CREATE — DROP FUNCTION
--   resets all privileges, and CREATE OR REPLACE only preserves them).
--
--   The grants below are identical to the ones already authored in
--   add_award_user_bonus_fn.sql (lines 127-129) and
--   add_referral_visit_gate.sql (lines 218-220). This file re-asserts
--   just the privileges — no DROP/CREATE — so it is safe to run on a
--   live project without touching the function bodies or their data.
--
-- If you instead get "function ... does not exist" when running this,
-- the functions were never created: run add_award_user_bonus_fn.sql and
-- add_referral_visit_gate.sql in full first, then this file is redundant.
--
-- Run once in the Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── award_user_bonus(text, integer, text) ───────────────────────────────
REVOKE EXECUTE ON FUNCTION public.award_user_bonus(text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_user_bonus(text, integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.award_user_bonus(text, integer, text) TO authenticated;

-- ── record_visit_and_claim_referral() ───────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.record_visit_and_claim_referral() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_visit_and_claim_referral() FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_visit_and_claim_referral() TO authenticated;

-- ── Verification ─────────────────────────────────────────────────────────
-- Each query should return one row reporting `true` for authenticated and
-- `false` for anon. If `authenticated` is false, the grant above did not
-- take (check you ran as a privileged role / the function owner).
SELECT 'award_user_bonus'                                            AS fn,
       has_function_privilege('authenticated',
         'public.award_user_bonus(text, integer, text)', 'EXECUTE')  AS authenticated_can_execute,
       has_function_privilege('anon',
         'public.award_user_bonus(text, integer, text)', 'EXECUTE')  AS anon_can_execute
UNION ALL
SELECT 'record_visit_and_claim_referral',
       has_function_privilege('authenticated',
         'public.record_visit_and_claim_referral()', 'EXECUTE'),
       has_function_privilege('anon',
         'public.record_visit_and_claim_referral()', 'EXECUTE');
