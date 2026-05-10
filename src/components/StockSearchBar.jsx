import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!hasSupabaseEnv) return
    const q = search.trim()
    const timer = window.setTimeout(async () => {
      if (!q) {
        setSearchResults([])
        return
      }
      try {
        const { data } = await supabase
          .from('companies')
          .select('id,name,symbol,sector')
          .or(`name.ilike.%${q}%,symbol.ilike.%${q}%`)
          .limit(8)

        const symbols = (data || []).map((d) => d.symbol).filter(Boolean)
        let stageByCompanyId = {}
        if (symbols.length) {
          const latestDateRes = await supabase.from('price_data').select('date').order('date', { ascending: false }).limit(1)
          const latestDate = latestDateRes.data?.[0]?.date
          if (latestDate) {
            const companyIds = (data || []).map((d) => d.id).filter(Boolean)
            const stageRes = await supabase
              .from('price_data')
              .select('company_id,stage')
              .eq('date', latestDate)
              .in('company_id', companyIds)
            stageByCompanyId = Object.fromEntries((stageRes.data || []).map((s) => [s.company_id, s.stage]))
          }
        }

        setSearchResults(
          (data || []).map((d) => ({
            ...d,
            stage: stageByCompanyId[d.id] || null,
          })),
        )
      } catch {
        setSearchResults([])
      }
    }, 300)

    return () => window.clearTimeout(timer)
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
    <div className={className}>
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
          className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border p-2 shadow-xl"
          style={{
            borderColor: C.border,
            background: C.surfaceCard,
            color: C.text,
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          }}
        >
          {visibleRows.length ? (
            <div className="space-y-1">
              {visibleRows.map((item) => (
                <button
                  key={`${item.symbol}-${item.name}-${item.id || ''}`}
                  type="button"
                  onClick={() => goToStock(item)}
                  className="flex w-full items-center justify-between rounded-xl border border-transparent px-2 py-2 text-left transition-colors"
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
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="truncate text-sm font-medium" style={{ color: C.text }}>
                      {item.name} ({item.symbol})
                    </p>
                    <p className="truncate text-xs" style={{ color: C.textMuted }}>
                      {item.sector || 'Unknown sector'}
                    </p>
                  </div>
                  <StagePill stage={item.stage} />
                </button>
              ))}
            </div>
          ) : (
            <p className="px-2 py-2 text-xs" style={{ color: C.textMuted }}>
              {search.trim() ? 'No matching stocks.' : 'No recent searches yet.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
