-- ════════════════════════════════════════════════════════════════════════
-- exclude_index_proxies_from_home_stocks.sql
--
-- Excludes index-proxy ETFs (NIFTYBEES) from get_home_stocks(), which is
-- the single upstream for BOTH stock-facing surfaces:
--
--     get_home_stocks()  ──┬──►  mv_home_stocks  ──►  Lab universe
--        (this function)   └──►  RPC call        ──►  Home screener
--
-- mv_home_stocks is just `SELECT ... FROM get_home_stocks()`, so fixing
-- the function and refreshing the view fixes both consumers at once. No
-- view surgery required.
--
-- WHY THE ETF IS IN `companies` AT ALL
--   NSE publishes no reliable index-level VOLUME, and the Distribution
--   Day gauge needs it ("close down AND volume up"). NIFTYBEES is the
--   standard proxy, and storing it as a companies row means the existing
--   fetch_bhav_daily pipeline collects its OHLCV nightly with zero new
--   fetch code. The cost is that stock-facing queries must exclude it —
--   which is what the is_index_proxy flag (add_index_proxy_etfs.sql) and
--   this migration are for.
--
-- ─── THE ONLY LOGIC CHANGE ──────────────────────────────────────────
--
--   BEFORE
--     where c.is_suspended is null
--       or c.is_suspended = false
--
--   AFTER
--     where (c.is_suspended is null or c.is_suspended = false)
--       and c.is_index_proxy is not true
--
--   The PARENTHESES ARE LOad-BEARING. AND binds tighter than OR, so
--   appending the new condition without them would have parsed as:
--       is_suspended IS NULL
--       OR (is_suspended = false AND is_index_proxy is not true)
--   …which lets NIFTYBEES straight through on any row where
--   is_suspended IS NULL. The existing clause only looked safe because
--   it had a single condition group.
--
--   `is not true` rather than `= false`: it treats NULL and false
--   identically (both pass), so the filter stays correct even if the
--   column's NOT NULL constraint is ever relaxed. `= false` would
--   silently drop every row with a NULL flag.
--
-- Everything else below is byte-for-byte the definition captured from
-- pg_get_functiondef on 27 Jul 2026 — same signature, same CTEs, same
-- joins, same ORDER BY, same LANGUAGE/STABLE/search_path attributes.
-- CREATE OR REPLACE requires an identical return signature, and keeping
-- the body otherwise untouched keeps this migration reviewable as a
-- one-clause diff.
--
-- SIDE BENEFIT: this file is now the version-controlled source of truth
-- for get_home_stocks(). Before today the definition existed only inside
-- Supabase despite being load-bearing for the entire home page.
--
-- APPLY ONCE in the Supabase SQL editor. Idempotent (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_home_stocks()
 RETURNS TABLE(id uuid, symbol text, name text, sector text, tier integer, close numeric, stage text, rs_vs_nifty numeric, ma30w numeric, ma50 numeric, obv_slope text, volume numeric, rsi numeric, high_52w numeric, low_52w numeric, avg_delivery_30d numeric, delivery_trend_30d text, avg_volume_30d numeric, vol_ratio numeric, is_accumulation boolean, is_distribution boolean, breakout_30wma boolean, breakdown_30wma boolean, breakout_50dma boolean, breakdown_50dma boolean, price_change_7d numeric, high_conviction boolean, promoter_pledge_pct numeric, weinstein_substage text, swingx_entry_date date, swingx_entry_price numeric, swingx_return_pct numeric, swingx_days integer, swingx_warning_level text, swingx_below_50dma boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with latest_delivery as (
    select
      ds.company_id,
      ds.avg_delivery_30d,
      ds.delivery_trend_30d,
      ds.avg_volume_30d,
      ds.vol_ratio,
      ds.is_accumulation,
      ds.is_distribution,
      ds.breakout_30wma,
      ds.breakdown_30wma,
      ds.breakout_50dma,
      ds.breakdown_50dma,
      ds.price_change_7d,
      ds.high_conviction
    from delivery_signals ds
    inner join (
      select company_id,
             max(date) as max_date
      from delivery_signals
      group by company_id
    ) latest
      on ds.company_id = latest.company_id
      and ds.date = latest.max_date
  ),
  latest_shareholding as (
    select
      sh.company_id,
      sh.promoter_pledge_pct
    from shareholding sh
    inner join (
      select company_id,
             max(quarter) as max_quarter
      from shareholding
      group by company_id
    ) latest
      on sh.company_id = latest.company_id
      and sh.quarter = latest.max_quarter
  ),
  active_swingx as (
    select
      company_id,
      entry_date as swingx_entry_date,
      entry_price as swingx_entry_price,
      return_pct as swingx_return_pct,
      days_in_swingx as swingx_days,
      warning_level as swingx_warning_level,
      below_50dma as swingx_below_50dma
    from swingx_entries
    where is_active = true
  )
  select
    c.id, c.symbol, c.name,
    c.sector, c.tier::int,
    p.close, p.stage,
    p.rs_vs_nifty, p.ma30w, p.ma50,
    p.obv_slope::text,
    p.volume, p.rsi,
    p.high_52w, p.low_52w,
    d.avg_delivery_30d,
    d.delivery_trend_30d,
    d.avg_volume_30d, d.vol_ratio,
    coalesce(d.is_accumulation, false),
    coalesce(d.is_distribution, false),
    coalesce(d.breakout_30wma, false),
    coalesce(d.breakdown_30wma, false),
    coalesce(d.breakout_50dma, false),
    coalesce(d.breakdown_50dma, false),
    d.price_change_7d,
    (sx.company_id is not null)
      as high_conviction,
    s.promoter_pledge_pct,
    p.weinstein_substage,
    sx.swingx_entry_date,
    sx.swingx_entry_price,
    sx.swingx_return_pct,
    sx.swingx_days,
    sx.swingx_warning_level,
    sx.swingx_below_50dma
  from companies c
  inner join price_data p
    on p.company_id = c.id
    and p.is_latest = true
  left join latest_delivery d
    on d.company_id = c.id
  left join latest_shareholding s
    on s.company_id = c.id
  left join active_swingx sx
    on sx.company_id = c.id
  where (c.is_suspended is null or c.is_suspended = false)
    and c.is_index_proxy is not true
  order by c.symbol;
$function$;

-- ── Propagate to the materialized view ──────────────────────────────
-- mv_home_stocks caches the function's output, so the function change
-- alone doesn't reach Lab until the view is rebuilt.
--
-- Plain REFRESH (not CONCURRENTLY) takes an ACCESS EXCLUSIVE lock for
-- the duration — readers block, so run it outside market hours if the
-- rebuild is slow. Use CONCURRENTLY instead if a unique index exists on
-- the view; see scripts/sql/fix_refresh_home_stocks_timeout.sql for the
-- timeout handling already in place.
REFRESH MATERIALIZED VIEW public.mv_home_stocks;

-- ── Verification ────────────────────────────────────────────────────
-- Both should return 0 rows. If either returns NIFTYBEES the WHERE
-- clause didn't take — check the parentheses.
SELECT 'leaked from function' AS check, symbol
FROM get_home_stocks()
WHERE symbol = 'NIFTYBEES';

SELECT 'leaked from view' AS check, symbol
FROM public.mv_home_stocks
WHERE symbol = 'NIFTYBEES';

-- Sanity: the universe should shrink by exactly the proxy count (1).
SELECT count(*) AS stocks_in_home_universe FROM public.mv_home_stocks;
