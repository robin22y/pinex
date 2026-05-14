-- Run in Supabase SQL Editor before relying on calc_delivery_signals.py
-- high_conviction output. Idempotent.

alter table public.delivery_signals
  add column if not exists high_conviction boolean default false;

comment on column public.delivery_signals.high_conviction is
  'Stage 2, close above 30W and 50D MAs, avg 30d delivery >40%, vol_ratio>1 vs 30d avg volume, 7d price change >0. No delivery_trend filter; vol_ratio proxies participation.';
