-- ════════════════════════════════════════════════════════════════════════
-- backfill_telegram_subscribers.sql  (v2 — pulls from 3 sources)
--
-- Recover historical Telegram bot users from every signal we have:
--
--   SOURCE A — usage_events WHERE event_type = 'telegram_subscribed'
--     The /subscribe handler logs this. Original v1 backfill only used
--     this source — but most users hit /start without typing
--     /subscribe, so this list was short.
--
--   SOURCE B — usage_events WHERE event_type = 'telegram_deeplink_succeeded'
--     The /start <token> deep-link branch logs this when a user
--     connects via /link. metadata carries chat_id + telegram_username
--     so we can populate both.
--
--   SOURCE C — profiles.telegram_chat_id IS NOT NULL
--     Every PineX account that successfully linked Telegram. The
--     /link flow writes the chat_id here directly. This is the
--     canonical source for "linked PineX users on Telegram".
--
--   SOURCE D — usage_events WHERE event_type = 'telegram_started'
--     (NEW) The /start handler now logs this on every welcome-flow
--     hit. Going forward this is the master audit log — every
--     /start lands here.
--
-- A user who appears in multiple sources is deduplicated on chat_id
-- (PRIMARY KEY). The EARLIEST timestamp across all sources becomes
-- created_at. Display name (username, first_name) is picked from
-- whichever source has it (profiles + telegram_deeplink_succeeded +
-- telegram_started carry these; telegram_subscribed only has chat_id).
--
-- ON CONFLICT (chat_id) DO NOTHING — safe to re-run. Existing rows
-- (live subscribers post-migration) are left alone.
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── Pre-flight: count what each source contributes ─────────────────────
DO $$
DECLARE
  cur_count    INT;
  src_a_count  INT;
  src_b_count  INT;
  src_c_count  INT;
  src_d_count  INT;
BEGIN
  SELECT COUNT(*) INTO cur_count FROM telegram_subscribers;

  SELECT COUNT(DISTINCT metadata->>'chat_id') INTO src_a_count
    FROM usage_events
    WHERE event_type = 'telegram_subscribed'
      AND metadata->>'chat_id' IS NOT NULL;

  SELECT COUNT(DISTINCT metadata->>'chat_id') INTO src_b_count
    FROM usage_events
    WHERE event_type = 'telegram_deeplink_succeeded'
      AND metadata->>'chat_id' IS NOT NULL;

  SELECT COUNT(*) INTO src_c_count
    FROM profiles WHERE telegram_chat_id IS NOT NULL;

  SELECT COUNT(DISTINCT metadata->>'chat_id') INTO src_d_count
    FROM usage_events
    WHERE event_type = 'telegram_started'
      AND metadata->>'chat_id' IS NOT NULL;

  RAISE NOTICE 'Before backfill: % rows in telegram_subscribers', cur_count;
  RAISE NOTICE 'Source A (/subscribe events): % distinct chat_ids', src_a_count;
  RAISE NOTICE 'Source B (/start deep-link events): % distinct chat_ids', src_b_count;
  RAISE NOTICE 'Source C (profiles.telegram_chat_id linked accounts): % users', src_c_count;
  RAISE NOTICE 'Source D (/start welcome events): % distinct chat_ids', src_d_count;
END $$;

-- ── SOURCE A — /subscribe events ───────────────────────────────────────
INSERT INTO telegram_subscribers (chat_id, created_at)
SELECT
  metadata->>'chat_id',
  MIN(created_at)
FROM usage_events
WHERE event_type = 'telegram_subscribed'
  AND metadata->>'chat_id' IS NOT NULL
GROUP BY metadata->>'chat_id'
ON CONFLICT (chat_id) DO NOTHING;

-- ── SOURCE B — /start deep-link events (has username metadata too) ─────
INSERT INTO telegram_subscribers (chat_id, username, created_at)
SELECT
  metadata->>'chat_id',
  metadata->>'telegram_username',
  MIN(created_at)
FROM usage_events
WHERE event_type = 'telegram_deeplink_succeeded'
  AND metadata->>'chat_id' IS NOT NULL
GROUP BY metadata->>'chat_id', metadata->>'telegram_username'
ON CONFLICT (chat_id) DO NOTHING;

-- ── SOURCE C — profiles.telegram_chat_id (linked PineX accounts) ────────
-- These are the most-trusted rows — chat_id was explicitly written by
-- the bot when the /link flow succeeded, AND we have the PineX user_id
-- to link back. telegram_chat_id is stored as bigint on profiles but
-- str-cast for the chat_id text PK on telegram_subscribers.
INSERT INTO telegram_subscribers (chat_id, username, user_id, created_at)
SELECT
  telegram_chat_id::text,
  telegram_username,
  id,
  COALESCE(telegram_linked_at, created_at)
FROM profiles
WHERE telegram_chat_id IS NOT NULL
ON CONFLICT (chat_id) DO UPDATE
  SET user_id   = COALESCE(telegram_subscribers.user_id, EXCLUDED.user_id),
      username  = COALESCE(telegram_subscribers.username, EXCLUDED.username);
-- ↑ For Source C we DO UPDATE instead of DO NOTHING because the
-- profiles linkage is the canonical source of truth for user_id —
-- if Source A inserted a row without user_id, we want to fill it in
-- from profiles. Existing username is preserved if already set.

-- ── SOURCE D — /start welcome events ───────────────────────────────────
INSERT INTO telegram_subscribers (chat_id, username, first_name, created_at)
SELECT
  metadata->>'chat_id',
  metadata->>'username',
  metadata->>'first_name',
  MIN(created_at)
FROM usage_events
WHERE event_type = 'telegram_started'
  AND metadata->>'chat_id' IS NOT NULL
GROUP BY metadata->>'chat_id', metadata->>'username', metadata->>'first_name'
ON CONFLICT (chat_id) DO NOTHING;

-- ── Post-flight summary ────────────────────────────────────────────────
DO $$
DECLARE
  final_count INT;
BEGIN
  SELECT COUNT(*) INTO final_count FROM telegram_subscribers;
  RAISE NOTICE 'After backfill: % rows in telegram_subscribers', final_count;
  IF final_count = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE 'STILL ZERO — diagnostic time. Run these queries:';
    RAISE NOTICE '';
    RAISE NOTICE '  SELECT event_type, COUNT(*) FROM usage_events';
    RAISE NOTICE '  WHERE event_type LIKE ''telegram_%%''';
    RAISE NOTICE '  GROUP BY event_type ORDER BY 2 DESC;';
    RAISE NOTICE '';
    RAISE NOTICE 'If no telegram_* events exist at all, the bot service';
    RAISE NOTICE 'wasn''t running (or its Supabase service-role key was';
    RAISE NOTICE 'wrong). In that case the 9 users you remember weren''t';
    RAISE NOTICE 'actually recorded anywhere — nothing to recover from.';
  END IF;
END $$;

-- ── Diagnostic queries (run manually if count is unexpected) ────────────
--
-- 1. What telegram-related events exist?
--    SELECT event_type, COUNT(*) FROM usage_events
--    WHERE event_type LIKE 'telegram_%'
--    GROUP BY event_type ORDER BY 2 DESC;
--
-- 2. How many PineX accounts have linked Telegram?
--    SELECT COUNT(*) FROM profiles WHERE telegram_chat_id IS NOT NULL;
--
-- 3. List backfilled rows with their source:
--    SELECT chat_id, username, first_name, user_id, created_at
--    FROM telegram_subscribers
--    ORDER BY created_at DESC;
