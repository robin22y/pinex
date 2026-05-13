-- Run in Supabase SQL Editor before re-running scripts/fetch_nifty_sectors.py.
-- Idempotent: safe to re-run.
--
-- Adds short-term momentum / trend fields to the nifty_sectors history table.

alter table public.nifty_sectors
  add column if not exists change_3d        numeric,
  add column if not exists consecutive_up   smallint default 0,
  add column if not exists consecutive_down smallint default 0,
  add column if not exists ma20             numeric,
  add column if not exists ma50             numeric,
  add column if not exists trend_signal     text;

comment on column public.nifty_sectors.change_3d is
  '3-day move: sum of last 3 daily change_1d values when history exists; else yfinance close-to-close 3D %.';
comment on column public.nifty_sectors.consecutive_up is
  'Trailing up-day streak from stored change_1d history (today prepended), ending on this row''s date.';
comment on column public.nifty_sectors.consecutive_down is
  'Trailing down-day streak from stored change_1d history (today prepended), ending on this row''s date.';
comment on column public.nifty_sectors.ma20 is
  '20-day simple moving average of close (null if insufficient history).';
comment on column public.nifty_sectors.ma50 is
  '50-day simple moving average of close (null if insufficient history).';
comment on column public.nifty_sectors.trend_signal is
  'Short regime from daily streaks + yfinance change_1w: Strong / Recovering / Bouncing / Weak / Under Pressure / Fading / Neutral.';
