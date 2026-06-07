-- ════════════════════════════════════════════════════════════════════════
-- Diagnose & repair stocks missing from Home search (mv_home_stocks)
-- ════════════════════════════════════════════════════════════════════════
-- Symptom: "Reliance Industries Limited" (and other stocks) don't show up
-- on the Home page search, even though they exist in the `companies` table.
--
-- Cause: the materialized view mv_home_stocks is built from get_home_stocks(),
-- which INNER JOINs companies with price_data WHERE is_latest = true. If a
-- company has no price_data row flagged is_latest, it silently disappears
-- from the search feed.
--
-- This script:
--   1. Confirms RELIANCE specifically — is it in companies? in mv_home_stocks?
--      does it have price_data? is is_latest set?
--   2. Lists ALL companies missing from mv_home_stocks with the reason.
--   3. Offers two one-line repairs.
--
-- Run in Supabase SQL Editor. Sections are independent — read 1 + 2, then
-- pick the right repair from 3.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. RELIANCE specific check ──────────────────────────────────────────
-- Each subquery returns ONE row showing what state RELIANCE is in.

-- 1a. Is RELIANCE in the companies table at all?
SELECT
  'companies' AS source,
  id, symbol, name, sector, tier, is_suspended
FROM companies
WHERE symbol = 'RELIANCE';
-- Expect: 1 row. If 0 rows → the search can't possibly find it; check the
-- ingest pipeline for why this stock never got inserted.


-- 1b. Does RELIANCE have any price_data rows at all?
SELECT
  'price_data ANY' AS source,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE is_latest = true) AS latest_rows,
  MAX(date) AS most_recent_date
FROM price_data p
JOIN companies c ON c.id = p.company_id
WHERE c.symbol = 'RELIANCE';
-- Expect: total_rows > 0 AND latest_rows = 1.
-- If latest_rows = 0 → is_latest never flipped to the newest row → fix #3a.


-- 1c. Is RELIANCE in mv_home_stocks (the actual feed the browser reads)?
SELECT
  'mv_home_stocks' AS source,
  symbol, name, sector, close, stage
FROM mv_home_stocks
WHERE symbol = 'RELIANCE';
-- Expect: 1 row with name = 'Reliance Industries Limited'.
-- If 0 rows → RELIANCE is excluded by the INNER JOIN in get_home_stocks().


-- ── 2. ALL companies missing from search, with reason ────────────────────
-- This is the big one. Returns every company that the user CAN'T find via
-- search, grouped by the underlying cause.

SELECT
  c.symbol,
  c.name,
  c.sector,
  c.tier,
  CASE
    WHEN c.is_suspended = true
      THEN 'SUSPENDED — flagged is_suspended in companies'
    WHEN NOT EXISTS (SELECT 1 FROM price_data p WHERE p.company_id = c.id)
      THEN 'NO PRICE DATA — never ingested to price_data'
    WHEN NOT EXISTS (
      SELECT 1 FROM price_data p
      WHERE p.company_id = c.id AND p.is_latest = true
    )
      THEN 'STALE FLAG — has price_data rows but none with is_latest=true'
    ELSE 'UNKNOWN — present in mv source but filtered out somehow'
  END AS reason_missing,
  (SELECT MAX(date) FROM price_data WHERE company_id = c.id)
    AS last_price_date
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM mv_home_stocks m WHERE m.symbol = c.symbol
)
ORDER BY reason_missing, c.symbol;
-- Read the output:
--   - rows where reason starts with "STALE FLAG"   → fix #3a (most common)
--   - rows where reason starts with "SUSPENDED"    → fix #3b (intentional?)
--   - rows where reason starts with "NO PRICE"     → upstream ingest issue,
--     not fixable here; investigate fetch_bhav_daily.py for that ticker
--   - rows where reason = "UNKNOWN"                → MV is stale, run #3c


-- ── 3. Repairs ──────────────────────────────────────────────────────────

-- 3a. Fix STALE FLAG — re-flip is_latest for every company.
--     Sets is_latest=true on the most recent date per company, false everywhere
--     else. Safe to run anytime — idempotent. THIS IS THE MOST LIKELY FIX.
WITH latest_per_company AS (
  SELECT DISTINCT ON (company_id) company_id, date
  FROM price_data
  ORDER BY company_id, date DESC
)
UPDATE price_data p
SET is_latest = (
  EXISTS (
    SELECT 1 FROM latest_per_company l
    WHERE l.company_id = p.company_id AND l.date = p.date
  )
);
-- After this runs, refresh the MV (see 3c) so the front-end picks it up.


-- 3b. Fix SUSPENDED — unsuspend a specific stock (e.g. RELIANCE) if it was
--     wrongly flagged. Comment out / change symbol as needed; runs ZERO
--     rows unless you uncomment.
-- UPDATE companies SET is_suspended = false WHERE symbol = 'RELIANCE';


-- 3c. Refresh the materialized view so the fixes above land in the feed.
--     This calls refresh_home_stocks() which both refreshes AND re-grants
--     SELECT to the API roles (see harden_mv_home_stocks_grants.sql).
SELECT refresh_home_stocks();


-- ── 4. Verify the fix landed ────────────────────────────────────────────
-- Re-run 1c above — RELIANCE should now appear in mv_home_stocks. Then
-- hard-refresh the Home page and search "reliance" — should return the
-- stock card.
SELECT symbol, name, sector, close, stage
FROM mv_home_stocks
WHERE symbol = 'RELIANCE';

-- And the count of missing-from-search should now be near zero (only the
-- truly-no-price-data ones remain):
SELECT COUNT(*) AS still_missing_from_search
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM mv_home_stocks m WHERE m.symbol = c.symbol
);
