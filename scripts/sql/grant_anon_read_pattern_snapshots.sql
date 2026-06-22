-- ─────────────────────────────────────────────────────────────────
-- pattern_snapshots — open SELECT to anon
-- ─────────────────────────────────────────────────────────────────
-- ROOT CAUSE
--   The Historical Conditions section on /stock/:symbol was showing
--   "found 0" on every stock, even with 5 years of backfilled data
--   in the table. The /stock/:symbol route is wrapped in <PublicGate>
--   (anon-accessible by design — public landing surface), but the
--   original RLS policy on pattern_snapshots gated SELECT to the
--   `authenticated` role only:
--
--     CREATE POLICY pattern_snapshots_authenticated_select
--       ON public.pattern_snapshots
--       FOR SELECT
--       TO authenticated
--       USING (true);
--
--   So every signed-out visitor hit zero rows regardless of how
--   much history existed in the table. Same content, same RLS,
--   different role → invisible.
--
-- FIX
--   pattern_snapshots is broadcast statistics — every reader sees
--   the same rows; there's nothing user-scoped to protect. Opening
--   SELECT to anon AND authenticated lines RLS up with the page's
--   actual access model.
--
--   This matches the policy shape used on other broadcast tables
--   (market_internals, sectors) which are already public-readable
--   for the same reason.
--
-- Idempotent. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────

-- Drop the old auth-only policy and any prior public variant from
-- earlier attempts at this fix, then create a single canonical one.
DROP POLICY IF EXISTS pattern_snapshots_authenticated_select
  ON public.pattern_snapshots;
DROP POLICY IF EXISTS pattern_snapshots_public_select
  ON public.pattern_snapshots;

CREATE POLICY pattern_snapshots_public_select
  ON public.pattern_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON POLICY pattern_snapshots_public_select
  ON public.pattern_snapshots IS
  'Broadcast statistics — every reader sees the same rows. Opened to anon + authenticated so the public stock-detail page can render the Historical Conditions section. Writes still flow through service role from the backtest pipeline.';

-- Belt-and-suspenders — make sure the table-level GRANT also
-- permits anon SELECT. Supabase usually grants both anon and
-- authenticated on public-schema tables by default, but on rare
-- migration paths the anon GRANT can go missing.
GRANT SELECT ON public.pattern_snapshots TO anon, authenticated;


-- ── Verification ──────────────────────────────────────────────
-- Both queries below should return one row after the migration
-- runs. If either returns zero, the policy or grant didn't land.

SELECT 'pattern_snapshots SELECT policy missing for anon' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'pattern_snapshots'
    AND cmd        = 'SELECT'
    AND 'anon' = ANY (roles)
);

SELECT 'anon has no SELECT grant on pattern_snapshots' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name   = 'pattern_snapshots'
    AND grantee      = 'anon'
    AND privilege_type = 'SELECT'
);
