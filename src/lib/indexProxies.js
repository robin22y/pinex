/**
 * indexProxies — the ETFs that live in `companies` but are not stocks.
 *
 * WHY THEY EXIST
 *   NSE publishes no reliable index-level VOLUME, and the Distribution
 *   Day gauge needs volume ("close down AND volume up"). The standard
 *   workaround is a liquid index ETF as the volume proxy:
 *     Nifty 50 -> NIFTYBEES
 *   Storing it as a `companies` row means the existing fetch_bhav_daily
 *   pipeline collects its OHLCV nightly with zero new fetch code.
 *
 * WHY THIS MODULE
 *   The cost of that reuse is that every stock-facing surface must
 *   exclude it, or NIFTYBEES shows up as a search result and a screener
 *   row. `companies` carries an `is_index_proxy` flag for exactly this
 *   (scripts/sql/add_index_proxy_etfs.sql) and queries against that
 *   table should filter on the COLUMN — it is authoritative and adding
 *   a new proxy needs no frontend deploy.
 *
 *   But mv_home_stocks does NOT carry the column, and neither does the
 *   get_home_stocks RPC built on it. Those consumers (Home screener,
 *   Lab universe) can only filter client-side, which is what the Set
 *   and predicate below are for.
 *
 *   Two mechanisms, one list. When mv_home_stocks is next rebuilt it
 *   should select is_index_proxy through — at that point Home and Lab
 *   can move to the column filter and this module shrinks to the
 *   SearchPage-style server-side usage only.
 *
 * KEEP IN SYNC with scripts/sql/add_index_proxy_etfs.sql.
 */

/** Symbols held only as index volume proxies. Upper-case. */
export const INDEX_PROXY_SYMBOLS = new Set(['NIFTYBEES'])

/**
 * True when `symbol` names an index-proxy ETF rather than an operating
 * company. Case-insensitive; tolerates null/undefined.
 */
export function isIndexProxySymbol(symbol) {
  return INDEX_PROXY_SYMBOLS.has(String(symbol || '').toUpperCase())
}

/**
 * Drop index-proxy rows from a list of {symbol} objects.
 *
 * For queries against `companies`, prefer the server-side column filter
 * (`.eq('is_index_proxy', false)`) and skip this — it's authoritative
 * and doesn't ship rows across the wire just to discard them. Use this
 * for mv_home_stocks / get_home_stocks results, where the column isn't
 * available.
 */
export function stripIndexProxies(rows) {
  if (!Array.isArray(rows)) return rows
  return rows.filter((r) => !isIndexProxySymbol(r?.symbol))
}
