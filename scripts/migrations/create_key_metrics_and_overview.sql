-- ── key_metrics + company_overview ─────────────────────────────────
-- Two stores populated weekly from IndianAPI so the Research
-- Assistant can ground its responses in OUR data instead of
-- Gemini's training distribution.
--
-- key_metrics       — 15 standard fundamentals per symbol
-- company_overview  — narrative profile fields (about, business
--                     model, products/brands, founding, HQ, etc.)
--
-- Both tables:
--   * UNIQUE on symbol (one row per stock — weekly upsert
--     overwrites)
--   * Public read RLS (the JS Research Assistant reads with the
--     anon key; writes happen via the pipeline's service-key
--     client which bypasses RLS — no INSERT/UPDATE policy needed)
--
-- IDEMPOTENT — safe to re-apply. Every CREATE / ALTER / CREATE
-- POLICY uses IF NOT EXISTS or wraps in DO $$ ... EXCEPTION block.

CREATE TABLE IF NOT EXISTS key_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT UNIQUE NOT NULL,
  market_cap      NUMERIC,
  pe_ratio        NUMERIC,
  pb_ratio        NUMERIC,
  ev_ebitda       NUMERIC,
  de_ratio        NUMERIC,
  current_ratio   NUMERIC,
  roe             NUMERIC,
  roce            NUMERIC,
  eps_ttm         NUMERIC,
  revenue_ttm     NUMERIC,
  pat_ttm         NUMERIC,
  dividend_yield  NUMERIC,
  face_value      NUMERIC,
  book_value      NUMERIC,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS key_metrics_symbol_idx ON key_metrics (symbol);

ALTER TABLE key_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "public reads key_metrics"
    ON key_metrics FOR SELECT
    TO anon, authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS company_overview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT UNIQUE NOT NULL,
  about           TEXT,
  business_model  TEXT,
  products_brands TEXT,
  founded_year    INTEGER,
  headquarters    TEXT,
  employee_count  INTEGER,
  promoter_names  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS company_overview_symbol_idx ON company_overview (symbol);

ALTER TABLE company_overview ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "public reads company_overview"
    ON company_overview FOR SELECT
    TO anon, authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
