-- stock_info_cache — Yahoo Finance + IndianAPI fundamentals cache.
--
-- Filled by supabase/functions/fetch-stock-info/index.ts on first
-- lookup of a symbol; subsequent requests within 24 hours hit the
-- cache and skip the external API call. RLS-enabled with no public
-- policies — only the edge function (which uses the service role)
-- ever reads or writes this table. Frontend never queries directly.
--
-- Idempotent. Safe to re-apply.

CREATE TABLE IF NOT EXISTS public.stock_info_cache (
    symbol     text        PRIMARY KEY,
    data       jsonb       NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_info_cache_fetched_at
    ON public.stock_info_cache (fetched_at DESC);

ALTER TABLE public.stock_info_cache ENABLE ROW LEVEL SECURITY;

-- No grants to anon / authenticated — only the function's
-- service-role connection can touch this table.


-- Verification
SELECT 'stock_info_cache table missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'stock_info_cache'
);
