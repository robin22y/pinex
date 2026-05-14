-- Run in Supabase SQL Editor before re-running scripts/calc_market_internals.py.
-- Idempotent: safe to re-run.
--
-- Advance/decline ratio and 7-day breadth trend flags for divergence context.

alter table public.market_internals
  add column if not exists advance_decline_ratio numeric,
  add column if not exists breadth_7d_new_lows_rising boolean default false,
  add column if not exists breadth_7d_above_ma150_falling boolean default false;

comment on column public.market_internals.advance_decline_ratio is
  'Stocks with close > prior session close divided by stocks with close < prior session close (is_latest vs prior date row). Null if denominator is zero.';
comment on column public.market_internals.breadth_7d_new_lows_rising is
  'True when new_52w_lows count today exceeds that from the oldest of the last 7 daily rows (weakness building).';
comment on column public.market_internals.breadth_7d_above_ma150_falling is
  'True when above_ma150_pct today is below that from the oldest of the last 7 daily rows (breadth deterioration).';
