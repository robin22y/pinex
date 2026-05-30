-- Cleanup rows that were silently written for non-trading days.
--
-- BACKGROUND: nse_holidays.py was missing 2026-05-28 (Buddha Purnima), so the
-- daily pipeline scripts didn't skip and wrote stale rows for it. A weekend
-- row (2026-05-24, Sunday) also slipped in earlier. These rows poison every
-- "previous trading day" lookup (Nifty 1d change, advance/decline vs prior,
-- breadth deltas) because they appear as legitimate adjacent dates.
--
-- This script deletes those rows from every place they landed. Re-run any
-- daily script afterwards to repopulate cleanly. Safe to re-run; uses IN().
--
-- Adjust the dates below if you discover more bad rows
-- (e.g. weekends/holidays where a row was written).

begin;

-- Per-stock price data (cascades downstream — drop is_latest false rows only
-- because today's is_latest row is still valid for the current trading day).
delete from price_data
 where date in ('2026-05-24','2026-05-28');

-- Per-stock delivery data (separate table written by the same daily job).
delete from delivery_data
 where date in ('2026-05-24','2026-05-28');

-- Per-stock delivery_signals (the calc_delivery_signals output keyed on date).
delete from delivery_signals
 where date in ('2026-05-24','2026-05-28');

-- Market-internals one-row-per-date (this is what the Home page Nifty close /
-- breadth widgets read).
delete from market_internals
 where date in ('2026-05-24','2026-05-28');

-- Sector breadth history (one row per sector per date).
delete from sectors
 where date in ('2026-05-24','2026-05-28');

-- Nifty / sector indices history.
delete from nifty_sectors
 where date in ('2026-05-24','2026-05-28');

commit;

-- After running, refresh the home feed so the frontend reads the cleaned data:
refresh materialized view mv_home_stocks;
