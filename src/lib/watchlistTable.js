import { supabase } from './supabase'

const WATCHLIST_ROW_FIELDS =
  'id, company_id, added_at, price_at_add, reference_date, reference_price, group_name, notes'

/**
 * Loads user watchlist from `watchlists` with company details hydrated in a second query.
 * @returns {{ data: unknown[], sourceTable: 'watchlists', error: import('@supabase/supabase-js').PostgrestError | null }}
 */
export async function loadUserWatchlist(userId) {
  const { data: watchlist, error } = await supabase
    .from('watchlists')
    .select(WATCHLIST_ROW_FIELDS)
    .eq('user_id', userId)
    .order('added_at', { ascending: false })

  console.log('watchlist rows:', watchlist?.length, 'error:', error)

  if (error) {
    return { data: [], sourceTable: 'watchlists', error }
  }

  if (!watchlist?.length) {
    return { data: [], sourceTable: 'watchlists', error: null }
  }

  const companyIds = [...new Set(watchlist.map((w) => w.company_id).filter(Boolean))]

  const { data: companies, error: companiesError } = companyIds.length
    ? await supabase.from('companies').select('id, symbol, name, sector, industry').in('id', companyIds)
    : { data: [], error: null }

  if (companiesError) {
    return { data: [], sourceTable: 'watchlists', error: companiesError }
  }

  const companyMap = {}
  companies?.forEach((c) => {
    companyMap[c.id] = c
  })

  const withCompanies = watchlist.map((w) => {
    const company = companyMap[w.company_id] || {}
    const symbol = company.symbol || ''
    return {
      ...w,
      company,
      companies: companyMap[w.company_id] || null,
      symbol,
      name: company.name || symbol,
      sector: company.sector || '',
    }
  })

  return { data: withCompanies, sourceTable: 'watchlists', error: null }
}

/** Insert into `watchlists`. */
export async function insertWatchlistRow(primary) {
  const { error } = await supabase.from('watchlists').insert(primary)
  return { table: 'watchlists', error: error ?? null }
}

/** Whether the user already has `company_id` on `watchlists`. */
export async function selectWatchMembership(userId, companyId) {
  return supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle()
}

export async function countWatchlistForUser(userId) {
  return supabase.from('watchlists').select('*', { count: 'exact', head: true }).eq('user_id', userId)
}
