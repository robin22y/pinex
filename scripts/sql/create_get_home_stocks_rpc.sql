-- Run in Supabase SQL Editor before deploying the matching frontend change in src/pages/Home.jsx.
-- Idempotent: safe to re-run.
--
-- Returns one row per active (non-suspended) company that has a latest price snapshot,
-- joined with the most-recent delivery_signals row and most-recent shareholding row.
-- INNER JOIN on price_data.is_latest=true means companies without price data are excluded
-- (which matches the legacy `.filter(c => c.close != null)` on the client).

create or replace function public.get_home_stocks()
returns table (
  id                  uuid,
  symbol              text,
  name                text,
  sector              text,
  tier                int,
  close               numeric,
  stage               text,
  rs_vs_nifty         numeric,
  ma30w               numeric,
  ma50                numeric,
  obv_slope           text,
  volume              numeric,
  rsi                 numeric,
  high_52w            numeric,
  low_52w             numeric,
  avg_delivery_30d    numeric,
  delivery_trend_30d  text,
  avg_volume_30d      numeric,
  vol_ratio           numeric,
  is_accumulation     boolean,
  is_distribution     boolean,
  breakout_30wma      boolean,
  breakdown_30wma     boolean,
  breakout_50dma      boolean,
  breakdown_50dma     boolean,
  price_change_7d     numeric,
  promoter_pledge_pct numeric
)
language sql
stable
security invoker
as $$
  with latest_delivery as (
    select distinct on (company_id)
      company_id,
      avg_delivery_30d,
      delivery_trend_30d,
      avg_volume_30d,
      vol_ratio,
      is_accumulation,
      is_distribution,
      breakout_30wma,
      breakdown_30wma,
      breakout_50dma,
      breakdown_50dma,
      price_change_7d
    from delivery_signals
    order by company_id, date desc
  ),
  latest_shareholding as (
    select distinct on (company_id)
      company_id,
      promoter_pledge_pct
    from shareholding
    order by company_id, quarter desc
  )
  select
    c.id,
    c.symbol,
    c.name,
    c.sector,
    c.tier::int as tier,
    p.close,
    p.stage,
    p.rs_vs_nifty,
    p.ma30w,
    p.ma50,
    p.obv_slope::text as obv_slope,
    p.volume,
    p.rsi,
    p.high_52w,
    p.low_52w,
    d.avg_delivery_30d,
    d.delivery_trend_30d,
    d.avg_volume_30d,
    d.vol_ratio,
    coalesce(d.is_accumulation, false)  as is_accumulation,
    coalesce(d.is_distribution, false)  as is_distribution,
    coalesce(d.breakout_30wma, false)   as breakout_30wma,
    coalesce(d.breakdown_30wma, false)  as breakdown_30wma,
    coalesce(d.breakout_50dma, false)   as breakout_50dma,
    coalesce(d.breakdown_50dma, false)  as breakdown_50dma,
    d.price_change_7d,
    s.promoter_pledge_pct
  from companies c
  inner join price_data p
    on p.company_id = c.id and p.is_latest = true
  left join latest_delivery d
    on d.company_id = c.id
  left join latest_shareholding s
    on s.company_id = c.id
  where c.is_suspended is null or c.is_suspended = false
  order by c.symbol;
$$;

grant execute on function public.get_home_stocks() to anon, authenticated, service_role;
