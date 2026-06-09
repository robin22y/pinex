-- Adds the criteria_change_reason column to swing_conditions.
-- The pipeline (calc_swing_conditions.py) populates it after each
-- daily run by diffing today's 5 boolean conditions against the most
-- recent prior row for the same company_id. The stock page renders
-- the value via SwingConditions.jsx ("Changed today: <reason>").
--
-- Default '' (not NULL) so existing readers that .select(*) and key
-- off truthy values get a clean empty-string for unchanged days.
-- IF NOT EXISTS guards make this safe to re-run.

ALTER TABLE swing_conditions
  ADD COLUMN IF NOT EXISTS criteria_change_reason TEXT DEFAULT '';
