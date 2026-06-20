-- ════════════════════════════════════════════════════════════════════════
-- update_company_studies.sql
--
-- Adds Malayalam / Hindi / Tamil columns to company_studies for the
-- multilingual PDF download feature on /learn/company/:symbol. EN
-- content stays in the existing columns (no rename). Apply AFTER
-- create_company_studies.sql.
--
-- Naming convention:
--   <field>             -- English (existing, no suffix)
--   <field>_ml          -- Malayalam
--   <field>_hi          -- Hindi
--   <field>_ta          -- Tamil
--
-- Translation is optional per language — the CompanyStudy.jsx page
-- falls back to EN if the selected language's column is empty, so
-- Robin can publish EN-only studies and add translations later.
--
-- Apply
--   Run once in Supabase SQL editor. Idempotent — IF NOT EXISTS on
--   every column add.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_studies
  ADD COLUMN IF NOT EXISTS title_ml                  text,
  ADD COLUMN IF NOT EXISTS title_hi                  text,
  ADD COLUMN IF NOT EXISTS title_ta                  text,
  ADD COLUMN IF NOT EXISTS what_they_do_ml           text,
  ADD COLUMN IF NOT EXISTS what_they_do_hi           text,
  ADD COLUMN IF NOT EXISTS what_they_do_ta           text,
  ADD COLUMN IF NOT EXISTS how_they_make_money_ml    text,
  ADD COLUMN IF NOT EXISTS how_they_make_money_hi    text,
  ADD COLUMN IF NOT EXISTS how_they_make_money_ta    text,
  ADD COLUMN IF NOT EXISTS who_built_it_ml           text,
  ADD COLUMN IF NOT EXISTS who_built_it_hi           text,
  ADD COLUMN IF NOT EXISTS who_built_it_ta           text,
  ADD COLUMN IF NOT EXISTS similar_companies_ml      text,
  ADD COLUMN IF NOT EXISTS similar_companies_hi      text,
  ADD COLUMN IF NOT EXISTS similar_companies_ta      text,
  ADD COLUMN IF NOT EXISTS what_to_watch_ml          text,
  ADD COLUMN IF NOT EXISTS what_to_watch_hi          text,
  ADD COLUMN IF NOT EXISTS what_to_watch_ta          text;
