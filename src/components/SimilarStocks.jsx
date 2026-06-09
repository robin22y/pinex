// SimilarStocks — "Stocks in similar condition" card on the stock
// detail page. Pure-frontend Supabase query, no backend changes, no
// new tables. Fetches up to 5 stocks that share the current stock's
// stage (and ideally its sector), excluding the current symbol.
//
// FETCH STRATEGY
//   One round-trip to price_data with an inner-join on companies for
//   symbol / name / sector. The price_data table uses `company_id` +
//   `date` (NOT `symbol` / `trading_date`) and exposes an `is_latest`
//   boolean flag for the freshest row per company — we filter on
//   `is_latest = true` instead of fetching the latest date first and
//   re-querying, which collapses the spec's 3 steps into 1 query.
//
// SECTOR FALLBACK
//   Same-sector matches are preferred. If we have ≥ 3 same-sector
//   matches we use those (capped at 5). Otherwise we fall back to
//   any-sector matches sharing the stage (also capped at 5). When
//   the final list has < 2 entries the component renders nothing —
//   "similar" with no peers isn't useful.
//
// RENDERING
//   Each row is a Link to /stock/<SYMBOL> styled as a flat card.
//   Stage shown via the shared Badge component using the same
//   green/amber/red palette the rest of the app uses (per the
//   colour-audit pass: green = healthy, amber = caution / new
//   feature, red = risk).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { C } from '../styles/tokens'
import Badge from './ui/Badge'

// ── Local helpers ─────────────────────────────────────────────────────
// Per the brief — kept inline so the component is self-contained.

function stageToStatus(stage) {
  const s = String(stage || '').toLowerCase().replace(/\s+/g, '')
  if (s === 'stage2') return 'green'
  if (s === 'stage1') return 'amber'
  if (s === 'stage3') return 'amber'
  if (s === 'stage4') return 'red'
  return 'neutral'
}

function stageLabel(stage) {
  const s = String(stage || '').toLowerCase().replace(/\s+/g, '')
  if (s === 'stage1') return 'Basing'
  if (s === 'stage2') return 'Advancing'
  if (s === 'stage3') return 'Topping'
  if (s === 'stage4') return 'Declining'
  return stage || 'Unknown'
}

// MAX_RESULTS caps the rendered list. POOL_SIZE caps the server-side
// fetch — wide enough to give sector fallback room to work (≈ 10
// sectors × average 2-3 stocks each), narrow enough to keep the
// round-trip cheap on slow connections. 25 covers Pharma / Banking
// / IT comfortably; widen if we ever see sector-fallback misses.
const MAX_RESULTS = 5
const POOL_SIZE = 25

// Module-level promise cache keyed by `<stage>|<sector>`. React.
// StrictMode in dev double-invokes effects → this dedupes the
// fetch to a single round-trip. Back-navigation to a previously-
// loaded peer cohort is instant. Cache lives for the session;
// peer cohorts only change post-EOD so within-session staleness
// is acceptable.
const similarCache = new Map()

export default function SimilarStocks({ currentSymbol, currentStage, currentSector }) {
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState([])
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!currentSymbol || !currentStage) {
      setLoading(false)
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    setErrored(false)
    ;(async () => {
      try {
        // Pool cache keyed by stage (sector filter is post-hoc client-
        // side so it doesn't belong in the cache key). Same pool can
        // serve every stock in the same stage — typical advancing run
        // covers ~500-800 of the universe, so one fetch backs every
        // stock-page visit in that stage for the session.
        const cacheKey = String(currentStage || '')
        let data
        if (similarCache.has(cacheKey)) {
          data = await similarCache.get(cacheKey)
        } else {
          const promise = supabase
            .from('price_data')
            .select('stage, close, date, companies!inner(symbol, name, sector)')
            .eq('is_latest', true)
            .eq('stage', currentStage)
            .order('close', { ascending: false })
            .limit(POOL_SIZE)
            .then((r) => (r?.error ? null : (r?.data ?? null)))
            .catch(() => null)
          similarCache.set(cacheKey, promise)
          data = await promise
          if (data === null) similarCache.delete(cacheKey)
        }
        if (cancelled) return
        if (!data) {
          setErrored(true)
          setResults([])
          return
        }
        const currentUpper = String(currentSymbol || '').toUpperCase()

        // Flatten the inner-join shape into the plain row shape the
        // renderer expects, then exclude the current symbol.
        const flat = (data || [])
          .map((r) => ({
            symbol: String(r?.companies?.symbol || '').toUpperCase(),
            name:   r?.companies?.name || '',
            sector: r?.companies?.sector || '',
            stage:  r?.stage || '',
            close:  r?.close ?? null,
          }))
          .filter((r) => r.symbol && r.symbol !== currentUpper)

        // Same-sector first (case-insensitive). If we have ≥ 3 of
        // those, use them; otherwise fall back to the wider pool.
        const sectorNorm = String(currentSector || '').trim().toLowerCase()
        const sameSector = sectorNorm
          ? flat.filter((r) => String(r.sector || '').trim().toLowerCase() === sectorNorm)
          : []
        const picked = sameSector.length >= 3 ? sameSector : flat
        setResults(picked.slice(0, MAX_RESULTS))
      } catch {
        if (!cancelled) {
          setErrored(true)
          setResults([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [currentSymbol, currentStage, currentSector])

  // Defensive: missing props from the parent → render nothing. The
  // parent is expected to gate on stage existing, but a defensive
  // early-return here keeps the component self-contained.
  if (!currentSymbol || !currentStage) return null

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              background: C.surface2,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '10px 12px',
              height: 44,
              opacity: 0.6,
              animation: 'pulse 1.5s infinite',
            }}
          />
        ))}
      </div>
    )
  }

  // Per the brief — < 2 results means "not enough similarity to be
  // useful". Render nothing so the section heading doesn't sit on
  // top of a thin or empty list.
  if (errored || results.length < 2) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {results.map((row) => (
        <Link
          key={row.symbol}
          to={`/stock/${row.symbol}`}
          style={{
            textDecoration: 'none',
            color: 'inherit',
            display: 'block',
          }}
        >
          <div
            style={{
              background: C.surface2,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-hover)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = C.border
              e.currentTarget.style.background = C.surface2
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13, fontWeight: 700, color: C.text,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {row.name || row.symbol}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>
                {row.symbol}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {row.sector ? (
                <span
                  style={{
                    fontSize: 11, color: C.textMuted,
                    whiteSpace: 'nowrap',
                    maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                  title={row.sector}
                >
                  {row.sector}
                </span>
              ) : null}
              <Badge status={stageToStatus(row.stage)} text={stageLabel(row.stage)} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
