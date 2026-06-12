-- Rename swing_conditions.condition_near_ma20 → condition_near_ma50
--
-- The underlying computation flipped from a 20-day MA proximity check
-- to a 50-day MA proximity check (commit 87f9636). The column kept
-- its old MA20 name for back-compat — but that's a lie that confuses
-- every reader who looks at the schema. This migration aligns the
-- column name with what it actually stores.
--
-- Idempotent: only renames when the old column still exists. Safe to
-- re-run; second invocation is a no-op.
--
-- ⚠ APPLY BEFORE running calc_swing_conditions.py on this commit.
--   The pipeline writes condition_near_ma50; until this migration
--   runs, every row write will PGRST204 (column not found) and the
--   nightly job's exit-1 health gate will fail the workflow.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'swing_conditions'
      AND column_name = 'condition_near_ma20'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'swing_conditions'
      AND column_name = 'condition_near_ma50'
  ) THEN
    ALTER TABLE swing_conditions
      RENAME COLUMN condition_near_ma20 TO condition_near_ma50;
    RAISE NOTICE 'Renamed swing_conditions.condition_near_ma20 → condition_near_ma50';
  ELSE
    RAISE NOTICE 'No rename needed (column already named condition_near_ma50 or source missing)';
  END IF;
END $$;
