-- Run in Supabase SQL Editor before relying on pct_from_30w output. Idempotent.

alter table public.delivery_signals
  add column if not exists pct_from_30w numeric(7,2) default null;

comment on column public.delivery_signals.pct_from_30w is
  'Percentage distance of close from 30W MA: (close - ma30w) / ma30w * 100. Used by high_conviction to filter out extended stocks (>15% above 30W MA).';
