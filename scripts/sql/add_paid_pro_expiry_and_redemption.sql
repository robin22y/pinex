-- add_paid_pro_expiry_and_redemption.sql
--
-- Adds a finite expiry to paid Pro redemptions and exposes a single
-- SECURITY DEFINER RPC that atomically:
--   1. checks the caller's points balance
--   2. deducts the redemption cost from user_points
--   3. bumps redeemed_points
--   4. flips/extends the caller's paid Pro window
--   5. logs a negative points_transactions row
--
-- Apply once in Supabase SQL editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.redeem_pro_month(
  p_points_cost integer DEFAULT 1000,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_cost integer := GREATEST(COALESCE(p_points_cost, 1000), 1);
  v_days integer := GREATEST(COALESCE(p_days, 30), 1);
  v_total integer := 0;
  v_redeemed integer := 0;
  v_plan text := 'free';
  v_plan_activated_at timestamptz := NULL;
  v_pro_expires_at timestamptz := NULL;
  v_anchor timestamptz := NULL;
  v_new_total integer := 0;
  v_new_redeemed integer := 0;
  v_new_start timestamptz := NULL;
  v_new_expiry timestamptz := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.user_points (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT
    COALESCE(up.total_points, 0),
    COALESCE(up.redeemed_points, 0),
    COALESCE(p.plan, 'free'),
    p.plan_activated_at,
    p.pro_expires_at
  INTO
    v_total,
    v_redeemed,
    v_plan,
    v_plan_activated_at,
    v_pro_expires_at
  FROM public.user_points up
  JOIN public.profiles p ON p.id = up.user_id
  WHERE up.user_id = v_uid
  FOR UPDATE OF up, p;

  IF v_total < v_cost THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  v_new_total := v_total - v_cost;
  v_new_redeemed := v_redeemed + v_cost;

  v_anchor :=
    CASE
      WHEN v_plan = 'pro' AND v_pro_expires_at IS NOT NULL AND v_pro_expires_at > v_now
        THEN v_pro_expires_at
      ELSE v_now
    END;

  v_new_start :=
    CASE
      WHEN v_plan = 'pro' AND v_pro_expires_at IS NOT NULL AND v_pro_expires_at > v_now
        THEN COALESCE(v_plan_activated_at, v_now)
      ELSE v_now
    END;

  v_new_expiry := v_anchor + make_interval(days => v_days);

  UPDATE public.user_points
  SET total_points = v_new_total,
      redeemed_points = v_new_redeemed,
      updated_at = v_now
  WHERE user_id = v_uid;

  UPDATE public.profiles
  SET plan = 'pro',
      plan_activated_at = v_new_start,
      pro_expires_at = v_new_expiry,
      trial_expires_at = NULL,
      points_balance = v_new_total
  WHERE id = v_uid;

  INSERT INTO public.points_transactions (
    user_id,
    action_type,
    points,
    notes
  ) VALUES (
    v_uid,
    'pro_redemption',
    -v_cost,
    'Pro access redeemed'
  );

  RETURN jsonb_build_object(
    'new_total', v_new_total,
    'redeemed_points', v_new_redeemed,
    'pro_started_at', v_new_start,
    'pro_expires_at', v_new_expiry
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_pro_month(integer, integer) TO authenticated;
