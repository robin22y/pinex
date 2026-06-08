-- ════════════════════════════════════════════════════════════════════════
-- research_notes — saved AI insights from the Research Assistant
-- ════════════════════════════════════════════════════════════════════════
-- Created for Feature 1 ("Save Research Notes") of the Research Assistant
-- enhancement set. Stores AI responses the user explicitly clicks 💾 on.
--
-- PRIVACY NOTE: the standing Research Assistant promise is "PineX never
-- sees your question or answer" — that holds for the Gemini conversation
-- itself (the request is made client-side to Google with the user's own
-- key, PineX servers are never in the loop). research_notes is a
-- separate, opt-in feature: rows only land here when the user clicks save
-- on a specific response, and RLS scopes reads/writes to the row's owner.
-- The user is the publisher; they consent by clicking save.
--
-- Schema choices:
--   - symbol NOT NULL — every note is anchored to a stock (or a
--     sentinel "_WATCHLIST" / "_COMPARE" for the watchlist-summary and
--     compare-stocks features that don't have a single owning stock).
--   - category — free-text label so frontend categories can evolve
--     without a migration. Existing values: valuation / growth /
--     shareholding / quarterly / cycle / trading / freetext /
--     watchlist_summary / compare.
--   - ON DELETE CASCADE on user_id so when a user deletes their account
--     their notes disappear with them.
--
-- Run in Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS research_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  company_name  TEXT,
  category      TEXT NOT NULL,
  response_text TEXT NOT NULL,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the two queries the app actually runs:
--   - ResearchNotes.jsx lists "all my notes, newest first"
--   - (future) per-stock filter when viewing a stock's research history
CREATE INDEX IF NOT EXISTS research_notes_user_saved_at_idx
  ON research_notes (user_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS research_notes_user_symbol_idx
  ON research_notes (user_id, symbol);

ALTER TABLE research_notes ENABLE ROW LEVEL SECURITY;

-- Drop+recreate so this migration is idempotent on re-runs.
DROP POLICY IF EXISTS "user reads own notes" ON research_notes;
CREATE POLICY "user reads own notes"
  ON research_notes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user writes own notes" ON research_notes;
CREATE POLICY "user writes own notes"
  ON research_notes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user deletes own notes" ON research_notes;
CREATE POLICY "user deletes own notes"
  ON research_notes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Verify
SELECT
  policyname,
  cmd,
  qual::text  AS using_expr,
  with_check::text AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'research_notes'
ORDER BY cmd, policyname;
