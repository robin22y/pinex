-- ─────────────────────────────────────────────────────────────────
-- Add Telegram link columns to profiles + waitlist
-- ─────────────────────────────────────────────────────────────────
-- Lets a user link their Telegram account so the daily Morning Brief
-- (or any future per-user push) can be delivered via the existing
-- Telegram bot. Waitlist also captures telegram_username so we can
-- DM them when they get off the list.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DO-block policy guard.
-- Safe to re-run.
--
-- To apply: paste this whole file into Supabase Dashboard → SQL
-- Editor → Run. Verification queries at the bottom confirm each
-- change landed.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- PART 1 — profiles: telegram_username, telegram_chat_id, telegram_linked_at
-- ═════════════════════════════════════════════════════════════════
-- telegram_username    : the @handle the user enters (no leading @
--                        when stored). Useful for display + manual
--                        outreach.
-- telegram_chat_id     : the numeric chat_id once the user has
--                        actually messaged the bot (bigint because
--                        Telegram chat_ids exceed 2^31 for some
--                        groups/channels). This is the value the
--                        bot needs to push them messages.
-- telegram_linked_at   : timestamp the link completed; null until
--                        the user has been verified via the bot's
--                        /start handshake.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS telegram_username  text,
  ADD COLUMN IF NOT EXISTS telegram_chat_id   bigint,
  ADD COLUMN IF NOT EXISTS telegram_linked_at timestamptz;


-- ═════════════════════════════════════════════════════════════════
-- PART 2 — waitlist: telegram_username
-- ═════════════════════════════════════════════════════════════════
-- Waitlist signups can optionally provide a Telegram handle. Plain
-- text, no chat_id (we don't bother verifying handles for waitlist
-- entries — they get a one-time DM if/when we onboard them).

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS telegram_username text;


-- ═════════════════════════════════════════════════════════════════
-- PART 3 — RLS: users may update their own telegram fields
-- ═════════════════════════════════════════════════════════════════
-- Guarded with a DO block so re-running doesn't error if the policy
-- already exists from a prior partial migration. Match the policy
-- name exactly: "Users update own telegram".

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'Users update own telegram'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "Users update own telegram"
      ON public.profiles FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id)
    $POL$;
    RAISE NOTICE 'Created policy "Users update own telegram"';
  ELSE
    RAISE NOTICE 'Policy "Users update own telegram" already exists — skipped';
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION — each query confirms one part of the migration
-- ═════════════════════════════════════════════════════════════════

-- 1. profiles columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name IN ('telegram_username', 'telegram_chat_id', 'telegram_linked_at')
ORDER BY column_name;
-- Expected: 3 rows.

-- 2. waitlist column
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'waitlist'
  AND column_name = 'telegram_username';
-- Expected: 1 row.

-- 3. RLS policy on profiles
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles'
  AND policyname = 'Users update own telegram';
-- Expected: 1 row with cmd=UPDATE and qual/with_check referencing auth.uid().
