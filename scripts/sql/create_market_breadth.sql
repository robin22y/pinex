-- market_breadth — per-trading-date A/D and cumulative A-D line.
--
-- Written daily by scripts/calc_market_breadth.py. Read by the Pulse
-- page's AdvanceDeclineLine chart (90-day series) and any other
-- breadth-momentum surfaces.
--
-- Why a separate table from market_internals?
--   market_internals is one row per date describing today's session
--   (above_ma30w_pct, stage counts, vix, etc.) — point-in-time signals.
--   market_breadth is a time-series of running A-D so the chart can
--   render a multi-day trend without recomputing the cumulative on
--   each page load. The Python script rebuilds the cumulative across
--   the last 90 days on every run, so the values stay self-consistent
--   even if a historical row gets backfilled or corrected.
--
-- Idempotent — safe to re-run. Creates the table if missing, then adds
-- any new columns that aren't there yet.

CREATE TABLE IF NOT EXISTS market_breadth (
  trading_date   DATE PRIMARY KEY,
  advances       INTEGER,
  declines       INTEGER,
  unchanged      INTEGER,
  ad_daily       INTEGER,
  ad_cumulative  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE market_breadth
  ADD COLUMN IF NOT EXISTS ad_cumulative INTEGER,
  ADD COLUMN IF NOT EXISTS ad_daily      INTEGER,
  ADD COLUMN IF NOT EXISTS advances      INTEGER,
  ADD COLUMN IF NOT EXISTS declines      INTEGER,
  ADD COLUMN IF NOT EXISTS unchanged     INTEGER;

-- Public-read RLS so the Pulse page can SELECT this with the anon key
-- (same pattern as market_internals + sectors).
ALTER TABLE market_breadth ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_breadth_public_read ON market_breadth;
CREATE POLICY market_breadth_public_read ON market_breadth
  FOR SELECT TO anon, authenticated
  USING (TRUE);

-- Index on trading_date — primary key already covers ordered reads
-- in DESC order, but we also query ASC for the chart; a covering
-- index on (trading_date) keeps both fast even as the table grows.
CREATE INDEX IF NOT EXISTS idx_market_breadth_trading_date
  ON market_breadth (trading_date DESC);
