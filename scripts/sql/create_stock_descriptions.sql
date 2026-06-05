-- ─────────────────────────────────────────────────────────────────
-- Stock Descriptions — per-stock daily prose card
-- ─────────────────────────────────────────────────────────────────
-- One row per (symbol, trading_date). Backs the StockDetail v2
-- "Quiet Clarity" prose block: the human-readable narrative, the
-- Malayalam one-liner, and the four Q&A fields (was it stage 2
-- before? / how long? / sector? / what changed?). Written by the
-- description-generation step of the daily pipeline and read by
-- the StockDetail page when a user opens a symbol.
--
-- The phase / criteria_score / days_in_phase columns are
-- denormalised snapshots of the screener row at generation time
-- so the prose stays consistent even if the live screener row
-- shifts later in the day.
--
-- RLS: public read — anyone can view a stock's description.
-- The generator script runs as service_role and bypasses RLS,
-- so writes don't need a separate policy.
--
-- Idempotent: re-running the file is safe (CREATE IF NOT EXISTS +
-- DROP POLICY IF EXISTS + CREATE POLICY pattern).
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- Table
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_descriptions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol                   text        NOT NULL,
  trading_date             date        NOT NULL,
  phase                    text,
  phase_label              text,
  criteria_score           integer,
  days_in_phase            integer,
  sector                   text,
  sector_breadth_pct       numeric,
  score_changed_today      boolean,
  criteria_gained          jsonb,
  criteria_lost            jsonb,
  narrative                text,
  malayalam_line           text,
  -- Cycle narrative — one column per accordion in StockDetail.jsx
  -- CYCLE_ACCORDIONS. Keep these aligned with the prompt fields in
  -- scripts/generate_descriptions.py _build_user_prompt().
  whats_happening          text,
  why_this_phase           text,
  what_changes             text,
  broader_cycle            text,
  -- Legacy qa_* columns kept nullable for historical rows. New rows
  -- do not populate these — superseded by the four cycle-narrative
  -- columns above. Safe to drop after a future cleanup pass.
  qa_was_it_stage2_before  text,
  qa_how_long              text,
  qa_sector                text,
  qa_what_changed          text,
  generated_at             timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (symbol, trading_date)
);


-- ═════════════════════════════════════════════════════════════════
-- Indexes — fast latest-row lookup by symbol
-- ═════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS stock_descriptions_symbol_date_idx
  ON stock_descriptions (symbol, trading_date DESC);


-- ═════════════════════════════════════════════════════════════════
-- RLS — public read
-- ═════════════════════════════════════════════════════════════════

ALTER TABLE stock_descriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read stock_descriptions" ON stock_descriptions;
CREATE POLICY "Public read stock_descriptions"
  ON stock_descriptions FOR SELECT
  USING (true);


-- ═════════════════════════════════════════════════════════════════
-- Grants — REST endpoints need SELECT for the policy to apply
-- ═════════════════════════════════════════════════════════════════

GRANT SELECT ON stock_descriptions TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════
-- Verification
-- ═════════════════════════════════════════════════════════════════

SELECT
  (SELECT COUNT(*) FROM stock_descriptions) AS row_count,
  (SELECT COUNT(*) FROM pg_policies
    WHERE tablename = 'stock_descriptions') AS policy_count,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE tablename = 'stock_descriptions') AS index_count;
