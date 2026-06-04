-- ─────────────────────────────────────────────────────────────────
-- Harden mv_home_stocks against silent grant loss
-- ─────────────────────────────────────────────────────────────────
-- WHY: mv_home_stocks lost its SELECT grants for anon / authenticated
-- at some point (most likely during a column-add rebuild — adding
-- columns to a materialized view requires DROP + CREATE, and CREATE
-- does NOT inherit the prior grants). Consequence: the entire
-- screener went empty (every /mv_home_stocks fetch returned []),
-- which surfaces in the UI as "No results for 'pharma'" / no stocks
-- on /home / empty Lab page.
--
-- This migration:
--   1. Re-grants SELECT on the view to the API roles right now
--      (immediate fix — paste & run, screener works on next reload).
--   2. Wraps the same grant into refresh_home_stocks() so the next
--      time someone rebuilds the view, the daily pipeline's refresh
--      call automatically re-asserts the grants — no more silent
--      loss the next time a column is added.
--
-- Idempotent: safe to re-run. Both GRANT and CREATE OR REPLACE are
-- no-ops when already in their target state.
--
-- To apply: copy-paste into Supabase Dashboard → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- 1. IMMEDIATE FIX — re-grant SELECT to the REST API roles
-- ═════════════════════════════════════════════════════════════════

GRANT SELECT ON mv_home_stocks TO anon, authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════
-- 2. HARDENING — bake the grant into refresh_home_stocks()
-- ═════════════════════════════════════════════════════════════════
-- The function is called at the end of every daily pipeline run
-- (fetch_bhav_daily.py, calc_delivery_signals.py) and can be called
-- manually with `SELECT refresh_home_stocks();`. By re-asserting the
-- GRANT inside the function body, the screener stays accessible
-- even after a DROP + CREATE rebuild — the grants are restored on
-- the next refresh.
--
-- REFRESH MATERIALIZED VIEW preserves grants on its own, so the
-- GRANT inside this function is a no-op in the common case. It only
-- matters when the view was rebuilt (column added/removed) — exactly
-- the scenario that caused this incident.
--
-- Signature unchanged: still () → void, callable from existing
-- Python pipeline code with no changes.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_home_stocks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_home_stocks;
  -- Re-assert grants so a column-add rebuild (DROP + CREATE) can't
  -- silently lock the API roles out again. No-op when grants
  -- already in place.
  EXECUTE 'GRANT SELECT ON mv_home_stocks TO anon, authenticated, service_role';
END;
$$;

-- Keep the function callable from the daily-pipeline service-role
-- session and from a manual SQL Editor run.
GRANT EXECUTE ON FUNCTION public.refresh_home_stocks() TO service_role;


-- ═════════════════════════════════════════════════════════════════
-- 3. VERIFY — confirm both fixes landed
-- ═════════════════════════════════════════════════════════════════

-- 3a. View should now show 3 rows (anon, authenticated, service_role
--     each with SELECT). If 0 rows → step 1 did not run.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'mv_home_stocks'
ORDER BY grantee;

-- 3b. Sanity check — refresh should now succeed AND re-grant
--     (look at the GRANTS query above before and after this call).
SELECT refresh_home_stocks();

-- 3c. Run query 3a one more time to confirm grants survived the
--     refresh (they should — the function re-asserts them).
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'mv_home_stocks'
ORDER BY grantee;


-- ═════════════════════════════════════════════════════════════════
-- ROLLBACK (if the new function body misbehaves for some reason)
-- ═════════════════════════════════════════════════════════════════
-- -- Restore a plain refresh-only function (no grant re-assertion):
-- CREATE OR REPLACE FUNCTION public.refresh_home_stocks()
-- RETURNS void
-- LANGUAGE sql
-- AS $$
--   REFRESH MATERIALIZED VIEW mv_home_stocks;
-- $$;
--
-- -- Note: if you roll back, the grants on the view still persist
-- -- (Postgres doesn't auto-revoke). You'd only see the bug recur
-- -- the next time someone rebuilds the view.
-- ─────────────────────────────────────────────────────────────────
