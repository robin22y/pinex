import { supabase } from './supabase'

const WATCHLIST_ROW_FIELDS =
  'id, user_id, company_id, symbol, created_at, reference_date, reference_price, price_at_add, group_name, notes'

/**
 * Loads user watchlist from `watchlist` (singular).
 * @returns {{ data: unknown[], sourceTable: 'watchlist', error: import('@supabase/supabase-js').PostgrestError | null }}
 */
export async function loadUserWatchlist(userId) {
  const { data: watchlist, error } = await supabase
    .from('watchlist')
    .select(WATCHLIST_ROW_FIELDS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    return { data: [], sourceTable: 'watchlist', error }
  }

  if (!watchlist?.length) {
    return { data: [], sourceTable: 'watchlist', error: null }
  }

  return { data: watchlist, sourceTable: 'watchlist', error: null }
}

/** Insert into `watchlist`. */
export async function insertWatchlistRow(primary) {
  const { error } = await supabase.from('watchlist').insert(primary)
  return { table: 'watchlist', error: error ?? null }
}

/** Whether the user already has `company_id` on `watchlist`. */
export async function selectWatchMembership(userId, companyId) {
  return supabase
    .from('watchlist')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle()
}

export async function countWatchlistForUser(userId) {
  return supabase.from('watchlist').select('*', { count: 'exact', head: true }).eq('user_id', userId)
}
