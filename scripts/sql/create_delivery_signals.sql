-- Run in Supabase SQL Editor (or psql).

create table if not exists delivery_signals (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id),
  date date not null,

  -- Delivery trend signals
  delivery_trend_7d text,   -- 'rising', 'falling', 'flat'
  delivery_trend_30d text,
  delivery_trend_60d text,
  delivery_trend_90d text,

  -- Delivery averages
  avg_delivery_7d numeric,
  avg_delivery_30d numeric,
  avg_delivery_60d numeric,
  avg_delivery_90d numeric,

  -- Volume data
  avg_volume_7d numeric,
  avg_volume_30d numeric,
  avg_volume_60d numeric,
  avg_volume_90d numeric,
  total_traded_volume_today numeric,

  -- Price vs delivery divergence
  price_change_7d numeric,     -- % price change over 7 days
  price_change_30d numeric,
  delivery_rising_price_flat_7d boolean default false,
  delivery_rising_price_flat_30d boolean default false,
  volume_rising_price_flat_7d boolean default false,
  volume_rising_price_flat_30d boolean default false,

  -- Flags
  unusual_accumulation boolean default false,

  -- Absolute delivery quantity trend + combined interpretation
  delivery_volume_trend_7d text,
  delivery_volume_trend_30d text,
  delivery_signal_7d text,
  delivery_signal_30d text,

  created_at timestamptz default now(),
  unique(company_id, date)
);

create policy "public_read_delivery_signals"
  on delivery_signals for select using (true);

create policy "service_insert_delivery_signals"
  on delivery_signals for insert to service_role with check (true);

create policy "service_update_delivery_signals"
  on delivery_signals for update to service_role using (true);

alter table delivery_signals enable row level security;
