-- criteria_changes — day-over-day diff of swing conditions per stock.
--
-- One row per (symbol, trading_date) WHEN the conditions_met score
-- changes vs the prior trading day. The pipeline (calc_swing_conditions.py)
-- writes this table after upserting swing_conditions.
--
-- Existing readers (generate_descriptions.py + ResearchAssistant.jsx)
-- consume `gained` / `lost` already. This migration adds a third
-- column — `criteria_change_reason` — a plain-English summary that
-- the stock page renders below the criteria dots.
--
-- IDEMPOTENT — safe to re-run. CREATE … IF NOT EXISTS + ALTER … IF
-- NOT EXISTS guard every statement so this can be applied to schemas
-- where the table already exists (it does in this deployment) without
-- duplicating columns or constraints.

CREATE TABLE IF NOT EXISTS criteria_changes (
  id                      BIGSERIAL PRIMARY KEY,
  symbol                  TEXT NOT NULL,
  trading_date            DATE NOT NULL,
  gained                  TEXT[] NOT NULL DEFAULT '{}',
  lost                    TEXT[] NOT NULL DEFAULT '{}',
  criteria_change_reason  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT criteria_changes_symbol_date_uk UNIQUE (symbol, trading_date)
);

ALTER TABLE criteria_changes
  ADD COLUMN IF NOT EXISTS criteria_change_reason TEXT;

CREATE INDEX IF NOT EXISTS criteria_changes_symbol_date_idx
  ON criteria_changes (symbol, trading_date DESC);

-- Public read so the stock page can fetch without an auth context.
-- Writes happen via the service-key client in the pipeline, which
-- bypasses RLS — no INSERT/UPDATE policy needed.
ALTER TABLE criteria_changes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "criteria_changes public read"
    ON criteria_changes
    FOR SELECT
    TO anon, authenticated
    USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;
