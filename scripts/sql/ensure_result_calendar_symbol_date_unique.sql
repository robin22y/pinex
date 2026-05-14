-- Supabase / PostgREST upsert from AdminResultCalendar.jsx uses:
--   .upsert(..., { onConflict: 'symbol,result_date' })
-- which requires a UNIQUE constraint on (symbol, result_date).

CREATE UNIQUE INDEX IF NOT EXISTS result_calendar_symbol_result_date_key
  ON public.result_calendar (symbol, result_date);

COMMENT ON INDEX result_calendar_symbol_result_date_key IS
  'Enables upsert on (symbol, result_date) from admin NSE CF-Event import.';
