-- ─────────────────────────────────────────────────────────────────
-- Repair is_latest = true flag on price_data
-- ─────────────────────────────────────────────────────────────────
-- WHY: Diagnostic showed only 12 of ~2125 companies had a row
-- marked is_latest = true. mv_home_stocks INNER JOINs on that
-- flag, so the screener collapsed to 12 rows.
--
-- Cause: fetch_bhav_daily.py clears is_latest = true on the prior
-- latest row BEFORE inserting the new bhav row. A failure between
-- the two non-transactional REST calls wipes the flag with nothing
-- replacing it. The 5y backfill also writes every row with
-- is_latest = False by design.
--
-- This migration deterministically re-marks the most-recent date
-- per company as is_latest = true.
--
-- ⚠ RUN EACH STEP SEPARATELY. The whole-file paste timed out at
-- the 60s Supabase statement limit. Each step below fits well
-- under the limit individually.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- STEP 0 — Diagnostic BEFORE (paste & run alone, <1s)
-- ═════════════════════════════════════════════════════════════════

SELECT
  COUNT(*) FILTER (WHERE is_latest = true)  AS rows_marked_latest,
  COUNT(DISTINCT company_id)                 AS distinct_companies,
  COUNT(*)                                   AS total_price_rows
FROM price_data;
-- Expected before: rows_marked_latest ≈ 12
-- Expected after:  rows_marked_latest ≈ distinct_companies (~2125)


-- ═════════════════════════════════════════════════════════════════
-- STEP 1 — Mark the most-recent row per company (paste & run alone)
-- ═════════════════════════════════════════════════════════════════
-- WHY this shape (instead of DISTINCT ON + UPDATE in one CTE which
-- timed out earlier):
--
--   GROUP BY company_id with MAX(date) hits the (company_id, date)
--   index and aggregates ~1.57M rows → ~2125 result rows in a
--   couple of seconds. The UPDATE then JOINs on (company_id, date)
--   to flip the flag on exactly those rows. Much lighter than the
--   DISTINCT ON sort that timed out.
--
-- We ALSO clear is_latest on rows that have it set but shouldn't
-- (safety). Limited to rows already flagged so this is a tiny set.
--
-- Idempotent — safe to re-run.

UPDATE price_data p
SET is_latest = (p.date = m.max_date)
FROM (
  SELECT company_id, MAX(date) AS max_date
  FROM price_data
  GROUP BY company_id
) m
WHERE p.company_id = m.company_id
  AND (
    -- Touch only rows that are either the new latest OR currently
    -- flagged-but-wrong. Avoids rewriting 1.5M rows we don't need
    -- to touch.
    p.date = m.max_date
    OR p.is_latest = true
  );


-- ═════════════════════════════════════════════════════════════════
-- STEP 2 — Verify the flag was set (paste & run alone, <1s)
-- ═════════════════════════════════════════════════════════════════

SELECT
  COUNT(*) FILTER (WHERE is_latest = true)  AS rows_marked_latest_after,
  COUNT(DISTINCT company_id)                 AS distinct_companies
FROM price_data;
-- Expected: rows_marked_latest_after ≈ distinct_companies (both ~2125)


-- ═════════════════════════════════════════════════════════════════
-- STEP 3 — Refresh mv_home_stocks (paste & run alone)
-- ═════════════════════════════════════════════════════════════════
-- A REFRESH MATERIALIZED VIEW on 2125 rows + joins typically takes
-- 10-30s. Running it as its own statement avoids dragging the
-- earlier UPDATE into the same timeout window.
--
-- If THIS step also times out (rare on 2125 rows but possible on a
-- congested instance), see the fallback at the bottom of this file.

SELECT refresh_home_stocks();


-- ═════════════════════════════════════════════════════════════════
-- STEP 4 — Final verification (paste & run alone, <1s)
-- ═════════════════════════════════════════════════════════════════

-- 4a. View should now have ~2125 rows.
SELECT COUNT(*) AS mv_home_stocks_rows FROM mv_home_stocks;

-- 4b. Spot check: pharma should return a real list.
SELECT symbol, name, sector, close
FROM mv_home_stocks
WHERE sector ILIKE '%pharma%'
ORDER BY symbol
LIMIT 10;


-- ═════════════════════════════════════════════════════════════════
-- FALLBACK — if STEP 3 keeps timing out
-- ═════════════════════════════════════════════════════════════════
-- REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index on
-- mv_home_stocks and is non-blocking, but takes longer overall. The
-- non-concurrent form locks the view but is typically faster.
--
-- If the standard refresh times out (>60s), try this in its own
-- transaction — increase the per-statement timeout for this session:
--
--   SET LOCAL statement_timeout = '300s';
--   REFRESH MATERIALIZED VIEW mv_home_stocks;
--
-- Or call the python pipeline directly if you have shell access:
--   python scripts/calc_delivery_signals.py --refresh-view-only
-- (the pipeline calls SELECT refresh_home_stocks() as service_role
-- which respects no statement timeout).
-- ─────────────────────────────────────────────────────────────────
