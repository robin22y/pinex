-- ════════════════════════════════════════════════════════════════════════
-- security_protect_user_fields.sql
--
-- Prevent users from self-upgrading by directly writing to
-- profiles.plan / role from the browser console.
--
-- NOTE on subscription_status:
--   The original spec also listed `subscription_status` as a column to
--   protect. That column DOES NOT EXIST on profiles in the current
--   schema — adding it errors with 42703. Once you introduce it for
--   the paid-launch billing layer, add it to BOTH:
--     1. the REVOKE UPDATE list below, and
--     2. the WITH CHECK clause of the RLS policy below.
--   A `DO $$ … IF EXISTS …` guard would make this self-healing, but
--   keeping the protection list explicit makes review easier — the
--   columns a console-attack can't change are listed verbatim.
--
-- Two layers of defense for plan + role:
--   1. Column-level REVOKE — Postgres rejects the UPDATE before RLS
--      evaluates if it touches a revoked column.
--   2. Row-level policy — backup if column GRANTs ever get restored.
--
-- Service-role retains full access (admin pages, backfill scripts,
-- payment webhook writes still work). User can still update everything
-- else on their own profile (full_name, telegram_*, language prefs).
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── LAYER 1: column-level REVOKE ────────────────────────────────────────
-- Postgres rejects any UPDATE that touches a column the role lacks
-- permission for, BEFORE RLS evaluates. No SQL injection, no RLS
-- subquery trickery bypasses this.
--
-- When paid-launch adds subscription_status, change this line to:
--   REVOKE UPDATE (plan, role, subscription_status) ON profiles FROM authenticated;
REVOKE UPDATE (plan, role) ON profiles FROM authenticated;

-- ── LAYER 2: row-level policy ───────────────────────────────────────────
-- Backup policy in case column GRANTs are restored by a future
-- migration. Subqueries inside WITH CHECK read the OLD row state — the
-- UPDATE is uncommitted at that point — so NEW.plan = OLD.plan is the
-- actual semantics.
--
-- IS NOT DISTINCT FROM treats NULL == NULL as true (regular = would
-- fail when both are NULL — e.g. for users who never got a plan set).
--
-- Drop any earlier version so this file is re-runnable.
DROP POLICY IF EXISTS "users cannot self-upgrade plan" ON profiles;

CREATE POLICY "users cannot self-upgrade plan"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    plan IS NOT DISTINCT FROM (
      SELECT plan FROM profiles WHERE id = auth.uid()
    )
    AND role IS NOT DISTINCT FROM (
      SELECT role FROM profiles WHERE id = auth.uid()
    )
    -- When paid-launch adds subscription_status, append:
    --   AND subscription_status IS NOT DISTINCT FROM (
    --     SELECT subscription_status FROM profiles WHERE id = auth.uid()
    --   )
  );

-- ── Verification ────────────────────────────────────────────────────────
-- As a non-admin user in DevTools console, the following should fail
-- with a "permission denied for column plan" error:
--
--   supabase.from('profiles').update({ plan: 'paid' })
--     .eq('id', '<your-uid>')
--
-- And this should fail with the same column-permission error on role:
--
--   supabase.from('profiles').update({ role: 'superadmin' })
--     .eq('id', '<your-uid>')
--
-- Regular profile updates still work:
--
--   supabase.from('profiles').update({ full_name: 'New Name' })
--     .eq('id', '<your-uid>')
--
-- As service-role (admin pages, webhooks, scripts), all updates work.
