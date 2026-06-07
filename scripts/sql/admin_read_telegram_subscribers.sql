-- ════════════════════════════════════════════════════════════════════════
-- SUPERSEDED — DO NOT RUN
--
-- This file errored with 42P01 ("relation telegram_subscribers does not
-- exist") because the table was never created in code. Use the
-- comprehensive replacement instead:
--
--   scripts/sql/setup_admin_role_and_telegram_subscribers.sql
--
-- The new file:
--   1. CREATEs telegram_subscribers with the schema the bot writes to
--   2. Restores robin22y@gmail.com to profiles.role='superadmin'
--   3. Adds role-based RLS (admin OR superadmin) instead of the
--      email-hardcoded pattern this file used
--
-- Kept here as a stub so the filename in earlier commit messages still
-- resolves; running this file alone will throw the same 42P01 error.
-- ════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE EXCEPTION
    'This migration has been superseded. Run scripts/sql/setup_admin_role_and_telegram_subscribers.sql instead.';
END $$;
