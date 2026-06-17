-- ── Daily-streak columns (idempotent) ──────────────────────────────
-- The user's spec described columns on `profiles`, but the canonical
-- streak state actually lives on `user_points` (current_streak,
-- longest_streak, last_streak_date, last_active_date). This migration:
--
--   1. Confirms those columns exist on user_points — safe to re-run.
--   2. Re-asserts the update_user_streak() RPC's grants (the function
--      itself is defined in scripts/sql/add_update_user_streak_rpc.sql
--      and should be present; if it isn't, apply that file first).
--   3. Applies the per-user fix for robin22y@gmail.com — five
--      consecutive daily_login rows in points_transactions
--      (2026-06-13 through 2026-06-17) but his stored streak was
--      stuck at 1 because the RPC was only invoked from /account,
--      not on every login. Once the AuthContext change ships, this
--      manual fix isn't needed for new users.
--
-- ROLLBACK
--   None of the steps are destructive. The ALTER TABLE branches are
--   no-ops on a current schema; the UPDATE only touches the one row.

ALTER TABLE user_points
  ADD COLUMN IF NOT EXISTS current_streak    integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak    integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_streak_date  date,
  ADD COLUMN IF NOT EXISTS last_active_date  date;

-- Confirm the RPC exists; raise a notice if it doesn't so the operator
-- knows to apply add_update_user_streak_rpc.sql before relying on
-- the AuthContext call path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_user_streak'
  ) THEN
    RAISE NOTICE 'update_user_streak() RPC missing — apply scripts/sql/add_update_user_streak_rpc.sql';
  END IF;
END $$;

-- ── Manual fix for robin22y@gmail.com ───────────────────────────────
-- Five consecutive daily_login dates (2026-06-13 through 2026-06-17)
-- — verified from points_transactions. The frontend RPC will keep
-- this row honest going forward; this UPDATE just unwedges history.
UPDATE user_points
SET current_streak   = 5,
    longest_streak   = GREATEST(COALESCE(longest_streak, 0), 5),
    last_streak_date = CURRENT_DATE,
    last_active_date = CURRENT_DATE,
    updated_at       = now()
WHERE user_id = (
  SELECT id FROM profiles WHERE email = 'robin22y@gmail.com'
);
