-- ─────────────────────────────────────────────────────────────────
-- Morning Briefs — per-user daily card
-- ─────────────────────────────────────────────────────────────────
-- One row per (user_id, brief_date). Written by scripts/generate_
-- morning_briefs.py at the end of the daily pipeline. Read by the
-- Home page (logged-in users only) to render the personalised
-- card above the screener.
--
-- RLS: users can only read their own briefs. The generator script
-- runs as service_role and bypasses RLS, so writes don't need a
-- separate policy.
--
-- Idempotent: re-running the file is safe (CREATE IF NOT EXISTS +
-- DO blocks for the policy / grant).
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- Table
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS morning_briefs (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  brief_date         date        NOT NULL,
  market_character   text,
  breadth_pct        numeric,
  watchlist_total    int,
  watchlist_changed  int,
  changed_symbols    jsonb       DEFAULT '[]'::jsonb,
  top_sector         text,
  top_sector_trend   text,
  daily_question     text,
  created_at         timestamptz DEFAULT now(),
  UNIQUE (user_id, brief_date)
);

CREATE INDEX IF NOT EXISTS morning_briefs_user_date_idx
  ON morning_briefs (user_id, brief_date DESC);


-- ═════════════════════════════════════════════════════════════════
-- RLS — users read their own briefs only
-- ═════════════════════════════════════════════════════════════════

ALTER TABLE morning_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own briefs" ON morning_briefs;
CREATE POLICY "Users read own briefs"
  ON morning_briefs FOR SELECT
  USING (auth.uid() = user_id);


-- ═════════════════════════════════════════════════════════════════
-- Grants — REST endpoints need SELECT for the policy to apply
-- ═════════════════════════════════════════════════════════════════

GRANT SELECT ON morning_briefs TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════
-- Verification
-- ═════════════════════════════════════════════════════════════════

SELECT
  (SELECT COUNT(*) FROM morning_briefs) AS row_count,
  (SELECT COUNT(*) FROM pg_policies
    WHERE tablename = 'morning_briefs') AS policy_count;
