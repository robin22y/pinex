-- earnings_intelligence — one row per analysed earnings transcript.
--
-- Written by the /iqjet-desk Earnings Intelligence panel. Each row
-- represents one Gemini analysis of one transcript Robin uploaded.
-- The transcript text itself is NOT stored — only the structured
-- analysis output. Transcripts can be hundreds of KB and would bloat
-- the table; if Robin wants to re-analyse the same call, he uploads
-- the file again.
--
-- RLS-enabled with no public policies — only the admin (via the
-- frontend's authenticated supabase client) reads/writes, gated by
-- a policy keyed off auth.users.email = robin22y@gmail.com.
--
-- Idempotent. Safe to re-apply.

CREATE TABLE IF NOT EXISTS public.earnings_intelligence (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
    symbol              text        NOT NULL,
    call_date           date        NOT NULL,
    transcript_length   integer,
    tone                text        NOT NULL,
    confidence_score    numeric,
    hedging_count       integer,
    evasion_count       integer,
    guidance_specific   boolean,
    verdict             text,
    key_phrases         jsonb       DEFAULT '[]'::jsonb,
    red_flags           jsonb       DEFAULT '[]'::jsonb,
    summary             text,
    created_by_email    text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- One analysis per (symbol, call_date) — re-running overwrites.
CREATE UNIQUE INDEX IF NOT EXISTS uq_earnings_intelligence_symbol_date
    ON public.earnings_intelligence (symbol, call_date);

CREATE INDEX IF NOT EXISTS idx_earnings_intelligence_company_id
    ON public.earnings_intelligence (company_id);

CREATE INDEX IF NOT EXISTS idx_earnings_intelligence_call_date
    ON public.earnings_intelligence (call_date DESC);

ALTER TABLE public.earnings_intelligence ENABLE ROW LEVEL SECURITY;

-- Admin-only access. Same email allow-list the page itself enforces.
DROP POLICY IF EXISTS earnings_intel_admin_select ON public.earnings_intelligence;
CREATE POLICY earnings_intel_admin_select
    ON public.earnings_intelligence
    FOR SELECT
    TO authenticated
    USING (auth.jwt() ->> 'email' = 'robin22y@gmail.com');

DROP POLICY IF EXISTS earnings_intel_admin_write ON public.earnings_intelligence;
CREATE POLICY earnings_intel_admin_write
    ON public.earnings_intelligence
    FOR ALL
    TO authenticated
    USING      (auth.jwt() ->> 'email' = 'robin22y@gmail.com')
    WITH CHECK (auth.jwt() ->> 'email' = 'robin22y@gmail.com');


-- Verification
SELECT 'earnings_intelligence table missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'earnings_intelligence'
);
