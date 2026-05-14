import { supabase } from './supabase'

const WATCHLIST_ROW_FIELDS =
  'id, user_id, company_id, added_at, reference_date, reference_price, price_at_add, group_name, notes'

/**
 * Loads user watchlist from `watchlists`.
 * @returns {{ data: unknown[], sourceTable: 'watchlists', error: import('@supabase/supabase-js').PostgrestError | null }}
 */
export async function loadUserWatchlist(userId) {
  const { data: watchlist, error } = await supabase
    .from('watchlists')
    .select(WATCHLIST_ROW_FIELDS)
    .eq('user_id', userId)
    .order('added_at', { ascending: false })

  if (error) {
    return { data: [], sourceTable: 'watchlists', error }
  }

  if (!watchlist?.length) {
    return { data: [], sourceTable: 'watchlists', error: null }
  }

  return { data: watchlist, sourceTable: 'watchlists', error: null }
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
