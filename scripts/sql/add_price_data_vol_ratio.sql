-- ─────────────────────────────────────────────────────────────────
-- Ensure vol_ratio + avg_volume_30d columns exist on price_data
-- ─────────────────────────────────────────────────────────────────
-- The StockDetail page's "Volume above average" criterion reads
-- price_data.vol_ratio. Earlier versions of the bhav pipeline did
-- not write this column — fetch_bhav_daily.py now does, so the
-- column needs to exist. Idempotent (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE price_data
  ADD COLUMN IF NOT EXISTS vol_ratio numeric;

ALTER TABLE price_data
  ADD COLUMN IF NOT EXISTS avg_volume_30d numeric;


-- Verification — both columns should exist after the migration
SELECT 'price_data.vol_ratio missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'price_data'
    AND column_name = 'vol_ratio'
);

SELECT 'price_data.avg_volume_30d missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'price_data'
    AND column_name = 'avg_volume_30d'
);
