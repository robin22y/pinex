-- Run in Supabase SQL Editor before relying on advance/decline from prev_close.
-- Idempotent.

alter table public.price_data
  add column if not exists prev_close numeric;

comment on column public.price_data.prev_close is
  'Prior session close (e.g. previous trading day) for the same row''s company; used for market advance/decline.';
