-- ─────────────────────────────────────────────────────────────────
-- Telegram one-time link tokens
-- ─────────────────────────────────────────────────────────────────
-- Backs the one-tap deep-link "Connect Telegram" flow:
--   1. Frontend creates a token tied to the user's auth.uid()
--   2. Frontend opens t.me/pinex_Alerts_bot?start=<token>
--   3. Bot's /start handler reads the token from update.start_payload,
--      looks it up here, links the chat_id to the matching user_id,
--      and marks the token used.
--
-- Tokens expire after 30 minutes and are single-use (used_at set on
-- the first successful redemption). Multiple attempts with the same
-- token = no-op (already used) → user is told to generate a new
-- token from /account.
--
-- RLS:
--   - Anyone authenticated can INSERT a token for themselves
--     (matching their own auth.uid() in user_id)
--   - SELECT only by the service_role (the bot script runs as
--     service_role and bypasses RLS automatically; anonymous /
--     authenticated users never need to read this table)
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════
-- Table
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token       text         PRIMARY KEY,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz  DEFAULT now(),
  used_at     timestamptz,
  expires_at  timestamptz  DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_id_idx
  ON telegram_link_tokens (user_id);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_expires_idx
  ON telegram_link_tokens (expires_at)
  WHERE used_at IS NULL;


-- ═════════════════════════════════════════════════════════════════
-- RLS — authenticated users INSERT their own tokens; no SELECT
-- (only service_role / the bot needs to read)
-- ═════════════════════════════════════════════════════════════════

ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;

-- INSERT — caller must be authenticated AND user_id must equal their auth.uid()
DROP POLICY IF EXISTS "Users insert own link tokens" ON telegram_link_tokens;
CREATE POLICY "Users insert own link tokens"
  ON telegram_link_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);


-- ═════════════════════════════════════════════════════════════════
-- GRANTS — anon never touches this table; authenticated INSERTs
-- only (RLS limits to own rows). service_role bypasses RLS.
-- ═════════════════════════════════════════════════════════════════

GRANT INSERT ON telegram_link_tokens TO authenticated;


-- ═════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═════════════════════════════════════════════════════════════════

SELECT
  (SELECT COUNT(*) FROM pg_policies
    WHERE tablename = 'telegram_link_tokens') AS policy_count,
  (SELECT has_table_privilege('authenticated', 'telegram_link_tokens', 'INSERT'))
    AS auth_can_insert,
  (SELECT has_table_privilege('anon', 'telegram_link_tokens', 'INSERT'))
    AS anon_can_insert;

-- Expected: policy_count=1, auth_can_insert=true, anon_can_insert=false
