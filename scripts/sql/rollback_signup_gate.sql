-- ─────────────────────────────────────────────────────────────────
-- ROLLBACK — remove the invite-only signup gate
-- ─────────────────────────────────────────────────────────────────
-- Drops the BEFORE INSERT trigger on auth.users and the function
-- it called. After running this, supabase.auth.signUp() will accept
-- new users without checking invited_at or public.invites — the
-- pre-gate behaviour.
--
-- Safe to run even if the gate was never installed (uses IF EXISTS).
-- Run this in Supabase Dashboard → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS gate_signup_trigger ON auth.users;
DROP FUNCTION IF EXISTS public.gate_new_auth_user_signup();

-- Verification — should return zero rows after rollback
SELECT tgname AS still_present
FROM pg_trigger
WHERE tgname = 'gate_signup_trigger';

SELECT proname AS still_present
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'gate_new_auth_user_signup';
