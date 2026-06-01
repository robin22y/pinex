-- ─────────────────────────────────────────────────────────────────
-- Lock signup to invited users only (pre-NSE-permission gate)
-- ─────────────────────────────────────────────────────────────────
-- Until NSE permission to operate is granted, the product is in
-- private beta. The intended access model is:
--
--   1. Public lands on /  (Landing) and joins the waitlist
--   2. Admin reviews the waitlist and approves selected users
--   3. Approval triggers a Supabase invite email (via the
--      `invite-user` Netlify function calling auth.admin
--      .inviteUserByEmail()) — this CREATES the auth.users row
--      with `invited_at` set
--   4. User clicks the invite link and sets their password
--
--   PLUS: friend referrals through /invite/:code create a row in
--   public.invites BEFORE the new user signs up.
--
-- Anything ELSE — somebody navigating directly to /register, or
-- calling supabase.auth.signUp() via the public anon key — must
-- be REJECTED. The frontend redirect alone is insufficient: any
-- attacker can call the Supabase auth API directly with the
-- published anon key. This trigger is the actual gate.
--
-- Idempotent: re-running drops + recreates the trigger.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- Gate function — checks two allowed signup paths
-- ═════════════════════════════════════════════════════════════════
-- Path A: Admin invite via auth.admin.inviteUserByEmail()
--         Identifiable by `invited_at IS NOT NULL` on the new row.
--         The admin API sets this column when the invite is sent.
--         An anon client calling signUp() CANNOT set invited_at —
--         it's an internal auth.users column the Supabase API
--         ignores from client payloads.
--
-- Path B: Friend referral via /invite/:code
--         The InviteAccept page calls public.acceptInvite(code,
--         email, name) which INSERTs a row into public.invites
--         with the invitee_email BEFORE supabase.auth.signUp()
--         is called. So at the time of the auth.users INSERT,
--         a matching invites row already exists.
--
-- Any other code path → REJECT with a clear message.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gate_new_auth_user_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  has_referral_invite boolean;
  normalized_email text;
BEGIN
  normalized_email := lower(coalesce(NEW.email, ''));

  -- Path A: admin invite via inviteUserByEmail()
  IF NEW.invited_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Path B: friend referral — public.invites row already exists
  SELECT EXISTS (
    SELECT 1
    FROM public.invites
    WHERE lower(invitee_email) = normalized_email
      AND status IN ('pending', 'accepted')
  ) INTO has_referral_invite;

  IF has_referral_invite THEN
    RETURN NEW;
  END IF;

  -- Otherwise — direct /register or direct API call. REJECT.
  RAISE EXCEPTION USING
    errcode = 'P0001',
    message = 'Signup is invite-only during the private beta. Join the waitlist at https://pinex.in or use a friend''s invite link.',
    hint    = 'pinex.signup.invite_only';
END;
$$;


-- ═════════════════════════════════════════════════════════════════
-- Trigger — runs BEFORE INSERT so the row is never created when
-- the gate rejects. Fires before any AFTER triggers (e.g. the
-- existing handle_new_auth_user that creates the profile row),
-- so a rejected signup leaves no orphan state.
-- ═════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS gate_signup_trigger ON auth.users;

CREATE TRIGGER gate_signup_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.gate_new_auth_user_signup();


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION — should return one row showing the trigger exists
-- ═════════════════════════════════════════════════════════════════

SELECT
  tgname           AS trigger_name,
  tgrelid::regclass AS on_table,
  proname          AS calls_function,
  tgenabled        AS enabled    -- 'O' = enabled
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgname = 'gate_signup_trigger';


-- ═════════════════════════════════════════════════════════════════
-- ROLLBACK (paste back to re-open public signups)
-- ═════════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS gate_signup_trigger ON auth.users;
-- DROP FUNCTION IF EXISTS public.gate_new_auth_user_signup();
-- ─────────────────────────────────────────────────────────────────
