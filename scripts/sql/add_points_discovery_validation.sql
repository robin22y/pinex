-- ── Points config rows for the new Home features ──────────────────
-- discovery_tap     awarded when the user taps a row in the
--                   "In your sectors today" (WhatToLookAt) card.
--                   1 pt, cap 3/day — three discovery taps is plenty
--                   to seed a research session without becoming a
--                   farming target.
-- validation_earned awarded once per day when the
--                   "Watchlist criteria updates" (YouWereRight) card
--                   actually has something to render. 5 pt, cap 1/day
--                   — passive earn for users whose existing watchlist
--                   showed strengthened criteria; rewards the act of
--                   curating a watchlist, not the act of clicking.
--
-- Idempotent: ON CONFLICT (action_type) DO NOTHING keeps any admin-
-- tuned values intact. Updating points_value later goes through the
-- admin UI; this migration only seeds.

INSERT INTO points_config
    (action_type,           display_name,                       category, points_value, daily_cap, notes)
VALUES
    ('discovery_tap',       'Tapped a suggested stock',         'daily',  1,            3,         'Awarded on each tap from the home "In your sectors today" card.'),
    ('validation_earned',   'Watchlist criteria improved',      'daily',  5,            1,         'Awarded once/day when a watchlist stock''s criteria score went up vs the prior trading day.')
ON CONFLICT (action_type) DO NOTHING;
