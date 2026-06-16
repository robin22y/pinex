-- ─────────────────────────────────────────────────────────────────
-- pattern_snapshots — Historical Conditions Engine
-- ─────────────────────────────────────────────────────────────────
-- One row per (company_id, date). Each row captures the conditions
-- a stock was in on a specific trading day PLUS what actually
-- happened over the next 7 / 30 / 60 / 90 trading days.
--
-- POPULATION
--   scripts/backtest/build_pattern_snapshots.py walks every
--   (symbol, date) in price_data, derives the snapshot, and upserts
--   into this table. Backfill runs once with sleep(0.1) between
--   rows (May 2026 Disk IO incident — read the script header).
--   Nightly the pipeline writes the date that has just aged out of
--   the 90-day lookforward window — i.e. today's nightly run writes
--   the snapshot for (today − 90 trading days).
--
-- READ PATH
--   supabase/functions/pattern-match queries this table on each
--   stock-detail page render. The "similar setup" matcher uses
--   ranges (stage exact, substage exact, ±10 RS, ±0.5 vol, ±7% breadth)
--   and excludes the last 90 days from results (forward data
--   incomplete for that window).
--
-- FK NOTE
--   The original spec referenced `companies(company_id)`. This repo's
--   companies PK column is `id`, so the FK uses `companies(id)` to
--   match every other migration here (delivery_signals, swing_*,
--   migration_indianapi.sql). Logically identical, just a column-
--   name compromise.
--
-- RLS
--   Same shape as divergence_signals (broadcast statistics — no
--   user-specific rows): RLS on, single SELECT policy for
--   authenticated callers. Writes happen via the service role from
--   the backfill / nightly Python scripts, which bypass RLS.
--
-- Idempotent. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pattern_snapshots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  date                   date NOT NULL,

  -- Snapshot conditions ────────────────────────────────────────
  stage                  text,
  substage               text,
  rs_vs_nifty            numeric,
  vol_ratio              numeric,
  breadth_pct            numeric,
  india_vix              numeric,

  -- Forward returns (% change from snapshot close) ─────────────
  forward_7d             numeric,
  forward_30d            numeric,
  forward_60d            numeric,
  forward_90d            numeric,

  -- Event flags within 30 trading days after snapshot ──────────
  hit_52w_high_30d       boolean,
  hit_52w_low_30d        boolean,
  stage_upgraded_30d     boolean,
  dropped_below_ma_30d   boolean,

  created_at             timestamptz NOT NULL DEFAULT now(),

  -- One snapshot per (company, date). The upsert path relies on
  -- this so re-running backfill replaces rather than duplicates.
  UNIQUE (company_id, date)
);

-- Index choices follow the matcher's WHERE clause: stage / substage
-- are equality filters (huge cut), rs / vol are range filters on the
-- remainder, and date powers the "exclude last 90 days" trim.
CREATE INDEX IF NOT EXISTS idx_pattern_stage
  ON public.pattern_snapshots (stage, substage);

CREATE INDEX IF NOT EXISTS idx_pattern_rs
  ON public.pattern_snapshots (rs_vs_nifty);

CREATE INDEX IF NOT EXISTS idx_pattern_vol
  ON public.pattern_snapshots (vol_ratio);

CREATE INDEX IF NOT EXISTS idx_pattern_date
  ON public.pattern_snapshots (date);


-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.pattern_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pattern_snapshots_authenticated_select
  ON public.pattern_snapshots;
CREATE POLICY pattern_snapshots_authenticated_select
  ON public.pattern_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY pattern_snapshots_authenticated_select
  ON public.pattern_snapshots IS
  'Aggregated historical conditions — broadcast statistics, same rows for every reader. Writes via service role from the backtest pipeline.';


-- Verification — each returns zero rows when the migration is clean.

SELECT 'pattern_snapshots table missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'pattern_snapshots'
);

SELECT 'pattern_snapshots unique constraint missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.pattern_snapshots'::regclass
    AND contype = 'u'
);

SELECT 'pattern_snapshots SELECT policy missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'pattern_snapshots'
    AND cmd        = 'SELECT'
);
