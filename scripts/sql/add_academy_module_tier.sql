-- ── academy_modules.tier ────────────────────────────────────────────────
-- Replaces the boolean `is_pro` flag with a three-way classification:
--   'basics'   = required pre-reqs ("MUST do these before anything else")
--   'standard' = the normal curriculum row
--   'pro'      = advanced / paid-tier rows that the learner can opt OUT of
--
-- We keep `is_pro` in place during the migration so any code paths still
-- reading it (older builds, scripts, telemetry) don't break — the admin
-- save handler now writes BOTH columns in lockstep (tier = 'pro' ⟺
-- is_pro = TRUE). A follow-up migration can drop `is_pro` once nothing
-- reads it.
--
-- Idempotent: safe to re-run.

ALTER TABLE academy_modules
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard'
    CHECK (tier IN ('basics', 'standard', 'pro'));

-- Backfill — existing Pro rows keep their classification. Everything
-- else lands on 'standard'; admin re-labels Basics manually via the
-- AcademyAdmin form.
UPDATE academy_modules
   SET tier = 'pro'
 WHERE is_pro = TRUE
   AND tier  = 'standard';

-- The Academy renderer sorts Basics first within each chapter, so an
-- index keyed on (chapter, tier, sort_order) keeps the ORDER BY cheap
-- as the module count grows. Partial — only published modules — to
-- match the actual learner-facing query.
CREATE INDEX IF NOT EXISTS idx_academy_modules_chapter_tier_order
  ON academy_modules (chapter, tier, sort_order)
  WHERE is_published = TRUE;
