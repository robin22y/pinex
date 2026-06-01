-- ─────────────────────────────────────────────────────────────────
-- Backfill cumulative A/D line + H-L 10d average from history
-- ─────────────────────────────────────────────────────────────────
-- The market_internals row for every past trading day already has
-- new_52w_highs and new_52w_lows populated. With the price_data
-- table also fully populated (rolling daily closes per company),
-- we can DERIVE everything else we need historically — no need
-- to wait for the pipeline to accumulate days going forward.
--
-- Three steps, idempotent:
--
--   STEP 1 — Reconstruct historical advances/declines per day
--            from price_data via LAG(close). Only writes rows
--            where advances IS NULL or declines IS NULL, so
--            running this twice is safe.
--
--   STEP 2 — Compute cumulative A/D line as a running SUM(net)
--            over date. Overwrites whatever was in
--            ad_line_cumulative (mostly zeros).
--
--   STEP 3 — Compute hl_spread_10d_avg as the 10-row rolling
--            average of (new_52w_highs − new_52w_lows). Doesn't
--            require advances/declines — works independently
--            even if step 1 had any gaps.
--
-- Run in Supabase Dashboard → SQL Editor → New query → Run.
-- Diagnostic + verification queries at the bottom.
-- Total runtime: ~10-30 seconds depending on price_data size.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- DIAGNOSTIC — paste output before/after to confirm state
-- ═════════════════════════════════════════════════════════════════

-- What's in market_internals now (before backfill)?
SELECT
  COUNT(*) FILTER (WHERE advances IS NOT NULL)                AS rows_with_advances,
  COUNT(*) FILTER (WHERE advances IS NULL)                    AS rows_missing_advances,
  COUNT(*) FILTER (WHERE COALESCE(ad_line_cumulative, 0) <> 0) AS rows_with_nonzero_ad_line,
  COUNT(*) FILTER (WHERE COALESCE(hl_spread_10d_avg, 0) <> 0)  AS rows_with_nonzero_hl_avg,
  COUNT(*)                                                    AS total_rows
FROM market_internals;


-- ═════════════════════════════════════════════════════════════════
-- STEP 1 — Reconstruct historical advances/declines from price_data
-- ═════════════════════════════════════════════════════════════════
-- For every (company, date) pair in price_data, the previous
-- session's close lives in the prior row when ORDERed by date
-- WITHIN that company. LAG(close) over PARTITION BY company_id
-- gives that value. Comparing close to prev_close yields the
-- advance/decline flag.
--
-- Aggregating by date (across all companies) gives the daily
-- advance and decline counts that the market_internals row for
-- that date should carry.
--
-- Idempotent: only writes rows where advances/declines are NULL.
-- ─────────────────────────────────────────────────────────────────

WITH stock_changes AS (
  SELECT
    company_id,
    date,
    close,
    LAG(close) OVER (
      PARTITION BY company_id
      ORDER BY date
    ) AS prev_close
  FROM price_data
),
daily_counts AS (
  SELECT
    date,
    SUM(CASE WHEN close > prev_close THEN 1 ELSE 0 END) AS advances,
    SUM(CASE WHEN close < prev_close THEN 1 ELSE 0 END) AS declines
  FROM stock_changes
  WHERE prev_close IS NOT NULL
  GROUP BY date
)
UPDATE market_internals mi
SET
  advances = dc.advances,
  declines = dc.declines
FROM daily_counts dc
WHERE mi.date = dc.date
  AND (mi.advances IS NULL OR mi.declines IS NULL);


-- ═════════════════════════════════════════════════════════════════
-- STEP 2 — Cumulative A/D line from advances/declines
-- ═════════════════════════════════════════════════════════════════
-- Running total of (advances − declines) ordered by date. The
-- cumulative value at row N is the sum of every prior day's net.
-- Pre-existing 0-everywhere values are overwritten.
-- ─────────────────────────────────────────────────────────────────

WITH ordered AS (
  SELECT
    id,
    date,
    COALESCE(advances, 0) - COALESCE(declines, 0) AS net_ad
  FROM market_internals
  WHERE advances IS NOT NULL OR declines IS NOT NULL
),
cumulative AS (
  SELECT
    id,
    date,
    net_ad,
    SUM(net_ad) OVER (
      ORDER BY date
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS ad_line_cumulative
  FROM ordered
)
UPDATE market_internals mi
SET ad_line_cumulative = c.ad_line_cumulative
FROM cumulative c
WHERE mi.id = c.id;


-- ═════════════════════════════════════════════════════════════════
-- STEP 3 — 10-day moving average of highs − lows
-- ═════════════════════════════════════════════════════════════════
-- AVG(...) OVER (ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) gives
-- the 10-row rolling mean. Doesn't depend on advances/declines —
-- new_52w_highs and new_52w_lows have been populated since the
-- table existed.
-- ─────────────────────────────────────────────────────────────────

WITH spreads AS (
  SELECT
    id,
    date,
    (COALESCE(new_52w_highs, 0) - COALESCE(new_52w_lows, 0))::numeric AS hl_spread
  FROM market_internals
),
averaged AS (
  SELECT
    id,
    date,
    ROUND(
      AVG(hl_spread) OVER (
        ORDER BY date
        ROWS BETWEEN 9 PRECEDING AND CURRENT ROW
      )::numeric,
      1
    ) AS hl_spread_10d_avg
  FROM spreads
)
UPDATE market_internals mi
SET hl_spread_10d_avg = a.hl_spread_10d_avg
FROM averaged a
WHERE mi.id = a.id;


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION — sample first 10 trading days after backfill
-- ═════════════════════════════════════════════════════════════════
-- ad_line_cumulative should grow / shrink as a running total.
-- hl_spread_10d_avg should be a small number for the first 10
-- days (window not yet full) and smooth after that.
-- ─────────────────────────────────────────────────────────────────

SELECT
  date,
  advances,
  declines,
  COALESCE(advances, 0) - COALESCE(declines, 0) AS net_ad,
  ad_line_cumulative,
  new_52w_highs,
  new_52w_lows,
  COALESCE(new_52w_highs, 0) - COALESCE(new_52w_lows, 0) AS hl_spread,
  hl_spread_10d_avg
FROM market_internals
ORDER BY date ASC
LIMIT 10;


-- Last 10 trading days — should show the cumulative A/D line at
-- its current value and a meaningful 10-day H-L average
SELECT
  date,
  advances,
  declines,
  COALESCE(advances, 0) - COALESCE(declines, 0) AS net_ad,
  ad_line_cumulative,
  COALESCE(new_52w_highs, 0) - COALESCE(new_52w_lows, 0) AS hl_spread,
  hl_spread_10d_avg
FROM market_internals
ORDER BY date DESC
LIMIT 10;


-- Summary — counts after backfill
SELECT
  COUNT(*) FILTER (WHERE advances IS NOT NULL)                AS rows_with_advances,
  COUNT(*) FILTER (WHERE advances IS NULL)                    AS rows_still_missing_advances,
  COUNT(*) FILTER (WHERE COALESCE(ad_line_cumulative, 0) <> 0) AS rows_with_nonzero_ad_line,
  COUNT(*) FILTER (WHERE COALESCE(hl_spread_10d_avg, 0) <> 0)  AS rows_with_nonzero_hl_avg,
  COUNT(*)                                                    AS total_rows
FROM market_internals;
