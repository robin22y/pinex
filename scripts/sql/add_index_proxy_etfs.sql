-- ════════════════════════════════════════════════════════════════════════
-- add_index_proxy_etfs.sql
--
-- Seeds the ETF rows the Distribution Day Counter needs, and adds the
-- `is_index_proxy` flag so they never pollute the screener / Lab /
-- search surfaces that are meant to show real operating companies.
--
-- WHY AN ETF AT ALL
--   NSE does not publish reliable index-level VOLUME. The distribution
--   day rule needs volume ("close down AND volume up"), so the standard
--   workaround is to use a liquid index ETF as the volume proxy:
--     NIFTY 50  ->  NIFTYBEES   (Nippon India ETF Nifty 50 BeES)
--   Verified 26 Jul 2026 against NSE sec_bhavdata_full: NIFTYBEES is
--   present under SERIES = EQ with a full OHLCV row
--   (close 271.21, TTL_TRD_QNTY 8,015,499). That means the EXISTING
--   fetch_bhav_daily.py pipeline picks it up with zero new fetch code
--   the moment the companies row exists.
--
-- WHY NOT A SEPARATE index_ohlcv TABLE
--   price_data already stores daily OHLCV keyed by company_id, already
--   has is_latest bookkeeping, already gets 60+ days of history, and is
--   already refreshed nightly. A parallel table would duplicate all of
--   that. The only cost of reusing it is needing this flag to keep ETFs
--   out of stock-facing lists — which is one boolean.
--
-- NIFTY 500 PROXY
--   Deliberately NOT seeded in this migration. Per the MVP decision,
--   both the Nifty 50 and Nifty 500 distribution reads fall back to
--   NIFTYBEES for now — the two indices distribute together on most
--   sessions, so a single proxy is an acceptable v1. When a clean 500
--   proxy is chosen, add it here with is_index_proxy = true and point
--   the secondary read at it.
--
-- APPLY ONCE in the Supabase SQL editor. Idempotent: the column ADD is
-- IF NOT EXISTS and the INSERT is ON CONFLICT DO UPDATE.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Flag column ────────────────────────────────────────────────────
-- Marks a companies row as an index-tracking instrument rather than an
-- operating company. Consumers that list "stocks" should filter it out:
--   .or('is_index_proxy.is.null,is_index_proxy.eq.false')
-- Defaults to false so every existing row is unaffected.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_index_proxy boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.is_index_proxy IS
  'True for index ETFs (NIFTYBEES etc.) held only as a volume proxy for '
  'index-level analytics such as the Distribution Day Counter. Exclude '
  'from screener / search / Lab result sets.';

-- Partial index — the analytics read is always "give me the proxies",
-- a tiny subset of the table.
CREATE INDEX IF NOT EXISTS idx_companies_index_proxy
  ON public.companies (symbol)
  WHERE is_index_proxy = true;

-- 2) Seed NIFTYBEES ─────────────────────────────────────────────────
-- nse_listed / exchange match what fetch_bhav_daily expects when it
-- joins bhav rows back to companies. sector is set to a sentinel so any
-- surface that groups by sector doesn't show it under a real sector.
INSERT INTO public.companies (symbol, name, sector, exchange, nse_listed, is_index_proxy, is_suspended)
VALUES ('NIFTYBEES', 'Nippon India ETF Nifty 50 BeES', 'Index ETF', 'NSE', true, true, false)
ON CONFLICT (symbol) DO UPDATE
  SET is_index_proxy = true,
      is_suspended   = false,
      name           = EXCLUDED.name,
      sector         = EXCLUDED.sector;

-- 3) Verification ───────────────────────────────────────────────────
-- Should return exactly one row. After the next fetch_bhav_daily run,
-- price_data will start carrying NIFTYBEES OHLCV and the Distribution
-- Day card goes live on its own.
SELECT id, symbol, name, sector, is_index_proxy, is_suspended
FROM public.companies
WHERE is_index_proxy = true
ORDER BY symbol;
