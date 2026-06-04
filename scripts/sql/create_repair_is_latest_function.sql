-- ─────────────────────────────────────────────────────────────────
-- repair_is_latest_flag() — atomic self-heal for price_data.is_latest
-- ─────────────────────────────────────────────────────────────────
-- Called nightly from scripts/repair_is_latest_and_refresh_view.py
-- to guarantee that every company's most-recent price_data row has
-- is_latest = true and no other row does. Fixes the recurring
-- "screener shows empty cells" issue caused by the bhav pipeline's
-- non-transactional clear-then-insert race.
--
-- The whole UPDATE runs in a single transaction — either every
-- flag is correct after this call, or nothing changed (rolled back
-- on failure). ~1-2 seconds for ~1.5M rows.
--
-- Idempotent: re-running when everything is already correct is a
-- no-op (the WHERE clause filters to rows that actually need
-- flipping).
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.repair_is_latest_flag()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  UPDATE price_data p
  SET is_latest = (p.date = m.max_date)
  FROM (
    SELECT company_id, MAX(date) AS max_date
    FROM price_data
    GROUP BY company_id
  ) m
  WHERE p.company_id = m.company_id
    AND (p.date = m.max_date OR p.is_latest = true);
$$;

-- Service role only. The nightly script runs as service_role; no
-- reason for anon / authenticated to call this from the REST API.
REVOKE EXECUTE ON FUNCTION public.repair_is_latest_flag() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_is_latest_flag() TO service_role;


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═════════════════════════════════════════════════════════════════

-- 1. Confirm the function exists
SELECT proname, pg_get_function_identity_arguments(oid) AS sig
FROM pg_proc
WHERE proname = 'repair_is_latest_flag';

-- 2. Run it once now to repair any existing damage
SELECT public.repair_is_latest_flag();

-- 3. Confirm rows-marked-latest now equals distinct-companies
SELECT
  COUNT(*) FILTER (WHERE is_latest = true) AS rows_latest,
  COUNT(DISTINCT company_id)                AS distinct_companies
FROM price_data;
-- Expected: rows_latest ≈ distinct_companies (~2125)

-- 4. Refresh the materialized view so the screener sees the fix
SELECT public.refresh_home_stocks();
