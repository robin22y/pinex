-- ─────────────────────────────────────────────────────────────────
-- iqjet_access — passcode-based gate for the /iqjet subscriber page.
-- ─────────────────────────────────────────────────────────────────
--
-- One row per granted access. Robin generates a passcode (format
-- "IQJET-XXXXXX") from the admin panel; the row may either be
-- pre-bound to a specific user (user_id set) or unclaimed
-- (user_id IS NULL). When the recipient enters the passcode on
-- their /profile page, claim_iqjet_passcode() binds it to their
-- auth.uid and records last_used_at.
--
-- Expiry is enforced at query time — no cron, no background job.
-- The verify_iqjet_access() RPC checks is_active = true AND
-- expires_at > now() on every page load.
--
-- Idempotent. Safe to re-apply.

CREATE TABLE IF NOT EXISTS public.iqjet_access (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  passcode      text NOT NULL UNIQUE,
  granted_by    text DEFAULT 'robin22y@gmail.com',
  granted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_used_at  timestamptz,
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_iqjet_access_user
  ON public.iqjet_access (user_id);

CREATE INDEX IF NOT EXISTS idx_iqjet_access_passcode
  ON public.iqjet_access (passcode);

ALTER TABLE public.iqjet_access ENABLE ROW LEVEL SECURITY;

-- ── Read policies ────────────────────────────────────────────────
-- Normal users see only their own row (used by the Profile page's
-- IQjet section to render the current state). Admin sees everything
-- so the IQjetAccessManager can list all rows.
DROP POLICY IF EXISTS iqjet_access_user_select ON public.iqjet_access;
CREATE POLICY iqjet_access_user_select
  ON public.iqjet_access
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS iqjet_access_admin_select ON public.iqjet_access;
CREATE POLICY iqjet_access_admin_select
  ON public.iqjet_access
  FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'email' = 'robin22y@gmail.com');

-- ── Write policies ───────────────────────────────────────────────
-- Only the admin email writes directly. End users go through the
-- claim_iqjet_passcode() RPC which runs SECURITY DEFINER and
-- bypasses RLS — that's the only path that can set user_id on a
-- previously-unclaimed row.
DROP POLICY IF EXISTS iqjet_access_admin_insert ON public.iqjet_access;
CREATE POLICY iqjet_access_admin_insert
  ON public.iqjet_access
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' = 'robin22y@gmail.com');

DROP POLICY IF EXISTS iqjet_access_admin_update ON public.iqjet_access;
CREATE POLICY iqjet_access_admin_update
  ON public.iqjet_access
  FOR UPDATE
  TO authenticated
  USING      (auth.jwt() ->> 'email' = 'robin22y@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'robin22y@gmail.com');

DROP POLICY IF EXISTS iqjet_access_admin_delete ON public.iqjet_access;
CREATE POLICY iqjet_access_admin_delete
  ON public.iqjet_access
  FOR DELETE
  TO authenticated
  USING (auth.jwt() ->> 'email' = 'robin22y@gmail.com');


-- ─────────────────────────────────────────────────────────────────
-- claim_iqjet_passcode(p_passcode) — atomic claim by the caller.
-- ─────────────────────────────────────────────────────────────────
-- Returns jsonb with shape:
--   { ok: bool, reason?: 'not_found' | 'expired' | 'revoked' | 'taken'
--                       | 'not_signed_in',
--     expires_at?: text }
--
-- SINGLE-USE RULE:
--   Once a row's user_id is set, the passcode is BOUND to that user
--   forever. Subsequent calls by any other auth.uid() return
--   reason='taken'. The current owner can re-call the RPC to refresh
--   last_used_at; that's the only reason the binding check accepts
--   user_id = auth.uid() instead of strictly requiring NULL.
--
-- Race-safety:
--   The UPDATE filters on (user_id IS NULL OR user_id = caller) so
--   even if two transactions both pass the read-side check, only one
--   wins the write. We then read GET DIAGNOSTICS ROW_COUNT and reject
--   with reason='taken' if zero rows were updated.
--
-- SECURITY DEFINER so it can update user_id even when the caller's
-- RLS prevents direct writes. Bound to the authenticated caller via
-- auth.uid().

DROP FUNCTION IF EXISTS public.claim_iqjet_passcode(text);
CREATE OR REPLACE FUNCTION public.claim_iqjet_passcode(p_passcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.iqjet_access;
  v_uid     uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  SELECT * INTO v_row
  FROM public.iqjet_access
  WHERE passcode = p_passcode
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_row.is_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;

  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired',
      'expires_at', to_char(v_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  END IF;

  -- Atomic claim. ZERO rows update when the passcode is already
  -- bound to someone else — that's our race-safe "taken" detection.
  UPDATE public.iqjet_access
  SET user_id      = v_uid,
      last_used_at = now()
  WHERE id        = v_row.id
    AND (user_id IS NULL OR user_id = v_uid);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END IF;

  RETURN jsonb_build_object('ok', true,
    'expires_at', to_char(v_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_iqjet_passcode(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_iqjet_passcode(text) TO authenticated;


-- ─────────────────────────────────────────────────────────────────
-- verify_iqjet_access() — boolean gate for /iqjet page load.
-- ─────────────────────────────────────────────────────────────────
-- Returns true iff the calling user has an active, non-expired
-- iqjet_access row. The admin email always returns true so Robin
-- can never lock himself out.

DROP FUNCTION IF EXISTS public.verify_iqjet_access();
CREATE OR REPLACE FUNCTION public.verify_iqjet_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.jwt() ->> 'email' = 'robin22y@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.iqjet_access
      WHERE user_id    = auth.uid()
        AND is_active  = true
        AND expires_at > now()
    );
$$;

REVOKE EXECUTE ON FUNCTION public.verify_iqjet_access() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_iqjet_access() TO authenticated;


-- ─────────────────────────────────────────────────────────────────
-- iqjet_access_with_email — convenience view for the admin panel.
-- ─────────────────────────────────────────────────────────────────
-- Joins profiles so the manager UI can render the email column
-- without a second round-trip. Read-only; the admin SELECT policy
-- on iqjet_access cascades through the view.

CREATE OR REPLACE VIEW public.iqjet_access_with_email AS
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


-- Verification
SELECT 'iqjet_access table missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'iqjet_access'
);

SELECT 'claim_iqjet_passcode function missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'claim_iqjet_passcode'
);

SELECT 'verify_iqjet_access function missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'verify_iqjet_access'
);
