// watchlistTable — single source of truth for
// reads / writes to the `watchlists` table.
//
// SCHEMA (relevant columns)
//   id              uuid pk
//   user_id         uuid (auth.users.id)
//   company_id      uuid (companies.id)
//   symbol          text  — kept in sync with
//                   companies.symbol so we can
//                   show the ticker without a
//                   join; backfilled on load.
//   group_name      text  — folder/category;
//                   defaults to 'My Watchlist'.
//                   Older code used
//                   `watchlist_group` or `group`
//                   — those have been removed.
//   added_at        timestamptz
//   price_at_add    numeric — captured close at
//                   the moment of add. Used for
//                   "gain since added" display.
//   reference_price numeric — admin-editable
//                   override that takes precedence
//                   over price_at_add when present.
//   reference_date  date
//   notes           text

import { supabase } from './supabase'

const WATCHLIST_ROW_FIELDS =
  'id, company_id, symbol, added_at, price_at_add, reference_date, reference_price, group_name, notes'

/**
 * Loads user watchlist from `watchlists` with company
 * details hydrated in a second query.
 *
 * Side effect: backfills any rows that have null
 * `symbol` (legacy inserts before symbol was
 * required) by reading symbol from `companies`
 * and updating the row in place.
 *
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

  // WHY: Earlier rows were inserted without
  // symbol (the column was added later). Once
  // we have the company map in hand, fill in
  // any null symbols silently in the background.
  // Runs only when at least one row has a null
  // symbol — no-op otherwise.
  const nullSymbolRows = watchlist.filter((r) => !r.symbol && r.company_id)
  if (nullSymbolRows.length > 0) {
    // Fire-and-forget: we don't block the page
    // render on these writes. The local map is
    // already populated so the UI reads correct
    // symbols regardless.
    void (async () => {
      for (const row of nullSymbolRows) {
        const co = companyMap[row.company_id]
        if (co?.symbol) {
          try {
            await supabase
              .from('watchlists')
              .update({ symbol: co.symbol })
              .eq('id', row.id)
          } catch {
            // Non-fatal — next load tries again.
          }
        }
      }
    })()
  }

  const withCompanies = watchlist.map((w) => {
    const company = companyMap[w.company_id] || {}
    // Fall back to the company.symbol when the
    // row itself is null — the backfill above
    // will repair the row in the DB.
    const symbol = w.symbol || company.symbol || ''
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

/**
 * Insert into `watchlists` with canonical defaults.
 *
 * Canonical fields written:
 *   user_id        — required
 *   company_id     — required
 *   symbol         — required; pulled from
 *                    primary.symbol if present
 *   group_name     — defaults to 'My Watchlist'
 *   added_at       — defaults to now()
 *   price_at_add   — null when not supplied
 *
 * Returns the inserted row via .select().single()
 * so callers can grab the new id without a follow-up
 * round-trip to selectWatchMembership.
 */
export async function insertWatchlistRow(primary) {
  const row = {
    group_name: 'My Watchlist',
    added_at: new Date().toISOString(),
    ...primary,
    // Defensive: keep symbol explicitly set even
    // if the caller passed an empty string. The
    // 44-row null-symbol bug we saw earlier came
    // from callers omitting the field entirely.
    symbol: primary?.symbol || null,
  }
  const { data, error } = await supabase
    .from('watchlists')
    .insert(row)
    .select()
    .single()
  return { table: 'watchlists', data: data ?? null, error: error ?? null }
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
