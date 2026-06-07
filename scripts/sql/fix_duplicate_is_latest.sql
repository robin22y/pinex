-- ════════════════════════════════════════════════════════════════════════
-- Fix duplicate `is_latest = true` rows in price_data
-- ════════════════════════════════════════════════════════════════════════
-- Symptom (confirmed): RELIANCE appears THREE times in mv_home_stocks with
-- different close prices. Cause: the daily pipeline is INSERTing a new
-- price_data row each day with is_latest=true, but NOT setting the previous
-- day's row to is_latest=false. So the flag accumulates on multiple dates
-- per stock, the INNER JOIN in get_home_stocks() emits one row per
-- is_latest=true match, and the search renders duplicate cards.
--
-- The previous script (diagnose_missing_from_search.sql §3a) tried to fix
-- this by re-writing is_latest on every row in price_data — that hit the
-- Supabase statement timeout because the table is millions of rows.
--
-- This script is TARGETED: it only updates rows that are currently in the
-- wrong state. Small write set, fast, no timeout.
--
-- Run in Supabase SQL Editor. Sections are independent — read 1 + 2 to
-- understand the scope, then run 3, then 4 to refresh the feed.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. How many companies have the bug? ─────────────────────────────────
-- Two kinds of bad state:
--   (a) multiple is_latest=true rows  → duplicate cards in search
--   (b) zero is_latest=true rows      → stock missing from search entirely

SELECT
  CASE
    WHEN latest_count > 1 THEN 'TOO MANY is_latest rows (duplicates)'
    WHEN latest_count = 0 THEN 'ZERO is_latest rows (missing from search)'
  END AS bug_kind,
  COUNT(*) AS company_count
FROM (
  SELECT
    c.id,
    (SELECT COUNT(*) FROM price_data p
     WHERE p.company_id = c.id AND p.is_latest = true) AS latest_count
  FROM companies c
  WHERE (c.is_suspended IS NULL OR c.is_suspended = false)
    AND EXISTS (SELECT 1 FROM price_data p WHERE p.company_id = c.id)
) t
WHERE latest_count <> 1
GROUP BY bug_kind
ORDER BY bug_kind;


-- ── 2. Sample of the bad rows (eyeball before fixing) ───────────────────
-- Top 20 companies with multiple is_latest=true rows, plus their bad dates.

SELECT
  c.symbol,
  c.name,
  COUNT(*) AS latest_row_count,
  ARRAY_AGG(p.date ORDER BY p.date DESC) AS dates_currently_flagged_latest
FROM companies c
JOIN price_data p ON p.company_id = c.id AND p.is_latest = true
GROUP BY c.id, c.symbol, c.name
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, c.symbol
LIMIT 20;


-- ── 3a. FIX duplicates — clear is_latest on every NON-most-recent row ───
-- For each company that has multiple is_latest=true rows, we keep the most
-- recent date flagged and clear all the older flagged ones. Only writes to
-- rows that need changing, so the write set scales with the duplicate
-- count (small), not the table size.

WITH max_latest_per_company AS (
  SELECT company_id, MAX(date) AS max_date
  FROM price_data
  WHERE is_latest = true
  GROUP BY company_id
  HAVING COUNT(*) > 1   -- only companies with duplicates
)
UPDATE price_data p
SET is_latest = false
FROM max_latest_per_company m
WHERE p.company_id = m.company_id
  AND p.is_latest = true
  AND p.date < m.max_date;
-- Expect: rowcount ≈ (duplicates - 1) per affected company. e.g. RELIANCE
-- showed 3 latest rows → 2 rows updated here.


-- ── 3b. FIX missing — flag the most-recent row for companies with none ──
-- For each company that has ZERO is_latest=true rows but DOES have
-- price_data, flag its most-recent row. Small write set: 1 row per
-- affected company.

WITH companies_missing_latest AS (
  SELECT c.id
  FROM companies c
  WHERE (c.is_suspended IS NULL OR c.is_suspended = false)
    AND EXISTS (SELECT 1 FROM price_data p WHERE p.company_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM price_data p
      WHERE p.company_id = c.id AND p.is_latest = true
    )
),
most_recent_per_missing AS (
  SELECT DISTINCT ON (p.company_id) p.company_id, p.date
  FROM price_data p
  JOIN companies_missing_latest m ON m.id = p.company_id
  ORDER BY p.company_id, p.date DESC
)
UPDATE price_data p
SET is_latest = true
FROM most_recent_per_missing m
WHERE p.company_id = m.company_id
  AND p.date = m.date;


-- ── 4. Refresh the materialized view so the feed picks up the fix ──────
SELECT refresh_home_stocks();


-- ── 5. Verify ──────────────────────────────────────────────────────────
-- RELIANCE should now appear exactly ONCE.
SELECT symbol, name, sector, close, stage
FROM mv_home_stocks
WHERE symbol = 'RELIANCE';

-- Count companies still in a bad state (should be 0 unless there are
-- companies with no price_data at all — those need ingest-pipeline fixes).
SELECT
  COUNT(*) FILTER (WHERE latest_count > 1) AS still_duplicated,
  COUNT(*) FILTER (WHERE latest_count = 0) AS still_missing
FROM (
  SELECT
    (SELECT COUNT(*) FROM price_data p
     WHERE p.company_id = c.id AND p.is_latest = true) AS latest_count
  FROM companies c
  WHERE (c.is_suspended IS NULL OR c.is_suspended = false)
    AND EXISTS (SELECT 1 FROM price_data p WHERE p.company_id = c.id)
) t;
