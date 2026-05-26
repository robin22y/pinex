/**
 * phaseHelpers — derive cycle-phase observations from price_data
 * snapshots without requiring a dedicated phase_history table.
 *
 * WHY: The eventual plan is to log every Stage transition into its
 * own table so we can answer "how long has X been in its current
 * phase" with one indexed query. Until that lands, we derive the
 * same answers on the fly from the trailing N days of price_data,
 * which the dashboard already has access to. Costs ~one extra query
 * per watchlist render — acceptable for ~10-30 stocks per user.
 *
 * The functions below intentionally take *arrays of price rows in
 * descending date order* (newest first). Callers are responsible
 * for the fetch + sort; this module is pure logic so it stays easy
 * to unit-test and to swap to the eventual transition log later.
 */

import { supabase } from './supabase'

/**
 * Compute how many trading sessions ago the stock last had a
 * different phase. Returns the integer count, or null if the row
 * set doesn't go back far enough to see a transition (i.e. the
 * stock has been in the same phase for the entire window).
 *
 * `rowsDesc` — array of `{ date, stage }` newest first. Today's row
 * is `rowsDesc[0]`.
 */
export function sessionsInCurrentPhase(rowsDesc) {
  if (!Array.isArray(rowsDesc) || rowsDesc.length === 0) return null
  const current = rowsDesc[0]?.stage
  if (!current) return null
  for (let i = 1; i < rowsDesc.length; i++) {
    if (rowsDesc[i]?.stage && rowsDesc[i].stage !== current) {
      return i // i sessions since the last different stage
    }
  }
  // Window exhausted without finding a change — return at-least value
  return rowsDesc.length
}

/**
 * Find the most recent phase transition in the window.
 * Returns `{ fromStage, toStage, sessionsAgo, date }` or null if
 * none seen in the window.
 */
export function lastPhaseChange(rowsDesc) {
  if (!Array.isArray(rowsDesc) || rowsDesc.length < 2) return null
  const current = rowsDesc[0]?.stage
  if (!current) return null
  for (let i = 1; i < rowsDesc.length; i++) {
    const prev = rowsDesc[i]?.stage
    if (prev && prev !== current) {
      return {
        fromStage: prev,
        toStage: current,
        sessionsAgo: i,
        date: rowsDesc[i - 1]?.date || null,
      }
    }
  }
  return null
}

/**
 * Fetch the trailing N-day stage history for a batch of company_ids.
 * Returns `{ [company_id]: rowsDesc }` where each rowsDesc is sorted
 * newest-first.
 *
 * `days` defaults to 180 (≈9 months of trading sessions) which is
 * deep enough to cover most realistic phase durations without
 * overfetching. The query reads `date, stage, company_id` only, so
 * payload stays small even at 30 stocks × 180 rows.
 */
export async function fetchPhaseHistory(companyIds, days = 180) {
  if (!Array.isArray(companyIds) || companyIds.length === 0) return {}
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  // Postgrest .in_() with 30 UUIDs fits well within URL limits.
  const { data, error } = await supabase
    .from('price_data')
    .select('company_id, date, stage')
    .in('company_id', companyIds)
    .gte('date', cutoff)
    .order('date', { ascending: false })

  if (error || !Array.isArray(data)) return {}

  const grouped = {}
  for (const row of data) {
    const cid = row.company_id
    if (!cid) continue
    if (!grouped[cid]) grouped[cid] = []
    grouped[cid].push(row)
  }
  return grouped
}

/**
 * Pure label helper — "14 sessions" / "3 months" style label
 * suitable for the phase-age bar.
 *
 * We use trading sessions (~21/month) as the unit since that's what
 * the underlying data measures. The threshold at which we switch to
 * months is deliberately conservative; cycle analysis treats a phase
 * older than ~60 sessions as "established" so that breakpoint reads
 * cleanly.
 */
export function formatPhaseAge(sessions) {
  if (sessions == null) return '—'
  if (sessions < 1) return 'today'
  if (sessions === 1) return '1 session'
  if (sessions < 21) return `${sessions} sessions`
  const months = sessions / 21
  if (months < 12) return `${months.toFixed(1)} months`
  return `${(months / 12).toFixed(1)} years`
}
