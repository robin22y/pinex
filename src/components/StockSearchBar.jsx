import Fuse from 'fuse.js'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'
import StagePill from './StagePill'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

const RECENT_SEARCHES_KEY = 'pinex_recent_searches'

function SearchGlyph({ style }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      style={style}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function loadRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 5) : []
  } catch {
    return []
  }
}

function saveRecentSearch(item) {
  const prev = loadRecentSearches()
  const next = [item, ...prev.filter((x) => x?.symbol !== item?.symbol)].slice(0, 5)
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
}

function resolvePick(trimmed, visibleRows, searchResults) {
  const u = trimmed.toUpperCase()
  const lc = trimmed.toLowerCase()
  let match =
    (searchResults.find((r) => String(r.symbol || '').toUpperCase() === u) ||
      visibleRows.find((r) => String(r.symbol || '').toUpperCase() === u))
  if (match) return match
  match =
    visibleRows.find((r) => String(r.name || '').toLowerCase().startsWith(lc)) ||
    searchResults.find((r) => String(r.name || '').toLowerCase().startsWith(lc))
  if (match) return match
  return visibleRows[0] || searchResults[0] || null
}

/**
 * @param {{ className?: string, variant?: 'hero' | 'compact' }} props
 */
export default function StockSearchBar({ className = '', variant = 'hero' }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [recentSearches, setRecentSearches] = useState(() => loadRecentSearches())
  const [searchOpen, setSearchOpen] = useState(false)
  const isCompact = variant === 'compact'

  // Fuse.js index, populated once on mount. Per-keystroke search reads
  // from this ref synchronously — no debounce, no per-stroke server
  // round-trip. allStocksRef is kept for diagnostics / extension; the
  // index in fuseRef is the source of truth for matching.
  const fuseRef = useRef(null)
  const allStocksRef = useRef([])
  // Generation counter — discards stale stage-fetch responses if the
  // user keeps typing after a query is in flight. Prevents an earlier
  // (longer) match list from overwriting a later (narrower) one when
  // the network reorders.
  const generationRef = useRef(0)

  // Mount once — load every active company and build the Fuse index.
  // is_suspended (NULL or false) is the canonical "active" filter on
  // companies — matches scripts/db.py + the get_home_stocks RPC. We
  // deliberately don't use .eq('is_active', true) because the companies
  // table doesn't have an is_active column.
  useEffect(() => {
    if (!hasSupabaseEnv) return
    let cancelled = false
    supabase
      .from('companies')
      .select('id,name,symbol,sector')
      .or('is_suspended.is.null,is_suspended.eq.false')
      .limit(5000)
      .then(({ data }) => {
        if (cancelled || !data) return
        allStocksRef.current = data
        fuseRef.current = new Fuse(data, {
          keys: [
            { name: 'symbol', weight: 0.6 },
            { name: 'name', weight: 0.4 },
          ],
          threshold: 0.3,
          includeScore: true,
          minMatchCharLength: 2,
        })
      })
    return () => { cancelled = true }
  }, [])

  // Per-keystroke — synchronous Fuse match + one server fetch for stage
  // and close on the top 8 hits. No 300ms debounce: Fuse is fast enough
  // to run on every keystroke, and the input feels noticeably snappier.
  useEffect(() => {
    const q = search.trim()
    if (!q || q.length < 2 || !fuseRef.current) {
      setSearchResults([])
      return
    }
    const gen = ++generationRef.current
    const hits = fuseRef.current.search(q).slice(0, 8)
    const companies = hits.map((h) => h.item)
    const ids = companies.map((c) => c.id).filter(Boolean)

    if (ids.length === 0) {
      if (gen === generationRef.current) setSearchResults([])
      return
    }

    supabase
      .from('price_data')
      .select('company_id,stage,close')
      .in('company_id', ids)
      .eq('is_latest', true)
      .then(({ data: priceRows }) => {
        if (gen !== generationRef.current) return
        const priceMap = Object.fromEntries(
          (priceRows || []).map((r) => [r.company_id, r]),
        )
        setSearchResults(
          companies.map((c) => ({
            ...c,
            stage: priceMap[c.id]?.stage,
            close: priceMap[c.id]?.close,
          })),
        )
      })
  }, [search])

  function goToStock(result) {
    if (!result?.symbol) return
    saveRecentSearch(result)
    setRecentSearches(loadRecentSearches())
    setSearch('')
    setSearchOpen(false)
    navigate(`/stock/${result.symbol}`)
  }

  const visibleRows = search ? searchResults : recentSearches

  function runSearch(e) {
    e?.preventDefault?.()
    const trimmed = search.trim()
    if (!trimmed) {
      setSearchOpen(true)
      return
    }
    const pick = resolvePick(trimmed, visibleRows, searchResults)
    if (pick) goToStock(pick)
    else setSearchOpen(true)
  }

  const pillShell = {
    borderColor: C.border,
    background: C.surface2,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  }

  return (
    <div className={className} style={{ position: 'relative' }}>
      <form
        onSubmit={runSearch}
        className={`flex w-full items-center gap-2 rounded-full border ${isCompact ? 'px-2.5 py-1' : 'px-3 py-1.5'}`}
        style={pillShell}
      >
        <span className="flex shrink-0 items-center pl-1" style={{ color: C.textMuted }}>
          <SearchGlyph />
        </span>
        <input
          value={search}
          onFocus={() => setSearchOpen(true)}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stocks…"
          className={`min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[#949eab] ${isCompact ? 'py-1' : 'py-2'}`}
          style={{ color: C.text }}
          aria-label="Search stocks"
        />
        <button
          type="submit"
          className={`shrink-0 rounded-full font-semibold transition-opacity hover:opacity-90 ${isCompact ? 'px-3 py-1.5 text-xs' : 'px-5 py-2 text-sm'}`}
          style={{ background: C.accent, color: C.accentOn }}
        >
          {isCompact ? 'Go' : 'Search'}
        </button>
      </form>

      {searchOpen ? (
        <div
          className="absolute left-0 right-0 z-50 mt-2 rounded-2xl border shadow-xl overflow-hidden"
          style={{
            borderColor: C.border,
            background: C.surfaceCard,
            color: C.text,
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
            minWidth: '100%',
          }}
        >
          {visibleRows.length ? (
            <div className="space-y-1 p-2">
              {visibleRows.map((item) => (
                <button
                  key={`${item.symbol}-${item.name}-${item.id || ''}`}
                  type="button"
                  onClick={() => goToStock(item)}
                  className="flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-3 text-left transition-colors hover:bg-opacity-60"
                  style={{
                    background: C.surface2,
                    color: C.text,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = C.borderHover
                    e.currentTarget.style.background = C.base
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'transparent'
                    e.currentTarget.style.background = C.surface2
                  }}
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="truncate text-sm font-medium" style={{ color: C.text }}>
                      {item.symbol}
                    </p>
                    <p className="truncate text-xs" style={{ color: C.textMuted }}>
                      {item.name}
                    </p>
                    <p className="truncate text-xs" style={{ color: C.textFaint }}>
                      {item.sector || 'Unknown sector'}
                    </p>
                  </div>
                  {item.stage && <StagePill stage={item.stage} />}
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-3 text-xs" style={{ color: C.textMuted }}>
              {search.trim() ? 'No matching stocks.' : 'No recent searches yet.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
