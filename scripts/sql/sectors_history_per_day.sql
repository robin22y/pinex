-- ── Sectors table — switch from snapshot to per-day history ────────
-- Today the sectors table holds ONE row per sector (UNIQUE on `name`)
-- — calc_swing_conditions.py overwrites it every nightly run. This
-- migration relaxes the constraint to (name, date) so each day's
-- breadth snapshot lands as a new row, enabling week-over-week trend
-- arrows on the Sectors view + a 7-day delta chip on the home Sector
-- Pulse card. Rows already present become the historical day-zero
-- baseline; no data is lost.
--
-- Idempotent — guarded INSTEAD of plain CREATE / ALTER so the
-- migration can be re-run safely after partial failures.

-- 1. Make `date` NOT NULL — required by the composite key. Existing
--    rows already carry today's date.
ALTER TABLE sectors
  ALTER COLUMN date SET NOT NULL;

-- 2. Drop the old single-column constraint if present.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
    WHERE conrelid = 'sectors'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (name)';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sectors DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

-- 3. Add the composite UNIQUE so PostgREST upsert(on_conflict='name,date')
--    has something to land on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'sectors_name_date_uidx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX sectors_name_date_uidx ON sectors (name, date)';
  END IF;
END $$;

-- 4. Helpful BTREE for "latest date per sector" reads.
CREATE INDEX IF NOT EXISTS sectors_date_idx ON sectors (date DESC);
