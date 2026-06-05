-- ─────────────────────────────────────────────────────────────────
-- admin_most_watched(p_window_days int) — Most Watched widget RPC
-- ─────────────────────────────────────────────────────────────────
-- WHY: the admin Most Watched widget queries `watchlists` directly,
-- which under default RLS only returns rows owned by the calling
-- user. The widget then tallies what it can see — so a superadmin
-- viewing the widget sees a count of "1" against each of their own
-- watched stocks instead of the true population-level aggregate.
--
-- This SECURITY DEFINER function runs as the table owner (bypasses
-- RLS), gates itself on the caller being a `superadmin` profile,
-- and returns ONLY the aggregate result — never per-user rows. The
-- widget loses the ability to leak individual users' watch lists
-- even if a future client bug tried to.
--
-- p_window_days:
--   0  → all time
--   7  → last 7 days
--   30 → last 30 days
--   any positive int → last N days
--
-- Idempotent: CREATE OR REPLACE pattern + DROP-then-CREATE on the
-- GRANT/REVOKE so re-running this file is safe.
-- ─────────────────────────────────────────────────────────────────


CREATE OR REPLACE FUNCTION admin_most_watched(p_window_days int DEFAULT 0)
RETURNS TABLE (
  company_id   uuid,
  symbol       text,
  name         text,
  sector       text,
  watch_count  int,
  last_added   timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Hard gate: only superadmins may call this. Without the check,
  -- any authenticated user could invoke the function and read the
  -- aggregate. SECURITY DEFINER means we're running as the table
  -- owner, so the RLS scope leak this function exists to fix would
  -- otherwise apply in reverse.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    w.company_id,
    -- Prefer the live companies.symbol; fall back to the symbol
    -- the user typed when they added the watch (legacy rows may
    -- predate the company_id link, or the company may have been
    -- renamed since).
    COALESCE(c.symbol, w.symbol)  AS symbol,
    c.name,
    c.sector,
    COUNT(*)::int                  AS watch_count,
    MAX(w.added_at)                AS last_added
  FROM public.watchlists w
  LEFT JOIN public.companies c ON c.id = w.company_id
  WHERE
    p_window_days = 0
    OR w.added_at >= (now() - (p_window_days || ' days')::interval)
  GROUP BY
    w.company_id,
    COALESCE(c.symbol, w.symbol),
    c.name,
    c.sector
  ORDER BY watch_count DESC, last_added DESC NULLS LAST
  LIMIT 15;
END;
$$;


-- ═════════════════════════════════════════════════════════════════
-- Grants — only authenticated callers reach the function. The
-- function itself rejects non-admins inside the body. Belt + braces.
-- ═════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION admin_most_watched(int) FROM public;
GRANT EXECUTE ON FUNCTION admin_most_watched(int) TO authenticated;


-- ═════════════════════════════════════════════════════════════════
-- Verification — run after creating to confirm scope works.
-- (Will RAISE for a non-admin caller; returns top 15 for admin.)
-- ═════════════════════════════════════════════════════════════════

-- SELECT * FROM admin_most_watched(0);   -- all time
-- SELECT * FROM admin_most_watched(7);   -- last 7 days
-- SELECT * FROM admin_most_watched(30);  -- last 30 days
