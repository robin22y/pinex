-- ── profiles.wywa_email_sent_at ───────────────────────────────────────
-- Stamp of the most recent WYWA re-engagement email sent to the user.
-- Drives the 7-day dedupe in WYWAEmailAdmin's eligibility query —
-- users who got the email in the past 7 days are excluded so we don't
-- spam them every time the admin runs the send.
--
--   wywa_email_sent_at IS NULL                — never sent
--                       OR
--   wywa_email_sent_at < now() - INTERVAL '7 days'  — long enough ago

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wywa_email_sent_at timestamptz;

-- Index supports the eligibility query's predicate without a full scan
-- on profiles. Partial — we only care about non-null rows when checking
-- 'recently sent' status.
CREATE INDEX IF NOT EXISTS idx_profiles_wywa_email_sent_at
  ON profiles (wywa_email_sent_at)
  WHERE wywa_email_sent_at IS NOT NULL;
