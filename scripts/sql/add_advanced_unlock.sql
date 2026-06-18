-- ── Advanced-tab progressive unlock ────────────────────────────────
-- Adds the gate columns on profiles + grandfathers every user who
-- has already been using PineX for > 3 days. Idempotent — re-runs
-- are no-ops on a current schema and no-ops on the seed UPDATE.
--
-- BACKGROUND
--   /breadth-lab (the Advanced tab) is being progressively unlocked
--   so brand-new users don't get dumped into market-internals charts
--   on day one. The gate is checked in three places:
--     1. src/lib/appNav.js  — the Advanced nav item is filtered out
--                              when !profile.advanced_unlocked && role
--                              is neither admin nor superadmin.
--     2. AuthContext        — eligibility check (current_streak >= 5)
--                              surfaces the AdvancedUnlock modal.
--     3. src/App.jsx        — the /breadth-lab route is wrapped in an
--                              AdvancedGate component that redirects
--                              to /home?advanced=locked when the user
--                              hasn't accepted.
--
--   The "I'm ready" button in the modal flips advanced_unlocked = true
--   and stamps advanced_unlocked_at = now() so we can track adoption.
--
-- SEED RULE
--   "Existing users get it automatically. Only new users go through
--   the journey." — anyone whose profiles.created_at is older than
--   3 days is auto-unlocked. The threshold matches the
--   academy_grandfathered convention already used elsewhere.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS advanced_unlocked    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS advanced_unlocked_at timestamptz;

-- Index supports the eligibility query path in AuthContext
-- (filter on advanced_unlocked = false). Partial — we only need
-- the locked rows.
CREATE INDEX IF NOT EXISTS idx_profiles_advanced_locked
  ON profiles (id)
  WHERE advanced_unlocked = false;

-- ── Grandfather seed ────────────────────────────────────────────
-- Mark every user who's been around > 3 days as already unlocked.
-- Stamp advanced_unlocked_at = created_at + 3 days so the
-- adoption-timeline analytics still tell a sensible story (their
-- 'unlock moment' is approximately when they would have hit the
-- streak gate in real time).
UPDATE profiles
SET advanced_unlocked    = true,
    advanced_unlocked_at = created_at + INTERVAL '3 days'
WHERE created_at < now() - INTERVAL '3 days'
  AND advanced_unlocked = false;
