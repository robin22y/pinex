-- Run in Supabase SQL Editor before relying on FII/DII/revenue/52W fields. Idempotent.

alter table public.delivery_signals
  add column if not exists fii_change numeric default null;

alter table public.delivery_signals
  add column if not exists dii_change numeric default null;

alter table public.delivery_signals
  add column if not exists promoter_increasing boolean default false;

alter table public.delivery_signals
  add column if not exists revenue_growing_3q boolean default false;

alter table public.delivery_signals
  add column if not exists pct_from_52w_high numeric(7,2) default null;

comment on column public.delivery_signals.fii_change is
  'Change in FII % between latest two shareholding quarters.';

comment on column public.delivery_signals.dii_change is
  'Change in DII % between latest two shareholding quarters.';

comment on column public.delivery_signals.promoter_increasing is
  'True when latest promoter_pct exceeds the prior quarter.';

comment on column public.delivery_signals.revenue_growing_3q is
  'True when revenue_growth_yoy > 0 for each of the latest three financial quarters.';

comment on column public.delivery_signals.pct_from_52w_high is
  'Percentage distance of close from 52-week high: (close - high_52w) / high_52w * 100.';
