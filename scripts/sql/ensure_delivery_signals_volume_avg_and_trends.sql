-- Idempotent: safe to re-run in Supabase SQL Editor.
-- Ensures total-turnover averages and ratio-based volume trend columns exist.

alter table delivery_signals
  add column if not exists avg_volume_7d numeric;

alter table delivery_signals
  add column if not exists avg_volume_30d numeric;

alter table delivery_signals
  add column if not exists avg_volume_60d numeric;

alter table delivery_signals
  add column if not exists avg_volume_90d numeric;

alter table delivery_signals
  add column if not exists delivery_volume_trend_7d text;

alter table delivery_signals
  add column if not exists delivery_volume_trend_30d text;
