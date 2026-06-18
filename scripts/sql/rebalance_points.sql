-- ════════════════════════════════════════════════════════════════════════
-- rebalance_points.sql
--
-- Points economy rebalance — June 2026.
--
-- Why
--   The original rates collapsed the path to Pro into a single
--   one-shot welcome bonus + a few stock-view drips. The "habit loop"
--   intent didn't survive contact with reality: users hit Pro by
--   farming stock_view + welcome_bonus inside an hour, then bounced.
--   Goal of this rebalance:
--     • Stretch the path to Pro across ~14 calendar days
--     • Reward streaks heavily (compounding daily-return incentive)
--     • Kill farmable actions (stock_view, watchlist_add)
--     • Cap academy module earning at 5/day so 8 modules can't be
--       binge-cleared on day 1
--
-- Target math at the new rates:
--   day 1 welcome           +200
--   14 × daily_login        +280
--   5 × academy_module      +100 (capped by sessionStorage gate
--                                 enforced in src/hooks/useAcademy.js)
--   streak_7_day_bonus      +150
--   streak_14_day_bonus     +300
--   ─────────────────────────────
--   Total at day 14         1,030  (Pro threshold = 1,000)
--
-- Grandfather: existing balances are NOT touched. Only NEW awards use
-- the new rates. user_points.total_points / lifetime_points stay as-is.
--
-- Schema note: this codebase's catalogue table is `points_config`, NOT
-- `point_action_types`. Robin's spec referenced the latter — same idea,
-- different name. Confirmed via probe (action_type, points_value,
-- is_active, daily_cap columns exist on points_config).
--
-- Run once in Supabase SQL editor. Idempotent — re-running sets the
-- same absolute values, so no double-counting.
-- ════════════════════════════════════════════════════════════════════════

-- ── New action_type: streak_14_day_bonus ────────────────────────────────
INSERT INTO public.points_config
  (action_type, display_name, category, points_value, daily_cap, is_active, notes)
VALUES
  ('streak_14_day_bonus',
   '14-day streak bonus',
   'streak', 300, 1, true,
   'Mid-streak bonus added in the June 2026 rebalance. Fills the gap '
     || 'between the 7-day and 30-day bonuses so the streak curve does '
     || 'not feel flat for two weeks.')
ON CONFLICT (action_type) DO UPDATE
SET display_name = EXCLUDED.display_name,
    category     = EXCLUDED.category,
    points_value = EXCLUDED.points_value,
    daily_cap    = EXCLUDED.daily_cap,
    is_active    = EXCLUDED.is_active,
    notes        = EXCLUDED.notes,
    updated_at   = now();

-- ── Rate changes ────────────────────────────────────────────────────────
UPDATE public.points_config
   SET points_value = 200, updated_at = now()
 WHERE action_type = 'welcome_bonus';

UPDATE public.points_config
   SET points_value = 20, updated_at = now()
 WHERE action_type = 'daily_login';

UPDATE public.points_config
   SET points_value = 20, updated_at = now()
 WHERE action_type IN (
   'academy_module_1','academy_module_2','academy_module_3',
   'academy_module_4','academy_module_5','academy_module_6',
   'academy_module_7','academy_module_8'
 );

UPDATE public.points_config
   SET points_value = 100, updated_at = now()
 WHERE action_type = 'academy_final_exam';

UPDATE public.points_config
   SET points_value = 150, updated_at = now()
 WHERE action_type = 'streak_7_day_bonus';

UPDATE public.points_config
   SET points_value = 500, updated_at = now()
 WHERE action_type = 'streak_30_day_bonus';

-- ── Deactivate farmable actions ─────────────────────────────────────────
-- DELETE would orphan historical points_transactions rows that joined
-- on the catalogue; safer to deactivate so the rows still describe
-- themselves but the awarder helper returns 0.
UPDATE public.points_config
   SET points_value = 0, is_active = false, updated_at = now()
 WHERE action_type IN ('stock_view', 'watchlist_add');

-- ── Referral guardrail ──────────────────────────────────────────────────
-- Keep the catalogue row at 100 pts but document the new awarding gate:
-- the frontend referral handler must check the referred user's visit
-- count (>= 3) before calling award_user_bonus. The SQL only updates
-- copy; the gate itself lives in the application code.
UPDATE public.points_config
   SET notes = 'Awarded once per referred user — frontend MUST gate '
     || 'on the referred user having visited 3+ times (anti-farm). '
     || 'Awards land 100 pts to the referrer; referred user gets a '
     || 'separate welcome_bonus when they sign up.',
       updated_at = now()
 WHERE action_type = 'referral';

-- ── Gift redemption cap → 20 points ─────────────────────────────────────
-- Supersedes the 100-pt cap set in
-- update_redemption_config_gift_and_1y_pro.sql. 20 keeps gifting
-- cheap-and-common; a casual "thanks for the recommendation" gesture,
-- not an economy lever.
UPDATE public.redemption_config
   SET display_name    = 'Gift 20 Points',
       description     = 'Send 20 points to another PineX user',
       value_label     = 'Send 20 points to a friend',
       points_required = 20,
       updated_at      = now()
 WHERE redemption_key = 'gift_pro';

-- ── Verification ────────────────────────────────────────────────────────
-- SELECT action_type, points_value, is_active
--   FROM public.points_config
--  WHERE action_type IN (
--    'welcome_bonus','daily_login','academy_module_1','academy_final_exam',
--    'streak_7_day_bonus','streak_14_day_bonus','streak_30_day_bonus',
--    'stock_view','watchlist_add','referral'
--  )
--  ORDER BY action_type;
--
-- SELECT redemption_key, display_name, points_required, is_active
--   FROM public.redemption_config
--  WHERE redemption_key = 'gift_pro';
