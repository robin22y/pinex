-- ── Schema bump for fetch_fundamentals_yf.py ───────────────────────
-- The yfinance fetcher exposes more fields than the IndianAPI one
-- (forward_pe, roa, the margin / growth pair, beta, 52W high/low).
-- Existing IndianAPI columns are kept untouched — both fetchers can
-- coexist; whichever ran last wins on overlapping fields. The yf
-- fetcher also splits quarterly results into its own table because
-- yfinance returns dated quarter-end rows that don't align with the
-- IndianAPI quarter strings.
--
-- IDEMPOTENT — every column + table + policy is guarded by IF NOT
-- EXISTS / DO $$ EXCEPTION. Safe to re-apply.

-- ── key_metrics — extra yfinance columns ───────────────────────────
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS forward_pe          NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS roa                 NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS profit_margins      NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS operating_margins   NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS revenue_growth      NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS earnings_growth     NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS beta                NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS fifty_two_week_high NUMERIC;
ALTER TABLE key_metrics ADD COLUMN IF NOT EXISTS fifty_two_week_low  NUMERIC;


-- ── quarterly_financials_yf — new table ────────────────────────────
-- One row per (symbol, quarter_end). Quarter-end is a calendar date
-- (yfinance returns date-typed columns), so the conflict key keeps
-- a maximum of 4 rows per stock when the fetcher caps to the last
-- 4 quarters.
CREATE TABLE IF NOT EXISTS quarterly_financials_yf (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            TEXT NOT NULL,
  quarter_end       DATE NOT NULL,
  revenue           NUMERIC,
  gross_profit      NUMERIC,
  operating_income  NUMERIC,
  net_income        NUMERIC,
  ebitda            NUMERIC,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quarterly_financials_yf_symbol_quarter_uk
    UNIQUE (symbol, quarter_end)
);

CREATE INDEX IF NOT EXISTS quarterly_financials_yf_symbol_idx
  ON quarterly_financials_yf (symbol, quarter_end DESC);

ALTER TABLE quarterly_financials_yf ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "public reads quarterly_financials_yf"
    ON quarterly_financials_yf FOR SELECT
    TO anon, authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
