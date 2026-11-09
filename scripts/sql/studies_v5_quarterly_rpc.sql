-- ════════════════════════════════════════════════════════════════════════
-- PineX Company Studies — v5: one-transaction period update (Phase 4b)
--
-- Run AFTER studies_v3_standalone.sql and studies_v4_site_content.sql.
-- Creates ONE function; touches no table, policy or existing function.
--
-- public.study_save_period_update(p_study_company_id uuid, p jsonb) → jsonb
--
-- Used by the admin Quarterly update wizard and by the Segments /
-- Shareholding "Add period" forms. A plpgsql function body runs inside a
-- single transaction: if any insert fails (bad number, check constraint,
-- RLS), everything it did is rolled back — no partial quarter remains.
--
-- SECURITY INVOKER: it runs with the caller's rights, so the existing
-- is_admin() RLS policies still decide what may be written. It also checks
-- is_admin() up front for a clear error message.
--
-- Period rows are append-only: when a row for the same key already exists,
-- a new row with revision = max(revision) + 1 is inserted (a correction);
-- nothing is ever UPDATEd. study_period_notes is not a revisioned table
-- (unique on study_company_id, period_end), so its note is upserted.
--
-- Payload p (every section optional except period_end):
-- {
--   "period_end": "2026-09-30",            -- required
--   "period_type": "Q",                    -- Q | H | FY (default Q)
--   "fiscal_label": "Q2 FY27",
--   "basis": "consolidated",               -- default consolidated
--   "currency": "INR", "unit": "crore",    -- default: the study's reporting_*
--   "source_id": "<uuid>",                 -- an existing source of this study
--   "new_source": { "kind", "title", "publisher", "url", "document_date", "page" },
--   "require_source": true,                -- error if no source resolved
--   "financials": { "revenue", "ebitda", "pat", "eps", "other_income",
--                   "total_debt", "cash", "cfo", "capex" },
--   "segments": [ { "segment_name", "revenue", "ebit" } ],
--   "shareholding_period_end": "2026-09-30",   -- default period_end
--   "shareholding": [ { "category", "pct", "pledged_pct" } ],
--   "ownership": [ { "holder_name", "holder_type", "period_from", "period_to",
--                    "pct_from", "pct_to", "profile" } ],
--   "note_md": "…",                        -- study_period_notes.what_changed_md
--   "developments": [ { "event_date", "title", "body", "category" } ],
--   "mark_reviewed": true
-- }
-- Returns { source_id, financials, segments, shareholding, ownership,
--           note, developments, reviewed, revisions: { financials, … } }.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.study_save_period_update(p_study_company_id uuid, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_company   public.study_companies%ROWTYPE;
  v_end       date    := nullif(p ->> 'period_end', '')::date;
  v_type      text    := coalesce(nullif(p ->> 'period_type', ''), 'Q');
  v_basis     text    := coalesce(nullif(p ->> 'basis', ''), 'consolidated');
  v_label     text    := nullif(btrim(p ->> 'fiscal_label'), '');
  v_source    uuid    := nullif(p ->> 'source_id', '')::uuid;
  v_sh_end    date;
  v_currency  text;
  v_unit      text;
  v_fin       jsonb   := p -> 'financials';
  v_ns        jsonb   := p -> 'new_source';
  v_rev       integer;
  v_sort      integer;
  r           jsonb;
  n_fin int := 0; n_seg int := 0; n_sh int := 0; n_own int := 0; n_dev int := 0; n_note int := 0;
  rev_fin int; rev_seg int := 0; rev_sh int := 0;
  v_reviewed  boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_company FROM public.study_companies WHERE id = p_study_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study % not found', p_study_company_id USING ERRCODE = 'P0002';
  END IF;
  IF v_end IS NULL THEN
    RAISE EXCEPTION 'period_end is required' USING ERRCODE = '23502';
  END IF;

  v_sh_end   := coalesce(nullif(p ->> 'shareholding_period_end', '')::date, v_end);
  v_currency := coalesce(nullif(p ->> 'currency', ''), v_company.reporting_currency);
  v_unit     := coalesce(nullif(p ->> 'unit', ''), v_company.reporting_unit);

  -- ── Source: new filing, or an existing source of THIS study ──
  IF jsonb_typeof(v_ns) = 'object' AND nullif(btrim(v_ns ->> 'title'), '') IS NOT NULL THEN
    SELECT coalesce(max(sort_order), 0) + 1 INTO v_sort
      FROM public.study_sources WHERE study_company_id = p_study_company_id;
    INSERT INTO public.study_sources
      (study_company_id, sort_order, kind, title, publisher, url, document_date, page)
    VALUES
      (p_study_company_id, v_sort,
       coalesce(nullif(v_ns ->> 'kind', ''), 'quarterly_result'),
       btrim(v_ns ->> 'title'),
       nullif(btrim(v_ns ->> 'publisher'), ''),
       nullif(btrim(v_ns ->> 'url'), ''),
       nullif(v_ns ->> 'document_date', '')::date,
       nullif(btrim(v_ns ->> 'page'), ''))
    RETURNING id INTO v_source;
  ELSIF v_source IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.study_sources
          WHERE id = v_source AND study_company_id = p_study_company_id) THEN
    RAISE EXCEPTION 'The chosen source does not belong to this study' USING ERRCODE = '23503';
  END IF;
  IF coalesce((p ->> 'require_source')::boolean, false) AND v_source IS NULL THEN
    RAISE EXCEPTION 'A source (the results filing) is required' USING ERRCODE = '23502';
  END IF;

  -- ── Financials: one row, next revision for its key ──
  IF jsonb_typeof(v_fin) = 'object' THEN
    SELECT coalesce(max(revision), 0) + 1 INTO rev_fin
      FROM public.study_financial_periods
     WHERE study_company_id = p_study_company_id AND period_end = v_end
       AND period_type = v_type AND basis = v_basis;
    INSERT INTO public.study_financial_periods
      (study_company_id, period_end, period_type, fiscal_label, basis,
       revenue, ebitda, pat, eps, other_income, total_debt, cash, cfo, capex,
       currency, unit, source_id, revision)
    VALUES
      (p_study_company_id, v_end, v_type, v_label, v_basis,
       (v_fin ->> 'revenue')::numeric, (v_fin ->> 'ebitda')::numeric, (v_fin ->> 'pat')::numeric,
       (v_fin ->> 'eps')::numeric, (v_fin ->> 'other_income')::numeric, (v_fin ->> 'total_debt')::numeric,
       (v_fin ->> 'cash')::numeric, (v_fin ->> 'cfo')::numeric, (v_fin ->> 'capex')::numeric,
       v_currency, v_unit, v_source, rev_fin);
    n_fin := 1;
  END IF;

  -- ── Segments ──
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'segments', '[]'::jsonb)) LOOP
    CONTINUE WHEN nullif(btrim(r ->> 'segment_name'), '') IS NULL;
    CONTINUE WHEN nullif(r ->> 'revenue', '') IS NULL AND nullif(r ->> 'ebit', '') IS NULL;
    SELECT coalesce(max(revision), 0) + 1 INTO v_rev
      FROM public.study_segment_periods
     WHERE study_company_id = p_study_company_id AND period_end = v_end AND period_type = v_type
       AND basis = v_basis AND segment_name = btrim(r ->> 'segment_name');
    INSERT INTO public.study_segment_periods
      (study_company_id, sort_order, period_end, period_type, basis, segment_name,
       revenue, ebit, currency, unit, source_id, revision)
    VALUES
      (p_study_company_id, n_seg + 1, v_end, v_type, v_basis, btrim(r ->> 'segment_name'),
       (r ->> 'revenue')::numeric, (r ->> 'ebit')::numeric, v_currency, v_unit, v_source, v_rev);
    n_seg := n_seg + 1;
    rev_seg := greatest(rev_seg, v_rev);
  END LOOP;

  -- ── Shareholding (long format, one row per category) ──
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'shareholding', '[]'::jsonb)) LOOP
    CONTINUE WHEN nullif(r ->> 'category', '') IS NULL;
    CONTINUE WHEN nullif(r ->> 'pct', '') IS NULL AND nullif(r ->> 'pledged_pct', '') IS NULL;
    SELECT coalesce(max(revision), 0) + 1 INTO v_rev
      FROM public.study_shareholding
     WHERE study_company_id = p_study_company_id AND period_end = v_sh_end AND category = r ->> 'category';
    INSERT INTO public.study_shareholding
      (study_company_id, sort_order, period_end, category, pct, pledged_pct, source_id, revision)
    VALUES
      (p_study_company_id, n_sh + 1, v_sh_end, r ->> 'category',
       (r ->> 'pct')::numeric, (r ->> 'pledged_pct')::numeric, v_source, v_rev);
    n_sh := n_sh + 1;
    rev_sh := greatest(rev_sh, v_rev);
  END LOOP;

  -- ── Ownership changes (not revisioned; plain rows) ──
  SELECT coalesce(max(sort_order), 0) INTO v_sort
    FROM public.study_ownership_changes WHERE study_company_id = p_study_company_id;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'ownership', '[]'::jsonb)) LOOP
    CONTINUE WHEN nullif(btrim(r ->> 'holder_name'), '') IS NULL;
    v_sort := v_sort + 1;
    INSERT INTO public.study_ownership_changes
      (study_company_id, sort_order, period_from, period_to, holder_name, holder_type,
       pct_from, pct_to, profile, source_id)
    VALUES
      (p_study_company_id, v_sort,
       (r ->> 'period_from')::date,
       coalesce(nullif(r ->> 'period_to', '')::date, v_sh_end),
       btrim(r ->> 'holder_name'),
       nullif(r ->> 'holder_type', ''),
       (r ->> 'pct_from')::numeric, (r ->> 'pct_to')::numeric,
       nullif(btrim(r ->> 'profile'), ''),
       coalesce(nullif(r ->> 'source_id', '')::uuid, v_source));
    n_own := n_own + 1;
  END LOOP;

  -- ── What changed (one note per period; upsert) ──
  IF nullif(btrim(p ->> 'note_md'), '') IS NOT NULL THEN
    INSERT INTO public.study_period_notes (study_company_id, period_end, fiscal_label, what_changed_md)
    VALUES (p_study_company_id, v_end, v_label, p ->> 'note_md')
    ON CONFLICT ON CONSTRAINT study_period_notes_key DO UPDATE
      SET what_changed_md = EXCLUDED.what_changed_md,
          fiscal_label    = coalesce(EXCLUDED.fiscal_label, public.study_period_notes.fiscal_label);
    n_note := 1;
  END IF;

  -- ── Developments ──
  SELECT coalesce(max(sort_order), 0) INTO v_sort
    FROM public.study_developments WHERE study_company_id = p_study_company_id;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'developments', '[]'::jsonb)) LOOP
    CONTINUE WHEN nullif(btrim(r ->> 'title'), '') IS NULL;
    v_sort := v_sort + 1;
    INSERT INTO public.study_developments
      (study_company_id, sort_order, event_date, title, body, category, source_id)
    VALUES
      (p_study_company_id, v_sort,
       nullif(r ->> 'event_date', '')::date,
       btrim(r ->> 'title'),
       nullif(btrim(r ->> 'body'), ''),
       coalesce(nullif(r ->> 'category', ''), 'other'),
       coalesce(nullif(r ->> 'source_id', '')::uuid, v_source));
    n_dev := n_dev + 1;
  END LOOP;

  -- ── Mark reviewed ──
  IF coalesce((p ->> 'mark_reviewed')::boolean, false) THEN
    UPDATE public.study_companies SET reviewed_at = now() WHERE id = p_study_company_id;
    v_reviewed := true;
  END IF;

  RETURN jsonb_build_object(
    'source_id',    v_source,
    'financials',   n_fin,
    'segments',     n_seg,
    'shareholding', n_sh,
    'ownership',    n_own,
    'note',         n_note,
    'developments', n_dev,
    'reviewed',     v_reviewed,
    'revisions',    jsonb_build_object('financials', rev_fin, 'segments', nullif(rev_seg, 0),
                                       'shareholding', nullif(rev_sh, 0))
  );
END;
$$;

COMMENT ON FUNCTION public.study_save_period_update(uuid, jsonb) IS
  'Admin: write one period (financials, segments, shareholding, ownership changes, note, developments) in a single transaction. Append-only: existing keys get revision+1.';

REVOKE EXECUTE ON FUNCTION public.study_save_period_update(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.study_save_period_update(uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.study_save_period_update(uuid, jsonb) TO authenticated;

COMMIT;

-- Optional smoke test (as an admin, in a scratch study you can delete):
--   SELECT public.study_save_period_update('<study id>', '{"period_end":"2026-09-30","financials":{"revenue":1}}');
--
-- ROLLBACK (removes only this function):
--   DROP FUNCTION IF EXISTS public.study_save_period_update(uuid, jsonb);
