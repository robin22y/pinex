import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { C, SectionHeading } from './shared'

// ── Most Watched stocks (admin) ───────────────────────────────────
// Aggregates `watchlists` by company_id, joins through `companies`
// for the symbol / name / sector, and surfaces the top 15. Useful
// for spotting which names PineX users care about most — informs
// content priorities, alert tuning, and which stocks deserve
// curator attention.

const MostWatched = () => {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [windowDays, setWindowDays] = useState(0) // 0 = all-time

  useEffect(() => {
    let cancelled = false

    async function load() {
      // 1. Pull every watchlist row we can read. RLS allows
      //    admins to read all rows post-policy fix, so this
      //    returns the full set (~162 today).
      let query = supabase
        .from('watchlists')
        .select('company_id, symbol, added_at')

      if (windowDays > 0) {
        const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString()
        query = query.gte('added_at', cutoff)
      }

      const { data: wl, error } = await query
      if (cancelled) return
      if (error || !wl) {
        setRows([])
        return
      }

      // 2. Tally per company_id (preferred) with a symbol fallback
      //    for legacy rows that lack the company_id link.
      const tally = {}
      for (const w of wl) {
        const key = w.company_id || `sym:${(w.symbol || '').toUpperCase()}`
        if (!tally[key]) {
          tally[key] = {
            key,
            company_id: w.company_id || null,
            symbol: (w.symbol || '').toUpperCase(),
            count: 0,
            lastAdded: null,
          }
        }
        tally[key].count += 1
        if (w.added_at && (!tally[key].lastAdded || w.added_at > tally[key].lastAdded)) {
          tally[key].lastAdded = w.added_at
        }
      }

      // 3. Top 15 by count, tie-break by recency
      const top = Object.values(tally)
        .sort((a, b) => b.count - a.count || (b.lastAdded || '').localeCompare(a.lastAdded || ''))
        .slice(0, 15)

      // 4. Hydrate name + sector via companies table — one query
      //    rather than N joins. Skip rows without company_id.
      const cidList = top.map((r) => r.company_id).filter(Boolean)
      const coMap = {}
      if (cidList.length) {
        const { data: cos } = await supabase
          .from('companies')
          .select('id, symbol, name, sector')
          .in('id', cidList)
        for (const c of cos || []) coMap[c.id] = c
      }

      if (cancelled) return
      setRows(
        top.map((r) => {
          const co = r.company_id ? coMap[r.company_id] : null
          return {
            ...r,
            symbol: co?.symbol || r.symbol,
            name:   co?.name   || '',
            sector: co?.sector || '',
          }
        })
      )
    }

    setRows(null)
    load()
    return () => { cancelled = true }
  }, [windowDays])

  const WINDOWS = [
    { key: 0,  label: 'All time' },
    { key: 7,  label: '7d' },
    { key: 30, label: '30d' },
  ]

  return (
    <>
      <SectionHeading icon="ti-bookmark" title="Most Watched Stocks" />

      <div style={{
        background: C.card,
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 16,
      }}>
        {/* Window selector */}
        <div style={{
          display: 'flex',
          gap: 6,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}>
          {WINDOWS.map((w) => {
            const active = windowDays === w.key
            return (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindowDays(w.key)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 20,
                  border: `1px solid ${active ? 'rgba(56,189,248,0.4)' : 'var(--border)'}`,
                  background: active ? 'rgba(56,189,248,0.10)' : 'transparent',
                  color: active ? C.blue : C.muted,
                  fontSize: 11,
                  fontWeight: active ? 700 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {w.label}
              </button>
            )
          })}
        </div>

        {rows === null ? (
          <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>
            No watchlist activity in this window.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  color: C.muted,
                  fontWeight: 600,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>#</th>
                <th style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  color: C.muted,
                  fontWeight: 600,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>Stock</th>
                <th style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  color: C.muted,
                  fontWeight: 600,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>Sector</th>
                <th style={{
                  textAlign: 'right',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  color: C.muted,
                  fontWeight: 600,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>Watchers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.key}
                  onClick={() => r.symbol && navigate(`/stock/${r.symbol}`)}
                  style={{
                    cursor: r.symbol ? 'pointer' : 'default',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { if (r.symbol) e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{
                    padding: '8px',
                    borderBottom: '1px solid var(--bg-elevated)',
                    color: i < 3 ? C.green : C.muted,
                    fontWeight: 700,
                    width: 24,
                  }}>{i + 1}</td>
                  <td style={{
                    padding: '8px',
                    borderBottom: '1px solid var(--bg-elevated)',
                  }}>
                    <div style={{ fontWeight: 700, color: C.text, fontFamily: 'var(--font-mono)' }}>
                      {r.symbol || '—'}
                    </div>
                    {r.name && (
                      <div style={{
                        fontSize: 10,
                        color: C.faint,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                      }}>
                        {r.name}
                      </div>
                    )}
                  </td>
                  <td style={{
                    padding: '8px',
                    borderBottom: '1px solid var(--bg-elevated)',
                    color: C.muted,
                    fontSize: 11,
                  }}>
                    {r.sector || '—'}
                  </td>
                  <td style={{
                    padding: '8px',
                    borderBottom: '1px solid var(--bg-elevated)',
                    textAlign: 'right',
                    fontWeight: 800,
                    color: C.blue,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {r.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

export default MostWatched
