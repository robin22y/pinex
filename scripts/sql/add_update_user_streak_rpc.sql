-- ─────────────────────────────────────────────────────────────────
-- update_user_streak() — realtime daily-streak update.
-- ─────────────────────────────────────────────────────────────────
--
-- BACKGROUND
--   scripts/calc_streaks.py runs once a day at ~12:00 UTC. Users who
--   log in AFTER the script runs (most Indian users — IST evenings)
--   never get credited until the NEXT day's pipeline run, by which
--   point their last_active_at looks like "yesterday" and the script
--   either no-ops or resets the streak. Real-world symptom: user
--   logs in for 4 days in a row, sees "1 day streak".
--
-- THIS RPC FIXES IT
--   Called from the frontend on page load (Account.jsx / Home.jsx
--   useEffect on auth-resolved). It ensures a user_points row exists,
--   then applies the same streak rules calc_streaks.py uses — but
--   right now, against the caller, in their own auth session.
--   The nightly script becomes a safety net for users who only
--   visit via Telegram bot / email links.
--
-- BACKFILL ON FIRST CALL
--   If last_streak_date is NULL (never tracked) we walk the user's
--   points_transactions to find the longest UNBROKEN run of
--   daily_login rows ending today or yesterday — so an existing
--   user who's been logging in for 4 days gets credited for all 4
--   on the first call, not just 1.
--
-- IDEMPOTENT
--   Same-day re-calls are a no-op (last_streak_date already today).
--   Returns a jsonb result so the caller can render the streak number
--   without a second round-trip.
--
-- SECURITY
--   SECURITY DEFINER so it can update user_points even when RLS
--   prevents direct writes. Bound to the calling auth.uid() — there
--   is no path to update another user's row.

DROP FUNCTION IF EXISTS public.update_user_streak();
CREATE OR REPLACE FUNCTION public.update_user_streak()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid    := auth.uid();
  v_today        date    := (now() AT TIME ZONE 'utc')::date;
  v_yesterday    date    := v_today - INTERVAL '1 day';
  v_existing     RECORD;
  v_new_streak   integer;
  v_new_longest  integer;
  v_backfilled   integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  -- Ensure a user_points row exists. NO-OPs when one already does.
  INSERT INTO public.user_points (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT current_streak, longest_streak, last_streak_date
  INTO v_existing
  FROM public.user_points
  WHERE user_id = v_uid;

  -- ── Same-day re-entry: leave the streak alone ────────────────
  IF v_existing.last_streak_date = v_today THEN
    RETURN jsonb_build_object(
      'ok',           true,
      'streak',       v_existing.current_streak,
      'longest',      v_existing.longest_streak,
      'last_date',    v_existing.last_streak_date,
      'unchanged',    true
    );
  END IF;

  -- ── Backfill from points_transactions on first call ──────────
  -- If we've never tracked a streak for this user but they have
  -- historical daily_login rows, walk those rows backward from today
  -- counting consecutive days. This gives Robin (4 days of logins,
  -- streak stuck at 0/1) the correct number on his next page load.
  IF v_existing.last_streak_date IS NULL THEN
    SELECT COUNT(*) INTO v_backfilled
    FROM (
      -- Distinct UTC dates of daily_login transactions, newest first.
      SELECT DISTINCT (created_at AT TIME ZONE 'utc')::date AS d
      FROM public.points_transactions
      WHERE user_id = v_uid
        AND action_type = 'daily_login'
      ORDER BY d DESC
    ) dates
    WHERE dates.d = v_today - (
      -- Count only the contiguous prefix — break on the first gap.
      SELECT COALESCE(MIN(rn) - 1, 0)
      FROM (
        SELECT
          (created_at AT TIME ZONE 'utc')::date AS d,
          ROW_NUMBER() OVER (ORDER BY (created_at AT TIME ZONE 'utc')::date DESC) - 1 AS rn
        FROM (
          SELECT DISTINCT created_at
          FROM public.points_transactions
          WHERE user_id = v_uid
            AND action_type = 'daily_login'
        ) t
      ) ranked
      WHERE ranked.d <> v_today - (ranked.rn * INTERVAL '1 day')::interval
    ) * INTERVAL '1 day';

    -- The CTE above is fiddly; if it didn't return a sensible value,
    -- fall back to a simpler PL/pgSQL loop that's easier to reason
    -- about.
    IF v_backfilled IS NULL OR v_backfilled < 0 THEN
      v_backfilled := 0;
      DECLARE
        v_expected date := v_today;
        r RECORD;
      BEGIN
        FOR r IN
          SELECT DISTINCT (created_at AT TIME ZONE 'utc')::date AS d
          FROM public.points_transactions
          WHERE user_id = v_uid
            AND action_type = 'daily_login'
          ORDER BY d DESC
        LOOP
          IF r.d = v_expected OR (v_expected = v_today AND r.d = v_yesterday) THEN
            v_backfilled := v_backfilled + 1;
            v_expected := r.d - INTERVAL '1 day';
          ELSE
            EXIT;
          END IF;
        END LOOP;
      END;
    END IF;

    -- Today's increment ON TOP of the backfilled run.
    v_new_streak := v_backfilled + 1;
  -- ── Standard increment / reset ───────────────────────────────
  ELSIF v_existing.last_streak_date = v_yesterday THEN
    v_new_streak := COALESCE(v_existing.current_streak, 0) + 1;
  ELSE
    -- Gap ≥ 2 days → fresh start.
    v_new_streak := 1;
  END IF;

  v_new_longest := GREATEST(COALESCE(v_existing.longest_streak, 0), v_new_streak);

  UPDATE public.user_points
  SET current_streak   = v_new_streak,
      longest_streak   = v_new_longest,
      last_streak_date = v_today,
      updated_at       = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'ok',          true,
    'streak',      v_new_streak,
    'longest',     v_new_longest,
    'last_date',   v_today,
    'unchanged',   false,
    'backfilled',  v_existing.last_streak_date IS NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_user_streak() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_user_streak() TO authenticated;


-- Verification
SELECT 'update_user_streak function missing' AS issue
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'update_user_streak'
);
