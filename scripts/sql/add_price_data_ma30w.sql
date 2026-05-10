-- Run in Supabase SQL Editor before fetch_price_data backfill.
-- True 30-week MA (weekly resample), daily forward-fill.

alter table price_data add column if not exists ma30w numeric;

alter table price_data add column if not exists ma30w_slope numeric;
