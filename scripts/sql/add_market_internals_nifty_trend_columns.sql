-- Run in Supabase SQL Editor before re-running scripts/calc_market_internals.py.
-- Idempotent: safe to re-run.
--
-- Adds Nifty 50 short-term trend metrics to the daily market_internals row.

alter table public.market_internals
  add column if not exists nifty_consecutive_up   smallint default 0,
  add column if not exists nifty_consecutive_down smallint default 0,
  add column if not exists nifty_change_1d        numeric,
  add column if not exists nifty_change_3d        numeric,
  add column if not exists nifty_change_1w        numeric,
  add column if not exists market_trend           text;

comment on column public.market_internals.nifty_consecutive_up is
  'Trailing up-day streak for Nifty 50 ending on this row''s date (mutually exclusive with nifty_consecutive_down).';
comment on column public.market_internals.nifty_consecutive_down is
  'Trailing down-day streak for Nifty 50 ending on this row''s date.';
comment on column public.market_internals.nifty_change_1d is
  '% change in Nifty 50 for the most recent trading day (mirrors the latest Nifty 50 row in nifty_sectors).';
comment on column public.market_internals.nifty_change_3d is
  'Approximate % move over last 3 sessions: sum of the last 3 Nifty 50 daily change_1d values from nifty_sectors.';
comment on column public.market_internals.nifty_change_1w is
  'Approximate % move over last 5 sessions: sum of the last 5 Nifty 50 daily change_1d values from nifty_sectors (used with streaks for market_trend).';
comment on column public.market_internals.market_trend is
  'Short-term regime label from streaks + 5-day summed daily returns: Strong Uptrend / Recovering / Bouncing / Attempting Recovery / Weak Downtrend / Pulling Back / Under Pressure / Fading / Neutral.';
