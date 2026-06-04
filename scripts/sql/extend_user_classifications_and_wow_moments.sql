-- ─────────────────────────────────────────────────────────────────
-- Extend user_classifications + add pending_wow_moments
-- ─────────────────────────────────────────────────────────────────
-- Builds on scripts/sql/create_user_classifications.sql (the v1
-- table with just {id, user_id, symbol, classification,
-- classified_at}). Adds the rest of the columns needed for the
-- nightly confirmation checker and the "wow moment" reveal flow.
--
-- Idempotent — every step uses IF [NOT] EXISTS / DO blocks so the
-- file can be re-run safely. No data loss; the legacy
-- `classification` column is preserved AND backfilled into the
-- new `classified_phase` column. A commented-out DROP at the
-- bottom lets you retire the legacy column once you're sure
-- nothing reads it any more.
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- PART A — Extend user_classifications
-- ═════════════════════════════════════════════════════════════════

-- 1. Add the new columns (NULLable for now; backfill before
-- adding NOT NULL on classified_phase).
ALTER TABLE user_classifications
  ADD COLUMN IF NOT EXISTS company_id                       uuid,
  ADD COLUMN IF NOT EXISTS classified_phase                 text,
  ADD COLUMN IF NOT EXISTS criteria_score_at_classification numeric,
  ADD COLUMN IF NOT EXISTS phase_day_at_classification      int,
  ADD COLUMN IF NOT EXISTS confirmed_at                     timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_phase                  text,
  ADD COLUMN IF NOT EXISTS criteria_score_at_confirmation   numeric,
  ADD COLUMN IF NOT EXISTS days_to_confirmation             int,
  ADD COLUMN IF NOT EXISTS was_correct                      boolean,
  ADD COLUMN IF NOT EXISTS included_in_accuracy             boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at                       timestamptz DEFAULT now();

-- 2. Backfill classified_phase from the legacy `classification`
-- column, if both exist. Safe no-op when either column is
-- missing (the DO block introspects the catalog).
DO $$
DECLARE
  has_legacy boolean;
  has_new    boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_classifications'
      AND column_name = 'classification'
  ) INTO has_legacy;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_classifications'
      AND column_name = 'classified_phase'
  ) INTO has_new;
  IF has_legacy AND has_new THEN
    EXECUTE $sql$
      UPDATE user_classifications
      SET classified_phase = classification
      WHERE classified_phase IS NULL
        AND classification IS NOT NULL
    $sql$;
    RAISE NOTICE 'Backfilled classified_phase from legacy classification column.';
  END IF;
END $$;

-- 3. Phase-value check constraint. Drop-and-recreate is idempotent.
-- Lives behind a name-aware drop so re-running doesn't error.
ALTER TABLE user_classifications
  DROP CONSTRAINT IF EXISTS user_classifications_phase_check;
ALTER TABLE user_classifications
  ADD CONSTRAINT user_classifications_phase_check
  CHECK (
    classified_phase IS NULL  -- allowed until full migration
    OR classified_phase IN ('Basing','Advancing','Topping','Declining')
  );

-- 4. Add the public-read policy ("community distribution") — lets
-- the future Community Distribution chart on /stock/:symbol read
-- aggregated phase counts across users without exposing any
-- per-user PII (the SELECT returns rows; the UI aggregates client-
-- side and never displays user_id).
--
-- Existing "Users manage own classifications" policy from v1
-- remains untouched (FOR ALL — covers SELECT/INSERT/UPDATE/DELETE
-- per-owner).
DROP POLICY IF EXISTS "Community distribution read" ON user_classifications;
CREATE POLICY "Community distribution read"
  ON user_classifications FOR SELECT
  USING (true);

-- 5. Grants — authenticated needs INSERT + UPDATE explicitly
-- (SELECT is already there from v1 via the manage policy).
GRANT SELECT, INSERT, UPDATE ON user_classifications TO authenticated;


-- ═════════════════════════════════════════════════════════════════
-- PART B — pending_wow_moments (NEW)
-- ═════════════════════════════════════════════════════════════════
-- Written by the nightly checker when a user's classification is
-- confirmed (the underlying signal moved in the direction they
-- predicted). The frontend renders unshown rows as a celebration
-- banner the next time the user opens PineX, then marks them
-- shown_at = now() so the celebration doesn't repeat.

CREATE TABLE IF NOT EXISTS pending_wow_moments (
  id                                 uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                            uuid         REFERENCES auth.users(id) ON DELETE CASCADE,
  classification_id                  uuid         REFERENCES user_classifications(id),
  symbol                             text         NOT NULL,
  company_name                       text,
  classified_phase                   text,
  classified_at                      timestamptz,
  criteria_score_at_classification   numeric,
  criteria_score_now                 numeric,
  days_elapsed                       int,
  was_early                          boolean      DEFAULT false,
  shown_at                           timestamptz,
  created_at                         timestamptz  DEFAULT now()
);

ALTER TABLE pending_wow_moments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own wow moments" ON pending_wow_moments;
CREATE POLICY "Users read own wow moments"
  ON pending_wow_moments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own wow moments" ON pending_wow_moments;
CREATE POLICY "Users update own wow moments"
  ON pending_wow_moments FOR UPDATE
  USING (auth.uid() = user_id);

GRANT SELECT, UPDATE ON pending_wow_moments TO authenticated;


-- ═════════════════════════════════════════════════════════════════
-- PART C — Indexes
-- ═════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_classifications_user
  ON user_classifications (user_id);

CREATE INDEX IF NOT EXISTS idx_classifications_symbol
  ON user_classifications (symbol);

CREATE INDEX IF NOT EXISTS idx_classifications_confirmed
  ON user_classifications (confirmed_at);

-- Partial index — only on rows the UI cares about (unshown wow
-- moments). Tiny on disk, fast for the dashboard's "any new
-- celebration?" query that runs on every page load.
CREATE INDEX IF NOT EXISTS idx_wow_moments_user_unshown
  ON pending_wow_moments (user_id)
  WHERE shown_at IS NULL;


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═════════════════════════════════════════════════════════════════

-- Expected: all 11 new columns present
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_classifications'
  AND column_name IN (
    'company_id', 'classified_phase',
    'criteria_score_at_classification', 'phase_day_at_classification',
    'confirmed_at', 'confirmed_phase',
    'criteria_score_at_confirmation', 'days_to_confirmation',
    'was_correct', 'included_in_accuracy', 'created_at'
  )
ORDER BY column_name;

-- Expected: 2 policies on user_classifications, 2 on pending_wow_moments
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_classifications', 'pending_wow_moments')
ORDER BY tablename, policyname;

-- Expected: pending_wow_moments exists with all columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pending_wow_moments'
ORDER BY ordinal_position;

-- Expected: 4 indexes (3 on user_classifications + 1 on pending_wow_moments)
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('user_classifications', 'pending_wow_moments')
ORDER BY tablename, indexname;


-- ═════════════════════════════════════════════════════════════════
-- OPTIONAL — Retire the legacy `classification` column
-- ═════════════════════════════════════════════════════════════════
-- Run ONLY after confirming nothing reads the old name anymore
-- (grep src/ scripts/ for `'classification'` and update any callers
-- to `'classified_phase'` first). MyClassification.jsx in particular
-- writes the old column name today — leave this commented out until
-- that file is migrated.
--
-- ALTER TABLE user_classifications DROP COLUMN IF EXISTS classification;
-- ─────────────────────────────────────────────────────────────────
