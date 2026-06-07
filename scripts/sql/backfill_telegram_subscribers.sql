-- ════════════════════════════════════════════════════════════════════════
-- backfill_telegram_subscribers.sql
--
-- Recover historical Telegram subscribers from usage_events. Until
-- setup_admin_role_and_telegram_subscribers.sql ran, the
-- telegram_subscribers table didn't exist — but scripts/telegram_bot.py
-- ALSO writes a parallel audit row to usage_events on every /start:
--
--   log_event("telegram_subscribed", {"chat_id": str(chat.id)})
--
-- So each historical /start left a row in usage_events even though the
-- telegram_subscribers upsert was a no-op against the missing table.
-- This migration reads those events and rebuilds telegram_subscribers
-- one row per distinct chat_id, with the EARLIEST telegram_subscribed
-- timestamp as created_at.
--
-- Users who later unsubscribed are EXCLUDED — the bot's /unsubscribe
-- writes 'telegram_unsubscribed', so if the latest event for a chat_id
-- is an unsubscribe, we skip it.
--
-- ON CONFLICT (chat_id) DO NOTHING means re-running is safe: any
-- chat_ids already in the table (newly subscribed post-migration) are
-- left alone.
--
-- WHAT WE CAN'T RECOVER
-- The original telegram_bot.py captured username + first_name in the
-- upsert payload but ONLY chat_id in the log_event metadata. So
-- backfilled rows show username=NULL and first_name=NULL. They appear
-- in admin counts and tables, just without display names. Users who
-- subscribe AFTER setup_admin_role_and_telegram_subscribers.sql ran
-- get the full record.
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── Pre-flight check — surface what we're about to do ──────────────────
DO $$
DECLARE
  current_count   INT;
  historical_count INT;
BEGIN
  SELECT COUNT(*) INTO current_count FROM telegram_subscribers;

  SELECT COUNT(DISTINCT metadata->>'chat_id') INTO historical_count
  FROM usage_events
  WHERE event_type = 'telegram_subscribed'
    AND metadata->>'chat_id' IS NOT NULL;

  RAISE NOTICE 'Before backfill: % rows in telegram_subscribers, % distinct chat_ids in usage_events',
    current_count, historical_count;
END $$;

-- ── Backfill ───────────────────────────────────────────────────────────
-- For each chat_id that subscribed at some point and DIDN'T have a later
-- unsubscribe event, insert a row with the earliest known created_at.
-- ON CONFLICT skips chat_ids already present (re-subscribed users etc.).
INSERT INTO telegram_subscribers (chat_id, created_at)
SELECT
  s.chat_id,
  s.first_subscribed_at
FROM (
  SELECT
    metadata->>'chat_id'  AS chat_id,
    MIN(created_at)       AS first_subscribed_at,
    MAX(created_at)       AS last_subscribed_at
  FROM usage_events
  WHERE event_type = 'telegram_subscribed'
    AND metadata->>'chat_id' IS NOT NULL
  GROUP BY metadata->>'chat_id'
) s
WHERE NOT EXISTS (
  -- Skip if the user later unsubscribed AFTER their most recent
  -- subscribe — i.e. they're actively unsubscribed.
  SELECT 1
  FROM usage_events u
  WHERE u.event_type = 'telegram_unsubscribed'
    AND u.metadata->>'chat_id' = s.chat_id
    AND u.created_at > s.last_subscribed_at
)
ON CONFLICT (chat_id) DO NOTHING;

-- ── Post-flight summary ────────────────────────────────────────────────
DO $$
DECLARE
  final_count INT;
BEGIN
  SELECT COUNT(*) INTO final_count FROM telegram_subscribers;
  RAISE NOTICE 'After backfill: % rows in telegram_subscribers', final_count;
  RAISE NOTICE 'If your expected count of ~9 isn''t reached, run:';
  RAISE NOTICE '  SELECT event_type, COUNT(*) FROM usage_events';
  RAISE NOTICE '  WHERE event_type IN (''telegram_subscribed'', ''telegram_unsubscribed'')';
  RAISE NOTICE '  GROUP BY event_type;';
  RAISE NOTICE 'to see how many subscribed / unsubscribed events actually exist.';
END $$;

-- ── If the count is still off — diagnostic queries to run manually ──────
--
-- 1. How many telegram_subscribed events?
--    SELECT COUNT(*) FROM usage_events WHERE event_type = 'telegram_subscribed';
--
-- 2. How many distinct chat_ids in those events?
--    SELECT COUNT(DISTINCT metadata->>'chat_id') FROM usage_events
--    WHERE event_type = 'telegram_subscribed';
--
-- 3. Are any chat_ids stored as numbers (not strings) in some rows?
--    SELECT pg_typeof(metadata->'chat_id'), COUNT(*)
--    FROM usage_events WHERE event_type = 'telegram_subscribed'
--    GROUP BY pg_typeof(metadata->'chat_id');
--    (The bot stringifies with str(chat.id), so this should always be
--    text — but checking rules out a data-shape mismatch.)
--
-- 4. List the chat_ids and timestamps:
--    SELECT metadata->>'chat_id' AS chat_id,
--           MIN(created_at) AS first_seen,
--           COUNT(*) AS event_count
--    FROM usage_events
--    WHERE event_type = 'telegram_subscribed'
--    GROUP BY metadata->>'chat_id'
--    ORDER BY first_seen DESC;
