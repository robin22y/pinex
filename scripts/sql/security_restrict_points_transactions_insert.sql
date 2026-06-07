-- ════════════════════════════════════════════════════════════════════════
-- security_restrict_points_transactions_insert.sql
--
-- Tighten the INSERT policy on points_transactions so that users
-- writing from the browser console can ONLY insert rows for:
--   - their own user_id
--   - one of the client-allowed action_types
--
-- Without this restriction, a sophisticated user could open DevTools
-- and call:
--   supabase.from('points_transactions').insert({
--     user_id: <self>,
--     points: 100000,
--     action_type: 'admin_bonus'
--   })
-- — and award themselves arbitrary points.
--
-- After this policy, the only action_types the browser can write are
-- the legitimate user-earned ones. Admin/system action types must come
-- through service-role (admin pages, scripts) which bypasses RLS.
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- Drop earlier INSERT policies — we replace with a single tight one.
DROP POLICY IF EXISTS "users insert own points"            ON points_transactions;
DROP POLICY IF EXISTS "users insert own points_transactions" ON points_transactions;
DROP POLICY IF EXISTS "users can insert points"            ON points_transactions;
DROP POLICY IF EXISTS "client insert points_transactions"  ON points_transactions;

-- Single source of truth: users may INSERT rows only for themselves and
-- only with one of these action_types. Everything else is denied.
--
-- Whitelist comes from src/lib/pointsAwarder.js + src/components/*.
-- If you add a new client-side action, add it to this list AND to the
-- pointsAwarder action constant array.
CREATE POLICY "client insert points_transactions"
  ON points_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND action_type IN (
      -- User-earned actions (legitimate browser-side writes)
      'daily_login',
      'daily_question',
      'classify_stock',
      'run_screen',
      'read_methodology',
      'research_question'
    )
  );

-- Admin / system action types — NOT covered by the policy above, so
-- they are DENIED for any authenticated session. Service-role bypasses
-- RLS, so these all still work when written by:
--   - Admin pages running with service-role (BonusModal in AdminPoints)
--   - Backfill scripts (retroactive_*, founding_*)
--   - Academy completion handler (assessment_*)
--   - One-off bonuses (admin_bonus)
--
-- Confirmation list for grep-ability — these MUST go through service-role:
--   admin_bonus
--   founding_member, founding_*
--   retroactive_signup, retroactive_*
--   assessment_pass, assessment_*
--   referral_*               (referral payouts run server-side)

-- ── Verification ────────────────────────────────────────────────────────
-- As a normal authenticated user in DevTools:
--   supabase.from('points_transactions').insert({
--     user_id: '<self>',
--     points: 999,
--     action_type: 'admin_bonus'
--   })
-- Should error: "new row violates row-level security policy"
--
-- The same insert with action_type='daily_login' should succeed (subject
-- to daily_cap from points_config — that's a separate guard).
--
-- From an admin page using service-role:
--   supabase.from('points_transactions').insert({
--     user_id, points: 50, action_type: 'admin_bonus', notes: '...'
--   })
-- Continues to work — service-role bypasses RLS entirely.
