-- Snapshot columns for watchlist gain tracking (applied if missing).
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS price_at_add numeric;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS reference_date date;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS reference_price numeric;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS group_name text DEFAULT 'My Watchlist';
