-- ════════════════════════════════════════════════════════════════════════
-- fix_pro_trial_system.sql
--
-- Reworks the Pro / trial / points economy:
--
--   1. Adds trial_expires_at to profiles (new column).
--   2. Recomputes profiles.points_balance from points_transactions
--      so the column tracks every event in history.
--      (Robin's spec called this `point_events`; the production table
--      we've been writing to since the awarder shipped is actually
--      `points_transactions`. Same semantic: each row carries
--      points = signed integer for the action.)
--   3. Backfills recent free signups into a 14-day Pro trial.
--      Older accounts (>30d old) stay on 'free' — they've had ample
--      time and shouldn't suddenly receive a free trial.
--
-- The frontend complements this migration:
--   - AuthContext sets plan='pro_trial' + trial_expires_at on new
--     signups (insertProfile), and downgrades to 'free' on hydrate
--     when trial_expires_at < now().
--   - The 1000-pt auto-flip is removed; Rewards.jsx's confirmation
--     modal is the only path that flips plan='pro' going forward.
--
-- Apply
--   Run once in Supabase SQL editor. Idempotent — the column ADD
--   uses IF NOT EXISTS and the backfill UPDATEs guard with a NULL
--   check.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Add trial_expires_at column ──────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

-- 2) Recompute points_balance from points_transactions ───────────
-- points_transactions.points carries the signed delta per event
-- (positive for awards, negative for deductions / redemptions).
-- Summing it gives the true running balance regardless of how many
-- events have happened. COALESCE(.., 0) handles users with zero
-- events (new accounts, accounts that never earned).
UPDATE public.profiles p
SET points_balance = COALESCE((
  SELECT SUM(pt.points)
  FROM public.points_transactions pt
  WHERE pt.user_id = p.id
), 0)
WHERE p.id IS NOT NULL;

-- 3) Backfill recent free signups into a 14-day Pro trial ────────
-- Two windows:
--   - Created in the last 30 days: trial = created_at + 14d
--     (gives newer accounts a real ramp without back-dating).
--   - Older accounts stay on 'free' (no surprise trial for dormant
--     legacy users).
-- The trial_expires_at IS NULL guard makes this rerunnable; once a
-- user has a trial timestamp we never reset it from this script.
UPDATE public.profiles
SET plan = 'pro_trial',
    trial_expires_at = created_at + INTERVAL '14 days'
WHERE plan = 'free'
  AND created_at > now() - INTERVAL '30 days'
  AND trial_expires_at IS NULL;
