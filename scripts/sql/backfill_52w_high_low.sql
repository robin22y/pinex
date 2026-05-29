-- Populate high_52w / low_52w on the latest price_data row for every company.
--
-- WHY: these columns were null across the feed (mv_home_stocks) because the
-- daily bhav update writes a fresh is_latest row without recomputing the
-- 52-week extremes — only the full history fetch set them. The Lab's Stage 3
-- "off 52-week high" and Stage 4 "near 52-week low" gates need them.
--
-- HOW: the trailing 252 trading sessions of daily high/low are already in
-- price_data, so we compute the true 52-week high (max daily high) and low
-- (min daily low) per company entirely in-database — no re-fetch, no API loop.
--
-- Wrapped in a function so the daily pipeline can keep it fresh
-- (`select update_52w_high_low();` before the mv refresh). Safe to re-run.
-- Run once in the Supabase SQL editor.

-- Drop first: CREATE OR REPLACE errors if a prior definition exists with a
-- different return type / signature, so we recreate cleanly. No dependents.
drop function if exists update_52w_high_low();

create function update_52w_high_low()
returns void
language sql
as $$
  with ranked as (
    select
      company_id,
      high,
      low,
      row_number() over (partition by company_id order by date desc) as rn
    from price_data
    where high is not null and low is not null
  ),
  extremes as (
    select
      company_id,
      max(high) as hi_52w,
      min(low)  as lo_52w
    from ranked
    where rn <= 252               -- ~52 weeks of trading sessions
    group by company_id
  )
  update price_data p
  set high_52w = e.hi_52w,
      low_52w  = e.lo_52w
  from extremes e
  where p.company_id = e.company_id
    and p.is_latest = true;
$$;

grant execute on function update_52w_high_low() to service_role;

-- Run it now …
select update_52w_high_low();

-- … then surface the values in the home feed.
refresh materialized view mv_home_stocks;
