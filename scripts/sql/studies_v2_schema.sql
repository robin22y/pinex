-- ════════════════════════════════════════════════════════════════════════
-- studies_v2_schema.sql — Company Studies, Phase 2: DB foundation
--
-- Design: docs/STUDIES_AUDIT.md §4, with the Phase 2 corrections.
--
-- What this does
--   1. Extends public.company_studies (additive only — nothing dropped or
--      renamed) and backfills slug / company_id / status for existing rows.
--   2. Creates study-level child tables (study_*), keyed by study_id.
--   3. Creates append-only period tables keyed by company_id, shared
--      across studies. Numeric + key columns cannot be UPDATEd —
--      corrections are a new row with revision + 1.
--   4. Creates security_invoker views (latest revision + freshness).
--   5. RLS on every new table; company_studies admin policy moves from
--      auth.email() to public.is_admin() (new policy added FIRST).
--
-- What this does NOT do
--   - Alter public.companies (only referenced by FK).
--   - Touch price_data / daily_closes / swing_conditions / any pipeline.
--   - Create anything named financials / shareholding / quarterly_changes /
--     products / sources / risks (those names are legacy or too generic).
--
-- Legacy compatibility
--   The current admin (src/components/admin/CompanyStudiesAdmin.jsx)
--   inserts/updates WITHOUT slug, company_id or status and toggles only
--   is_published. The BEFORE trigger below therefore:
--     - fills slug from symbol and company_id from companies.symbol,
--     - maps an is_published flip to status ('published' / 'draft'),
--     - otherwise derives is_published from status.
--   So the legacy admin and /learn/company pages keep working unchanged.
--
-- Prerequisites (verify before running)
--   - public.is_admin() exists (scripts/sql/fix_is_admin_recursion.sql).
--   - Your profiles.role is 'superadmin' or 'admin' — otherwise you lose
--     write access to company_studies from the app once the email policy
--     is dropped (SQL editor / service role is unaffected).
--   - companies.id is uuid and companies.symbol is unique.
--
-- Apply
--   Run once in the Supabase SQL editor. Idempotent: safe to re-run.
--   Takes a brief lock on public.companies while FKs are created —
--   run outside the daily.yml window.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 0. Shared helper functions
-- ────────────────────────────────────────────────────────────────────────

-- Slug: lowercase, '&' -> 'and', any run of non-alphanumerics -> '-',
-- trimmed of leading/trailing '-'.  'M&M' -> 'm-and-m', 'BAJAJ-AUTO' -> 'bajaj-auto'.
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

-- Shared updated_at trigger for every study table.
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

-- Append-only guard. TG_ARGV = list of column names that may never change
-- on UPDATE. Compared via jsonb so one function serves all period tables.
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
-- 1. Extend company_studies (additive)
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.company_studies
  ADD COLUMN IF NOT EXISTS company_id       uuid REFERENCES public.companies (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slug             text,
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS title            text,
  ADD COLUMN IF NOT EXISTS headline         text,
  ADD COLUMN IF NOT EXISTS story_hook       text,
  ADD COLUMN IF NOT EXISTS summary          text,
  ADD COLUMN IF NOT EXISTS sector_label     text,
  ADD COLUMN IF NOT EXISTS hero_image_url   text,
  ADD COLUMN IF NOT EXISTS logo_url         text,
  ADD COLUMN IF NOT EXISTS story_md         text,
  ADD COLUMN IF NOT EXISTS central_question text,
  ADD COLUMN IF NOT EXISTS then_text        text,
  ADD COLUMN IF NOT EXISTS now_text         text,
  ADD COLUMN IF NOT EXISTS next_text        text,
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS version          integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_built_at    timestamptz;
-- NOTE: no byline column by design — the renderer hard-codes "PineX Research".

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'company_studies_status_check'
                   AND conrelid = 'public.company_studies'::regclass) THEN
    ALTER TABLE public.company_studies
      ADD CONSTRAINT company_studies_status_check
      CHECK (status IN ('draft','researching','reviewed','published','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'company_studies_version_check'
                   AND conrelid = 'public.company_studies'::regclass) THEN
    ALTER TABLE public.company_studies
      ADD CONSTRAINT company_studies_version_check CHECK (version >= 1);
  END IF;
END $$;

-- 1a. Backfill (runs BEFORE the triggers exist, so is_published is untouched).

-- slug from symbol; duplicates (if any) get -2, -3 … suffixes.
WITH s AS (
  SELECT id,
         public.study_slugify(symbol) AS base,
         row_number() OVER (PARTITION BY public.study_slugify(symbol)
                            ORDER BY published_at NULLS LAST, id) AS rn
  FROM public.company_studies
  WHERE slug IS NULL
)
UPDATE public.company_studies c
SET slug = CASE WHEN s.rn = 1 THEN s.base ELSE s.base || '-' || s.rn END
FROM s
WHERE c.id = s.id;

-- company_id from companies.symbol.
UPDATE public.company_studies c
SET company_id = co.id
FROM public.companies co
WHERE c.company_id IS NULL
  AND upper(co.symbol) = upper(c.symbol);

-- status from is_published.
UPDATE public.company_studies
SET status = 'published'
WHERE is_published = true
  AND status <> 'published';

ALTER TABLE public.company_studies ALTER COLUMN slug SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'company_studies_slug_key'
                   AND conrelid = 'public.company_studies'::regclass) THEN
    ALTER TABLE public.company_studies
      ADD CONSTRAINT company_studies_slug_key UNIQUE (slug);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS company_studies_status_idx     ON public.company_studies (status);
CREATE INDEX IF NOT EXISTS company_studies_company_id_idx ON public.company_studies (company_id);
-- slug is indexed by company_studies_slug_key (UNIQUE).

-- ────────────────────────────────────────────────────────────────────────
-- 2. Study-level tables (study_id FK, ON DELETE CASCADE)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.study_sources (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id      uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order    integer     NOT NULL DEFAULT 0,
  kind          text        NOT NULL
                CHECK (kind IN ('annual_report','quarterly_result','investor_presentation',
                                'concall','shareholding_filing','exchange_announcement',
                                'mf_portfolio','government','other')),
  title         text        NOT NULL,
  publisher     text,
  url           text,
  document_date date,
  page          text,
  accessed_on   date,
  archive_url   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_founders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id        uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order      integer     NOT NULL DEFAULT 0,
  name            text        NOT NULL,
  image_url       text,
  education       text,
  previous_career text,
  founding_story  text,
  -- Spec name was "current_role", which is a reserved SQL keyword
  -- (CURRENT_ROLE returns the session role when unquoted). Renamed.
  present_role    text,
  source_id       uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_timeline (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id      uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order    integer     NOT NULL DEFAULT 0,
  event_date    date,
  event_year    integer     CHECK (event_year BETWEEN 1800 AND 2200),
  title         text        NOT NULL,
  body          text,
  is_pull_quote boolean     NOT NULL DEFAULT false,
  source_id     uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_products (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id            uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
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
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id      uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order    integer     NOT NULL DEFAULT 0,
  market        text        NOT NULL,
  geography     text,
  level         text        NOT NULL CHECK (level IN ('tam','sam','company_opportunity')),
  estimate_type text        NOT NULL CHECK (estimate_type IN ('company','third_party','pinex_calc')),
  -- array of {label, value, unit, source_id}
  inputs        jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(inputs) = 'array'),
  calculation   text,
  result_value  numeric,
  result_unit   text,
  as_of_year    integer     CHECK (as_of_year BETWEEN 1900 AND 2200),
  notes         text,
  source_id     uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_developments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order  integer     NOT NULL DEFAULT 0,
  event_date  date,
  title       text        NOT NULL,
  body        text,
  category    text        NOT NULL DEFAULT 'other'
              CHECK (category IN ('filing','order','management','capex','regulatory','other')),
  source_id   uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_risks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order  integer     NOT NULL DEFAULT 0,
  title       text        NOT NULL,
  body        text,
  severity    text        CHECK (severity IN ('high','medium','low')),
  source_id   uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_watch_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order  integer     NOT NULL DEFAULT 0,
  label       text        NOT NULL,
  note        text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_ownership_changes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id      uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order    integer     NOT NULL DEFAULT 0,
  company_id    uuid        NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  period_from   date        NOT NULL,
  period_to     date        NOT NULL,
  holder_name   text        NOT NULL,
  holder_type   text        NOT NULL
                CHECK (holder_type IN ('fii','mf','insurance','dii_other','promoter','other')),
  pct_from      numeric(7,4) CHECK (pct_from IS NULL OR pct_from BETWEEN 0 AND 100),
  pct_to        numeric(7,4) CHECK (pct_to   IS NULL OR pct_to   BETWEEN 0 AND 100),
  change_pct    numeric(7,4) GENERATED ALWAYS AS (coalesce(pct_to, 0) - coalesce(pct_from, 0)) STORED,
  -- NULL when unchanged. Generated columns cannot reference each other,
  -- so the arithmetic is repeated here.
  direction     text GENERATED ALWAYS AS (
                  CASE
                    WHEN coalesce(pct_from, 0) = 0 AND coalesce(pct_to, 0) > 0 THEN 'new'
                    WHEN coalesce(pct_from, 0) > 0 AND coalesce(pct_to, 0) = 0 THEN 'exit'
                    WHEN coalesce(pct_to, 0) > coalesce(pct_from, 0)          THEN 'increase'
                    WHEN coalesce(pct_to, 0) < coalesce(pct_from, 0)          THEN 'decrease'
                  END) STORED,
  profile       text,
  source_id     uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_to > period_from)
);

CREATE TABLE IF NOT EXISTS public.study_status_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  from_status text,
  to_status   text        NOT NULL,
  changed_by  uuid,       -- auth.uid(); NULL when changed from SQL editor / service role
  changed_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

-- ────────────────────────────────────────────────────────────────────────
-- 3. Period tables (company_id, append-only, shared across studies)
-- ────────────────────────────────────────────────────────────────────────
-- company_id uses ON DELETE RESTRICT: history is never silently deleted.
-- (No code path deletes from companies today.)

CREATE TABLE IF NOT EXISTS public.study_financial_periods (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  period_end    date        NOT NULL,
  period_type   text        NOT NULL CHECK (period_type IN ('Q','FY','H')),
  fiscal_label  text,                    -- e.g. 'Q2 FY26'
  basis         text        NOT NULL DEFAULT 'consolidated'
                CHECK (basis IN ('standalone','consolidated')),
  revenue       numeric,
  ebitda        numeric,
  pat           numeric,
  eps           numeric,
  other_income  numeric,
  total_debt    numeric,
  cash          numeric,
  cfo           numeric,
  capex         numeric,
  unit          text        NOT NULL DEFAULT 'crore',
  source_id     uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  filed_at      date,
  revision      integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_financial_periods_key
    UNIQUE (company_id, period_end, period_type, basis, revision)
);
-- No price, market cap or valuation columns — by design (decision #4).

CREATE TABLE IF NOT EXISTS public.study_segment_periods (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  period_end    date        NOT NULL,
  period_type   text        NOT NULL CHECK (period_type IN ('Q','FY','H')),
  basis         text        NOT NULL DEFAULT 'consolidated'
                CHECK (basis IN ('standalone','consolidated')),
  segment_name  text        NOT NULL,
  revenue       numeric,
  ebit          numeric,
  unit          text        NOT NULL DEFAULT 'crore',
  source_id     uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  revision      integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_segment_periods_key
    UNIQUE (company_id, period_end, period_type, basis, segment_name, revision)
);

CREATE TABLE IF NOT EXISTS public.study_shareholding_periods (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  period_end            date        NOT NULL,
  promoter_pct          numeric(7,4) CHECK (promoter_pct          BETWEEN 0 AND 100),
  promoter_pledged_pct  numeric(7,4) CHECK (promoter_pledged_pct  BETWEEN 0 AND 100),
  fii_pct               numeric(7,4) CHECK (fii_pct               BETWEEN 0 AND 100),
  dii_pct               numeric(7,4) CHECK (dii_pct               BETWEEN 0 AND 100),
  mf_pct                numeric(7,4) CHECK (mf_pct                BETWEEN 0 AND 100),
  insurance_pct         numeric(7,4) CHECK (insurance_pct         BETWEEN 0 AND 100),
  public_pct            numeric(7,4) CHECK (public_pct            BETWEEN 0 AND 100),
  others_pct            numeric(7,4) CHECK (others_pct            BETWEEN 0 AND 100),
  source_id             uuid        REFERENCES public.study_sources (id) ON DELETE SET NULL,
  filed_at              date,
  revision              integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_shareholding_periods_key UNIQUE (company_id, period_end, revision)
);

-- Narrative per period — study-level, editable (not append-only).
CREATE TABLE IF NOT EXISTS public.study_period_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id        uuid        NOT NULL REFERENCES public.company_studies (id) ON DELETE CASCADE,
  sort_order      integer     NOT NULL DEFAULT 0,
  period_end      date        NOT NULL,
  fiscal_label    text,
  what_changed_md text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_period_notes_key UNIQUE (study_id, period_end)
);

-- ────────────────────────────────────────────────────────────────────────
-- 4. Indexes (every FK + query paths)
-- ────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS study_sources_study_id_idx        ON public.study_sources (study_id);
CREATE INDEX IF NOT EXISTS study_founders_study_id_idx       ON public.study_founders (study_id);
CREATE INDEX IF NOT EXISTS study_founders_source_id_idx      ON public.study_founders (source_id);
CREATE INDEX IF NOT EXISTS study_timeline_study_id_idx       ON public.study_timeline (study_id);
CREATE INDEX IF NOT EXISTS study_timeline_source_id_idx      ON public.study_timeline (source_id);
CREATE INDEX IF NOT EXISTS study_products_study_id_idx       ON public.study_products (study_id);
CREATE INDEX IF NOT EXISTS study_products_source_id_idx      ON public.study_products (source_id);
CREATE INDEX IF NOT EXISTS study_tam_study_id_idx            ON public.study_tam (study_id);
CREATE INDEX IF NOT EXISTS study_tam_source_id_idx           ON public.study_tam (source_id);
CREATE INDEX IF NOT EXISTS study_developments_study_id_idx   ON public.study_developments (study_id);
CREATE INDEX IF NOT EXISTS study_developments_source_id_idx  ON public.study_developments (source_id);
CREATE INDEX IF NOT EXISTS study_risks_study_id_idx          ON public.study_risks (study_id);
CREATE INDEX IF NOT EXISTS study_risks_source_id_idx         ON public.study_risks (source_id);
CREATE INDEX IF NOT EXISTS study_watch_items_study_id_idx    ON public.study_watch_items (study_id);
CREATE INDEX IF NOT EXISTS study_ownership_changes_study_id_idx   ON public.study_ownership_changes (study_id);
CREATE INDEX IF NOT EXISTS study_ownership_changes_company_id_idx ON public.study_ownership_changes (company_id, period_to DESC);
CREATE INDEX IF NOT EXISTS study_ownership_changes_source_id_idx  ON public.study_ownership_changes (source_id);
CREATE INDEX IF NOT EXISTS study_status_log_study_id_idx     ON public.study_status_log (study_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS study_period_notes_study_id_idx   ON public.study_period_notes (study_id, period_end DESC);

CREATE INDEX IF NOT EXISTS study_financial_periods_company_idx   ON public.study_financial_periods (company_id, period_end DESC);
CREATE INDEX IF NOT EXISTS study_financial_periods_source_id_idx ON public.study_financial_periods (source_id);
CREATE INDEX IF NOT EXISTS study_segment_periods_company_idx     ON public.study_segment_periods (company_id, period_end DESC);
CREATE INDEX IF NOT EXISTS study_segment_periods_source_id_idx   ON public.study_segment_periods (source_id);
CREATE INDEX IF NOT EXISTS study_shareholding_periods_company_idx   ON public.study_shareholding_periods (company_id, period_end DESC);
CREATE INDEX IF NOT EXISTS study_shareholding_periods_source_id_idx ON public.study_shareholding_periods (source_id);

-- ────────────────────────────────────────────────────────────────────────
-- 5. Triggers
-- ────────────────────────────────────────────────────────────────────────

-- 5a. company_studies: fill slug / company_id, keep is_published <-> status in sync.
CREATE OR REPLACE FUNCTION public.company_studies_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.study_slugify(NEW.symbol);
  END IF;

  IF NEW.company_id IS NULL AND NEW.symbol IS NOT NULL THEN
    SELECT co.id INTO NEW.company_id
    FROM public.companies co
    WHERE upper(co.symbol) = upper(NEW.symbol)
    LIMIT 1;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := coalesce(NEW.status, 'draft');
    -- Legacy admin inserts is_published=true without a status.
    IF NEW.is_published IS TRUE AND NEW.status = 'draft' THEN
      NEW.status := 'published';
    END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NULL;  -- status is the source of truth when it changes
    ELSIF NEW.is_published IS DISTINCT FROM OLD.is_published THEN
      -- Legacy admin toggled only is_published.
      NEW.status := CASE WHEN NEW.is_published THEN 'published' ELSE 'draft' END;
    END IF;
  END IF;

  NEW.is_published := (NEW.status = 'published');

  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_studies_sync_trg ON public.company_studies;
CREATE TRIGGER company_studies_sync_trg
  BEFORE INSERT OR UPDATE ON public.company_studies
  FOR EACH ROW EXECUTE FUNCTION public.company_studies_sync();

-- 5b. company_studies: log every status change. SECURITY DEFINER so the
-- log insert is not blocked by study_status_log RLS.
CREATE OR REPLACE FUNCTION public.company_studies_log_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.study_status_log (study_id, from_status, to_status, changed_by)
    VALUES (NEW.id,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
            NEW.status,
            auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.company_studies_log_status() FROM PUBLIC;

DROP TRIGGER IF EXISTS company_studies_log_status_trg ON public.company_studies;
CREATE TRIGGER company_studies_log_status_trg
  AFTER INSERT OR UPDATE OF status ON public.company_studies
  FOR EACH ROW EXECUTE FUNCTION public.company_studies_log_status();

-- One-off: seed the log with the current status of pre-existing rows.
INSERT INTO public.study_status_log (study_id, from_status, to_status, note)
SELECT cs.id, NULL, cs.status, 'v2 backfill'
FROM public.company_studies cs
WHERE NOT EXISTS (SELECT 1 FROM public.study_status_log l WHERE l.study_id = cs.id);

-- 5c. updated_at on company_studies + every new table that has it.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_studies',
    'study_sources','study_founders','study_timeline','study_products','study_tam',
    'study_developments','study_risks','study_watch_items','study_ownership_changes',
    'study_financial_periods','study_segment_periods','study_shareholding_periods',
    'study_period_notes'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at_trg', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.study_set_updated_at()',
      t || '_updated_at_trg', t);
  END LOOP;
END $$;

-- 5d. Append-only guards: key + numeric columns cannot be UPDATEd.
-- (Editable: fiscal_label, unit, source_id, filed_at — metadata only.)
DROP TRIGGER IF EXISTS study_financial_periods_append_only_trg ON public.study_financial_periods;
CREATE TRIGGER study_financial_periods_append_only_trg
  BEFORE UPDATE ON public.study_financial_periods
  FOR EACH ROW EXECUTE FUNCTION public.study_block_period_update(
    'company_id','period_end','period_type','basis','revision',
    'revenue','ebitda','pat','eps','other_income','total_debt','cash','cfo','capex');

DROP TRIGGER IF EXISTS study_segment_periods_append_only_trg ON public.study_segment_periods;
CREATE TRIGGER study_segment_periods_append_only_trg
  BEFORE UPDATE ON public.study_segment_periods
  FOR EACH ROW EXECUTE FUNCTION public.study_block_period_update(
    'company_id','period_end','period_type','basis','segment_name','revision',
    'revenue','ebit');

DROP TRIGGER IF EXISTS study_shareholding_periods_append_only_trg ON public.study_shareholding_periods;
CREATE TRIGGER study_shareholding_periods_append_only_trg
  BEFORE UPDATE ON public.study_shareholding_periods
  FOR EACH ROW EXECUTE FUNCTION public.study_block_period_update(
    'company_id','period_end','revision',
    'promoter_pct','promoter_pledged_pct','fii_pct','dii_pct','mf_pct',
    'insurance_pct','public_pct','others_pct');

-- ────────────────────────────────────────────────────────────────────────
-- 6. RLS helpers
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.study_is_public(p_study_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_studies
    WHERE id = p_study_id AND status = 'published'
  );
$$;

CREATE OR REPLACE FUNCTION public.company_has_public_study(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_studies
    WHERE company_id = p_company_id AND status = 'published'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.study_is_public(uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.company_has_public_study(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.study_is_public(uuid)          TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.company_has_public_study(uuid) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 7. RLS policies
-- ────────────────────────────────────────────────────────────────────────
-- public.is_admin() is granted to `authenticated` only, so every admin
-- policy is scoped TO authenticated (an anon request evaluating it would
-- otherwise fail with "permission denied for function is_admin").

-- 7a. company_studies: add role-based admin policy FIRST, then drop the email one.
DROP POLICY IF EXISTS company_studies_admin_role ON public.company_studies;
CREATE POLICY company_studies_admin_role
  ON public.company_studies
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS company_studies_admin_all ON public.company_studies;
-- company_studies_public_read (is_published = true) is kept unchanged;
-- the sync trigger guarantees is_published = (status = 'published').

-- 7b. Study-level tables: public read via parent study, admin all.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'study_sources','study_founders','study_timeline','study_products','study_tam',
    'study_developments','study_risks','study_watch_items','study_ownership_changes',
    'study_period_notes'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated
         USING (public.study_is_public(study_id))',
      t || '_public_read', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_admin_all', t);
  END LOOP;
END $$;

-- 7c. Company-level period tables: public read if any published study
-- exists for the company; admin all (incl. DELETE — the only role that can).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'study_financial_periods','study_segment_periods','study_shareholding_periods'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated
         USING (public.company_has_public_study(company_id))',
      t || '_public_read', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_admin_all', t);
  END LOOP;
END $$;

-- 7d. Status log: admin only (writes come from the SECURITY DEFINER trigger).
ALTER TABLE public.study_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_status_log_admin_all ON public.study_status_log;
CREATE POLICY study_status_log_admin_all
  ON public.study_status_log
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ────────────────────────────────────────────────────────────────────────
-- 8. Views (security_invoker — base-table RLS applies to the caller)
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.study_financials_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (company_id, period_end, period_type, basis) *
FROM public.study_financial_periods
ORDER BY company_id, period_end, period_type, basis, revision DESC;

CREATE OR REPLACE VIEW public.study_segments_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (company_id, period_end, period_type, basis, segment_name) *
FROM public.study_segment_periods
ORDER BY company_id, period_end, period_type, basis, segment_name, revision DESC;

CREATE OR REPLACE VIEW public.study_shareholding_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (company_id, period_end) *
FROM public.study_shareholding_periods
ORDER BY company_id, period_end, revision DESC;

-- Freshness. Thresholds:
--   financials_stale / shareholding_stale : latest period_end older than 100 days
--   review_stale                          : reviewed_at NULL or older than 180 days
--   missing_latest_quarter                : no 'Q' financials row for the most recent
--                                           quarter end that is at least 60 days old
--                                           (SEBI LODR: 45 days for Q1–Q3, 60 for Q4)
CREATE OR REPLACE VIEW public.study_freshness
WITH (security_invoker = true) AS
WITH expected AS (
  SELECT (date_trunc('quarter', (current_date - 60)::timestamp) - interval '1 day')::date
         AS expected_quarter_end
)
SELECT
  s.id                       AS study_id,
  s.slug,
  s.symbol,
  s.company_id,
  s.status,
  f.latest_financial_period_end,
  q.latest_quarter_period_end,
  sh.latest_shareholding_period_end,
  s.reviewed_at,
  e.expected_quarter_end,
  (f.latest_financial_period_end IS NULL
     OR f.latest_financial_period_end < current_date - 100)            AS financials_stale,
  (sh.latest_shareholding_period_end IS NULL
     OR sh.latest_shareholding_period_end < current_date - 100)        AS shareholding_stale,
  (s.reviewed_at IS NULL OR s.reviewed_at < now() - interval '180 days') AS review_stale,
  NOT EXISTS (SELECT 1 FROM public.study_sources x WHERE x.study_id = s.id) AS missing_sources,
  NOT EXISTS (SELECT 1 FROM public.study_tam     x WHERE x.study_id = s.id) AS missing_tam,
  (sh.latest_shareholding_period_end IS NULL)                          AS missing_shareholding,
  (q.latest_quarter_period_end IS NULL
     OR q.latest_quarter_period_end < e.expected_quarter_end)          AS missing_latest_quarter
FROM public.company_studies s
CROSS JOIN expected e
LEFT JOIN LATERAL (
  SELECT max(fp.period_end) AS latest_financial_period_end
  FROM public.study_financial_periods fp
  WHERE fp.company_id = s.company_id
) f ON true
LEFT JOIN LATERAL (
  SELECT max(fp.period_end) AS latest_quarter_period_end
  FROM public.study_financial_periods fp
  WHERE fp.company_id = s.company_id AND fp.period_type = 'Q'
) q ON true
LEFT JOIN LATERAL (
  SELECT max(sp.period_end) AS latest_shareholding_period_end
  FROM public.study_shareholding_periods sp
  WHERE sp.company_id = s.company_id
) sh ON true;

GRANT SELECT ON public.study_financials_latest   TO anon, authenticated;
GRANT SELECT ON public.study_segments_latest     TO anon, authenticated;
GRANT SELECT ON public.study_shareholding_latest TO anon, authenticated;
-- Freshness is editorial tooling: no anon grant. Non-admins who are signed
-- in only see published rows anyway (security_invoker + RLS).
REVOKE ALL   ON public.study_freshness FROM anon;
GRANT SELECT ON public.study_freshness TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- Smoke test (run separately after COMMIT; read-only)
-- ════════════════════════════════════════════════════════════════════════
-- SELECT id, symbol, slug, company_id, status, is_published FROM public.company_studies ORDER BY symbol;
-- SELECT * FROM public.study_status_log ORDER BY changed_at DESC LIMIT 20;
-- SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'company_studies';
-- SELECT * FROM public.study_freshness;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (commented out). Removes everything this file added and
-- restores the email-based admin policy. Existing narrative data in
-- company_studies is untouched; only the NEW columns are dropped.
-- ════════════════════════════════════════════════════════════════════════
-- BEGIN;
--
-- DROP VIEW IF EXISTS public.study_freshness;
-- DROP VIEW IF EXISTS public.study_shareholding_latest;
-- DROP VIEW IF EXISTS public.study_segments_latest;
-- DROP VIEW IF EXISTS public.study_financials_latest;
--
-- DROP TABLE IF EXISTS public.study_period_notes;
-- DROP TABLE IF EXISTS public.study_shareholding_periods;
-- DROP TABLE IF EXISTS public.study_segment_periods;
-- DROP TABLE IF EXISTS public.study_financial_periods;
-- DROP TABLE IF EXISTS public.study_status_log;
-- DROP TABLE IF EXISTS public.study_ownership_changes;
-- DROP TABLE IF EXISTS public.study_watch_items;
-- DROP TABLE IF EXISTS public.study_risks;
-- DROP TABLE IF EXISTS public.study_developments;
-- DROP TABLE IF EXISTS public.study_tam;
-- DROP TABLE IF EXISTS public.study_products;
-- DROP TABLE IF EXISTS public.study_timeline;
-- DROP TABLE IF EXISTS public.study_founders;
-- DROP TABLE IF EXISTS public.study_sources;
--
-- DROP TRIGGER IF EXISTS company_studies_sync_trg         ON public.company_studies;
-- DROP TRIGGER IF EXISTS company_studies_log_status_trg   ON public.company_studies;
-- DROP TRIGGER IF EXISTS company_studies_updated_at_trg   ON public.company_studies;
--
-- -- Restore the original email policy BEFORE dropping the role policy.
-- DROP POLICY IF EXISTS company_studies_admin_all ON public.company_studies;
-- CREATE POLICY company_studies_admin_all
--   ON public.company_studies FOR ALL
--   USING (auth.email() = 'robin22y@gmail.com')
--   WITH CHECK (auth.email() = 'robin22y@gmail.com');
-- DROP POLICY IF EXISTS company_studies_admin_role ON public.company_studies;
--
-- DROP INDEX IF EXISTS public.company_studies_status_idx;
-- DROP INDEX IF EXISTS public.company_studies_company_id_idx;
-- ALTER TABLE public.company_studies DROP CONSTRAINT IF EXISTS company_studies_slug_key;
-- ALTER TABLE public.company_studies DROP CONSTRAINT IF EXISTS company_studies_status_check;
-- ALTER TABLE public.company_studies DROP CONSTRAINT IF EXISTS company_studies_version_check;
-- ALTER TABLE public.company_studies
--   DROP COLUMN IF EXISTS company_id,
--   DROP COLUMN IF EXISTS slug,
--   DROP COLUMN IF EXISTS status,
--   DROP COLUMN IF EXISTS title,
--   DROP COLUMN IF EXISTS headline,
--   DROP COLUMN IF EXISTS story_hook,
--   DROP COLUMN IF EXISTS summary,
--   DROP COLUMN IF EXISTS sector_label,
--   DROP COLUMN IF EXISTS hero_image_url,
--   DROP COLUMN IF EXISTS logo_url,
--   DROP COLUMN IF EXISTS story_md,
--   DROP COLUMN IF EXISTS central_question,
--   DROP COLUMN IF EXISTS then_text,
--   DROP COLUMN IF EXISTS now_text,
--   DROP COLUMN IF EXISTS next_text,
--   DROP COLUMN IF EXISTS reviewed_at,
--   DROP COLUMN IF EXISTS version,
--   DROP COLUMN IF EXISTS last_built_at;
--
-- DROP FUNCTION IF EXISTS public.company_studies_log_status();
-- DROP FUNCTION IF EXISTS public.company_studies_sync();
-- DROP FUNCTION IF EXISTS public.company_has_public_study(uuid);
-- DROP FUNCTION IF EXISTS public.study_is_public(uuid);
-- DROP FUNCTION IF EXISTS public.study_block_period_update();
-- DROP FUNCTION IF EXISTS public.study_set_updated_at();
-- DROP FUNCTION IF EXISTS public.study_slugify(text);
--
-- COMMIT;
