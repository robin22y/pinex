-- ── Welcome bonus + Academy point bumps ──────────────────────────
-- One migration covers three things because they share the same
-- target table (points_config) and the same idempotent shape:
--
--   1. welcome_bonus (500 pts)         — fired once on first
--                                        AuthContext hydrate per user.
--                                        See src/context/AuthContext.jsx
--                                        for the caller-side dedupe
--                                        check against points_transactions.
--
--   2. academy_module_1..8 (100 pts ea) — was 50 (legacy 'module_complete').
--                                        Each module fires once per user
--                                        on completion. Caller dedupes
--                                        via points_transactions.
--
--   3. academy_final_exam (200 pts)    — one-shot completion bonus.
--
-- ON CONFLICT (action_type) DO UPDATE so re-runs reset stale values
-- to the new amounts without erroring.

INSERT INTO points_config
  (action_type, display_name, category, points_value, daily_cap, is_active, notes)
VALUES
  ('welcome_bonus',
    'Welcome to PineX',
    'onboarding', 500, 1, true,
    'Awarded once at first login. AuthContext caller-dedupes via points_transactions.'),

  ('academy_module_1', 'Academy Module 1 complete', 'academy', 100, 1, true,
    'One-time award. Caller checks points_transactions for prior fire.'),
  ('academy_module_2', 'Academy Module 2 complete', 'academy', 100, 1, true, 'One-time award.'),
  ('academy_module_3', 'Academy Module 3 complete', 'academy', 100, 1, true, 'One-time award.'),
  ('academy_module_4', 'Academy Module 4 complete', 'academy', 100, 1, true, 'One-time award.'),
  ('academy_module_5', 'Academy Module 5 complete', 'academy', 100, 1, true, 'One-time award.'),
  ('academy_module_6', 'Academy Module 6 complete', 'academy', 100, 1, true, 'One-time award.'),
  ('academy_module_7', 'Academy Module 7 complete', 'academy', 100, 1, true, 'One-time award.'),
  ('academy_module_8', 'Academy Module 8 complete', 'academy', 100, 1, true, 'One-time award.'),

  ('academy_final_exam',
    'Academy final exam passed',
    'academy', 200, 1, true,
    'One-time. Bonus on top of the per-module rewards.')

ON CONFLICT (action_type) DO UPDATE
SET display_name = EXCLUDED.display_name,
    category     = EXCLUDED.category,
    points_value = EXCLUDED.points_value,
    daily_cap    = EXCLUDED.daily_cap,
    is_active    = EXCLUDED.is_active,
    notes        = EXCLUDED.notes,
    updated_at   = now();
