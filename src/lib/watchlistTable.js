import { supabase } from './supabase'

/** Primary table used in UX / docs (`watchlists`); mirrors legacy `watchlist` when plural is unavailable. */

const WATCHLISTS_SELECT = `
  id,
  symbol,
  added_at,
  price_at_add,
  reference_date,
  reference_price,
  group_name,
  notes,
  company_id,
  companies (
    id,
    name,
    sector,
    industry
  )
`

function normSym(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
}

/**
 * Loads user watchlist from `watchlists` or falls back to `watchlist` with company hydration.
 * @returns {{ data: unknown[], sourceTable: 'watchlists' | 'watchlist', error: import('@supabase/supabase-js').PostgrestError | null }}
 */
export async function loadUserWatchlist(userId) {
  const { data: pluralData, error: pluralErr } = await supabase
    .from('watchlists')
    .select(WATCHLISTS_SELECT)
    .eq('user_id', userId)
    .order('added_at', { ascending: false })

  console.log('watchlist fetch:', pluralData, pluralErr)

  if (!pluralErr && Array.isArray(pluralData)) {
    return { data: pluralData, sourceTable: 'watchlists', error: null }
  }

  const { data: singData, error: singErr } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  console.log('watchlist fetch (fallback watchlist singular):', singData, singErr)

  if (singErr) {
    return { data: [], sourceTable: 'watchlist', error: singErr ?? pluralErr }
  }

  const singRows = Array.isArray(singData) ? singData : []

  // Plural failed (or mismatched embed), but singular table is empty → still a valid empty list.
  if (singRows.length === 0) {
    return { data: [], sourceTable: 'watchlist', error: null }
  }

  const symbols = [...new Set(singRows.map((w) => normSym(w.symbol)).filter(Boolean))]
  const companiesRes =
    symbols.length > 0
      ? await supabase.from('companies').select('id,symbol,name,sector,industry').in('symbol', symbols)
      : { data: [] }

  const bySym = {}
  for (const c of companiesRes.data || []) {
    const k = normSym(c.symbol)
    if (k) bySym[k] = c
  }

  const hydrated = singRows.map((w) => {
    const s = normSym(w.symbol)
    const co = s ? bySym[s] : null
    const added_at = w.added_at ?? w.created_at ?? null
    return {
      ...w,
      added_at,
      company_id: w.company_id ?? co?.id ?? null,
      companies: co
        ? {
            id: co.id,
            name: co.name,
            sector: co.sector,
            industry: co.industry,
          }
        : null,
    }
  })

  return { data: hydrated, sourceTable: 'watchlist', error: null }
}

/**
 * Insert into `watchlists` when present; falls back to legacy `watchlist` on schema/table mismatch errors.
 */
export async function insertWatchlistRow(primary, fallback) {
  let { error: e1 } = await supabase.from('watchlists').insert(primary)
  if (!e1) return { table: 'watchlists', error: null }
  const msg = `${e1.message || ''} ${e1.details || ''}`.toLowerCase()
  const maybeMissing =
    e1.code === 'PGRST204' ||
    e1.code === '42P01' ||
    msg.includes('relation') ||
    msg.includes('does not exist') ||
    msg.includes('column')
  if (!maybeMissing) return { table: 'watchlists', error: e1 }
  const { error: e2 } = await supabase.from('watchlist').insert(fallback)
  return { table: 'watchlist', error: e2 ?? null }
}

/** Whether the user already has `company_id` on either table. */
export async function selectWatchMembership(userId, companyId) {
  const plural = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle()

  console.log('[watchlist membership] watchlists:', plural?.data, plural?.error)

  if (plural?.data?.id) return plural

  const sing = await supabase
    .from('watchlist')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle()

  console.log('[watchlist membership] watchlist:', sing?.data, sing?.error)

  return sing
}

export async function countWatchlistForUser(userId) {
  const r = await supabase.from('watchlists').select('*', { count: 'exact', head: true }).eq('user_id', userId)
  if (!r.error) return r
  return supabase.from('watchlist').select('*', { count: 'exact', head: true }).eq('user_id', userId)
}
