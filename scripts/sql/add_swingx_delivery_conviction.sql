-- swingx_entries: optional delivery-conviction context
-- Delivery % is India-specific data, NOT part of the pure-Weinstein SwingX
-- core (see calc_high_conviction / calc_delivery_conviction in
-- scripts/calc_delivery_signals.py). These columns let the frontend offer an
-- OPTIONAL "high delivery" filter without it ever gating SwingX membership.
--
-- Safe to re-run. Run once in the Supabase SQL editor.

ALTER TABLE swingx_entries
  ADD COLUMN IF NOT EXISTS high_delivery_conviction boolean DEFAULT false;

ALTER TABLE swingx_entries
  ADD COLUMN IF NOT EXISTS delivery_pct numeric;
