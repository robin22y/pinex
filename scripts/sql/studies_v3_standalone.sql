-- ════════════════════════════════════════════════════════════════════════
-- studies_v3_standalone.sql — Company Studies as a standalone GLOBAL product
--
-- Replaces the study_* objects from studies_v2_schema.sql, which tied study
-- data to the NSE `companies` table. Studies now hang off their own
-- `study_companies` table (any exchange, any country, any currency) and
-- share nothing with the screener.
--
-- PART A  drops what v2 created OUTSIDE company_studies.
-- PART B  creates the standalone schema.
--
-- Kept from v2 on purpose (company_studies still depends on them):
--   - every column / constraint / index / policy v2 added to company_studies
--   - company_studies_sync_trg        -> public.company_studies_sync()
--                                        (calls public.study_slugify)
--   - company_studies_updated_at_trg  -> public.study_set_updated_at()
--   - company_studies_log_status_trg  -> public.company_studies_log_status()
--   study_slugify and study_set_updated_at are therefore KEPT (and reused
--   below). company_studies_log_status() wrote into the v2
--   study_status_log(study_id …), which this file drops; its body is
--   replaced with a no-op so status changes on company_studies (legacy
--   admin Publish button) do not start failing. The trigger itself stays.
--
-- Not touched: company_studies data, companies, price_data, daily_closes,
-- swing_conditions, any pipeline.
--
-- Idempotent: PART A only drops a table when it still has the v2 shape
-- (a `study_id` column), so re-running this file never wipes v3 data.
-- Views and functions are dropped and recreated (they hold no data).
--
-- Safety: PART A aborts the whole transaction if any v2 data table has
-- rows. study_status_log is exempt — v2 seeded it with one 'v2 backfill'
-- row per existing company_studies row.
--
-- Apply: run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- PART A — DROP v2 study_* objects
-- ════════════════════════════════════════════════════════════════════════

-- A1. Views (no data; v3 recreates the same names with new columns).
DROP VIEW IF EXISTS public.study_freshness           CASCADE;
DROP VIEW IF EXISTS public.study_financials_latest   CASCADE;
DROP VIEW IF EXISTS public.study_segments_latest     CASCADE;
DROP VIEW IF EXISTS public.study_shareholding_latest CASCADE;

-- A2. Tables — only while they still have the v2 shape.
DO $$
DECLARE
  t   text;
  n   bigint;
  v2_tables text[] := ARRAY[
    -- children first is not required (CASCADE), but keeps the log readable
    'study_period_notes','study_ownership_changes','study_watch_items',
    'study_risks','study_developments','study_tam','study_products',
    'study_timeline','study_founders','study_status_log','study_sources'
  ];
BEGIN
  -- Safety check before dropping anything.
  FOREACH t IN ARRAY v2_tables || ARRAY['study_financial_periods','study_segment_periods',
                                        'study_shareholding_periods'] LOOP
    IF t <> 'study_status_log'
       AND to_regclass('public.' || t) IS NOT NULL
       AND (EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t
                      AND column_name IN ('study_id','company_id'))
            OR t = 'study_shareholding_periods')
    THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'v2 table public.% has % row(s) — refusing to drop. Nothing was changed.', t, n;
      END IF;
    END IF;
  END LOOP;

  -- Study-level v2 tables: v2 shape = has study_id.
  FOREACH t IN ARRAY v2_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t
                 AND column_name = 'study_id') THEN
      EXECUTE format('DROP TABLE public.%I CASCADE', t);
      RAISE NOTICE 'dropped v2 table public.%', t;
    END IF;
  END LOOP;

  -- Period v2 tables: v2 shape = has company_id (v3 uses study_company_id).
  FOREACH t IN ARRAY ARRAY['study_financial_periods','study_segment_periods'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t
                 AND column_name = 'company_id') THEN
      EXECUTE format('DROP TABLE public.%I CASCADE', t);
      RAISE NOTICE 'dropped v2 table public.%', t;
    END IF;
  END LOOP;
END $$;

-- v2-only name (v3 uses study_shareholding, long format).
DROP TABLE IF EXISTS public.study_shareholding_periods CASCADE;

-- A3. Helper functions v2 added that company_studies does not use.
-- CASCADE also removes the v2 RLS policies / triggers that referenced them
-- (and, on a re-run, the v3 ones — PART B recreates those).
DROP FUNCTION IF EXISTS public.company_has_public_study(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.study_is_public(uuid)          CASCADE;
DROP FUNCTION IF EXISTS public.study_block_period_update()    CASCADE;

-- A4. Neutralise the company_studies status logger (its target table is gone).
CREATE OR REPLACE FUNCTION public.company_studies_log_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- No-op since v3: study_status_log now belongs to study_companies.
  -- company_studies is the legacy narrative table; its status history is
  -- not logged. Trigger kept so v2's company_studies wiring is unchanged.
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.company_studies_log_status() FROM PUBLIC;

-- ════════════════════════════════════════════════════════════════════════
-- PART B — CREATE standalone global schema
-- ════════════════════════════════════════════════════════════════════════

-- B0. Shared functions.

-- Kept from v2; re-declared so this file also works on its own.
CREATE OR REPLACE FUNCTION public.study_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.study_slugify(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT trim(BOTH '-' FROM
           regexp_replace(replace(lower(coalesce(p, '')), '&', '-and-'),
                          '[^a-z0-9]+', '-', 'g'));
$$;

-- Append-only guard. TG_ARGV = columns that may never change on UPDATE.
CREATE OR REPLACE FUNCTION public.study_block_period_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  col text;
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (o -> col) IS DISTINCT FROM (n -> col) THEN
      RAISE EXCEPTION
        '%.%: column "%" is append-only — insert a new row with revision = % instead of updating',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, col, (o ->> 'revision')::int + 1
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- B1. study_companies
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.study_companies (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text        NOT NULL,
  name                  text        NOT NULL,
  country               text        CHECK (country ~ '^[A-Z]{2}$'),          -- ISO 3166-1 alpha-2
  exchange              text,                                                 -- e.g. 'NSE','NYSE','LSE','TSE'
  ticker                text,
  isin                  text        CHECK (isin IS NULL OR isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  sector                text,
  industry              text,
  website               text,
  logo_url              text,
  hero_image_url        text,
  reporting_currency    text        CHECK (reporting_currency ~ '^[A-Z]{3}$'), -- ISO 4217
  reporting_unit        text        CHECK (reporting_unit IN ('thousand','million','billion','lakh','crore')),
  accounting_standard   text        CHECK (accounting_standard IN ('ind_as','ifrs','us_gaap','other')),
  fiscal_year_end_month integer     CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
  status                text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','researching','reviewed','published','archived')),
  featured              boolean     NOT NULL DEFAULT false,
  headline              text,
  story_hook            text,
  summary               text,
  story_md              text,
  central_question      text,
  then_text             text,
  now_text              text,
  next_text             text,
  reviewed_at           timestamptz,
  published_at          timestamptz,
  version               integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_companies_slug_key            UNIQUE (slug),
  CONSTRAINT study_companies_exchange_ticker_key UNIQUE (exchange, ticker)
);
-- NOTE: UNIQUE (exchange, ticker) treats NULLs as distinct, so unlisted
-- companies (no exchange/ticker) never collide.

-- ────────────────────────────────────────────────────────────────────────
-- B2. Child tables
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.study_sources (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  kind             text        NOT NULL
                   CHECK (kind IN ('annual_report','quarterly_result','investor_presentation',
                                   'concall','regulatory_filing','shareholding_filing',
                                   'fund_disclosure','government','other')),
  title            text        NOT NULL,
  publisher        text,
  url              text,
  document_date    date,
  page             text,
  accessed_on      date,
  archive_url      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_founders (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  name             text        NOT NULL,
  image_url        text,
  education        text,
  previous_career  text,
  founding_story   text,
  -- Quoted: CURRENT_ROLE is a reserved SQL keyword. Unquoted in raw SQL it
  -- returns the session role, not this column. PostgREST quotes it for you.
  "current_role"   text,
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_timeline (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  event_date       date,
  event_year       integer     CHECK (event_year BETWEEN 1600 AND 2200),
  title            text        NOT NULL,
  body             text,
  is_pull_quote    boolean     NOT NULL DEFAULT false,
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_products (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id    uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order          integer     NOT NULL DEFAULT 0,
  name                text        NOT NULL,
  category            text,
  description         text,
  applications        text,
  end_markets         text,
  customers_disclosed text,
  interesting_fact    text,
  source_id           uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_tam (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  market           text        NOT NULL,
  geography        text,
  level            text        NOT NULL CHECK (level IN ('tam','sam','company_opportunity')),
  estimate_type    text        NOT NULL CHECK (estimate_type IN ('company','third_party','pinex_calc')),
  -- array of {label, value, unit, source_id}
  inputs           jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(inputs) = 'array'),
  calculation      text,
  result_value     numeric,
  result_currency  text        CHECK (result_currency IS NULL OR result_currency ~ '^[A-Z]{3}$'),
  result_unit      text,
  as_of_year       integer     CHECK (as_of_year BETWEEN 1900 AND 2200),
  notes            text,
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_developments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  event_date       date,
  title            text        NOT NULL,
  body             text,
  category         text        NOT NULL DEFAULT 'other'
                   CHECK (category IN ('filing','order','management','capex','regulatory','other')),
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_risks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  title            text        NOT NULL,
  body             text,
  severity         text        CHECK (severity IN ('high','medium','low')),
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_watch_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  label            text        NOT NULL,
  note             text,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_status_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  from_status      text,
  to_status        text        NOT NULL,
  changed_by       uuid,       -- auth.uid(); NULL from SQL editor / service role
  changed_at       timestamptz NOT NULL DEFAULT now(),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────
-- B3. Period tables
-- ────────────────────────────────────────────────────────────────────────
-- financial / segment / shareholding are append-only (revision column).
-- ownership_changes and period_notes are editorial rows: editable.

CREATE TABLE IF NOT EXISTS public.study_financial_periods (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  period_end       date        NOT NULL,
  period_type      text        NOT NULL CHECK (period_type IN ('Q','H','FY')),
  fiscal_label     text,                          -- e.g. 'Q2 FY26', 'H1 2025'
  basis            text        NOT NULL DEFAULT 'consolidated'
                   CHECK (basis IN ('consolidated','standalone')),
  revenue          numeric,
  ebitda           numeric,
  pat              numeric,
  eps              numeric,
  other_income     numeric,
  total_debt       numeric,
  cash             numeric,
  cfo              numeric,
  capex            numeric,
  -- NULL = use study_companies.reporting_currency / reporting_unit
  currency         text        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  unit             text        CHECK (unit IS NULL OR unit IN ('thousand','million','billion','lakh','crore')),
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  revision         integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_financial_periods_key
    UNIQUE (study_company_id, period_end, period_type, basis, revision)
);
-- No price, market cap or valuation columns — by design.

CREATE TABLE IF NOT EXISTS public.study_segment_periods (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  period_end       date        NOT NULL,
  period_type      text        NOT NULL CHECK (period_type IN ('Q','H','FY')),
  basis            text        NOT NULL DEFAULT 'consolidated'
                   CHECK (basis IN ('consolidated','standalone')),
  segment_name     text        NOT NULL,
  revenue          numeric,
  ebit             numeric,
  currency         text        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  unit             text        CHECK (unit IS NULL OR unit IN ('thousand','million','billion','lakh','crore')),
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  revision         integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_segment_periods_key
    UNIQUE (study_company_id, period_end, period_type, basis, segment_name, revision)
);

CREATE TABLE IF NOT EXISTS public.study_shareholding (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  period_end       date        NOT NULL,
  category         text        NOT NULL
                   CHECK (category IN ('promoter_insider','institutional_foreign',
                                       'institutional_domestic','mutual_funds','insurance',
                                       'public_retail','government','other')),
  pct              numeric(7,4) CHECK (pct         IS NULL OR pct         BETWEEN 0 AND 100),
  pledged_pct      numeric(7,4) CHECK (pledged_pct IS NULL OR pledged_pct BETWEEN 0 AND 100),
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  revision         integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_shareholding_key
    UNIQUE (study_company_id, period_end, category, revision)
);

CREATE TABLE IF NOT EXISTS public.study_ownership_changes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  period_from      date        NOT NULL,
  period_to        date        NOT NULL,
  holder_name      text        NOT NULL,
  holder_type      text,
  pct_from         numeric(7,4) CHECK (pct_from IS NULL OR pct_from BETWEEN 0 AND 100),
  pct_to           numeric(7,4) CHECK (pct_to   IS NULL OR pct_to   BETWEEN 0 AND 100),
  -- NULL treated as 0 so a new holder (pct_from NULL) still gets a change.
  change_pct       numeric(7,4) GENERATED ALWAYS AS (coalesce(pct_to, 0) - coalesce(pct_from, 0)) STORED,
  -- NULL when unchanged (or both sides empty).
  direction        text GENERATED ALWAYS AS (
                     CASE
                       WHEN coalesce(pct_from, 0) = 0 AND coalesce(pct_to, 0) > 0 THEN 'new'
                       WHEN coalesce(pct_from, 0) > 0 AND coalesce(pct_to, 0) = 0 THEN 'exit'
                       WHEN pct_to > pct_from THEN 'increase'
                       WHEN pct_to < pct_from THEN 'decrease'
                     END) STORED,
  profile          text,
  source_id        uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_ownership_changes_period_check CHECK (period_to > period_from)
);

CREATE TABLE IF NOT EXISTS public.study_period_notes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  period_end       date        NOT NULL,
  fiscal_label     text,
  what_changed_md  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_period_notes_key UNIQUE (study_company_id, period_end)
);

-- ────────────────────────────────────────────────────────────────────────
-- B4. Indexes
-- ────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS study_companies_status_idx   ON public.study_companies (status);
-- slug: indexed by the study_companies_slug_key UNIQUE constraint.
CREATE INDEX IF NOT EXISTS study_companies_featured_idx ON public.study_companies (featured) WHERE featured;

DO $$
DECLARE
  t text;
BEGIN
  -- study_company_id on plain child tables
  FOREACH t IN ARRAY ARRAY[
    'study_sources','study_founders','study_timeline','study_products','study_tam',
    'study_developments','study_risks','study_watch_items','study_ownership_changes'
  ] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (study_company_id, sort_order)',
                   t || '_study_company_id_idx', t);
  END LOOP;

  -- (study_company_id, period_end desc) on period tables — also covers the FK
  FOREACH t IN ARRAY ARRAY[
    'study_financial_periods','study_segment_periods','study_shareholding','study_period_notes'
  ] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (study_company_id, period_end DESC)',
                   t || '_period_idx', t);
  END LOOP;

  -- source_id FK on every table that has it
  FOREACH t IN ARRAY ARRAY[
    'study_founders','study_timeline','study_products','study_tam','study_developments',
    'study_risks','study_financial_periods','study_segment_periods','study_shareholding',
    'study_ownership_changes'
  ] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (source_id)',
                   t || '_source_id_idx', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS study_status_log_study_company_id_idx
  ON public.study_status_log (study_company_id, changed_at DESC);

-- ────────────────────────────────────────────────────────────────────────
-- B5. Triggers
-- ────────────────────────────────────────────────────────────────────────

-- B5a. study_companies: default slug from name, stamp published_at.
CREATE OR REPLACE FUNCTION public.study_companies_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.study_slugify(NEW.name);
  END IF;
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS study_companies_before_write_trg ON public.study_companies;
CREATE TRIGGER study_companies_before_write_trg
  BEFORE INSERT OR UPDATE ON public.study_companies
  FOR EACH ROW EXECUTE FUNCTION public.study_companies_before_write();

-- B5b. study_companies: log status on insert and every status change.
CREATE OR REPLACE FUNCTION public.study_companies_log_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.study_status_log (study_company_id, from_status, to_status, changed_by)
    VALUES (NEW.id,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
            NEW.status,
            auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.study_companies_log_status() FROM PUBLIC;

DROP TRIGGER IF EXISTS study_companies_log_status_trg ON public.study_companies;
CREATE TRIGGER study_companies_log_status_trg
  AFTER INSERT OR UPDATE OF status ON public.study_companies
  FOR EACH ROW EXECUTE FUNCTION public.study_companies_log_status();

-- B5c. updated_at on every new table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'study_companies',
    'study_sources','study_founders','study_timeline','study_products','study_tam',
    'study_developments','study_risks','study_watch_items','study_status_log',
    'study_financial_periods','study_segment_periods','study_shareholding',
    'study_ownership_changes','study_period_notes'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at_trg', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.study_set_updated_at()',
      t || '_updated_at_trg', t);
  END LOOP;
END $$;

-- B5d. Append-only guards: key + numeric columns cannot be UPDATEd.
-- Still editable: sort_order, fiscal_label, currency, unit, source_id.
DROP TRIGGER IF EXISTS study_financial_periods_append_only_trg ON public.study_financial_periods;
CREATE TRIGGER study_financial_periods_append_only_trg
  BEFORE UPDATE ON public.study_financial_periods
  FOR EACH ROW EXECUTE FUNCTION public.study_block_period_update(
    'study_company_id','period_end','period_type','basis','revision',
    'revenue','ebitda','pat','eps','other_income','total_debt','cash','cfo','capex');

DROP TRIGGER IF EXISTS study_segment_periods_append_only_trg ON public.study_segment_periods;
CREATE TRIGGER study_segment_periods_append_only_trg
  BEFORE UPDATE ON public.study_segment_periods
  FOR EACH ROW EXECUTE FUNCTION public.study_block_period_update(
    'study_company_id','period_end','period_type','basis','segment_name','revision',
    'revenue','ebit');

DROP TRIGGER IF EXISTS study_shareholding_append_only_trg ON public.study_shareholding;
CREATE TRIGGER study_shareholding_append_only_trg
  BEFORE UPDATE ON public.study_shareholding
  FOR EACH ROW EXECUTE FUNCTION public.study_block_period_update(
    'study_company_id','period_end','category','revision',
    'pct','pledged_pct');

-- ────────────────────────────────────────────────────────────────────────
-- B6. RLS
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.study_is_public(p_study_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.study_companies
    WHERE id = p_study_company_id AND status = 'published'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.study_is_public(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.study_is_public(uuid) TO anon, authenticated;

-- public.is_admin() is granted to `authenticated` only, so admin policies
-- are scoped TO authenticated (anon evaluating it would raise an error).

ALTER TABLE public.study_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_companies_public_read ON public.study_companies;
CREATE POLICY study_companies_public_read
  ON public.study_companies FOR SELECT TO anon, authenticated
  USING (status = 'published');
DROP POLICY IF EXISTS study_companies_admin_all ON public.study_companies;
CREATE POLICY study_companies_admin_all
  ON public.study_companies FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Child + period tables: public read via parent; admin all (incl. DELETE).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'study_sources','study_founders','study_timeline','study_products','study_tam',
    'study_developments','study_risks','study_watch_items',
    'study_financial_periods','study_segment_periods','study_shareholding',
    'study_ownership_changes','study_period_notes'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated
         USING (public.study_is_public(study_company_id))',
      t || '_public_read', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_admin_all', t);
  END LOOP;
END $$;

-- Status log: admin only (rows written by the SECURITY DEFINER trigger).
ALTER TABLE public.study_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_status_log_admin_all ON public.study_status_log;
CREATE POLICY study_status_log_admin_all
  ON public.study_status_log FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ────────────────────────────────────────────────────────────────────────
-- B7. Views (security_invoker — caller's RLS applies)
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.study_financials_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (study_company_id, period_end, period_type, basis) *
FROM public.study_financial_periods
ORDER BY study_company_id, period_end, period_type, basis, revision DESC;

CREATE OR REPLACE VIEW public.study_segments_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (study_company_id, period_end, period_type, basis, segment_name) *
FROM public.study_segment_periods
ORDER BY study_company_id, period_end, period_type, basis, segment_name, revision DESC;

CREATE OR REPLACE VIEW public.study_shareholding_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (study_company_id, period_end, category) *
FROM public.study_shareholding
ORDER BY study_company_id, period_end, category, revision DESC;

-- Freshness.
--   financials_stale / shareholding_stale : latest period_end > 100 days ago (or none)
--   review_stale                          : reviewed_at NULL or > 180 days ago
--   missing_latest_quarter                : company reports quarterly (has any 'Q' row)
--       and has no 'Q' row for its most recent fiscal quarter end that is at
--       least 60 days old. Quarter ends are derived from fiscal_year_end_month
--       (NULL -> December), so a March-FY Indian company and a January-FY US
--       retailer are both judged on their own calendar. Half-yearly reporters
--       (no 'Q' rows) are never flagged here — financials_stale covers them.
CREATE OR REPLACE VIEW public.study_freshness
WITH (security_invoker = true) AS
SELECT
  c.id                                AS study_company_id,
  c.slug,
  c.name,
  c.exchange,
  c.ticker,
  c.status,
  f.latest_financial_period_end,
  q.latest_quarter_period_end,
  sh.latest_shareholding_period_end,
  c.reviewed_at,
  eq.expected_quarter_end,
  (f.latest_financial_period_end IS NULL
     OR f.latest_financial_period_end < current_date - 100)              AS financials_stale,
  (sh.latest_shareholding_period_end IS NULL
     OR sh.latest_shareholding_period_end < current_date - 100)          AS shareholding_stale,
  (c.reviewed_at IS NULL OR c.reviewed_at < now() - interval '180 days') AS review_stale,
  NOT EXISTS (SELECT 1 FROM public.study_sources x WHERE x.study_company_id = c.id) AS missing_sources,
  NOT EXISTS (SELECT 1 FROM public.study_tam     x WHERE x.study_company_id = c.id) AS missing_tam,
  (sh.latest_shareholding_period_end IS NULL)                            AS missing_shareholding,
  (q.latest_quarter_period_end IS NOT NULL
     AND q.latest_quarter_period_end < eq.expected_quarter_end)          AS missing_latest_quarter
FROM public.study_companies c
LEFT JOIN LATERAL (
  SELECT max(fp.period_end) AS latest_financial_period_end
  FROM public.study_financial_periods fp
  WHERE fp.study_company_id = c.id
) f ON true
LEFT JOIN LATERAL (
  SELECT max(fp.period_end) AS latest_quarter_period_end
  FROM public.study_financial_periods fp
  WHERE fp.study_company_id = c.id AND fp.period_type = 'Q'
) q ON true
LEFT JOIN LATERAL (
  SELECT max(s.period_end) AS latest_shareholding_period_end
  FROM public.study_shareholding s
  WHERE s.study_company_id = c.id
) sh ON true
LEFT JOIN LATERAL (
  -- x = today - 60 days. Walk back k months from x's month so the month is
  -- a fiscal quarter end ((month - fy_end) mod 3 = 0); if that month's last
  -- day is still after x, step back one more quarter.
  SELECT CASE
           WHEN (b.cand_start + interval '1 month' - interval '1 day')::date <= b.x
             THEN (b.cand_start + interval '1 month' - interval '1 day')::date
           ELSE (b.cand_start - interval '2 months' - interval '1 day')::date
         END AS expected_quarter_end
  FROM (
    SELECT a.x,
           date_trunc('month', a.x::timestamp)
             - make_interval(months => (((extract(month FROM a.x)::int - a.fy) % 3) + 3) % 3)
             AS cand_start
    FROM (SELECT current_date - 60 AS x,
                 coalesce(c.fiscal_year_end_month, 12) AS fy) a
  ) b
) eq ON true;

GRANT SELECT ON public.study_financials_latest   TO anon, authenticated;
GRANT SELECT ON public.study_segments_latest     TO anon, authenticated;
GRANT SELECT ON public.study_shareholding_latest TO anon, authenticated;
-- Editorial tooling: no anon access.
REVOKE ALL   ON public.study_freshness FROM anon;
GRANT SELECT ON public.study_freshness TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- Smoke test (run separately after COMMIT; read-only)
-- ════════════════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name LIKE 'study%' ORDER BY 1;
-- SELECT tablename, policyname, roles, cmd FROM pg_policies
--   WHERE tablename LIKE 'study%' ORDER BY 1, 2;
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.company_studies'::regclass AND NOT tgisinternal;
-- SELECT * FROM public.study_freshness;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (commented out). Removes everything PART B created and restores
-- the v2 status logger body. It does NOT recreate the v2 study_* tables —
-- re-run studies_v2_schema.sql for that (it is idempotent).
-- ════════════════════════════════════════════════════════════════════════
-- BEGIN;
--
-- DROP VIEW IF EXISTS public.study_freshness;
-- DROP VIEW IF EXISTS public.study_shareholding_latest;
-- DROP VIEW IF EXISTS public.study_segments_latest;
-- DROP VIEW IF EXISTS public.study_financials_latest;
--
-- DROP TABLE IF EXISTS public.study_period_notes       CASCADE;
-- DROP TABLE IF EXISTS public.study_ownership_changes  CASCADE;
-- DROP TABLE IF EXISTS public.study_shareholding       CASCADE;
-- DROP TABLE IF EXISTS public.study_segment_periods    CASCADE;
-- DROP TABLE IF EXISTS public.study_financial_periods  CASCADE;
-- DROP TABLE IF EXISTS public.study_status_log         CASCADE;
-- DROP TABLE IF EXISTS public.study_watch_items        CASCADE;
-- DROP TABLE IF EXISTS public.study_risks              CASCADE;
-- DROP TABLE IF EXISTS public.study_developments       CASCADE;
-- DROP TABLE IF EXISTS public.study_tam                CASCADE;
-- DROP TABLE IF EXISTS public.study_products           CASCADE;
-- DROP TABLE IF EXISTS public.study_timeline           CASCADE;
-- DROP TABLE IF EXISTS public.study_founders           CASCADE;
-- DROP TABLE IF EXISTS public.study_sources            CASCADE;
-- DROP TABLE IF EXISTS public.study_companies          CASCADE;
--
-- DROP FUNCTION IF EXISTS public.study_companies_log_status();
-- DROP FUNCTION IF EXISTS public.study_companies_before_write();
-- DROP FUNCTION IF EXISTS public.study_is_public(uuid);
-- DROP FUNCTION IF EXISTS public.study_block_period_update();
-- -- study_set_updated_at and study_slugify stay: company_studies triggers use them.
--
-- -- company_studies_log_status() stays a no-op until the v2 study_status_log
-- -- (study_id …) exists again; re-running studies_v2_schema.sql restores both.
--
-- COMMIT;
