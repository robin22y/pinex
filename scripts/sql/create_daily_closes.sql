-- ════════════════════════════════════════════════════════════════════════
-- create_daily_closes.sql
--
-- A narrow closing-price history table, separate from price_data.
--
-- WHY A SEPARATE TABLE
--   price_data carries ~40 columns per row (OHLC, volume, delivery, every
--   indicator). Extending its history to ~220 sessions to satisfy the
--   200-day moving average would multiply all of that. daily_closes stores
--   only what a moving average actually consumes — one company, one date,
--   one close — so the same depth of history costs a fraction of the space.
--
--   price_data is untouched by this and by the backfill that fills this
--   table. Nothing here writes to it, and no existing pipeline step reads
--   from here.
--
-- SIZE
--   Three columns: uuid (16 B) + date (4 B) + numeric (~8-10 B), plus ~24 B
--   row header and the PK/index entries. Roughly 90-110 B per row all-in.
--   ~2,125 companies x ~220 sessions ~ 467k rows ~ 45 MB with both indexes.
--
-- COLUMN TYPES
--   company_id is uuid to match price_data.company_id and companies.id, so
--   the FK is a straight match with no casting at join time.
--
-- ON DELETE CASCADE
--   A delisted company removed from `companies` takes its closes with it
--   rather than leaving orphans that no join will ever reach.
--
-- APPLY ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.daily_closes (
  company_id uuid    NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  date       date    NOT NULL,
  close      numeric NOT NULL,
  PRIMARY KEY (company_id, date)
);

-- The PK already covers (company_id, date) ascending. This descending
-- variant is what a moving-average read actually wants: "the last N closes
-- for one company", which is an index-order scan with no sort step.
CREATE INDEX IF NOT EXISTS idx_daily_closes_company_date_desc
  ON public.daily_closes (company_id, date DESC);

COMMENT ON TABLE public.daily_closes IS
  'Closing prices only, kept deeper than price_data so long moving averages '
  '(150-day, 200-day) can be computed without carrying OHLCV and indicator '
  'columns at that depth. Written by scripts/backfill_daily_closes.py. '
  'price_data remains the source of truth for everything else.';

-- ── Verification ────────────────────────────────────────────────────
-- Zero rows immediately after creating the table. Run again after
-- scripts/backfill_daily_closes.py completes: expect ~2,125 companies and
-- roughly 2,125 x 220 rows, less for recent listings with shorter history.
SELECT
  count(DISTINCT company_id) AS companies,
  count(*)                   AS total_rows,
  min(date)                  AS oldest,
  max(date)                  AS newest
FROM public.daily_closes;
