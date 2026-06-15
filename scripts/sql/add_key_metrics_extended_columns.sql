-- ─────────────────────────────────────────────────────────────────
-- Extended yfinance fundamentals on key_metrics.
-- ─────────────────────────────────────────────────────────────────
-- The /iqjet-desk Stock Lookup card needs cashflow / balance-sheet
-- fields (operating cash flow, free cash flow, total debt, total
-- assets, receivables, inventory, goodwill) to drive its forensic
-- flag panel. Yahoo's open quoteSummary endpoint started returning
-- 401 Unauthorized from server-side callers in 2024, so the
-- Supabase Edge Function path (Deno → Yahoo) hits the dashboard
-- empty.
--
-- The new columns below are populated by
-- scripts/iqjet/fetch_stock_fundamentals_extended.py — a Python
-- yfinance loop that runs nightly (alongside the existing
-- key_metrics refresh) and writes the fields directly into
-- key_metrics so the browser reads them straight from Supabase.
-- No Yahoo dependency on the user's request path.
--
-- Idempotent. Safe to re-apply.

ALTER TABLE public.key_metrics
    ADD COLUMN IF NOT EXISTS operating_cashflow   numeric,
    ADD COLUMN IF NOT EXISTS free_cashflow        numeric,
    ADD COLUMN IF NOT EXISTS net_receivables      numeric,
    ADD COLUMN IF NOT EXISTS inventory            numeric,
    ADD COLUMN IF NOT EXISTS goodwill             numeric,
    ADD COLUMN IF NOT EXISTS total_debt           numeric,
    ADD COLUMN IF NOT EXISTS total_cash           numeric,
    ADD COLUMN IF NOT EXISTS total_assets         numeric,
    ADD COLUMN IF NOT EXISTS extended_updated_at  timestamptz;

COMMENT ON COLUMN public.key_metrics.operating_cashflow   IS 'yfinance info.operatingCashflow (₹). Source: fetch_stock_fundamentals_extended.py.';
COMMENT ON COLUMN public.key_metrics.free_cashflow        IS 'yfinance info.freeCashflow (₹). Source: fetch_stock_fundamentals_extended.py.';
COMMENT ON COLUMN public.key_metrics.net_receivables      IS 'Most recent balance sheet net receivables (₹).';
COMMENT ON COLUMN public.key_metrics.inventory            IS 'Most recent balance sheet inventory (₹).';
COMMENT ON COLUMN public.key_metrics.goodwill             IS 'Most recent balance sheet goodwill (₹).';
COMMENT ON COLUMN public.key_metrics.total_debt           IS 'yfinance info.totalDebt (₹).';
COMMENT ON COLUMN public.key_metrics.total_cash           IS 'yfinance info.totalCash (₹).';
COMMENT ON COLUMN public.key_metrics.total_assets         IS 'Most recent balance sheet total assets (₹).';
COMMENT ON COLUMN public.key_metrics.extended_updated_at  IS 'When the extended columns above were last refreshed by the Python pipeline.';

-- Verification
SELECT 'key_metrics extended columns missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'key_metrics'
      AND column_name  = 'operating_cashflow'
);
