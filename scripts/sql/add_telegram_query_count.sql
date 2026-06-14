-- Add a per-chat query counter so the bot can rate-limit non-linked
-- users to N data queries before requiring an account link.
--
-- Linked users (those with a row in profiles where telegram_chat_id =
-- their bot chat id) are unlimited. Non-linked users get LIMIT_NON_LINKED
-- (currently 3) calls to /today, /setups, /sector, /stock before the
-- bot stops fulfilling those commands and points them at /link.
--
-- Idempotent — safe to re-run.

ALTER TABLE telegram_subscribers
  ADD COLUMN IF NOT EXISTS query_count INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows to 0 so the NOT NULL default holds for old rows.
-- (NOT NULL DEFAULT 0 on ADD COLUMN already does this in Postgres ≥11,
-- but the explicit UPDATE keeps the migration valid on older databases
-- and makes the intent obvious.)
UPDATE telegram_subscribers
SET    query_count = 0
WHERE  query_count IS NULL;
