-- Populate high_52w / low_52w on the latest price_data row for every company.
--
-- WHY: these columns were null across the feed (mv_home_stocks) because the
-- daily bhav update recomputed them with a query that hit PostgREST's 1000-row
-- cap — only a few companies got values. The Lab's Stage 3 "off 52-week high"
-- and Stage 4 "near 52-week low" gates need them.
--
-- HOW: the last ~year of daily high/low is already in price_data, so we compute
-- the true 52-week high (max daily high) / low (min daily low) per company in
-- one set-based statement — no re-fetch, no API loop. We filter by a 365-day
-- date cutoff and GROUP BY (cheap, index-friendly) rather than ranking every
-- row with a window function, which timed out over the 2-year history.
--
-- Wrapped in a function so the daily pipeline can keep it fresh
-- (`select update_52w_high_low();` before the mv refresh). Safe to re-run.

-- ── STEP 1: create the function (run this block) ────────────────────────────
-- Drop first: CREATE OR REPLACE errors if a prior definition exists with a
-- different return type / signature, so we recreate cleanly. No dependents.
drop function if exists update_52w_high_low();

create function update_52w_high_low()
returns void
language sql
as $$
  with extremes as (
    select
      company_id,
      max(high) as hi_52w,
      min(low)  as lo_52w
    from price_data
    where date >= (current_date - interval '365 days')
      and high is not null
      and low  is not null
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

-- ── STEP 2: backfill all stocks (run separately) ────────────────────────────
select update_52w_high_low();

-- ── STEP 3: surface in the feed (run SEPARATELY — last) ─────────────────────
-- If this times out in the SQL editor, it's fine: the daily pipeline already
-- refreshes the view (refresh_home_stocks), or run `select refresh_home_stocks();`.
refresh materialized view mv_home_stocks;
