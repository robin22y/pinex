-- ============================================================
-- Migration: IndianAPI integration
-- Run once in Supabase SQL editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. financials — add missing columns
-- ------------------------------------------------------------
ALTER TABLE financials
  ADD COLUMN IF NOT EXISTS pat_growth_qoq  numeric,
  ADD COLUMN IF NOT EXISTS pat_growth_yoy  numeric,
  ADD COLUMN IF NOT EXISTS data_source     text DEFAULT 'screener';

-- ------------------------------------------------------------
-- 2. shareholding — add missing columns
-- ------------------------------------------------------------
ALTER TABLE shareholding
  ADD COLUMN IF NOT EXISTS dii_pct       numeric,
  ADD COLUMN IF NOT EXISTS public_pct    numeric,
  ADD COLUMN IF NOT EXISTS total_pct     numeric,
  ADD COLUMN IF NOT EXISTS data_source   text DEFAULT 'screener';

-- ------------------------------------------------------------
-- 3. stock_news — new table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_news (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol              text        NOT NULL,
  company_id          uuid        REFERENCES companies(id),
  title               text,
  url                 text        NOT NULL,
  source              text,
  published_at        timestamptz,
  fetched_date        date        NOT NULL,
  sentiment_score     smallint    CHECK (sentiment_score BETWEEN 1 AND 10),
  sentiment_scored_at timestamptz,
  updated_at          timestamptz DEFAULT now(),
  UNIQUE(symbol, url)
);

CREATE INDEX IF NOT EXISTS idx_stock_news_symbol
  ON stock_news(symbol);

CREATE INDEX IF NOT EXISTS idx_stock_news_fetched_date
  ON stock_news(fetched_date DESC);

-- If stock_news already existed without sentiment columns:
ALTER TABLE stock_news
  ADD COLUMN IF NOT EXISTS sentiment_score smallint,
  ADD COLUMN IF NOT EXISTS sentiment_scored_at timestamptz;

-- Named check so we can replace if re-run (optional; skip if constraint already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'stock_news'
      AND c.conname = 'stock_news_sentiment_score_check'
  ) THEN
    ALTER TABLE stock_news
      ADD CONSTRAINT stock_news_sentiment_score_check
      CHECK (sentiment_score BETWEEN 1 AND 10);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. corporate_actions — new table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS corporate_actions (
  id          uuid  DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol      text  NOT NULL,
  company_id  uuid  REFERENCES companies(id),
  action_type text,
  ex_date     date,
  record_date date,
  details     jsonb,
  data_source text  DEFAULT 'indianapi',
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(symbol, action_type, ex_date)
);

CREATE INDEX IF NOT EXISTS idx_corporate_actions_symbol
  ON corporate_actions(symbol);

CREATE INDEX IF NOT EXISTS idx_corporate_actions_ex_date
  ON corporate_actions(ex_date DESC);
