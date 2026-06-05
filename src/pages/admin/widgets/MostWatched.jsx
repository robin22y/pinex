import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { C, SectionHeading } from './shared'

// ── Most Watched stocks (admin) ───────────────────────────────────
// Renders the top 15 stocks by watchlist count. Backed by the
// `admin_most_watched(p_window_days)` SECURITY DEFINER RPC, which
// runs as the table owner, gates on profiles.role='superadmin',
// returns ONLY the aggregate (never per-user rows), and joins
// companies internally.
//
// The previous client-side aggregation queried `watchlists`
// directly — under default RLS that scope-limited the SELECT to
// the admin's own rows, so the widget showed "1" against each of
// the admin's own watched stocks instead of the true population
// counts. The RPC is the single round-trip fix; the function-side
// admin check means the widget can't leak per-user data even if a
// future client bug tried to.
//
// SQL migration: scripts/sql/create_admin_most_watched_function.sql

const MostWatched = () => {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [windowDays, setWindowDays] = useState(0) // 0 = all-time

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase.rpc('admin_most_watched', {
        p_window_days: windowDays,
      })
      if (cancelled) return
      // P0001 (RAISE EXCEPTION 'admin only') hits non-admin callers.
      // 42883 (function does not exist) hits before the migration
      // is applied. Both surface as empty rows for graceful render.
      if (error || !Array.isArray(data)) {
        setRows([])
        return
      }
      setRows(
        data.map((r, i) => ({
          key: r.company_id || `idx:${i}`,
          company_id: r.company_id || null,
          symbol: String(r.symbol || '').toUpperCase(),
          name:   r.name || '',
          sector: r.sector || '',
          count:  Number(r.watch_count) || 0,
          lastAdded: r.last_added || null,
        }))
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
