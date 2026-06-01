-- ─────────────────────────────────────────────────────────────────
-- Phase 1: Mansfield RS column + Nifty history table
-- ─────────────────────────────────────────────────────────────────
-- Adds the schema needed for textbook Mansfield Relative Strength:
--
--   RP_raw[t]      = stock_close[t] / nifty_close[t]
--   RP_smoothed[t] = SMA(RP_raw, 252)[t]
--   mansfield_rs[t] = (RP_raw[t] / RP_smoothed[t] - 1) × 100
--
-- The 252-day smoothing is roughly 52 weeks (textbook Mansfield).
-- Cross above 0 = stock now outperforming Nifty on a smoothed basis.
--
-- Two changes:
--   1. price_data.mansfield_rs       (per-row, time series)
--   2. nifty_history table           (one row per trading day)
--
-- Both nullable so existing rows degrade gracefully until backfill
-- runs (scripts/compute_mansfield_rs.py).
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- price_data.mansfield_rs
-- ═════════════════════════════════════════════════════════════════
-- One value per stock per trading day. Stored as numeric (not
-- double precision) for consistent rounding across the API
-- boundary. Null until the compute pass populates it.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE price_data
  ADD COLUMN IF NOT EXISTS mansfield_rs numeric;

-- Helpful index for chart queries that fetch a single stock's
-- Mansfield series across recent dates.
CREATE INDEX IF NOT EXISTS idx_price_data_mansfield_lookup
  ON price_data(company_id, date)
  WHERE mansfield_rs IS NOT NULL;


-- ═════════════════════════════════════════════════════════════════
-- nifty_history — Nifty 50 daily closes (for Mansfield + breadth)
-- ═════════════════════════════════════════════════════════════════
-- Dedicated table so Nifty data is independent of any per-stock
-- table. Populated by scripts/fetch_nifty_history.py (yfinance
-- ^NSEI; bhav copy doesn't include indices).
--
-- date is the PK; one row per trading day.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nifty_history (
  date         date PRIMARY KEY,
  close        numeric NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS: nifty data is public market data, read-only for everyone
-- (anon + authenticated). Writes happen via service_role (pipeline).
ALTER TABLE nifty_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nifty_history_select ON nifty_history;
CREATE POLICY nifty_history_select ON nifty_history
  FOR SELECT TO anon, authenticated USING (true);


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION — every row should return 0 if both objects exist
-- ═════════════════════════════════════════════════════════════════

SELECT 'price_data.mansfield_rs missing' AS check_failed
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'price_data'
    AND column_name = 'mansfield_rs'
);

SELECT 'nifty_history table missing' AS check_failed
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'nifty_history'
);


-- ═════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═════════════════════════════════════════════════════════════════
-- DROP INDEX IF EXISTS idx_price_data_mansfield_lookup;
-- ALTER TABLE price_data DROP COLUMN IF EXISTS mansfield_rs;
-- DROP POLICY IF EXISTS nifty_history_select ON nifty_history;
-- DROP TABLE IF EXISTS nifty_history;
-- ─────────────────────────────────────────────────────────────────
