-- ════════════════════════════════════════════════════════════════════════
-- grant_7day_pro_to_all_users.sql
--
-- One-time backfill: grant every current user 7 days of free Pro access,
-- expiring 2026-06-28 23:59:59 UTC (early morning 2026-06-29 IST).
--
-- PAIRS WITH
--   - Rewards page section reorder (Redeem moved to top)
--   - "Subscribe to Pro" nudge banner that activates starting
--     2026-06-29 for users whose pro_expires_at has passed.
--
-- RULES
--   - Sets plan='pro' (paid tier, not trial).
--   - Sets pro_expires_at to the shared expiry timestamp.
--   - Clears trial_expires_at since the user is now on paid Pro.
--   - The WHERE clause is idempotent: users already on Pro that
--     extends BEYOND the grant expiry keep their longer access.
--     Re-running this script is safe.
--
-- ROLLBACK
--   To undo the grant for users we explicitly stamped:
--     UPDATE public.profiles
--     SET plan = 'free',
--         pro_expires_at = NULL,
--         plan_activated_at = NULL
--     WHERE pro_expires_at = '2026-06-28 23:59:59+00';
--
-- DEPENDS ON
--   scripts/sql/fix_is_admin_recursion.sql must have been applied,
--   otherwise the UPDATE 500s the same way the per-row PATCHes do.
-- ════════════════════════════════════════════════════════════════════════

UPDATE public.profiles
SET plan               = 'pro',
    pro_expires_at     = '2026-06-28 23:59:59+00',
    plan_activated_at  = COALESCE(plan_activated_at, now()),
    trial_expires_at   = NULL
WHERE pro_expires_at IS NULL
   OR pro_expires_at < '2026-06-28 23:59:59+00';

-- Sanity reports — read-only, optional to inspect after the UPDATE.
SELECT 'users on pro after grant' AS metric, COUNT(*) AS n
FROM public.profiles WHERE plan = 'pro';

SELECT 'users still free after grant' AS metric, COUNT(*) AS n
FROM public.profiles WHERE plan = 'free';
