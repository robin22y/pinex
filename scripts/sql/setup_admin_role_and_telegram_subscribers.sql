-- ════════════════════════════════════════════════════════════════════════
-- setup_admin_role_and_telegram_subscribers.sql
--
-- Three things in one migration — safe to re-run (idempotent):
--
--   1. CREATE TABLE telegram_subscribers (the bot writes to it but the
--      table was never created in code — your error
--      `42P01: relation "telegram_subscribers" does not exist` is from
--      running the earlier admin_read_telegram_subscribers.sql against
--      a missing table).
--
--   2. Restore robin22y@gmail.com to profiles.role='superadmin' so the
--      role-based admin policies below grant the right level of access.
--      The role may have been reset somewhere between commits — this
--      migration is the canonical fix.
--
--   3. Replace the email-hardcoded SELECT policies with role-based ones
--      (admin OR superadmin) on telegram_subscribers. The previous
--      admin_read_telegram_subscribers.sql used the email pattern,
--      which is brittle — switching to role lets you elevate future
--      admins without changing SQL.
--
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. telegram_subscribers ─────────────────────────────────────────────
-- Schema mirrors what scripts/telegram_bot.py writes:
--   payload = { chat_id, username, first_name, created_at }
--   .upsert(payload, on_conflict="chat_id")
-- Plus the user_id linkage column that AdminUsers > Telegram Users reads
-- (populated by the /link command in the bot, FK to profiles.id).
CREATE TABLE IF NOT EXISTS telegram_subscribers (
  chat_id     TEXT PRIMARY KEY,
  username    TEXT,
  first_name  TEXT,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Helpful indexes for the admin queries:
--   COUNT(*) WHERE user_id IS NOT NULL  -> linked count
--   ORDER BY created_at DESC LIMIT 1000 -> recent list
CREATE INDEX IF NOT EXISTS idx_telegram_subscribers_user_id
  ON telegram_subscribers(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_subscribers_created_at
  ON telegram_subscribers(created_at DESC);

-- Enable RLS — service-role bypasses, so the bot keeps writing freely.
ALTER TABLE telegram_subscribers ENABLE ROW LEVEL SECURITY;

-- ── 2. Restore robin22y@gmail.com to superadmin ─────────────────────────
-- The profile row exists (the auth account works). We just need to make
-- sure the role column carries 'superadmin' so the role-based policies
-- below grant the right access. Idempotent — UPDATE is safe on every run.
UPDATE profiles
SET role = 'superadmin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'robin22y@gmail.com');

-- Sanity check — surface a notice if the user can't be found so a
-- mis-typed email isn't a silent no-op.
DO $$
DECLARE
  uid UUID;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = 'robin22y@gmail.com';
  IF uid IS NULL THEN
    RAISE NOTICE 'robin22y@gmail.com has no auth.users row — the role update was a no-op.';
  ELSIF NOT EXISTS (SELECT 1 FROM profiles WHERE id = uid AND role = 'superadmin') THEN
    RAISE NOTICE 'Profile row for robin22y@gmail.com is missing or role update failed.';
  ELSE
    RAISE NOTICE 'OK: robin22y@gmail.com is superadmin.';
  END IF;
END $$;

-- ── 3. Role-based RLS — telegram_subscribers ────────────────────────────
-- Drop the previous (email-hardcoded) policy if it's there; replace with
-- one that checks profiles.role. Anyone in admin/superadmin sees every
-- row; everyone else sees nothing. Service-role (the bot) bypasses RLS.
DROP POLICY IF EXISTS "admin_read_telegram_subscribers" ON telegram_subscribers;
CREATE POLICY "admin_read_telegram_subscribers"
  ON telegram_subscribers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  );

-- Admins can also UPDATE/DELETE from the browser if needed (e.g.
-- unsubscribing a user manually). The bot still writes via service-role
-- and that bypasses RLS — this just enables manual admin maintenance.
DROP POLICY IF EXISTS "admin_write_telegram_subscribers" ON telegram_subscribers;
CREATE POLICY "admin_write_telegram_subscribers"
  ON telegram_subscribers
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

GRANT SELECT ON telegram_subscribers TO authenticated;
GRANT INSERT, UPDATE, DELETE ON telegram_subscribers TO authenticated;
-- service_role retains its existing privileges (bypasses RLS for writes).

-- ── 4. Verification queries (run these after) ───────────────────────────
-- As robin22y in Supabase Studio:
--   SELECT role FROM profiles WHERE id = (
--     SELECT id FROM auth.users WHERE email = 'robin22y@gmail.com'
--   );
--   -- expect: 'superadmin'
--
--   SELECT COUNT(*) FROM telegram_subscribers;
--   -- expect: total bot subscriber count (the bot starts populating it
--   -- from this point on; existing /start hits before this migration
--   -- did not insert since the table didn't exist).
--
-- If the count is unexpectedly low, it's because the bot couldn't
-- insert pre-migration. New /start hits land starting now.
