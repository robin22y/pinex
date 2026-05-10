-- Run once in Supabase SQL Editor. Adds RS vs Nifty + MA150 slope columns for Stage Analysis.

alter table price_data add column if not exists ma150_slope numeric;

alter table price_data add column if not exists rs_vs_nifty numeric;

alter table price_data add column if not exists rs_positive boolean;

alter table price_data add column if not exists nifty_close numeric;
