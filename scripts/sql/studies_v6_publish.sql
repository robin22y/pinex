-- ════════════════════════════════════════════════════════════════════════
-- PineX Company Studies — v6: publish bookkeeping (Phase 5)
--
-- Run AFTER v3, v4 and v5. Additive only.
--
-- 1. study_companies.last_built_at — set by netlify/functions/admin-publish-study.js
--    when it fires the Netlify build hook for that study. Until this runs, the
--    function still works and says the timestamp could not be stored.
--
-- The build-hook debounce timestamp lives in site_content under the key
-- 'system.last_build_hook' (no schema change needed; the function upserts it
-- with the service key).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.study_companies
  ADD COLUMN IF NOT EXISTS last_built_at timestamptz;

COMMENT ON COLUMN public.study_companies.last_built_at IS
  'When admin-publish-study last fired the Netlify build hook for this study (publish / unpublish / archive / rebuild).';

COMMIT;

-- ROLLBACK:
--   ALTER TABLE public.study_companies DROP COLUMN IF EXISTS last_built_at;
