-- ════════════════════════════════════════════════════════════════════════
-- create_saved_screens.sql
--
-- Backing store for Lab → "Save this condition" (BUG 2 fix).
--
-- Before this table existed the save button wrote to localStorage and
-- showed a 2-second toast — there was no way to retrieve a saved
-- screen later, and the Pro badge on the button suggested a real
-- save. New behaviour:
--
--   src/pages/Lab.jsx saveCondition()
--     - checks profile.plan === 'pro' (Free users see an inline
--       upsell line and the modal never opens)
--     - opens the inline SaveScreenModal for a name
--     - INSERT INTO saved_screens (user_id, name, filters)
--     - filters is a jsonb blob — { filters, sortKey, sortDir, swingxView }
--
-- RLS posture
--   Each authenticated user can read/write only their own rows.
--   Service-role bypass remains via the standard supabase SERVICE_KEY
--   used by maintenance scripts.
--
-- Apply
--   Run once in Supabase SQL editor. Idempotent — IF NOT EXISTS guards
--   everywhere.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.saved_screens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  filters    jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_screens_user_id_idx
  ON public.saved_screens (user_id, created_at DESC);

ALTER TABLE public.saved_screens ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate the policies so re-running this file keeps them
-- in sync if we ever tweak the predicate.
DROP POLICY IF EXISTS saved_screens_select_own ON public.saved_screens;
CREATE POLICY saved_screens_select_own
  ON public.saved_screens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS saved_screens_insert_own ON public.saved_screens;
CREATE POLICY saved_screens_insert_own
  ON public.saved_screens
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS saved_screens_update_own ON public.saved_screens;
CREATE POLICY saved_screens_update_own
  ON public.saved_screens
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS saved_screens_delete_own ON public.saved_screens;
CREATE POLICY saved_screens_delete_own
  ON public.saved_screens
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
