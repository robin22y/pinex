-- iqjet_broadcasts — audit log of admin-initiated Telegram DM blasts.
--
-- Each row records one click of "Send to Selected Users" on
-- /iqjet-desk. The function logs the message preview, the set of
-- user_ids targeted, and the per-recipient delivery status returned
-- by Telegram's sendMessage API. Used to render the "last 5
-- broadcasts" list in the Broadcast panel.
--
-- RLS-enabled, admin-only. The edge function uses the service-role
-- key so the policy is for client-side reads from /iqjet-desk only.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.iqjet_broadcasts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    sent_at         timestamptz NOT NULL DEFAULT now(),
    recipient_count integer     NOT NULL,
    message_preview text        NOT NULL,
    user_ids        jsonb       NOT NULL,
    delivery_status jsonb       NOT NULL,
    sent_by         text        NOT NULL,
    -- 'private' = direct DMs to user_ids (iqjet-telegram function)
    -- 'public'  = single post to t.me/pinexin (iqjet-telegram-send function)
    channel_type    text        NOT NULL DEFAULT 'private'
);

-- Backfill for tables created before the channel_type column landed.
ALTER TABLE public.iqjet_broadcasts
    ADD COLUMN IF NOT EXISTS channel_type text NOT NULL DEFAULT 'private';

CREATE INDEX IF NOT EXISTS idx_iqjet_broadcasts_sent_at
    ON public.iqjet_broadcasts (sent_at DESC);

ALTER TABLE public.iqjet_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iqjet_broadcasts_admin_select ON public.iqjet_broadcasts;
CREATE POLICY iqjet_broadcasts_admin_select
    ON public.iqjet_broadcasts
    FOR SELECT
    TO authenticated
    USING (auth.jwt() ->> 'email' = 'robin22y@gmail.com');

-- The iqjet-telegram DM function uses the service-role key so it
-- bypasses RLS for INSERTs. The PUBLIC broadcast posts via
-- iqjet-telegram-send (which doesn't have service-role context),
-- so we let the admin write audit rows directly from the browser.
DROP POLICY IF EXISTS iqjet_broadcasts_admin_insert ON public.iqjet_broadcasts;
CREATE POLICY iqjet_broadcasts_admin_insert
    ON public.iqjet_broadcasts
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.jwt() ->> 'email' = 'robin22y@gmail.com');


-- Verification
SELECT 'iqjet_broadcasts table missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'iqjet_broadcasts'
);
