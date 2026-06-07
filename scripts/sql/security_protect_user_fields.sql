-- ════════════════════════════════════════════════════════════════════════
-- security_protect_user_fields.sql
--
-- Prevent users from self-upgrading by directly writing to
-- profiles.plan / subscription_status / role from the browser console.
--
-- Two layers of defense:
--   1. Column-level REVOKE — the authenticated role literally cannot
--      issue UPDATE statements that touch these columns. Postgres
--      rejects the statement before RLS even runs.
--   2. Row-level policy — backup: if a future migration restores the
--      column GRANTs by accident, RLS still blocks the change.
--
-- Service-role retains full access (admin pages, backfill scripts,
-- payment webhook writes still work). User can still update everything
-- else on their own profile (full_name, telegram_*, language prefs,
-- etc.) via the existing self-update policy.
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── LAYER 1: column-level REVOKE ────────────────────────────────────────
-- This is the strongest guarantee. Postgres GRANT/REVOKE supports
-- per-column UPDATE permissions. With these revokes in place, even an
-- authenticated user calling supabase.from('profiles').update({plan:'paid'})
-- from the console gets a "permission denied for column" error from
-- Postgres BEFORE RLS evaluates. No SQL injection or RLS bypass can
-- get around this.
REVOKE UPDATE (plan, subscription_status, role) ON profiles FROM authenticated;

-- If you later need a column to be user-editable, GRANT it back:
--   GRANT UPDATE (some_column) ON profiles TO authenticated;
-- — but never plan / subscription_status / role.

-- ── LAYER 2: row-level policy ───────────────────────────────────────────
-- Backup policy in case column GRANTs are accidentally restored by a
-- future migration. The USING clause restricts who can update their own
-- row (the existing pattern); WITH CHECK uses subqueries that read the
-- OLD row state — at WITH CHECK evaluation time the UPDATE is
-- uncommitted, so the subquery returns the pre-update value.
--
-- If NEW.plan == OLD.plan AND NEW.subscription_status == OLD.subscription_status
-- AND NEW.role == OLD.role, the update passes — i.e. the user changed
-- something OTHER than the protected columns.
--
-- Drop any earlier version first so this is re-runnable.
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
    AND subscription_status IS NOT DISTINCT FROM (
      SELECT subscription_status FROM profiles WHERE id = auth.uid()
    )
    AND role IS NOT DISTINCT FROM (
      SELECT role FROM profiles WHERE id = auth.uid()
    )
  );

-- ── Verification ────────────────────────────────────────────────────────
-- As a non-admin user in DevTools console, the following should fail
-- with a permission-denied or RLS-violation error:
--
--   supabase.from('profiles').update({ plan: 'paid' })
--     .eq('id', '<your-uid>')
--
-- As service-role (admin pages, webhooks, scripts), the same call works.
--
-- robin22y@gmail.com is superadmin via setup_admin_role_and_telegram_subscribers.sql,
-- but superadmin status is checked through role-based policies on OTHER
-- tables. To change a user's plan/role/subscription_status as an admin,
-- write a SECURITY DEFINER function or use the service-role key — never
-- expose these fields to direct client UPDATEs.
