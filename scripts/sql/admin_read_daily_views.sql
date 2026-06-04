-- ─────────────────────────────────────────────────────────────────
-- Let admins SELECT all rows in daily_views
-- ─────────────────────────────────────────────────────────────────
-- WHY: The existing own_views_select policy on daily_views
-- restricts SELECT to auth.uid() = user_id. That's correct for
-- regular users (they should only see their own view history),
-- but it means the admin dashboard at /admin can't aggregate
-- views across all users — admins only see their own clicks.
-- Symptom: "Top Viewed Stocks (7 days)" shows "No view data yet"
-- even when other users have been browsing.
--
-- Fix: add a second SELECT policy that's true ONLY for is_admin()
-- callers. RLS policies are OR'd — a row is returned if ANY policy
-- allows it — so admins see everything (via this policy) AND their
-- own rows (via own_views_select, no change). Non-admins are
-- unaffected.
--
-- is_admin() is a SECURITY DEFINER helper that returns true when
-- the calling user has profiles.role = 'admin'. Restored to
-- authenticated EXECUTE in restore_auth_access.sql, so RLS
-- policies that call it work as expected.
--
-- Idempotent: DROP-then-CREATE. Re-running is safe.
-- ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins read all views" ON daily_views;
CREATE POLICY "Admins read all views"
  ON daily_views FOR SELECT
  TO authenticated
  USING (is_admin());


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═════════════════════════════════════════════════════════════════

-- 1. The new policy should appear alongside own_views_select.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'daily_views'
  AND cmd = 'SELECT'
ORDER BY policyname;
-- Expected: 2 rows — own_views_select + "Admins read all views"

-- 2. Sanity-check by simulating what the admin dashboard will see.
--    Run this AS yourself (admin) in SQL Editor — it should match
--    the row count visible from the service_role view.
SELECT COUNT(*) AS visible_to_me
FROM daily_views
WHERE viewed_date >= (current_date AT TIME ZONE 'Asia/Kolkata' - interval '6 days')::date;
-- Expected after this migration: matches the service_role count
-- (1 in your case, then growing as users browse).
