-- ════════════════════════════════════════════════════════════════════════
-- setup_usage_events_rls_and_backfill.sql
--
-- Two problems in one migration:
--
-- PROBLEM 1 — RLS on usage_events
--   Browser-side logResearchUsage / logKeySaved / logTradingConsent
--   inserts may be silently denied by RLS — Supabase returns empty
--   data with no error when an INSERT is blocked. Telemetry events
--   never land, admin counts stay at 0, no one knows why.
--
--   Symmetric problem on the SELECT side: even if the writes worked
--   via service-role, the admin browser session can't read the rows
--   without an explicit policy.
--
-- PROBLEM 2 — Historical research_key_saved events don't exist
--   logKeySaved is a recent addition. Users who saved keys before that
--   commit have no research_key_saved row — they only have
--   research_question_asked rows.
--
--   BUT: every research_question_asked event PROVES the user had a
--   working key at that moment (you can't ask Gemini without one).
--   So we can synthesize a research_key_saved event for every user
--   who has ever asked a question — backdated to their first question
--   timestamp.
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── PART 1 — Make sure usage_events has RLS enabled ─────────────────────
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- ── PART 2 — Authenticated users may INSERT their own rows ──────────────
-- Browser-side telemetry needs this. The user_id MUST match auth.uid()
-- so users can only log events ABOUT themselves. event_type and
-- metadata are free-form (anything client-driven goes here).
--
-- Service-role bypasses this — pipeline scripts continue logging as
-- before.
DROP POLICY IF EXISTS "users insert own usage_events" ON usage_events;
CREATE POLICY "users insert own usage_events"
  ON usage_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IS NULL  -- anonymous events (no logged-in user) are allowed
  );

-- ── PART 3 — Admins may SELECT every row ────────────────────────────────
-- For the admin dashboards (research funnel, telegram counts, etc).
-- Anyone in profiles.role IN ('admin', 'superadmin') gets full read.
-- Service-role bypasses entirely.
DROP POLICY IF EXISTS "admin reads usage_events" ON usage_events;
CREATE POLICY "admin reads usage_events"
  ON usage_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  );

-- ── PART 4 — Users may read their own rows ──────────────────────────────
-- Useful for "show me my own activity" surfaces (rewards page reads
-- points_transactions; same pattern here for usage_events).
DROP POLICY IF EXISTS "users read own usage_events" ON usage_events;
CREATE POLICY "users read own usage_events"
  ON usage_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT ON usage_events TO authenticated;

-- ── PART 5 — Pre-flight: count what we have ────────────────────────────
DO $$
DECLARE
  qcount INT;
  kcount INT;
  candidate_count INT;
BEGIN
  SELECT COUNT(*) INTO qcount
    FROM usage_events WHERE event_type = 'research_question_asked';
  SELECT COUNT(*) INTO kcount
    FROM usage_events WHERE event_type = 'research_key_saved';

  -- Users who asked at least one question but have no key-saved event
  SELECT COUNT(DISTINCT user_id) INTO candidate_count
    FROM usage_events q
    WHERE q.event_type = 'research_question_asked'
      AND q.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM usage_events k
        WHERE k.event_type = 'research_key_saved'
          AND k.user_id = q.user_id
      );

  RAISE NOTICE 'Before backfill:';
  RAISE NOTICE '  research_question_asked events:       %', qcount;
  RAISE NOTICE '  research_key_saved events:            %', kcount;
  RAISE NOTICE '  Users who asked but have no save row: %', candidate_count;
END $$;

-- ── PART 6 — Backfill research_key_saved from research_question_asked ───
-- For every user_id that has at least one research_question_asked but
-- no research_key_saved, synthesize a single research_key_saved event
-- backdated to the user's FIRST question. Provenance = 'backfill' in
-- metadata so admins can tell synthetic events apart from real ones.
INSERT INTO usage_events (event_type, user_id, metadata, created_at)
SELECT
  'research_key_saved',
  q.user_id,
  jsonb_build_object(
    'user_id',  q.user_id,
    'provider', 'gemini',
    'verified', true,
    'source',   'backfill_from_first_question',
    'timestamp', q.first_q::text
  ),
  q.first_q
FROM (
  SELECT user_id, MIN(created_at) AS first_q
  FROM usage_events
  WHERE event_type = 'research_question_asked'
    AND user_id IS NOT NULL
  GROUP BY user_id
) q
WHERE NOT EXISTS (
  SELECT 1 FROM usage_events k
  WHERE k.event_type = 'research_key_saved'
    AND k.user_id = q.user_id
);

-- ── PART 7 — Post-flight summary ────────────────────────────────────────
DO $$
DECLARE
  kcount INT;
  registered_distinct INT;
  active_distinct INT;
BEGIN
  SELECT COUNT(*) INTO kcount
    FROM usage_events WHERE event_type = 'research_key_saved';
  SELECT COUNT(DISTINCT user_id) INTO registered_distinct
    FROM usage_events WHERE event_type = 'research_key_saved'
      AND user_id IS NOT NULL;
  SELECT COUNT(DISTINCT user_id) INTO active_distinct
    FROM usage_events WHERE event_type = 'research_question_asked'
      AND user_id IS NOT NULL;

  RAISE NOTICE '';
  RAISE NOTICE 'After backfill:';
  RAISE NOTICE '  research_key_saved events:    %', kcount;
  RAISE NOTICE '  Distinct registered users:    %', registered_distinct;
  RAISE NOTICE '  Distinct users who asked Q:   %', active_distinct;
  RAISE NOTICE '';
  RAISE NOTICE 'AdminDashboard Research Assistant card should now show:';
  RAISE NOTICE '  Keys registered    %', registered_distinct;
  RAISE NOTICE '  Actually using it  %', active_distinct;

  IF registered_distinct = 0 AND active_distinct = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE 'Both still zero — likely causes:';
    RAISE NOTICE '  1. No one has actually used Research Assistant yet.';
    RAISE NOTICE '  2. The new logResearchUsage / logKeySaved client writes';
    RAISE NOTICE '     were being denied by RLS — the policies above fix';
    RAISE NOTICE '     that, so future saves + questions will land.';
  END IF;
END $$;

-- ── Diagnostic queries (run manually if needed) ─────────────────────────
--
-- 1. Per-event-type breakdown:
--    SELECT event_type, COUNT(*) FROM usage_events
--    GROUP BY event_type ORDER BY 2 DESC;
--
-- 2. Recent activity:
--    SELECT created_at, event_type, user_id, metadata
--    FROM usage_events
--    ORDER BY created_at DESC LIMIT 20;
--
-- 3. Did MY user_id log any research events?
--    Replace <my-uid> with auth.uid() value.
--    SELECT created_at, event_type, metadata
--    FROM usage_events
--    WHERE user_id = '<my-uid>'
--      AND event_type LIKE 'research_%'
--    ORDER BY created_at DESC;
