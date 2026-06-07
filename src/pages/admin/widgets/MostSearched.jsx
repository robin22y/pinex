import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { C, SectionHeading } from './shared'

// ── Most Searched stocks (admin) ────────────────────────────────────────
// Reads usage_events WHERE event_type='stock_search' and tallies
// metadata.query / metadata.symbol counts per stock symbol. Renders the
// top 15 in a sortable mini-table.
//
// The client-side trackSearch() in Home.jsx fires a fire-and-forget
// INSERT into usage_events on every successful smart-search hit, so
// this widget reflects platform-wide search demand (not just the admin's
// own searches). Service-role bypasses RLS for writes; admin reads via
// the admin_reads_usage_events policy.
//
// Window selector matches MostWatched: All time / 7d / 30d.

const MostSearched = () => {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [windowDays, setWindowDays] = useState(0) // 0 = all-time

  useEffect(() => {
    let cancelled = false

    async function load() {
      let q = supabase
        .from('usage_events')
        .select('metadata, created_at')
        .eq('event_type', 'stock_search')
      if (windowDays > 0) {
        const since = new Date(Date.now() - windowDays * 86400000).toISOString()
        q = q.gte('created_at', since)
      }
      const { data, error } = await q.limit(10000)
      if (cancelled) return
      if (error || !Array.isArray(data)) {
        setRows([])
        return
      }
      // Aggregate by symbol (preferring metadata.symbol, falling back
      // to upper-cased metadata.query).
      const counts = {}
      const lastSeen = {}
      for (const ev of data) {
        const m = ev.metadata || {}
        const sym = String(m.symbol || m.query || '').toUpperCase().trim()
        if (!sym) continue
        // Skip non-stock searches (questions for Research Assistant etc.)
        if (sym.includes(' ') || sym.length > 25) continue
        counts[sym] = (counts[sym] || 0) + 1
        if (!lastSeen[sym] || ev.created_at > lastSeen[sym]) lastSeen[sym] = ev.created_at
      }
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([symbol, count]) => ({
          key: symbol, symbol, count, lastSeen: lastSeen[symbol],
        }))
      setRows(sorted)
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
      <SectionHeading icon="ti-search" title="Most Searched Stocks" />
      <div style={{
        background: C.card,
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {WINDOWS.map((w) => {
            const active = windowDays === w.key
            return (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindowDays(w.key)}
                style={{
                  padding: '4px 10px', borderRadius: 20,
                  border: `1px solid ${active ? 'rgba(56,189,248,0.4)' : 'var(--border)'}`,
                  background: active ? 'rgba(56,189,248,0.10)' : 'transparent',
                  color: active ? C.blue : C.muted,
                  fontSize: 11, fontWeight: active ? 700 : 400,
                  cursor: 'pointer', whiteSpace: 'nowrap',
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
            No search activity in this window. If you expected data,
            check that Home.jsx is firing stock_search events to
            usage_events (RLS must allow authenticated inserts).
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['#', 'Stock', 'Searches', 'Last seen'].map((h, i) => (
                  <th key={h} style={{
                    textAlign: i === 2 || i === 3 ? 'right' : 'left',
                    padding: '6px 8px',
                    borderBottom: '1px solid var(--border)',
                    color: C.muted, fontWeight: 600, fontSize: 10,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}
                  onClick={() => r.symbol && navigate(`/stock/${r.symbol}`)}
                  style={{ cursor: r.symbol ? 'pointer' : 'default', transition: 'background 0.12s' }}
                  onMouseEnter={(e) => { if (r.symbol) e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '8px', borderBottom: '1px solid var(--bg-elevated)', color: i < 3 ? C.green : C.muted, fontWeight: 700, width: 24 }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid var(--bg-elevated)' }}>
                    <span style={{ fontWeight: 700, color: C.text, fontFamily: 'var(--font-mono)' }}>
                      {r.symbol}
                    </span>
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid var(--bg-elevated)', textAlign: 'right', fontWeight: 800, color: C.blue, fontFamily: 'var(--font-mono)' }}>
                    {r.count}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid var(--bg-elevated)', textAlign: 'right', color: C.muted, fontSize: 11 }}>
                    {r.lastSeen
                      ? new Date(r.lastSeen).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                      : '—'}
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

export default MostSearched
