-- user_saved_screens
-- Stores a user's saved Lab screens (template + criteria config) so they can
-- re-run a screen later. RLS-scoped to the owner. The Lab fails soft if this
-- table doesn't exist yet, so it's safe to deploy the frontend first.
--
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS user_saved_screens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  template_id     TEXT,
  criteria_config JSONB,
  universe        TEXT DEFAULT 'all',
  sort_by         TEXT DEFAULT 'rs',
  last_run        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_saved_screens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own saved screens" ON user_saved_screens;
CREATE POLICY "Users own saved screens" ON user_saved_screens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
