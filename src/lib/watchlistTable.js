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
//   added_at        timestamptz
//   price_at_add    numeric — captured close at
//                   the moment of add. Used for
//                   "gain since added" display.
//   reference_price numeric — admin-editable
//                   override that takes precedence
//                   over price_at_add when present.
//   reference_date  date
//   notes           text
//
// DEV BYPASS FALLBACK
//   When VITE_DEV_BYPASS=true the AuthContext
//   substitutes a hardcoded DEV_USER whose id
//   doesn't exist in auth.users. RLS policies
//   like `auth.uid() = user_id` reject all
//   writes from this user with 401. To keep the
//   dev experience functional we shadow reads/
//   writes for that specific UUID through
//   localStorage. Real users are unaffected.

import { supabase } from './supabase'

const WATCHLIST_ROW_FIELDS =
  'id, company_id, symbol, added_at, price_at_add, reference_date, reference_price, group_name, notes'

// Keep in sync with src/context/AuthContext.jsx
// DEV_USER.id — that user has no real Supabase
// session so all writes go to localStorage.
const DEV_USER_ID = '00000000-0000-0000-0000-0000000000d1'
const LOCAL_KEY = 'pinex_dev_watchlist'

function isDevUser(userId) {
  return userId === DEV_USER_ID
}

function loadLocalRows() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
  } catch {
    return []
  }
}

function saveLocalRows(rows) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows))
  } catch {
    // localStorage quota / privacy mode — non-fatal.
  }
}

/**
 * Loads user watchlist from `watchlists` with company
 * details hydrated in a second query.
 *
 * In dev bypass mode the rows come from localStorage
 * but companies are still hydrated from Supabase so
 * stage badges / prices stay live.
 *
 * Side effect (real users only): backfills any rows
 * that have null `symbol` by reading symbol from
 * `companies` and updating the row in place.
 */
export async function loadUserWatchlist(userId) {
  // ── Dev bypass: rows come from localStorage ──
  if (isDevUser(userId)) {
    const rows = loadLocalRows()
    if (!rows.length) {
      return { data: [], sourceTable: 'localStorage', error: null }
    }
    const companyIds = [...new Set(rows.map((w) => w.company_id).filter(Boolean))]
    const { data: companies } = companyIds.length
      ? await supabase.from('companies').select('id, symbol, name, sector, industry').in('id', companyIds)
      : { data: [] }
    const companyMap = {}
    companies?.forEach((c) => { companyMap[c.id] = c })

    const withCompanies = rows.map((w) => {
      const company = companyMap[w.company_id] || {}
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
    return { data: withCompanies, sourceTable: 'localStorage', error: null }
  }

  // ── Real users: Supabase ──
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

  // Backfill any rows that have null `symbol` (legacy
  // inserts before symbol was required). Fire-and-forget
  // so UI rendering isn't blocked.
  const nullSymbolRows = watchlist.filter((r) => !r.symbol && r.company_id)
  if (nullSymbolRows.length > 0) {
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
            /* Non-fatal — next load tries again. */
          }
        }
      }
    })()
  }

  const withCompanies = watchlist.map((w) => {
    const company = companyMap[w.company_id] || {}
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
 *   user_id, company_id, symbol, group_name (default
 *   'My Watchlist'), added_at (default now()),
 *   price_at_add (null if not supplied).
 *
 * Returns the inserted row via .select().single()
 * so callers can grab the new id without a follow-up
 * round-trip to selectWatchMembership.
 *
 * In dev bypass mode the row is persisted to
 * localStorage and returned with a synthetic uuid.
 */
export async function insertWatchlistRow(primary) {
  const row = {
    group_name: 'My Watchlist',
    added_at: new Date().toISOString(),
    ...primary,
    symbol: primary?.symbol || null,
  }

  if (isDevUser(primary?.user_id)) {
    const rows = loadLocalRows()
    // Reject duplicate company_id silently — same
    // behaviour as a real UNIQUE(user_id, company_id)
    // constraint would give.
    const exists = rows.find((r) => r.company_id === row.company_id)
    if (exists) {
      return { table: 'localStorage', data: exists, error: null }
    }
    const synthetic = {
      ...row,
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
    rows.unshift(synthetic)
    saveLocalRows(rows)
    return { table: 'localStorage', data: synthetic, error: null }
  }

  const { data, error } = await supabase
    .from('watchlists')
    .insert(row)
    .select()
    .single()
  return { table: 'watchlists', data: data ?? null, error: error ?? null }
}

/**
 * Delete a watchlist row. Dispatches to localStorage
 * in dev bypass, Supabase otherwise.
 */
export async function deleteWatchlistRow(userId, rowId) {
  if (isDevUser(userId)) {
    const rows = loadLocalRows()
    saveLocalRows(rows.filter((r) => r.id !== rowId))
    return { error: null }
  }
  const { error } = await supabase
    .from('watchlists')
    .delete()
    .eq('id', rowId)
    .eq('user_id', userId)
  return { error: error ?? null }
}

/** Whether the user already has `company_id` on `watchlists`. */
export async function selectWatchMembership(userId, companyId) {
  if (isDevUser(userId)) {
    const rows = loadLocalRows()
    const match = rows.find((r) => r.company_id === companyId)
    return { data: match || null, error: null }
  }
  return supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle()
}

export async function countWatchlistForUser(userId) {
  if (isDevUser(userId)) {
    return { count: loadLocalRows().length, error: null }
  }
  return supabase.from('watchlists').select('*', { count: 'exact', head: true }).eq('user_id', userId)
}
