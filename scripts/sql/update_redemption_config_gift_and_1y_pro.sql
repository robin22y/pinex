-- ════════════════════════════════════════════════════════════════════════
-- update_redemption_config_gift_and_1y_pro.sql
--
-- Two Rewards-page changes per Robin's spec (18 Jun 2026):
--
--   1. Hide "1 Year Pro Free" (10,000 pts). 10k pts is too steep for
--      beta — it kills daily-engagement motivation by collapsing the
--      whole points game into a single big-bang prize. Setting
--      is_active=false hides it server-side; Rewards.jsx already drops
--      it from its REDEMPTION_LIST as a belt-and-suspenders measure.
--
--   2. "Gift Pro to a Friend" → "Gift 100 Points". Was 1,000 pts for
--      a month of Pro to a friend; now a flat 100-pt points-to-points
--      transfer between users. Points-as-currency stays internal —
--      no Pro plan changes hand, keeps the gift gesture cheap enough
--      to be common without leaking real value.
--
-- Both changes target only the redemption_config table — no
-- points_transactions / user_points side effects. Idempotent: the
-- UPDATEs set absolute values, re-running is a no-op.
--
-- Run once in Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Hide 1 Year Pro Free
UPDATE public.redemption_config
   SET is_active = false,
       updated_at = now()
 WHERE redemption_key = 'pro_1_year';

-- 2) Retitle gift_pro to a 100-point gift
UPDATE public.redemption_config
   SET display_name    = 'Gift 100 Points',
       description     = 'Send 100 points to another PineX user',
       value_label     = 'Send 100 points to a friend',
       points_required = 100,
       badge           = NULL,
       updated_at      = now()
 WHERE redemption_key = 'gift_pro';

-- ── Verification ────────────────────────────────────────────────────────
-- SELECT redemption_key, display_name, points_required, is_active
--   FROM public.redemption_config
--  WHERE redemption_key IN ('pro_1_year', 'gift_pro');
--
-- Expected:
--   pro_1_year | 1 Year Pro Free | 10000 | false
--   gift_pro   | Gift 100 Points | 100   | true
