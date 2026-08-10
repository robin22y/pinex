-- ════════════════════════════════════════════════════════════════════════
-- create_validation_baseline.sql
--
-- The reference dma_200 per company that check 5 of the publish gate
-- (scripts/validate_static_data.py) compares each run against.
--
-- WHY THIS IS A TABLE AND NOT A FILE
--   It used to live in scripts/.validation_state.json, gitignored and
--   described as "per-machine runtime state". That framing was the bug.
--   The baseline describes THE DATABASE, and there is exactly one database
--   — so a per-machine copy is not state, it is a fork.
--
--   The practical consequence: the gate runs in GitHub Actions on a fresh
--   ubuntu-latest checkout, where a gitignored file cannot exist. Check 5
--   therefore reported "no baseline found - first run" on every single CI
--   run it ever made, and compared nothing. It only ever worked on a
--   developer laptop, where it silently diverged from what CI would have
--   seen. Storing the baseline beside the data it describes gives local and
--   CI one shared reference and deletes the divergence rather than papering
--   over it.
--
-- WHY dma_200 AND NOTHING ELSE
--   The 200-day average is the slowest-moving number the screener
--   publishes. A legitimate session moves it a fraction of a percent, so a
--   >5% jump is close to proof that history was rewritten underneath it —
--   a corporate action, a backfill, or a bad ingest. The faster averages
--   move enough on their own to need a wider tolerance, which would blunt
--   exactly the signal this exists to catch.
--
-- written_at IS PER ROW, NOT PER TABLE
--   Every row of a given write carries the same timestamp, so max(written_at)
--   is the baseline's age. A baseline that quietly stops updating is the
--   same silent failure as one that never existed, just slower, and the
--   gate now alerts when the newest row is older than three trading days.
--   A separate metadata table would be a second thing to keep in step for
--   no gain at this size.
--
-- SIZE
--   uuid (16 B) + float8 (8 B) + timestamptz (8 B) + ~24 B row header, one
--   row per company with a dma_200 — about 1,800 rows, well under 1 MB.
--   Rewritten wholesale each clean run.
--
-- ON DELETE CASCADE
--   A delisted company drops out of the baseline with its other rows,
--   rather than leaving a reference no join will reach.
--
-- APPLY ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.validation_baseline (
  company_id uuid        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  dma_200    double precision NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id)
);

-- The staleness check reads max(written_at) on every run. Without this it
-- is a sequential scan of the whole table; with it, an index-only lookup.
CREATE INDEX IF NOT EXISTS validation_baseline_written_at_idx
  ON public.validation_baseline (written_at DESC);

-- Service-role writes only. This is pipeline state: nothing in the browser
-- bundle should read it, and nothing anonymous should ever write it.
ALTER TABLE public.validation_baseline ENABLE ROW LEVEL SECURITY;
