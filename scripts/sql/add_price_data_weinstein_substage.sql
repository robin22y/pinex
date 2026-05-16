-- Add weinstein_substage column to price_data.
-- Safe to re-run (IF NOT EXISTS).
-- Run BEFORE re-running create_get_home_stocks_rpc.sql.

alter table price_data
  add column if not exists weinstein_substage text;
