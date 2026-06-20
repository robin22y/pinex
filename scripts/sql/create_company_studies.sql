-- ════════════════════════════════════════════════════════════════════════
-- create_company_studies.sql
--
-- Backing store for Robin's Company Study series — long-form "what does
-- this company actually do" write-ups that pair with a YouTube/podcast
-- episode. Reads at /learn/company/:symbol; index at /learn/companies.
--
-- One row per company (symbol unique). Robin authors and publishes via
-- the IQjet Desk admin panel; public reads are gated to is_published =
-- true so drafts stay private.
--
-- The multilingual columns (title_ml/_hi/_ta and 5 section _ml/_hi/_ta
-- variants) are added in a separate file (update_company_studies.sql)
-- so the base schema stays readable.
--
-- Apply
--   Run once in Supabase SQL editor. Idempotent — IF NOT EXISTS guards
--   on the table + index, drop-and-recreate on the RLS policies.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.company_studies (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol                   text        NOT NULL UNIQUE,
  what_they_do             text,
  how_they_make_money      text,
  who_built_it             text,
  similar_companies        text,
  what_to_watch            text,
  youtube_url              text,
  podcast_duration_seconds integer,
  published_at             timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  is_published             boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS company_studies_published_idx
  ON public.company_studies (is_published, published_at DESC);

ALTER TABLE public.company_studies ENABLE ROW LEVEL SECURITY;

-- Public read — anyone (including anonymous visitors) can SELECT rows
-- where is_published = true. Drafts stay invisible.
DROP POLICY IF EXISTS company_studies_public_read ON public.company_studies;
CREATE POLICY company_studies_public_read
  ON public.company_studies
  FOR SELECT
  USING (is_published = true);

-- Admin full access — auth.email() gate keeps INSERT / UPDATE / DELETE
-- locked to the operator account. Same pattern used elsewhere in the
-- project for admin-only writes.
DROP POLICY IF EXISTS company_studies_admin_all ON public.company_studies;
CREATE POLICY company_studies_admin_all
  ON public.company_studies
  FOR ALL
  USING (auth.email() = 'robin22y@gmail.com')
  WITH CHECK (auth.email() = 'robin22y@gmail.com');
