-- ════════════════════════════════════════════════════════════════════════
-- add_ma200_columns.sql
--
-- Adds the 200-day moving average and its slope to price_data. These are
-- the missing inputs for the Trend Template screen: four of its eight
-- criteria compare price / MA50 / MA150 against the 200-day line, and
-- price_data previously carried ma10/ma20/ma30/ma50/ma150/ma30w only.
--
-- ── NO BACKFILL, BY DESIGN ──────────────────────────────────────────
--   The Trend Template reads ONE row per stock — the is_latest = true
--   row. That's ~2,123 rows out of ~273,080. It never reads history.
--
--   fetch_bhav_daily already pulls 300 sessions per company to compute
--   the existing MAs (see the .limit(300) in fetch_price_history), so
--   200 periods are available with no extra I/O. One nightly run
--   populates every row the screen actually reads.
--
--   Historical rows keep ma200 = NULL permanently and nothing cares.
--   That is deliberate: back-filling 273k rows would churn dead tuples
--   and pressure autovacuum for no benefit, since no query reads
--   ma200 off a non-latest row.
--
-- ── COST ────────────────────────────────────────────────────────────
--   ADD COLUMN with no DEFAULT is a catalogue-only change in Postgres
--   11+ — no table rewrite, no lock beyond a brief ACCESS EXCLUSIVE on
--   the catalogue entry. Two numerics on the 2,123 rows that matter is
--   ~0.04 MB. Even if every row were eventually populated it would be
--   ~6 MB on a 273k-row table.
--
--   NULLABLE deliberately — no DEFAULT. A default of 0 would be a lie
--   (0 is a valid-looking MA that would pass "price above MA" for every
--   stock), and it would force a rewrite of all 273k rows. NULL means
--   "not computed yet" and every consumer must treat it as unknown
--   rather than as a passing value.
--
-- APPLY ONCE in the Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.price_data
  ADD COLUMN IF NOT EXISTS ma200          numeric,
  ADD COLUMN IF NOT EXISTS ma200_slope    numeric,
  ADD COLUMN IF NOT EXISTS ma200_slope_5m numeric;

COMMENT ON COLUMN public.price_data.ma200 IS
  '200-day simple moving average of close. NULL until the stock has 200 '
  'sessions of history, and on historical rows (only is_latest = true '
  'rows are populated — see add_ma200_columns.sql).';

COMMENT ON COLUMN public.price_data.ma200_slope IS
  'Percent change in ma200 over the trailing ~1 trading month (21 '
  'sessions). Positive = the long-term average is rising. This is the '
  'MINIMUM horizon in Trend Template criterion 3. NULL when history is '
  'insufficient — callers must treat NULL as "cannot evaluate", never '
  'as a pass.';

COMMENT ON COLUMN public.price_data.ma200_slope_5m IS
  'Percent change in ma200 over the trailing ~5 trading months (105 '
  'sessions). The PREFERRED horizon in Trend Template criterion 3. '
  'Stored alongside the 1-month value so the screen can offer a real '
  'lookback toggle rather than only a threshold tweak. NULL when '
  'history is insufficient.';

-- ── Verification ────────────────────────────────────────────────────
-- Right after applying, both counts are 0 — nothing has computed them
-- yet. After the next fetch_bhav_daily run, ma200_populated should be
-- close to the is_latest row count (stocks with <200 sessions of
-- history stay NULL, which is correct — they cannot qualify for the
-- Trend Template anyway).
SELECT
  count(*)                                             AS is_latest_rows,
  count(*) FILTER (WHERE ma200 IS NOT NULL)            AS ma200_populated,
  count(*) FILTER (WHERE ma200_slope IS NOT NULL)      AS slope_1m_populated,
  count(*) FILTER (WHERE ma200_slope_5m IS NOT NULL)   AS slope_5m_populated
FROM public.price_data
WHERE is_latest = true;
