-- ─────────────────────────────────────────────────────────────────
-- Rewards page leaderboard RPCs
-- ─────────────────────────────────────────────────────────────────
-- Two SECURITY DEFINER functions backing the /rewards page:
--
--   rewards_weekly_leaderboard()  → top 10 earners (last 7 days)
--   rewards_user_weekly_rank(uid) → that user's rank, even if outside top 10
--
-- Why RPCs and not a direct PostgREST query:
--   • points_transactions almost certainly has RLS limiting SELECT to
--     "user_id = auth.uid()" — without that, every user could read
--     every other user's transaction history.
--   • PostgREST has no SQL GROUP BY surface — the rewards page needs
--     SUM(points) GROUPED BY user_id.
--   • The leaderboard exposes ONLY aggregate display data: first
--     name + last initial + sum. No transaction-level rows.
--
-- Privacy note on the displayed name:
--   We show "Robin A." (first name + first letter of last name).
--   Full names are NOT returned to the client even though we have
--   them in profiles — the function does the trimming server-side.
-- ─────────────────────────────────────────────────────────────────


-- ── 1. Weekly leaderboard — top 10 earners over the trailing 7 days ──
CREATE OR REPLACE FUNCTION rewards_weekly_leaderboard()
RETURNS TABLE (
  user_id        uuid,
  display_name   text,
  weekly_points  bigint,
  is_me          boolean
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  -- Require authentication. Without this an anonymous PostgREST
  -- caller could pull the leaderboard without an account.
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  RETURN QUERY
  WITH weekly_sum AS (
    SELECT
      pt.user_id,
      SUM(pt.points)::bigint AS weekly_points
    FROM public.points_transactions pt
    WHERE pt.created_at >= (now() - interval '7 days')
      AND pt.points > 0                          -- earnings only, exclude redemptions
    GROUP BY pt.user_id
  )
  SELECT
    w.user_id,
    -- "Robin A." pattern. Falls back to "PineX user" if name is missing.
    COALESCE(
      NULLIF(
        TRIM(
          COALESCE(SPLIT_PART(p.full_name, ' ', 1), '') ||
          CASE
            WHEN COALESCE(SPLIT_PART(p.full_name, ' ', 2), '') <> ''
              THEN ' ' || LEFT(SPLIT_PART(p.full_name, ' ', 2), 1) || '.'
            ELSE ''
          END
        ),
        ''
      ),
      'PineX user'
    )                                            AS display_name,
    w.weekly_points,
    (w.user_id = caller_id)                       AS is_me
  FROM weekly_sum w
  LEFT JOIN public.profiles p ON p.id = w.user_id
  ORDER BY w.weekly_points DESC
  LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION rewards_weekly_leaderboard() FROM public;
GRANT EXECUTE ON FUNCTION rewards_weekly_leaderboard() TO authenticated;


-- ── 2. Caller's rank — for the "Your rank this week: 23rd" line ──
CREATE OR REPLACE FUNCTION rewards_user_weekly_rank()
RETURNS TABLE (
  rank           bigint,
  weekly_points  bigint,
  total_ranked   bigint
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  RETURN QUERY
  WITH weekly_sum AS (
    SELECT
      pt.user_id,
      SUM(pt.points)::bigint AS weekly_points
    FROM public.points_transactions pt
    WHERE pt.created_at >= (now() - interval '7 days')
      AND pt.points > 0
    GROUP BY pt.user_id
  ),
  ranked AS (
    SELECT
      user_id,
      weekly_points,
      RANK() OVER (ORDER BY weekly_points DESC) AS rnk
    FROM weekly_sum
  )
  SELECT
    r.rnk          AS rank,
    r.weekly_points,
    (SELECT COUNT(*) FROM weekly_sum) AS total_ranked
  FROM ranked r
  WHERE r.user_id = caller_id;
END;
$$;

REVOKE ALL ON FUNCTION rewards_user_weekly_rank() FROM public;
GRANT EXECUTE ON FUNCTION rewards_user_weekly_rank() TO authenticated;


-- ═════════════════════════════════════════════════════════════════
-- Verification
-- ═════════════════════════════════════════════════════════════════

-- Run as a signed-in user:
--   SELECT * FROM rewards_weekly_leaderboard();
--   SELECT * FROM rewards_user_weekly_rank();
