-- ─────────────────────────────────────────────────────────────────
-- Points configuration tables — admin-editable point economy
-- ─────────────────────────────────────────────────────────────────
-- Three tables that move the points economy out of source code and
-- into the database. Admins can change point values and run
-- seasonal promotions from the dashboard with no code deploy.
--
--   points_config        — earning catalogue (one row per action_type)
--   points_offers        — seasonal multipliers + flat bonuses
--   redemption_config    — redemption catalogue (1 month Pro, etc.)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT
-- means re-running is safe. Seed rows preserve any admin edits the
-- next time the file is re-run.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- 1. points_config — earning catalogue
-- ═════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS points_config (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type   text        UNIQUE NOT NULL,    -- 'daily_login', 'classify_stock', …
  display_name  text        NOT NULL,           -- 'Open app + check watchlist'
  category      text        NOT NULL,           -- 'daily' | 'learning' | 'referral' | 'streak' | 'achievement'
  points_value  integer     NOT NULL DEFAULT 0,
  daily_cap     integer,                         -- NULL = no cap
  is_active     boolean     NOT NULL DEFAULT true,
  notes         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,                            -- admin email of last editor
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS points_config_category_idx  ON points_config (category);
CREATE INDEX IF NOT EXISTS points_config_active_idx    ON points_config (is_active);


-- ═════════════════════════════════════════════════════════════════
-- 2. points_offers — seasonal multipliers + flat bonuses
-- ═════════════════════════════════════════════════════════════════
-- A non-NULL action_type scopes the offer to one action. NULL means
-- it applies to every action_type. multiplier = 1.0 + bonus_points
-- = 0 is a no-op offer (kept for historical records).
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS points_offers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  description    text,
  multiplier     numeric(5,2) NOT NULL DEFAULT 1.0,
  bonus_points   integer     NOT NULL DEFAULT 0,
  action_type    text,                            -- NULL = applies to ALL actions
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS points_offers_active_window_idx
  ON points_offers (is_active, starts_at, ends_at);


-- ═════════════════════════════════════════════════════════════════
-- 3. redemption_config — redemption catalogue
-- ═════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS redemption_config (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  redemption_key  text        UNIQUE NOT NULL,    -- 'pro_1_month', etc.
  display_name    text        NOT NULL,
  description     text,
  value_label     text,                            -- 'Worth ₹299'
  badge           text,                            -- 'BEST VALUE' | NULL
  points_required integer     NOT NULL,
  sort_order      integer     NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS redemption_config_sort_idx ON redemption_config (sort_order);


-- ═════════════════════════════════════════════════════════════════
-- Seed data — earn catalogue (matches Rewards.jsx static config)
-- ═════════════════════════════════════════════════════════════════
INSERT INTO points_config (action_type, display_name, category, points_value, daily_cap, notes) VALUES
  -- DAILY ────────────────────────────────────────────────────────
  ('daily_login',          'Open app + check watchlist', 'daily',       2,    1, NULL),
  ('daily_question',       'Answer daily question',      'daily',       5,    1, NULL),
  ('classify_stock',       'Classify a stock',           'daily',       3,    5, NULL),
  ('run_screen',           'Run a screen',               'daily',       2,    3, NULL),
  ('read_methodology',     'Read methodology article',   'daily',       3,    3, NULL),

  -- STREAK MILESTONES ────────────────────────────────────────────
  ('streak_3_days',        '3-day streak milestone',     'streak',     15,    NULL, 'One-shot reward on the 3rd day'),
  ('streak_7_days',        '7-day streak milestone',     'streak',     35,    NULL, NULL),
  ('streak_14_days',       '14-day streak milestone',    'streak',     75,    NULL, NULL),
  ('streak_30_days',       '30-day streak milestone',    'streak',    150,    NULL, NULL),
  ('streak_100_days',      '100-day streak milestone',   'streak',    600,    NULL, NULL),

  -- LEARNING ─────────────────────────────────────────────────────
  ('module_complete_1',    'Complete Module 1',          'learning',   50,    1, 'Once per user'),
  ('module_complete_2_7',  'Complete Modules 2–7',       'learning',   40,    1, 'Per module, one-time each'),
  ('module_complete_8',    'Complete Module 8',          'learning',   75,    1, NULL),
  ('certification',        'Pass certification',         'learning',  200,    1, NULL),
  ('featured_answer',      'Featured daily answer',      'learning',   25,    1, 'Awarded by admin'),
  ('ten_upvotes',          '10 upvotes on an answer',    'learning',   20,    NULL, 'Per answer that hits 10 upvotes'),

  -- REFERRAL ─────────────────────────────────────────────────────
  ('referral_click',       'Your link clicked',          'referral',   10,    5, NULL),
  ('referral_register',    'Friend registers',           'referral',  100,    NULL, 'Per referral'),
  ('referral_module1',     'Friend completes Module 1',  'referral',  200,    NULL, NULL),
  ('referral_30day',       'Friend active 30 days',      'referral',  500,    NULL, NULL),
  ('referral_certified',   'Friend gets certified',      'referral',  300,    NULL, NULL),

  -- ACHIEVEMENTS ─────────────────────────────────────────────────
  ('achievement_first_steps',  'First Steps',            'achievement',  10, NULL, NULL),
  ('achievement_week_warrior', 'Week Warrior',           'achievement',  35, NULL, NULL),
  ('achievement_classifier',   'Classifier',             'achievement',  50, NULL, NULL),
  ('achievement_student',      'Student',                'achievement', 100, NULL, NULL),
  ('achievement_graduate',     'Graduate',               'achievement', 200, NULL, NULL),
  ('achievement_evangelist',   'Evangelist',             'achievement', 100, NULL, NULL),
  ('achievement_centurion',    'Centurion (100 pts)',    'achievement',  50, NULL, NULL),
  ('achievement_thousander',   'Thousand Club',          'achievement', 100, NULL, NULL),
  ('achievement_lab_runner',   'Lab Runner',             'achievement',  50, NULL, NULL),
  ('achievement_streak_100',   '100-Day Streak',         'achievement', 600, NULL, NULL)
ON CONFLICT (action_type) DO NOTHING;


-- ═════════════════════════════════════════════════════════════════
-- Seed data — redemption catalogue (matches Rewards.jsx)
-- ═════════════════════════════════════════════════════════════════
INSERT INTO redemption_config (redemption_key, display_name, description, value_label, badge, points_required, sort_order) VALUES
  ('pro_1_month',   '1 Month Pro',          'Unlock Pro for 30 days',                       'Worth ₹299',                       NULL,         1000,   10),
  ('pro_50_off',    '50% Off Pro',          'Pay half price for your next month',           'Pay ₹150 instead of ₹299',         NULL,          500,   20),
  ('pro_1_year',    '1 Year Pro Free',      '12 months of Pro at zero cost',                'Worth ₹3,588',                     'BEST VALUE', 10000,   30),
  ('gift_pro',      'Gift Pro to a Friend', 'Give a friend one month of Pro on you',        'Give 1 month Pro',                 NULL,         1000,   40),
  ('streak_freeze', 'Streak Freeze',        'Pause your streak for 24 hours — max 2 active', 'Protect streak for 24 hours',     NULL,          100,   50)
ON CONFLICT (redemption_key) DO NOTHING;


-- ═════════════════════════════════════════════════════════════════
-- Seed data — one historical offer (inactive) so the table isn't
-- empty on first load. Admins create real ones from the dashboard.
-- ═════════════════════════════════════════════════════════════════
INSERT INTO points_offers (name, description, multiplier, bonus_points, action_type, starts_at, ends_at, is_active, created_by)
SELECT 'Founding Bonus (closed)',
       'Historical record — the +100 founding-graduate-bonus run on 2026-06-07.',
       1.0,
       0,
       'founding_graduate_bonus',
       '2026-06-07T00:00:00+00:00'::timestamptz,
       '2026-06-07T23:59:59+00:00'::timestamptz,
       false,
       'system'
WHERE NOT EXISTS (
  SELECT 1 FROM points_offers WHERE name = 'Founding Bonus (closed)'
);


-- ═════════════════════════════════════════════════════════════════
-- RLS — public read, admin write
-- ═════════════════════════════════════════════════════════════════
-- The frontend (Rewards.jsx + AdminPointsConfig) needs to read these
-- tables. RLS allows SELECT for everyone (the values are public
-- information — what each action is worth). Mutations are gated by
-- the AdminRoute on the JSX side; if we ever ship a public mutation
-- code path, swap "admin writes" to a profiles.role check.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE points_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_offers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemption_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public reads points_config"  ON points_config;
DROP POLICY IF EXISTS "public reads points_offers"  ON points_offers;
DROP POLICY IF EXISTS "public reads redemption"     ON redemption_config;
CREATE POLICY "public reads points_config"  ON points_config     FOR SELECT USING (true);
CREATE POLICY "public reads points_offers"  ON points_offers     FOR SELECT USING (true);
CREATE POLICY "public reads redemption"     ON redemption_config FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin writes points_config" ON points_config;
DROP POLICY IF EXISTS "admin writes points_offers" ON points_offers;
DROP POLICY IF EXISTS "admin writes redemption"    ON redemption_config;
CREATE POLICY "admin writes points_config"
  ON points_config
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')));
CREATE POLICY "admin writes points_offers"
  ON points_offers
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')));
CREATE POLICY "admin writes redemption"
  ON redemption_config
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')));

GRANT SELECT ON points_config, points_offers, redemption_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON points_config, points_offers, redemption_config TO authenticated;


-- ═════════════════════════════════════════════════════════════════
-- Verification
-- ═════════════════════════════════════════════════════════════════
-- After running:
--   SELECT category, COUNT(*) FROM points_config GROUP BY category;
--   SELECT * FROM redemption_config ORDER BY sort_order;
--   SELECT * FROM points_offers ORDER BY starts_at DESC;
-- Expected: 30 points_config rows, 5 redemption_config rows, 1 closed offer.
