-- user_classifications
-- Stores each user's OWN phase label for a stock (Basing / Advancing /
-- Topping / Declining). PineX never classifies a stock itself — this is a
-- private, per-user annotation surfaced by the "My Classification" component
-- on the stock detail page. RLS scopes every row to its owner.
--
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS user_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  classification TEXT NOT NULL,
  classified_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

ALTER TABLE user_classifications ENABLE ROW LEVEL SECURITY;

-- Drop-then-create so this script is safe to re-run.
DROP POLICY IF EXISTS "Users manage own classifications" ON user_classifications;
CREATE POLICY "Users manage own classifications" ON user_classifications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
