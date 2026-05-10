-- Run in Supabase SQL Editor (before re-running calc_delivery_signals.py).

alter table delivery_signals
add column if not exists delivery_volume_trend_7d text;

alter table delivery_signals
add column if not exists delivery_volume_trend_30d text;

alter table delivery_signals
add column if not exists delivery_signal_7d text;

alter table delivery_signals
add column if not exists delivery_signal_30d text;
