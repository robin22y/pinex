-- ════════════════════════════════════════════════════════════════════════
-- add_dma_columns.sql
--
-- Adds dma_50 / dma_150 / dma_200 to price_data.
-- Written by scripts/calc_moving_averages.py, sourced from daily_closes.
--
-- ── WHY price_data ──────────────────────────────────────────────────
--   price_data is the table the stock detail view reads for latest
--   per-stock indicator values. Three independent confirmations:
--
--     1. src/pages/StockDetail.jsx queries
--          .from('price_data')
--          .select('date, stage, rsi, close, ma50, ma30w, vol_ratio, ...')
--          .eq('company_id', cid).order('date', desc).limit(120)
--        and takes priceHistory[0] as `latest`. Every indicator the page
--        renders comes off that row.
--
--     2. price_data already carries the whole indicator family —
--        ma10, ma20, ma30, ma50, ma150, ma200, ma30w, ma150_slope,
--        ma200_slope, obv, obv_slope, rsi, mansfield_rs, vol_ratio.
--        It is the indicator table; nothing else holds these.
--
--     3. `is_latest = true` matches exactly 2,123 rows — one per company,
--        equal to the company count. That is the canonical "latest row"
--        marker and it is the same row order-by-date-desc-limit-1 returns.
--
--   Rejected alternatives, for the record:
--     key_metrics     fundamentals keyed by symbol, no price indicators
--     swing_conditions boolean condition flags, no numeric values
--     stage_flags     stage-transition events, not a latest-state table
--     daily_closes    the raw close history — the INPUT to this
--                     calculation, not somewhere to store its output
--
-- ── RELATIONSHIP TO THE EXISTING ma50 / ma150 / ma200 ────────────────
--   price_data already has ma50/ma150/ma200, and these new columns
--   duplicate them by name. They are not redundant in practice:
--
--     ma50/ma150/ma200   computed by fetch_bhav_daily from price_data's
--                        own ~130-session history. rolling(150) and
--                        rolling(200) cannot resolve on 130 rows, so
--                        ma150 and ma200 are NULL on all 2,123 latest
--                        rows today.
--     dma_50/150/200     computed by calc_moving_averages.py from
--                        daily_closes, which holds ~228 sessions. These
--                        populate.
--
--   Two sources for the same quantity is a state to exit, not to keep.
--   Once dma_* is trusted, either point fetch_bhav_daily at daily_closes
--   and drop dma_*, or drop ma150/ma200 and read dma_* everywhere.
--
-- ── NULLABLE, NO DEFAULT — DELIBERATE ───────────────────────────────
--   A DEFAULT of 0 would be a lie: 0 is a valid-looking average that
--   passes "price above its 200 DMA" for every stock on earth. NULL
--   means "not computable", and every consumer must treat it as unknown
--   rather than as a pass.
--
--   No DEFAULT also keeps this a catalogue-only change in Postgres 11+ —
--   no table rewrite and no long lock on a 443k-row table.
--
-- ── COST ────────────────────────────────────────────────────────────
--   Three numerics on the 2,123 rows the script writes is ~0.06 MB.
--   Historical rows stay NULL and cost nothing (a NULL column is a bit
--   in the row's null bitmap, not a stored value).
--
-- APPLY ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.price_data
  ADD COLUMN IF NOT EXISTS dma_50  numeric,
  ADD COLUMN IF NOT EXISTS dma_150 numeric,
  ADD COLUMN IF NOT EXISTS dma_200 numeric;

COMMENT ON COLUMN public.price_data.dma_50 IS
  '50-day simple moving average of close, computed from daily_closes by '
  'scripts/calc_moving_averages.py. NULL when the company has fewer than '
  '50 closes — never a partial-window average. Rounded to 2 decimals. '
  'Only is_latest = true rows are populated.';

COMMENT ON COLUMN public.price_data.dma_150 IS
  '150-day simple moving average of close, computed from daily_closes by '
  'scripts/calc_moving_averages.py. NULL when the company has fewer than '
  '150 closes — never a partial-window average. Rounded to 2 decimals. '
  'Only is_latest = true rows are populated.';

COMMENT ON COLUMN public.price_data.dma_200 IS
  '200-day simple moving average of close, computed from daily_closes by '
  'scripts/calc_moving_averages.py. NULL when the company has fewer than '
  '200 closes — never a partial-window average. A 200 DMA computed from '
  '80 sessions is not a 200 DMA. Rounded to 2 decimals. Only '
  'is_latest = true rows are populated.';

-- ── Verification ────────────────────────────────────────────────────
-- Right after applying, all three counts are 0 — the columns exist but
-- nothing has computed them. Run scripts/calc_moving_averages.py, then
-- run this again.
--
-- daily_closes currently spans 228 sessions, so after the script expect
-- dma_50 and dma_150 near 2,123 and dma_200 somewhat lower — companies
-- listed inside the last 200 sessions genuinely have no 200 DMA yet.
SELECT
  count(*)                                      AS is_latest_rows,
  count(*) FILTER (WHERE dma_50  IS NOT NULL)   AS dma_50_populated,
  count(*) FILTER (WHERE dma_150 IS NOT NULL)   AS dma_150_populated,
  count(*) FILTER (WHERE dma_200 IS NOT NULL)   AS dma_200_populated
FROM public.price_data
WHERE is_latest = true;
