import Fuse from 'fuse.js'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'
import SearchModal from './SearchModal'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

const RECENT_SEARCHES_KEY = 'pinex_recent_searches'

function SearchGlyph() {
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

/**
 * Premium Stock Search Bar with modal-based search experience.
 * Supports three states: Idle (recent), Typing (results), Exact Match (snapshot).
 * @param {{ className?: string, variant?: 'hero' | 'compact' }} props
 */
export default function StockSearchBar({ className = '', variant = 'hero' }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [recentSearches, setRecentSearches] = useState(() => loadRecentSearches())
  const [searchOpen, setSearchOpen] = useState(false)
  const isCompact = variant === 'compact'

  const fuseRef = useRef(null)
  const generationRef = useRef(0)

  // Load Fuse index on mount
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

  // Per-keystroke search
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

  const pillShell = {
    borderColor: C.border,
    background: C.surface2,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  }

  return (
    <div className={className} style={{ position: 'relative' }}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSearchOpen(true)
        }}
        className={`flex w-full items-center gap-2 rounded-full border cursor-pointer transition-colors ${isCompact ? 'px-2.5 py-1' : 'px-3 py-1.5'}`}
        style={pillShell}
        onClick={() => setSearchOpen(true)}
      >
        <span className="flex shrink-0 items-center pl-1" style={{ color: C.textMuted }}>
          <SearchGlyph />
        </span>
        <input
          value={search}
          onFocus={() => setSearchOpen(true)}
          onChange={(e) => setSearch(e.target.value)}
          onClick={() => setSearchOpen(true)}
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

      {/* Premium search modal */}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        searchQuery={search}
        onSearchChange={setSearch}
        searchResults={searchResults}
        recentSearches={recentSearches}
        onSelectStock={goToStock}
      />
    </div>
  )
}
