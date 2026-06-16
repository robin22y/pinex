-- ─────────────────────────────────────────────────────────────────
-- daily_market_context — pre-computed "Today in Market Context" row
-- ─────────────────────────────────────────────────────────────────
-- ONE row per trading day. Replaces the on-the-fly client-side
-- compute that lived in src/components/home/TodayVsHistory.jsx —
-- the homepage section now reads a single row instead of pulling
-- the whole market_internals history into the browser and bucketing
-- it client-side.
--
-- POPULATION
--   scripts/calc_market_context.py upserts today's row from the
--   nightly pipeline. Reads market_internals' history, finds
--   similar past trading days (±5% breadth, ±50 stage2 count,
--   matching vix bucket), counts what Nifty did 10 trading days
--   later, and stores the distribution as JSON.
--
-- READ PATH
--   The frontend reads exactly one row:
--     SELECT * FROM daily_market_context
--     ORDER BY date DESC LIMIT 1
--   Zero aggregation on the browser. Fast.
--
-- RLS
--   Broadcast statistics — same shape as divergence_signals and
--   pattern_snapshots. RLS on, single SELECT policy for authenticated
--   callers; writes happen via the service role from the nightly
--   pipeline.
--
-- Idempotent. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.daily_market_context (
  date                date PRIMARY KEY,
  above_ma30w_pct     numeric,
  stage2_count        integer,
  stage3_count        integer,
  india_vix           numeric,
  vix_level           text,
  nifty_close         numeric,
  nifty_change_1d     numeric,
  similar_days_count  integer,
  distribution_10d    jsonb,
  market_phase        text,
  generated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_market_context_date
  ON public.daily_market_context (date DESC);


-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.daily_market_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_market_context_authenticated_select
  ON public.daily_market_context;
CREATE POLICY daily_market_context_authenticated_select
  ON public.daily_market_context
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY daily_market_context_authenticated_select
  ON public.daily_market_context IS
  'Pre-computed daily market context — broadcast stats, identical for every reader. Writes via service role from the nightly pipeline.';


-- Verification — both return zero rows on a clean install.

SELECT 'daily_market_context table missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'daily_market_context'
);

SELECT 'daily_market_context SELECT policy missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'daily_market_context'
    AND cmd        = 'SELECT'
);
