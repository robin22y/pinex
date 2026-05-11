-- Idempotent: run in Supabase SQL Editor before re-running calc_delivery_signals.py.

alter table delivery_signals
  add column if not exists delivery_pct_today numeric;

alter table delivery_signals
  add column if not exists vol_ratio numeric;

alter table delivery_signals
  add column if not exists is_accumulation boolean default false;

alter table delivery_signals
  add column if not exists is_distribution boolean default false;

alter table delivery_signals
  add column if not exists breakout_30wma boolean default false;

alter table delivery_signals
  add column if not exists breakdown_30wma boolean default false;

alter table delivery_signals
  add column if not exists breakout_50dma boolean default false;

alter table delivery_signals
  add column if not exists breakdown_50dma boolean default false;
