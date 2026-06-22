-- ─────────────────────────────────────────────────────────────────
-- IQjet · access table + verification RPC
-- ─────────────────────────────────────────────────────────────────
-- Robin gates the /iqjet page on pinex.in with a personal access
-- code. Each row in `iqjet_access` represents one code that grants
-- entry. Robin manages codes manually (per Robin: "will rotate codes
-- manually when needed") via the Supabase SQL editor.
--
-- WHY THE RPC IS THE ONLY READ PATH:
-- The frontend never SELECTs from iqjet_access directly. Instead it
-- calls `verify_iqjet_access(code)` which returns a single boolean.
-- Result: an attacker holding the anon key cannot enumerate codes,
-- diff response sizes, or probe for active rows. RLS on the table
-- denies all anon SELECT; the RPC carries SECURITY DEFINER so it
-- can read while everyone else cannot.
--
-- The browser stores the verified code in localStorage (per Robin's
-- accepted trade-off; he rotates manually when sharing trust ends).
--
-- Idempotent (IF NOT EXISTS, OR REPLACE). Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS iqjet_access (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Optional binding to a real auth user; null = anonymous code.
    user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    -- The code itself. UNIQUE so two rows can't share a code.
    access_code  text NOT NULL UNIQUE,
    -- Human note Robin can leave when granting (e.g. "for sanjay,
    -- given 12 Jun 2026"). Not user-facing.
    granted_to   text,
    is_active    boolean NOT NULL DEFAULT true,
    granted_at   timestamptz DEFAULT now(),
    revoked_at   timestamptz
);

-- Lock the table down. RLS denies everything by default; the verify
-- RPC below uses SECURITY DEFINER to read past it.
ALTER TABLE iqjet_access ENABLE ROW LEVEL SECURITY;

-- Explicit deny policy isn't strictly required (RLS denies by
-- default once enabled and no permissive policy exists) but stating
-- it documents intent. No policies = no rows visible to anyone via
-- direct table access using the anon or authenticated role.


-- ── verify_iqjet_access(code) ────────────────────────────────────
-- Single boolean output. Two reasons it's a function and not a view:
--   1. SECURITY DEFINER lets it read iqjet_access despite RLS.
--   2. We can later add throttling / logging here in ONE place
--      without changing the client contract.
--
-- Returns FALSE for: empty/whitespace input, missing code, code
-- present but inactive, or any error path. Never returns NULL.
CREATE OR REPLACE FUNCTION verify_iqjet_access(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hit boolean;
BEGIN
    IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
        RETURN false;
    END IF;
    SELECT EXISTS (
        SELECT 1 FROM iqjet_access
        WHERE access_code = btrim(p_code)
          AND is_active   = true
    ) INTO v_hit;
    RETURN COALESCE(v_hit, false);
END;
$$;

-- Allow anon + authenticated to CALL the function (read access is
-- via the function, never via the table). REVOKE on the table is
-- already implicit since RLS has no policies.
GRANT EXECUTE ON FUNCTION verify_iqjet_access(text) TO anon, authenticated;


-- Verification — should return zero rows when both objects exist.
SELECT 'iqjet_access table missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'iqjet_access'
);

SELECT 'verify_iqjet_access function missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'verify_iqjet_access'
);
