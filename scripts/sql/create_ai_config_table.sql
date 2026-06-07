-- ── ai_config ────────────────────────────────────────────────────────────
-- Single source of truth for Gemini model names across:
--   * pipeline scripts (server-side, our cost — use lite/cheap model)
--   * Research Assistant client BYOK calls (user's cost — use better model)
--   * daily question + sector overview generators (server-side)
--
-- When Google releases a new model, an admin can change the model name
-- here without a code deployment. All callers read this table at
-- runtime with a hardcoded fallback so a missing/stale config row
-- never crashes the pipeline.
--
-- Run in Supabase SQL editor. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS ai_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key    TEXT UNIQUE NOT NULL,
  config_value  TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  description   TEXT,
  category      TEXT DEFAULT 'gemini',
  is_active     BOOLEAN DEFAULT true,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;

-- Public reads — every browser session needs the current model strings.
DROP POLICY IF EXISTS "public reads ai_config" ON ai_config;
CREATE POLICY "public reads ai_config"
  ON ai_config FOR SELECT
  USING (true);

-- Admin-only writes — anyone in profiles.role IN ('admin','superadmin')
-- can INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "admin writes ai_config" ON ai_config;
CREATE POLICY "admin writes ai_config"
  ON ai_config FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  );

GRANT SELECT ON ai_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON ai_config TO authenticated;

-- ── Seed default model rows ─────────────────────────────────────────────
-- ON CONFLICT DO NOTHING means re-running this migration won't clobber
-- values an admin has edited from the dashboard.

INSERT INTO ai_config
  (config_key, config_value, display_name, description, category)
VALUES
  (
    'gemini_pipeline_model',
    'gemini-2.5-flash-lite',
    'Pipeline Model (server-side)',
    'Used for daily stock description generation. Runs on your API key. Use a lite/cheap model here.',
    'gemini'
  ),
  (
    'gemini_research_model',
    'gemini-2.5-flash',
    'Research Assistant Model (client)',
    'Used for user Research Assistant queries. Runs on user''s own API key. Can use a better quality model since user pays.',
    'gemini'
  ),
  (
    'gemini_question_model',
    'gemini-2.5-flash-lite',
    'Daily Question Generator',
    'Used to generate daily questions in admin panel. Runs on your key.',
    'gemini'
  ),
  (
    'gemini_sector_model',
    'gemini-2.5-flash-lite',
    'Sector Overview Generator',
    'Used for sector AI overviews. Runs on your API key.',
    'gemini'
  )
ON CONFLICT (config_key) DO NOTHING;
