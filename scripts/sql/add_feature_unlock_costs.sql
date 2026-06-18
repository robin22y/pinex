-- ── Points-as-access-currency foundation ─────────────────────────────
-- Two unrelated additions in one migration so they're easy to revert
-- together if the points-economy reframe goes sideways:
--
--   1. NEW TABLE feature_unlock_costs — admin-editable catalogue of
--      points-cost-to-unlock per gated feature. The actual "spend
--      points to unlock" UX isn't built yet; this is the data shape
--      it'll consume. Five seed rows match the spec.
--
--   2. NEW points_config rows for the action_types the upcoming
--      earning hooks will reference (stock_view, streak_7_day_bonus,
--      streak_30_day_bonus, first_screen, share_stock). Adding them
--      here so the points_config table is the single source of truth
--      for point values — every caller goes through awardPoints()
--      which reads from points_config.
--
-- IDEMPOTENT — re-runs are no-ops via ON CONFLICT DO NOTHING.

-- ── 1. feature_unlock_costs ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_unlock_costs (
  feature_key   text  PRIMARY KEY,
  display_name  text  NOT NULL,
  points_cost   int   NOT NULL CHECK (points_cost >= 0),
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE feature_unlock_costs IS
  'Points-cost-to-unlock catalogue per gated feature. Read by the redeem-points UI; admin-editable from /admin/points.';

-- ── RLS — public read, no writes from the client ────────────────
-- The catalogue is informational (anyone can see the access
-- ladder). Writes must go through the admin SQL surface.
ALTER TABLE feature_unlock_costs ENABLE ROW LEVEL SECURITY;

-- Re-create idempotently so re-runs are no-ops.
DROP POLICY IF EXISTS feature_unlock_costs_public_read ON feature_unlock_costs;
CREATE POLICY feature_unlock_costs_public_read
  ON feature_unlock_costs
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Seed costs — values per the points-economy spec. Idempotent via
-- ON CONFLICT so re-runs don't bump updated_at unnecessarily.
INSERT INTO feature_unlock_costs (feature_key, display_name, points_cost, notes)
VALUES
  ('advanced',              'Advanced (market internals)', 500,   'Alternative path to the streak-5 gate.'),
  ('screener_pro',          'Pro Screener',                1000,  'Unlocks every Screener template.'),
  ('swingx_access',         'SwingX',                      1000,  'Single-tap SwingX shortlist.'),
  ('historical_conditions', 'Historical Conditions',       1500,  'Backtest-grade pattern history.'),
  ('iqjet',                 'IQjet',                       5000,  'Invite-only — points unlock the queue.')
ON CONFLICT (feature_key) DO NOTHING;

-- ── 2. New points_config rows for earning hooks ───────────────────
-- Schema reminder: action_type (text), display_name, category,
-- points_value (int), daily_cap (int or null = no cap), is_active.
INSERT INTO points_config (action_type, display_name, category, points_value, daily_cap, is_active, notes)
VALUES
  ('stock_view',           'View a stock page',            'engage',  1,   10,   true,
    'Capped at 10/day so a marathon scroll session does not skew totals.'),
  ('streak_7_day_bonus',   '7-day streak bonus',           'streak',  35,  1,    true,
    'Awarded once when user_points.current_streak ticks to 7.'),
  ('streak_30_day_bonus',  '30-day streak bonus',          'streak',  150, 1,    true,
    'Awarded once when user_points.current_streak ticks to 30.'),
  ('first_screen',         'First screener run today',     'engage',  5,   1,    true,
    'One-time bonus per UTC day when the user first runs Screener / Lab.'),
  ('share_stock',          'Share a stock link',           'engage',  3,   5,    true,
    'Copy-link button on the stock detail page. Capped to discourage spam.')
ON CONFLICT (action_type) DO NOTHING;
