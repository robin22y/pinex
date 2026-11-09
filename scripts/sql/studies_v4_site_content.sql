-- ════════════════════════════════════════════════════════════════════════
-- studies_v4_site_content.sql — Phase 2b: site content + media
--
-- Makes every public string and image on the studies site and homepage
-- editable from admin:
--   1. study_media              image library (alt text + credit mandatory)
--   2. storage bucket           'study-media' (public, 5 MB, webp/avif/jpeg/png)
--   3. image FKs + card fields  on study_companies / founders / products / timeline
--   4. study_series             + study_company_series (many-to-many)
--   5. site_content             key → jsonb, draft/published, seeded placeholders
--   6. site_updates             manual "What's New" items
--   7. home_whats_new           view: updates + period notes + developments
--
-- Depends on: studies_v3_standalone.sql (study_companies, study_is_public,
-- study_set_updated_at) and public.is_admin().
--
-- Touches existing tables ONLY by adding columns to study_companies,
-- study_founders, study_products, study_timeline. Nothing is dropped.
--
-- Idempotent. Seeds use ON CONFLICT DO NOTHING, so re-running never
-- overwrites content edited in admin.
--
-- Apply: run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1. study_media
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.study_media (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path  text        NOT NULL,                       -- original, path inside the study-media bucket
  -- array of {width, path, format}; path is inside the bucket
  variants      jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(variants) = 'array'),
  width         integer     CHECK (width  IS NULL OR width  > 0),
  height        integer     CHECK (height IS NULL OR height > 0),
  alt_text      text        NOT NULL CHECK (btrim(alt_text) <> ''),
  credit        text        NOT NULL CHECK (btrim(credit)   <> ''),
  caption       text,
  source_url    text,
  focal_x       numeric     NOT NULL DEFAULT 0.5 CHECK (focal_x BETWEEN 0 AND 1),
  focal_y       numeric     NOT NULL DEFAULT 0.5 CHECK (focal_y BETWEEN 0 AND 1),
  tags          text[]      NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        DEFAULT auth.uid(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_media_storage_path_key UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS study_media_tags_idx ON public.study_media USING gin (tags);

-- ────────────────────────────────────────────────────────────────────────
-- 3. Image references + card fields (before media_is_public, which reads them)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.study_companies
  ADD COLUMN IF NOT EXISTS hero_image_id     uuid REFERENCES public.study_media (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS card_image_id     uuid REFERENCES public.study_media (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS logo_image_id     uuid REFERENCES public.study_media (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS label             text DEFAULT 'Company Study',
  ADD COLUMN IF NOT EXISTS read_time_minutes integer,      -- NULL = app computes it
  ADD COLUMN IF NOT EXISTS card_title        text,         -- NULL = falls back to headline
  ADD COLUMN IF NOT EXISTS card_summary      text;         -- NULL = falls back to summary
-- hero_image_url / logo_url are kept for now (deprecated; components render
-- images only from study_media, which guarantees alt text and credit).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'study_companies_read_time_check'
                   AND conrelid = 'public.study_companies'::regclass) THEN
    ALTER TABLE public.study_companies
      ADD CONSTRAINT study_companies_read_time_check
      CHECK (read_time_minutes IS NULL OR read_time_minutes BETWEEN 1 AND 600);
  END IF;
END $$;

ALTER TABLE public.study_founders
  ADD COLUMN IF NOT EXISTS image_id uuid REFERENCES public.study_media (id) ON DELETE SET NULL;
ALTER TABLE public.study_products
  ADD COLUMN IF NOT EXISTS image_id uuid REFERENCES public.study_media (id) ON DELETE SET NULL;
ALTER TABLE public.study_timeline
  ADD COLUMN IF NOT EXISTS image_id uuid REFERENCES public.study_media (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS study_companies_hero_image_id_idx ON public.study_companies (hero_image_id);
CREATE INDEX IF NOT EXISTS study_companies_card_image_id_idx ON public.study_companies (card_image_id);
CREATE INDEX IF NOT EXISTS study_companies_logo_image_id_idx ON public.study_companies (logo_image_id);
CREATE INDEX IF NOT EXISTS study_founders_image_id_idx       ON public.study_founders (image_id);
CREATE INDEX IF NOT EXISTS study_products_image_id_idx       ON public.study_products (image_id);
CREATE INDEX IF NOT EXISTS study_timeline_image_id_idx       ON public.study_timeline (image_id);

-- ────────────────────────────────────────────────────────────────────────
-- 4. Series
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.study_series (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL,
  name        text        NOT NULL,
  description text,
  icon_key    text,
  image_id    uuid        REFERENCES public.study_media (id) ON DELETE SET NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_series_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS public.study_company_series (
  study_company_id uuid        NOT NULL REFERENCES public.study_companies (id) ON DELETE CASCADE,
  series_id        uuid        NOT NULL REFERENCES public.study_series (id)    ON DELETE CASCADE,
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (study_company_id, series_id)
);

CREATE INDEX IF NOT EXISTS study_series_image_id_idx         ON public.study_series (image_id);
CREATE INDEX IF NOT EXISTS study_series_active_idx           ON public.study_series (is_active, sort_order);
-- PK covers study_company_id; series_id needs its own index.
CREATE INDEX IF NOT EXISTS study_company_series_series_id_idx ON public.study_company_series (series_id, sort_order);

-- ────────────────────────────────────────────────────────────────────────
-- 5. site_content
-- ────────────────────────────────────────────────────────────────────────
-- value       = the live, published value (what the public site renders)
-- draft_value = pending edits from admin; copied into value on publish
-- status      = 'published' once value is live; a 'draft' row is never public
CREATE TABLE IF NOT EXISTS public.site_content (
  key         text        PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  value       jsonb       NOT NULL,
  status      text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  draft_value jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        DEFAULT auth.uid()
);

-- ────────────────────────────────────────────────────────────────────────
-- 6. site_updates
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_updates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL CHECK (btrim(title) <> ''),
  body             text,
  study_company_id uuid        REFERENCES public.study_companies (id) ON DELETE SET NULL,
  icon_key         text,
  link_href        text,
  published_at     timestamptz,                -- NULL = not scheduled
  is_active        boolean     NOT NULL DEFAULT true,
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_updates_study_company_id_idx ON public.site_updates (study_company_id);
CREATE INDEX IF NOT EXISTS site_updates_live_idx             ON public.site_updates (is_active, published_at DESC);

-- ────────────────────────────────────────────────────────────────────────
-- Triggers: updated_at (shared function from v3) + site_content.updated_by
-- ────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['study_media','study_series','site_content','site_updates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at_trg', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.study_set_updated_at()',
      t || '_updated_at_trg', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.site_content_set_updated_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- auth.uid() is NULL from the SQL editor / service role; keep the old value then.
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_content_updated_by_trg ON public.site_content;
CREATE TRIGGER site_content_updated_by_trg
  BEFORE INSERT OR UPDATE ON public.site_content
  FOR EACH ROW EXECUTE FUNCTION public.site_content_set_updated_by();

-- ────────────────────────────────────────────────────────────────────────
-- Helpers (SECURITY DEFINER, fixed search_path)
-- ────────────────────────────────────────────────────────────────────────

-- True when the media row is used by anything public:
--   a published study (hero / card / logo, founders, products, timeline),
--   an active series, or any PUBLISHED site_content value (searched
--   recursively, so any key holding the id as a string counts).
CREATE OR REPLACE FUNCTION public.media_is_public(p_media_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
       EXISTS (SELECT 1 FROM public.study_companies c
               WHERE c.status = 'published'
                 AND p_media_id IN (c.hero_image_id, c.card_image_id, c.logo_image_id))
    OR EXISTS (SELECT 1 FROM public.study_founders f
               JOIN public.study_companies c ON c.id = f.study_company_id
               WHERE f.image_id = p_media_id AND c.status = 'published')
    OR EXISTS (SELECT 1 FROM public.study_products p
               JOIN public.study_companies c ON c.id = p.study_company_id
               WHERE p.image_id = p_media_id AND c.status = 'published')
    OR EXISTS (SELECT 1 FROM public.study_timeline t
               JOIN public.study_companies c ON c.id = t.study_company_id
               WHERE t.image_id = p_media_id AND c.status = 'published')
    OR EXISTS (SELECT 1 FROM public.study_series s
               WHERE s.image_id = p_media_id AND s.is_active)
    OR EXISTS (SELECT 1 FROM public.site_content sc
               WHERE sc.status = 'published'
                 AND jsonb_path_exists(sc.value, '$.** ? (@ == $id)',
                                       jsonb_build_object('id', p_media_id::text)));
$$;
REVOKE EXECUTE ON FUNCTION public.media_is_public(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.media_is_public(uuid) TO anon, authenticated;

-- Published site content for the public site / static prerender.
-- A function rather than a view: the table itself is admin-only (so
-- draft_value never leaks), and a SECURITY DEFINER view would trip the
-- Supabase linter. Call with NULL for every key, or a list of keys.
--   supabase.rpc('site_content_published', { p_keys: ['home.hero','site.nav'] })
CREATE OR REPLACE FUNCTION public.site_content_published(p_keys text[] DEFAULT NULL)
RETURNS TABLE (key text, value jsonb, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sc.key, sc.value, sc.updated_at
  FROM public.site_content sc
  WHERE sc.status = 'published'
    AND (p_keys IS NULL OR sc.key = ANY (p_keys))
  ORDER BY sc.key;
$$;
REVOKE EXECUTE ON FUNCTION public.site_content_published(text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.site_content_published(text[]) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────
-- Admin policies are TO authenticated because is_admin() is granted to
-- authenticated only.

ALTER TABLE public.study_media          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_series         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_company_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_content         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_updates         ENABLE ROW LEVEL SECURITY;

-- study_media
DROP POLICY IF EXISTS study_media_public_read ON public.study_media;
CREATE POLICY study_media_public_read ON public.study_media
  FOR SELECT TO anon, authenticated USING (public.media_is_public(id));
DROP POLICY IF EXISTS study_media_admin_all ON public.study_media;
CREATE POLICY study_media_admin_all ON public.study_media
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- study_series: active series are public
DROP POLICY IF EXISTS study_series_public_read ON public.study_series;
CREATE POLICY study_series_public_read ON public.study_series
  FOR SELECT TO anon, authenticated USING (is_active);
DROP POLICY IF EXISTS study_series_admin_all ON public.study_series;
CREATE POLICY study_series_admin_all ON public.study_series
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- study_company_series: public when the series is active AND the study is published
-- (otherwise the link table would reveal unpublished studies).
DROP POLICY IF EXISTS study_company_series_public_read ON public.study_company_series;
CREATE POLICY study_company_series_public_read ON public.study_company_series
  FOR SELECT TO anon, authenticated
  USING (public.study_is_public(study_company_id)
         AND EXISTS (SELECT 1 FROM public.study_series s WHERE s.id = series_id AND s.is_active));
DROP POLICY IF EXISTS study_company_series_admin_all ON public.study_company_series;
CREATE POLICY study_company_series_admin_all ON public.study_company_series
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- site_content: table is admin-only (draft_value must not leak).
-- Public reads go through site_content_published().
DROP POLICY IF EXISTS site_content_admin_all ON public.site_content;
CREATE POLICY site_content_admin_all ON public.site_content
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- site_updates: live rows only; a row tied to a study also needs that study published.
DROP POLICY IF EXISTS site_updates_public_read ON public.site_updates;
CREATE POLICY site_updates_public_read ON public.site_updates
  FOR SELECT TO anon, authenticated
  USING (is_active
         AND published_at IS NOT NULL
         AND published_at <= now()
         AND (study_company_id IS NULL OR public.study_is_public(study_company_id)));
DROP POLICY IF EXISTS site_updates_admin_all ON public.site_updates;
CREATE POLICY site_updates_admin_all ON public.site_updates
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ────────────────────────────────────────────────────────────────────────
-- 2. Storage bucket + policies
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('study-media', 'study-media', true, 5242880,
        ARRAY['image/webp','image/avif','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS study_media_objects_public_read ON storage.objects;
CREATE POLICY study_media_objects_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'study-media');

DROP POLICY IF EXISTS study_media_objects_admin_insert ON storage.objects;
CREATE POLICY study_media_objects_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'study-media' AND public.is_admin());

DROP POLICY IF EXISTS study_media_objects_admin_update ON storage.objects;
CREATE POLICY study_media_objects_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'study-media' AND public.is_admin())
  WITH CHECK (bucket_id = 'study-media' AND public.is_admin());

DROP POLICY IF EXISTS study_media_objects_admin_delete ON storage.objects;
CREATE POLICY study_media_objects_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'study-media' AND public.is_admin());

-- ────────────────────────────────────────────────────────────────────────
-- 7. home_whats_new view
-- ────────────────────────────────────────────────────────────────────────
-- Newest first, 10 rows. kind = 'update' | 'period_note' | 'development'.
-- security_invoker: the caller's RLS applies to every source table as
-- well as the explicit published filters below.
CREATE OR REPLACE VIEW public.home_whats_new
WITH (security_invoker = true) AS
SELECT kind, id, title, date, study_slug, study_name, icon_key, link_href
FROM (
  SELECT 'update'::text           AS kind,
         u.id,
         u.title,
         u.published_at::date     AS date,
         c.slug                   AS study_slug,
         c.name                   AS study_name,
         u.icon_key,
         u.link_href,
         u.published_at           AS sort_ts
  FROM public.site_updates u
  LEFT JOIN public.study_companies c ON c.id = u.study_company_id
  WHERE u.is_active
    AND u.published_at IS NOT NULL
    AND u.published_at <= now()
    AND (u.study_company_id IS NULL OR c.status = 'published')

  UNION ALL

  -- Title is the period label (e.g. 'Q2 FY27'); the UI adds wording via site_content.
  SELECT 'period_note',
         n.id,
         coalesce(nullif(btrim(n.fiscal_label), ''), to_char(n.period_end, 'Mon YYYY')),
         n.created_at::date,
         c.slug,
         c.name,
         NULL::text,
         NULL::text,
         n.created_at
  FROM public.study_period_notes n
  JOIN public.study_companies c ON c.id = n.study_company_id
  WHERE c.status = 'published'

  UNION ALL

  SELECT 'development',
         d.id,
         d.title,
         coalesce(d.event_date, d.created_at::date),
         c.slug,
         c.name,
         NULL::text,
         NULL::text,
         coalesce(d.event_date::timestamptz, d.created_at)
  FROM public.study_developments d
  JOIN public.study_companies c ON c.id = d.study_company_id
  WHERE c.status = 'published'
) x
ORDER BY sort_ts DESC NULLS LAST, id
LIMIT 10;

GRANT SELECT ON public.home_whats_new TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 5b. Seed site_content (placeholders, published). Never overwrites.
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO public.site_content (key, value, status) VALUES
  ('site.brand', jsonb_build_object(
      'name', 'PineX',
      'tagline', 'Carefully researched company studies, built from filings.'), 'published'),

  ('site.nav', jsonb_build_array(
      jsonb_build_object('label', 'Studies',  'href', '/company',      'visible', true),
      jsonb_build_object('label', 'Series',   'href', '/series',       'visible', true),
      jsonb_build_object('label', 'Screener', 'href', '/quickscanner', 'visible', true),
      jsonb_build_object('label', 'About',    'href', '/about',        'visible', true)), 'published'),

  ('home.hero', jsonb_build_object(
      'study_company_id',  NULL,
      'eyebrow',           'Featured study',
      'headline_override', NULL,
      'intro_override',    NULL,
      'cta_label',         'Read the study',
      'image_id',          NULL), 'published'),

  ('home.value_props', jsonb_build_array(
      jsonb_build_object('title', 'Built from filings',   'text', 'Every figure links back to the document it came from.',          'icon_key', 'document'),
      jsonb_build_object('title', 'History kept',         'text', 'Each quarter is added, never overwritten, so changes stay visible.', 'icon_key', 'layers'),
      jsonb_build_object('title', 'Ownership, both ways', 'text', 'Increases and decreases in disclosed holdings, side by side.',      'icon_key', 'people'),
      jsonb_build_object('title', 'Reviewed and dated',   'text', 'Every study shows when it was last reviewed.',                       'icon_key', 'clock')), 'published'),

  ('home.sections', jsonb_build_object(
      'latest_studies', jsonb_build_object('title', 'Latest studies', 'visible', true),
      'whats_new',      jsonb_build_object('title', 'What''s new',    'visible', true),
      'popular_series', jsonb_build_object('title', 'Popular series', 'visible', true)), 'published'),

  ('site.labels', jsonb_build_object(
      'min_read',          '{n} min read',
      'updated',           'Updated',
      'kind_update',       'Update',
      'kind_period_note',  'Results note',
      'kind_development',  'Development',
      'studies_in_series', '{n} studies'), 'published'),

  -- Section titles on every study page (StudyPage `sectionTitles` prop).
  ('study.sections', jsonb_build_object(
      'contents',          'Contents',
      'story',             'The story',
      'founders',          'The people',
      'timeline',          'Timeline',
      'products',          'Products',
      'market',            'Market',
      'latest-quarter',    'Latest quarter',
      'financial-history', 'Financial history',
      'segments',          'Segments',
      'shareholding',      'Shareholding',
      'ownership-changes', 'Ownership changes',
      'developments',      'Developments',
      'then-now-next',     'Then, now, next',
      'risks',             'Risks',
      'watching',          'What we''re watching',
      'central-question',  'The central question',
      'sources',           'Sources'), 'published'),

  ('site.footer', jsonb_build_object(
      'text',  'PineX Research publishes company studies for information and education.',
      'links', jsonb_build_array(
                 jsonb_build_object('label', 'About',      'href', '/about'),
                 jsonb_build_object('label', 'Disclaimer', 'href', '/disclaimer'),
                 jsonb_build_object('label', 'Privacy',    'href', '/privacy'),
                 jsonb_build_object('label', 'Terms',      'href', '/terms'))), 'published'),

  ('site.disclaimer', jsonb_build_object(
      'text', 'For information and education only. Not investment advice. PineX Research is not registered as an investment adviser or research analyst. Verify independently against the original filings.'), 'published')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- Smoke test (run separately; read-only)
-- ════════════════════════════════════════════════════════════════════════
-- SELECT * FROM public.site_content_published(NULL);
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'study-media';
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'study_media%';
-- SELECT * FROM public.home_whats_new;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (commented out). Removes everything this file created.
-- The storage bucket can only be deleted once it is empty — empty it from
-- the dashboard (Storage → study-media) first.
-- ════════════════════════════════════════════════════════════════════════
-- BEGIN;
--
-- DROP VIEW IF EXISTS public.home_whats_new;
--
-- DROP POLICY IF EXISTS study_media_objects_public_read  ON storage.objects;
-- DROP POLICY IF EXISTS study_media_objects_admin_insert ON storage.objects;
-- DROP POLICY IF EXISTS study_media_objects_admin_update ON storage.objects;
-- DROP POLICY IF EXISTS study_media_objects_admin_delete ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'study-media';   -- fails if not empty
--
-- DROP TABLE IF EXISTS public.site_updates          CASCADE;
-- DROP TABLE IF EXISTS public.site_content          CASCADE;
-- DROP TABLE IF EXISTS public.study_company_series  CASCADE;
-- DROP TABLE IF EXISTS public.study_series          CASCADE;
--
-- ALTER TABLE public.study_timeline  DROP COLUMN IF EXISTS image_id;
-- ALTER TABLE public.study_products  DROP COLUMN IF EXISTS image_id;
-- ALTER TABLE public.study_founders  DROP COLUMN IF EXISTS image_id;
-- ALTER TABLE public.study_companies DROP CONSTRAINT IF EXISTS study_companies_read_time_check;
-- ALTER TABLE public.study_companies
--   DROP COLUMN IF EXISTS hero_image_id,
--   DROP COLUMN IF EXISTS card_image_id,
--   DROP COLUMN IF EXISTS logo_image_id,
--   DROP COLUMN IF EXISTS label,
--   DROP COLUMN IF EXISTS read_time_minutes,
--   DROP COLUMN IF EXISTS card_title,
--   DROP COLUMN IF EXISTS card_summary;
--
-- DROP TABLE IF EXISTS public.study_media CASCADE;
--
-- DROP FUNCTION IF EXISTS public.site_content_published(text[]);
-- DROP FUNCTION IF EXISTS public.media_is_public(uuid);
-- DROP FUNCTION IF EXISTS public.site_content_set_updated_by();
--
-- COMMIT;
