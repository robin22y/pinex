-- Run in Supabase SQL Editor before re-running scripts/calc_delivery_signals.py
-- against the updated logic that emits the `weak_delivery` flag.
-- Idempotent: safe to re-run.

alter table public.delivery_signals
  add column if not exists weak_delivery boolean default false;

comment on column public.delivery_signals.weak_delivery is
  'Distribution warning: delivery_trend_30d=''falling'' AND avg_delivery_30d<35 AND price_change_7d<0. Catches stocks where retail / committed buyers are exiting while traders keep gross volume elevated.';
