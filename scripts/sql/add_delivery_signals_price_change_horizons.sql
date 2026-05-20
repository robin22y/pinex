-- Add 90d, 180d, 365d price change columns to delivery_signals.
-- These are pre-computed at pipeline time (same as price_change_7d / price_change_30d),
-- so the heatmap can read any timeframe with a single query instead of per-company price_data lookups.

ALTER TABLE delivery_signals
  ADD COLUMN IF NOT EXISTS price_change_90d  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_change_180d DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_change_365d DOUBLE PRECISION;

COMMENT ON COLUMN delivery_signals.price_change_90d  IS 'Price % change vs 90 calendar days ago, computed by calc_delivery_signals.py';
COMMENT ON COLUMN delivery_signals.price_change_180d IS 'Price % change vs 180 calendar days ago, computed by calc_delivery_signals.py';
COMMENT ON COLUMN delivery_signals.price_change_365d IS 'Price % change vs 365 calendar days ago, computed by calc_delivery_signals.py';
