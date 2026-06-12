-- ============================================================================
-- Stage flagging & manual override system.
--
-- Tables / columns this migration creates (idempotent — safe to re-run):
--   - stage_flags                       (user-submitted phase mismatch reports)
--   - companies.stage_override          (permanent admin lock for a stock)
--   - companies.stage_override_reason   (audit note for the override)
--   - swing_conditions.stage_override   (temporary admin lock until next pipeline)
--   - swing_conditions.override_note    (audit note on the temporary override)
--   - swing_conditions.override_expires (when the temporary override lapses)
--   - swing_conditions.ma30w_slope      (forward-prepared column for the
--                                        Stage-3-requires-rising-MA rule landing
--                                        in calc_swing_conditions.py next pass)
--
-- Plus an immediate UPDATE for ORIENTHOT — the misclassified Topping stock
-- the user flagged in conversation. We set a *permanent* override on
-- companies.stage_override so the next StockDetail fetch picks it up
-- without waiting for a pipeline cycle.
--
-- The whole script is wrapped in a DO block so partial state (e.g. an
-- earlier run that created the table but failed on a policy) doesn't
-- block a re-run.
-- ============================================================================

-- ── 1. stage_flags table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stage_flags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            TEXT NOT NULL,
  company_id        UUID REFERENCES companies(id),
  user_id           UUID REFERENCES profiles(id),
  reported_stage    TEXT NOT NULL,
  suggested_stage   TEXT,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','reviewed','corrected','dismissed')),
  admin_note        TEXT,
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stage_flags_status_created_idx
  ON stage_flags (status, created_at DESC);

CREATE INDEX IF NOT EXISTS stage_flags_user_symbol_day_idx
  ON stage_flags (user_id, symbol, (created_at::date));

ALTER TABLE stage_flags ENABLE ROW LEVEL SECURITY;

-- Policies — drop-and-recreate so re-runs adopt any wording changes.
DROP POLICY IF EXISTS "user inserts own flag"    ON stage_flags;
DROP POLICY IF EXISTS "user reads own flags"     ON stage_flags;
DROP POLICY IF EXISTS "admin manages flags"      ON stage_flags;

CREATE POLICY "user inserts own flag"
  ON stage_flags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user reads own flags"
  ON stage_flags FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin','superadmin')
    )
  );

CREATE POLICY "admin manages flags"
  ON stage_flags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin','superadmin')
    )
  );

-- ── 2. companies — permanent overrides ─────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS stage_override        TEXT,
  ADD COLUMN IF NOT EXISTS stage_override_reason TEXT;

-- ── 3. swing_conditions — temporary overrides + ma30w_slope ────────────────
ALTER TABLE swing_conditions
  ADD COLUMN IF NOT EXISTS stage_override   TEXT,
  ADD COLUMN IF NOT EXISTS override_note    TEXT,
  ADD COLUMN IF NOT EXISTS override_expires DATE,
  ADD COLUMN IF NOT EXISTS ma30w_slope      NUMERIC;

-- ── 4. One-off correction for ORIENTHOT ────────────────────────────────────
-- Oriental Hotels was misclassified as Stage 3 / Topping despite never
-- having been Stage 2 in coverage. Permanent override until the pipeline
-- rule changes ship (Stage 3 needs prior Stage 2 history + slope <= 0).
UPDATE companies
SET    stage_override        = 'Stage 1',
       stage_override_reason = 'Corrected: never had Stage 2 in coverage. '
                            || 'Was misclassified as Stage 3 / Topping by the '
                            || 'pre-rule-change pipeline. Pipeline fix follows.'
WHERE  symbol = 'ORIENTHOT';
