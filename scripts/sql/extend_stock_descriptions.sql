-- ─────────────────────────────────────────────────────────────────
-- Extend stock_descriptions to match scripts/generate_descriptions.py
-- ─────────────────────────────────────────────────────────────────
-- WHY: the original create_stock_descriptions.sql shipped with four
-- `qa_*` columns (was_it_stage2_before / how_long / sector /
-- what_changed). The Quiet Clarity rebuild of StockDetail.jsx and
-- the rewritten generate_descriptions.py now use four DIFFERENT
-- cycle-narrative columns (whats_happening / why_this_phase /
-- what_changes / broader_cycle), plus several denormalised context
-- columns the script tries to persist for debugging.
--
-- Because Supabase silently 204s an upsert that references unknown
-- columns (PGRST204), every nightly generate_descriptions run wrote
-- ZERO rows. The frontend then renders "Not available for this
-- stock yet." in every accordion.
--
-- This migration adds the missing columns idempotently. Safe to run
-- multiple times. The old qa_* columns are LEFT IN PLACE (nullable,
-- no longer written) so no historical data is lost.
--
-- AFTER RUNNING THIS:
--   1. Verify with the SELECT at the bottom (all 11 columns present).
--   2. Re-run scripts/generate_descriptions.py --full to repopulate.
-- ─────────────────────────────────────────────────────────────────

-- ── Cycle narrative (the four accordions on StockDetail) ─────────
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS whats_happening  text;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS why_this_phase   text;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS what_changes     text;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS broader_cycle    text;

-- ── Denormalised context the generator persists for audit/debug ──
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS phase_label         text;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS sector              text;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS sector_breadth_pct  numeric;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS score_changed_today boolean;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS criteria_gained     jsonb;
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS criteria_lost       jsonb;

-- ── Updated-at — generator writes datetime.utcnow().isoformat() ──
-- The original table only has `generated_at` (DEFAULT now()). Adding
-- updated_at as a regular column with a DEFAULT so existing rows
-- backfill cleanly and new writes succeed.
ALTER TABLE stock_descriptions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();


-- ═════════════════════════════════════════════════════════════════
-- Verification — all expected columns must be present
-- ═════════════════════════════════════════════════════════════════

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'stock_descriptions'
  AND column_name IN (
    'whats_happening',
    'why_this_phase',
    'what_changes',
    'broader_cycle',
    'phase_label',
    'sector',
    'sector_breadth_pct',
    'score_changed_today',
    'criteria_gained',
    'criteria_lost',
    'updated_at'
  )
ORDER BY column_name;
-- Expect: 11 rows.
