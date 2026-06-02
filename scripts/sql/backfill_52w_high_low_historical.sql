-- ─────────────────────────────────────────────────────────────────
-- Backfill trailing-252-day high_52w / low_52w on every historical
-- price_data row (not just is_latest).
-- ─────────────────────────────────────────────────────────────────
-- Why: the bhav pipeline (fetch_bhav_daily.py / its calc_indicators)
-- does NOT write high_52w or low_52w per row. Those columns are
-- populated by the SQL function `update_52w_high_low()` which only
-- updates rows where is_latest = true — meaning historical rows
-- almost always have NULL for both columns.
--
-- Consequence: backfill_market_internals_history.py reads NULL,
-- counts zero stocks at 52W highs and zero at 52W lows for most
-- historical dates → the H-L spread chart on /breadth-lab shows
-- a flat zero with occasional spikes (from the few accidentally
-- populated rows).
--
-- This migration uses a window function — MAX(close) and MIN(close)
-- OVER (PARTITION BY company ORDER BY date ROWS 251 PRECEDING) —
-- to compute the correct trailing-252-day high/low per row in one
-- pass and write back. After this runs, the historical 52W
-- highs/lows reflect what they actually were on each historical
-- date (rather than today's snapshot or NULL).
--
-- Idempotent — re-running just recomputes and re-writes the same
-- values. Safe to run multiple times.
--
-- Runtime: depends on row count. For 1.57M price_data rows expect
-- 30-90 seconds. The window function is well-indexed (assumes
-- price_data has an index on (company_id, date) which is standard).
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- DIAGNOSTIC BEFORE — paste to confirm what's currently in the DB
-- ═════════════════════════════════════════════════════════════════

SELECT
  COUNT(*) FILTER (WHERE high_52w IS NOT NULL)   AS rows_with_high_52w,
  COUNT(*) FILTER (WHERE high_52w IS NULL)       AS rows_missing_high_52w,
  COUNT(*) FILTER (WHERE low_52w  IS NOT NULL)   AS rows_with_low_52w,
  COUNT(*) FILTER (WHERE low_52w  IS NULL)       AS rows_missing_low_52w,
  COUNT(*)                                       AS total_rows
FROM price_data;


-- ═════════════════════════════════════════════════════════════════
-- BACKFILL — single CTE + UPDATE
-- ═════════════════════════════════════════════════════════════════

WITH windowed AS (
  SELECT
    id,
    company_id,
    date,
    close,
    MAX(close) OVER (
      PARTITION BY company_id
      ORDER BY date
      ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
    ) AS h52,
    MIN(close) OVER (
      PARTITION BY company_id
      ORDER BY date
      ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
    ) AS l52
  FROM price_data
  WHERE close IS NOT NULL
)
UPDATE price_data pd
SET
  high_52w = w.h52,
  low_52w  = w.l52
FROM windowed w
WHERE pd.id = w.id
  AND (
    pd.high_52w IS DISTINCT FROM w.h52
    OR pd.low_52w IS DISTINCT FROM w.l52
  );


-- ═════════════════════════════════════════════════════════════════
-- DIAGNOSTIC AFTER — should show near-100% populated
-- ═════════════════════════════════════════════════════════════════

SELECT
  COUNT(*) FILTER (WHERE high_52w IS NOT NULL)   AS rows_with_high_52w,
  COUNT(*) FILTER (WHERE high_52w IS NULL)       AS rows_missing_high_52w,
  COUNT(*) FILTER (WHERE low_52w  IS NOT NULL)   AS rows_with_low_52w,
  COUNT(*) FILTER (WHERE low_52w  IS NULL)       AS rows_missing_low_52w,
  COUNT(*)                                       AS total_rows
FROM price_data;


-- Spot-check on a known stock — first 10 rows and last 10 rows
-- should show high_52w / low_52w as the proper trailing-252-day
-- high/low (not the latest snapshot or NULL).
SELECT date, close, high_52w, low_52w
FROM price_data
WHERE company_id = (SELECT id FROM companies WHERE symbol = 'SBIN' LIMIT 1)
ORDER BY date ASC
LIMIT 10;

SELECT date, close, high_52w, low_52w
FROM price_data
WHERE company_id = (SELECT id FROM companies WHERE symbol = 'SBIN' LIMIT 1)
ORDER BY date DESC
LIMIT 10;
