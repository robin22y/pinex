-- ─────────────────────────────────────────────────────────────────
-- IQjet · Pillar 1 — divergence_signals table
-- ─────────────────────────────────────────────────────────────────
-- One row per trading day. Populated by scripts/iqjet/calc_divergences.py
-- which runs after market_internals is fresh for the day. The row is
-- the basis for both the /iqjet web dashboard's Market Pulse card and
-- the daily Telegram post.
--
-- Verdict scale (count of divergences that fired today):
--   0  → STRONG
--   1  → WATCH
--   2  → MIXED
--   3  → WEAK
--   4+ → DANGEROUS
--
-- divergences_detected stores the list of which signals fired, so the
-- Telegram post + UI can name them specifically rather than just
-- showing a count. Each entry is a short stable key
-- (e.g. "nifty_up_breadth_down") plus a human-facing label.
--
-- Idempotent (IF NOT EXISTS). Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS divergence_signals (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    date                   date NOT NULL UNIQUE,
    verdict                text NOT NULL,
    divergences_detected   jsonb,
    breadth_pct            numeric,
    ad_line_direction      text,
    stage2_count           integer,
    stage3_count           integer,
    nifty_close            numeric,
    notes                  text,
    created_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_divergence_signals_date
    ON divergence_signals (date DESC);


-- Verification — should return zero rows when the table exists
SELECT 'divergence_signals table missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'divergence_signals'
);

SELECT 'divergence_signals.date column missing' AS issue
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'divergence_signals'
      AND column_name  = 'date'
);
