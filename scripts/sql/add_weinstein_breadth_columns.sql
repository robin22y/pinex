-- ─────────────────────────────────────────────────────────────────
-- Add Weinstein breadth columns to market_internals
-- ─────────────────────────────────────────────────────────────────
-- New columns populated by scripts/calc_market_internals.py:
--
--   ad_line_cumulative  — running total of (advances − declines).
--                         Weinstein's primary breadth indicator;
--                         direction matters more than the level.
--
--   hl_spread_10d_avg   — 10-day moving average of
--                         (new_52w_highs − new_52w_lows).
--                         Smoothed signal; deeply negative = broad
--                         weakness even if the index is up.
--
-- Both default to 0 so existing rows have valid defaults and the
-- next pipeline tick can fill the live values.
-- Idempotent (uses IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE market_internals
  ADD COLUMN IF NOT EXISTS ad_line_cumulative numeric DEFAULT 0;

ALTER TABLE market_internals
  ADD COLUMN IF NOT EXISTS hl_spread_10d_avg numeric DEFAULT 0;


-- Verification — should return zero rows when both columns exist
SELECT 'market_internals.ad_line_cumulative missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'market_internals'
    AND column_name = 'ad_line_cumulative'
);

SELECT 'market_internals.hl_spread_10d_avg missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'market_internals'
    AND column_name = 'hl_spread_10d_avg'
);
