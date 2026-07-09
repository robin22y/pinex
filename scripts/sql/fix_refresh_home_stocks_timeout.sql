-- ─────────────────────────────────────────────────────────────────
-- Fix: refresh_home_stocks() hits Postgres statement_timeout
-- ─────────────────────────────────────────────────────────────────
-- WHY: the daily pipeline calls refresh_home_stocks() twice per run
-- (fetch_bhav_daily.py, calc_delivery_signals.py). As price_data has
-- grown (2 years retained × ~2100 companies), REFRESH MATERIALIZED
-- VIEW mv_home_stocks now regularly exceeds the connection pooler's
-- default statement_timeout and gets killed:
--
--   'message': 'canceling statement due to statement timeout', 'code': '57014'
--
-- Confirmed in production logs — GitHub Actions run 28931786768
-- (2026-07-08 09:19 UTC), step "(5/7) calc_delivery_signals.py":
--   View refresh error: {'message': 'canceling statement due to
--   statement timeout', 'code': '57014', ...}
--
-- When this refresh silently fails mid-pipeline, downstream SwingX
-- eligibility computation sees stale/empty data, which cascades into
-- calc_swing_conditions.py's health gate correctly failing the job
-- (working as designed) — but the whole day's data update is lost.
--
-- HOW: ALTER FUNCTION ... SET statement_timeout gives this specific
-- function a longer per-call budget, independent of whatever the
-- pooler or role default is. Every caller (both Python scripts, plus
-- manual `SELECT refresh_home_stocks();` in the SQL editor) gets the
-- longer timeout automatically — no application code changes needed.
--
-- This does NOT touch the function body (still the grant-hardened
-- version from harden_mv_home_stocks_grants.sql) — it only attaches a
-- per-function config parameter, which Postgres applies for the
-- duration of every call to this function.
--
-- Idempotent: safe to re-run.
-- To apply: copy-paste into Supabase Dashboard → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────────

ALTER FUNCTION public.refresh_home_stocks() SET statement_timeout = '180000'; -- 3 minutes, in ms

-- ── VERIFY ───────────────────────────────────────────────────────
-- Should show statement_timeout=180000 in the proconfig array.
SELECT proname, proconfig
FROM pg_proc
WHERE proname = 'refresh_home_stocks';

-- Sanity check — should now complete without a 57014 error even
-- under load.
SELECT refresh_home_stocks();

-- ── ROLLBACK (if 3 minutes isn't enough, or you want pooler default back) ──
-- ALTER FUNCTION public.refresh_home_stocks() RESET statement_timeout;
-- ─────────────────────────────────────────────────────────────────
