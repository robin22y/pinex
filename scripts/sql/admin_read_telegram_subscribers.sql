-- ── admin_read_telegram_subscribers ─────────────────────────────────────
-- ROOT CAUSE the admin pages couldn't see the bot user count:
--   telegram_subscribers is written by scripts/telegram_bot.py using
--   the service-role key (which bypasses RLS), so rows exist in the
--   DB. But the admin browser session uses the user's anon-key JWT,
--   and there was no SELECT policy on the table — so every
--   admin-facing query (.from('telegram_subscribers').select(...))
--   returned [] silently. AdminUsers > Telegram Users tab showed
--   "Total subscribers: 0" even when /start had been hit hundreds
--   of times.
--
-- Fix: mirror the admin_read_all_profiles pattern. Allow the admin
-- email to SELECT every row. Anonymous + non-admin sessions still
-- see nothing — chat_id is a private identifier.
--
-- Run once in the Supabase SQL editor. Idempotent.

-- Ensure RLS is on (if the table was created without it, no-op).
ALTER TABLE telegram_subscribers ENABLE ROW LEVEL SECURITY;

-- Allow the admin to SELECT every row.
DROP POLICY IF EXISTS "admin_read_telegram_subscribers" ON telegram_subscribers;
CREATE POLICY "admin_read_telegram_subscribers"
  ON telegram_subscribers
  FOR SELECT
  TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'robin22y@gmail.com'
  );

-- The authenticated role needs the table grant for the policy to
-- have anything to filter. Service-role retains its existing access
-- (it bypasses RLS) — pipeline writes via telegram_bot.py keep
-- working unchanged.
GRANT SELECT ON telegram_subscribers TO authenticated;

-- ── Verification (run after) ────────────────────────────────────────────
-- As admin in Supabase Studio:
--   SELECT count(*) FROM telegram_subscribers;
-- Should now match the bot's view (no longer 0 from the browser).
