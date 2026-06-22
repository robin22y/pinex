-- ════════════════════════════════════════════════════════════════════════
-- drop_52w_defaults.sql
--
-- Removes the `DEFAULT 0` constraint on market_internals.new_52w_highs
-- / new_52w_lows / highs_minus_lows so failed fetch_52w_highs_lows.py
-- runs leave them as NULL instead of a misleading 0.
--
-- WHY THIS MATTERS
--   calc_market_internals.py creates today's row with these three
--   columns OMITTED from its upsert (it is NOT the sole writer; see
--   the long comment at section 1c in that file). With the columns
--   having `DEFAULT 0`, Postgres fills the gap with literal zeros.
--
--   If fetch_52w_highs_lows.py --update then fails (NSE down, network
--   blip), today's row sits at 0/0 forever — and the Pulse page shows
--   "52W Highs: 0 · 52W Lows: 0" to users, indistinguishable from a
--   genuinely dead-flat market day.
--
--   With these defaults removed, a failed fetch leaves the columns
--   NULL. The frontend can then render "—" / "data pending" instead
--   of a misleading 0; the broadcast Gate C0 (non-numeric check)
--   trips correctly; admin diagnosis becomes possible at a glance.
--
-- ROLLBACK
--   ALTER TABLE public.market_internals
--     ALTER COLUMN new_52w_highs    SET DEFAULT 0,
--     ALTER COLUMN new_52w_lows     SET DEFAULT 0,
--     ALTER COLUMN highs_minus_lows SET DEFAULT 0;
--
-- IDEMPOTENT
--   DROP DEFAULT on a column with no default is a no-op. Safe to
--   re-run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.market_internals
  ALTER COLUMN new_52w_highs    DROP DEFAULT,
  ALTER COLUMN new_52w_lows     DROP DEFAULT,
  ALTER COLUMN highs_minus_lows DROP DEFAULT;

-- One-time repair for today's row IF it landed at 0/0 because of the
-- default. Nulls it out so the manual fetch_52w_highs_lows.py --update
-- (or the next cron) can write the real counts cleanly. Restricted to
-- rows where BOTH are 0 — preserves any historical 0/0 day that was
-- a genuine NSE result (unlikely but defensive).
UPDATE public.market_internals
SET new_52w_highs    = NULL,
    new_52w_lows     = NULL,
    highs_minus_lows = NULL
WHERE new_52w_highs = 0
  AND new_52w_lows  = 0
  AND date >= CURRENT_DATE - INTERVAL '7 days';
