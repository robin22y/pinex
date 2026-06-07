-- ════════════════════════════════════════════════════════════════════════
-- fix_daily_questions_admin_save.sql
--
-- Two problems fixed in one migration:
--
-- PROBLEM 1 — admin can't save the daily question
--   AdminQuestions.jsx calls:
--     supabase.from('daily_questions').upsert(
--       { question_date: TODAY(), question_text, ... },
--       { onConflict: 'question_date' }
--     )
--   For ON CONFLICT to work, question_date needs a UNIQUE constraint.
--   For the admin browser session to UPSERT, RLS must allow it.
--   If either is missing, the upsert silently 400s.
--
-- PROBLEM 2 — only one question per date
--   The UNIQUE constraint on question_date enforces the business rule
--   ("one question per day") at the database level. Without it, two
--   simultaneous admin clicks could create duplicate rows.
--
-- Run once in Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. UNIQUE constraint on question_date ───────────────────────────────
-- Required for the upsert(onConflict='question_date') pattern.
-- Wrap in a DO block so we can guard with IF NOT EXISTS — Postgres
-- doesn't have a one-liner for "ALTER TABLE ADD CONSTRAINT IF NOT EXISTS".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'daily_questions'::regclass
      AND conname = 'daily_questions_question_date_key'
  ) THEN
    ALTER TABLE daily_questions
      ADD CONSTRAINT daily_questions_question_date_key
      UNIQUE (question_date);
  END IF;
END $$;

-- ── 2. RLS — enable, then add policies ──────────────────────────────────
ALTER TABLE daily_questions ENABLE ROW LEVEL SECURITY;

-- Public read — Home.jsx + Learn.jsx surface today's question to every
-- visitor (including anonymous).
DROP POLICY IF EXISTS "public reads daily_questions" ON daily_questions;
CREATE POLICY "public reads daily_questions"
  ON daily_questions
  FOR SELECT
  USING (true);

-- Admin write — INSERT/UPDATE/DELETE for admin OR superadmin. Plain
-- authenticated users can read but not write.
DROP POLICY IF EXISTS "admin writes daily_questions" ON daily_questions;
CREATE POLICY "admin writes daily_questions"
  ON daily_questions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  );

GRANT SELECT ON daily_questions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON daily_questions TO authenticated;

-- ── 3. Verification (run after) ────────────────────────────────────────
-- As admin (robin22y) in Supabase Studio:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'daily_questions'::regclass AND contype = 'u';
--   -- expect: daily_questions_question_date_key
--
--   SELECT policyname FROM pg_policies WHERE tablename = 'daily_questions';
--   -- expect: public reads daily_questions, admin writes daily_questions
--
-- Then try saving a question via /admin/questions — the green "Question
-- saved for today." toast should fire and the row should appear in
-- daily_questions for today's date.
