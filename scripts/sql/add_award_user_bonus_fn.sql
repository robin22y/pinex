-- ════════════════════════════════════════════════════════════════════════
-- add_award_user_bonus_fn.sql
--
-- SECURITY DEFINER RPC that lets authenticated users self-claim
-- one-shot bonuses (welcome bonus, academy module completions, streak
-- milestones) WITHOUT relaxing the strict INSERT policy on
-- points_transactions.
--
-- Why this exists
--   security_restrict_points_transactions_insert.sql whitelists only
--   the high-frequency "user actually did something" action_types
--   (daily_login, classify_stock, run_screen, …). Bonus action_types
--   like welcome_bonus / academy_module_N / streak_7_day_bonus were
--   excluded — sound from an anti-abuse standpoint, but it meant the
--   frontend's awardPoints() calls for those types were silently
--   denied. Result: every new signup landed on user_points.total = 0
--   even though AuthContext "fired" the welcome bonus.
--
-- What this fn enforces
--   - Caller must be authenticated (auth.uid() set).
--   - p_action_type must be one of the WHITELIST below — same set the
--     client-side helpers (AuthContext, useAcademy) call awardPoints
--     for. Catches typos and prevents arbitrary action_types.
--   - Idempotent: if a points_transactions row already exists for
--     (auth.uid(), p_action_type), the RPC returns the existing
--     total_points without writing again. Eliminates double-awards
--     when the IIFE fires twice (sign-out / sign-in cycle, refresh
--     race) — replaces the client-side dedupe lookups we used before.
--   - points_value comes from points_config (single source of truth);
--     p_fallback_points used only if config is missing/disabled.
--   - Inserts points_transactions row (bypasses RLS via SECURITY
--     DEFINER) AND bumps user_points (creates the row if missing).
--
-- Returns the user's NEW total_points after the award, or the existing
-- total if the bonus was already claimed.
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.award_user_bonus(text, integer, text);

CREATE OR REPLACE FUNCTION public.award_user_bonus(
  p_action_type     text,
  p_fallback_points integer DEFAULT 0,
  p_notes           text    DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id    uuid    := auth.uid();
  award_amount integer;
  cfg_value    integer;
  cfg_active   boolean;
  new_total    integer;
BEGIN
  -- ── Auth gate ─────────────────────────────────────────────────────
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be authenticated';
  END IF;

  -- ── action_type whitelist ────────────────────────────────────────
  -- Keep in sync with the awardPoints call sites:
  --   - AuthContext welcome_bonus + streak_{7,30,100}_day_bonus
  --   - useAcademy academy_module_{1..8} + academy_final_exam
  IF p_action_type NOT IN (
    'welcome_bonus',
    'academy_module_1', 'academy_module_2', 'academy_module_3',
    'academy_module_4', 'academy_module_5', 'academy_module_6',
    'academy_module_7', 'academy_module_8',
    'academy_final_exam',
    'streak_7_day_bonus', 'streak_30_day_bonus', 'streak_100_day_bonus'
  ) THEN
    RAISE EXCEPTION 'Unsupported action_type: %', p_action_type;
  END IF;

  -- ── Idempotency: skip if already claimed ─────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.points_transactions
     WHERE user_id = caller_id
       AND action_type = p_action_type
     LIMIT 1
  ) THEN
    SELECT coalesce(total_points, 0) INTO new_total
      FROM public.user_points
     WHERE user_id = caller_id;
    RETURN coalesce(new_total, 0);
  END IF;

  -- ── Resolve points amount ────────────────────────────────────────
  SELECT points_value, is_active
    INTO cfg_value, cfg_active
    FROM public.points_config
   WHERE action_type = p_action_type
   LIMIT 1;

  IF cfg_active IS TRUE AND cfg_value IS NOT NULL AND cfg_value >= 0 THEN
    award_amount := cfg_value;
  ELSE
    award_amount := GREATEST(coalesce(p_fallback_points, 0), 0);
  END IF;

  IF award_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid points amount for %: % (config=% fallback=%)',
      p_action_type, award_amount, cfg_value, p_fallback_points;
  END IF;

  -- ── Insert transaction (bypasses RLS via SECURITY DEFINER) ───────
  INSERT INTO public.points_transactions (user_id, points, action_type, notes)
  VALUES (caller_id, award_amount, p_action_type, p_notes);

  -- ── Bump user_points (seed row if missing) ───────────────────────
  INSERT INTO public.user_points (user_id, total_points, lifetime_points, updated_at)
  VALUES (caller_id, award_amount, award_amount, now())
  ON CONFLICT (user_id) DO UPDATE
    SET total_points    = public.user_points.total_points    + EXCLUDED.total_points,
        lifetime_points = public.user_points.lifetime_points + EXCLUDED.lifetime_points,
        updated_at      = now()
  RETURNING total_points INTO new_total;

  RETURN coalesce(new_total, award_amount);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.award_user_bonus(text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_user_bonus(text, integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.award_user_bonus(text, integer, text) TO authenticated;
