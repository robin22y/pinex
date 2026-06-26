import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { C } from '../styles/tokens'
import StagePill from '../components/StagePill'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

export default function SearchPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [recentSearches, setRecentSearches] = useState([])
  const [allStocks, setAllStocks] = useState([])
  const fuseRef = useRef(null)
  const inputRef = useRef(null)
  const generationRef = useRef(0)

  // Load companies on mount
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
        setAllStocks(data)
        fuseRef.current = new Fuse(data, {
          keys: [
            { name: 'symbol', weight: 0.6 },
            { name: 'name', weight: 0.4 },
          ],
          threshold: 0.3,
          includeScore: true,
          minMatchCharLength: 2,
        })
        // Load recent searches
        try {
          const saved = JSON.parse(localStorage.getItem('pinex_recent_searches') || '[]')
          setRecentSearches(Array.isArray(saved) ? saved.slice(0, 5) : [])
        } catch {}
      })

    return () => { cancelled = true }
  }, [])

  // Handle search input
  useEffect(() => {
    const q = search.trim()
    if (!q || q.length < 2 || !fuseRef.current) {
      setResults([])
      return
    }

    const gen = ++generationRef.current
    const hits = fuseRef.current.search(q).slice(0, 8)
    const companies = hits.map((h) => h.item)
    const ids = companies.map((c) => c.id).filter(Boolean)

    if (ids.length === 0) {
      if (gen === generationRef.current) setResults([])
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
        setResults(
          companies.map((c) => ({
            ...c,
            stage: priceMap[c.id]?.stage,
            close: priceMap[c.id]?.close,
          })),
        )
      })
  }, [search])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Handle back button and ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        goBack()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  function goBack() {
    navigate(-1)
  }

  function goToStock(symbol) {
    if (!symbol) return
    // Save to recent searches
    try {
      const recent = JSON.parse(localStorage.getItem('pinex_recent_searches') || '[]')
      const updated = [symbol, ...recent.filter(s => s !== symbol)].slice(0, 5)
      localStorage.setItem('pinex_recent_searches', JSON.stringify(updated))
    } catch {}
    navigate(`/stock/${symbol}`)
  }

  const visibleItems = search.trim() ? results : recentSearches

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        height: '100dvh',
        width: '100%',
        background: C.base,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: C.base,
        }}
      >
        <button
          onClick={goBack}
          style={{
            background: 'none',
            border: 'none',
            color: C.text,
            cursor: 'pointer',
            fontSize: 20,
            padding: 8,
          }}
        >
          ←
        </button>
        <span style={{ color: C.textMuted, fontSize: 14 }}>Search stocks</span>
      </div>

      {/* Search Input */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${C.border}`,
          background: C.base,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: C.surface2,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: '12px 16px',
            gap: 8,
          }}
        >
          <span style={{ color: C.textMuted, fontSize: 16 }}>🔍</span>
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stocks…"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              color: C.text,
              fontSize: 16,
              outline: 'none',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                background: 'none',
                border: 'none',
                color: C.textMuted,
                cursor: 'pointer',
                fontSize: 18,
                padding: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {search.trim() === 0 && recentSearches.length > 0 && (
          <div style={{ padding: '16px' }}>
            <p
              style={{
                fontSize: 12,
                color: C.textMuted,
                textTransform: 'uppercase',
                fontWeight: 700,
                marginBottom: 12,
                letterSpacing: '0.08em',
              }}
            >
              Recent Searches
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentSearches.map((symbol) => (
                <button
                  key={symbol}
                  onClick={() => goToStock(symbol)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    color: C.text,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
        )}

        {search.trim() && results.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p style={{ color: C.textMuted }}>No matching stocks</p>
          </div>
        )}

        {results.length > 0 && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((stock) => (
              <button
                key={stock.id}
                onClick={() => goToStock(stock.symbol)}
                style={{
                  textAlign: 'left',
                  padding: '16px',
                  background: C.surface2,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: C.text,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                      {stock.symbol}
                    </p>
                    <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0' }}>
                      {stock.name}
                    </p>
                    <p style={{ fontSize: 11, color: C.textFaint, margin: '2px 0 0' }}>
                      {stock.sector}
                    </p>
                  </div>
                  {stock.stage && <StagePill stage={stock.stage} />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
