import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// ── SwingX Activity (entries / exits / warnings + 7d reason histogram) ──────
// Reads from swingx_entries. The detail panel
// is fetched lazily on expand so the initial
// dashboard render stays light.

const EXIT_REASON_LABELS = {
  stage_change:    'Stage change',
  below_30w:       'Below 30W Trend Line',
  sector_weakened: 'Sector weakened',
  conditions_lost: 'Conditions lost',
}

const SwingXActivity = () => {
  const [stats, setStats] = useState(null)
  const [reasonHist, setReasonHist] = useState([])
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState({ exits: [], entries: [] })
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    const todayIso = new Date().toISOString().slice(0, 10)
    const day7ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    const [active, newToday, exitedToday, warned, reasons7d] = await Promise.all([
      supabase
        .from('swingx_entries')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),

      supabase
        .from('swingx_entries')
        .select('id', { count: 'exact', head: true })
        .eq('entry_date', todayIso),

      supabase
        .from('swingx_entries')
        .select('id', { count: 'exact', head: true })
        .eq('exit_date', todayIso),

      // WHY: warning_level NOT NULL flags active
      // entries that are in their grace window
      // before a real exit. Surfaces churn risk
      // for the admin.
      supabase
        .from('swingx_entries')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .not('warning_level', 'is', null),

      supabase
        .from('swingx_entries')
        .select('exit_reason')
        .gte('exit_date', day7ago)
        .not('exit_reason', 'is', null),
    ])

    setStats({
      active: active.count || 0,
      newToday: newToday.count || 0,
      exitedToday: exitedToday.count || 0,
      warned: warned.count || 0,
    })

    // HOW IT'S DERIVED — exit-reason histogram
    //   Bucket the last-7-days exit_reason rows
    //   client-side. Sorted descending by count
    //   so the dominant cause sits at the top.
    const counts = {}
    ;(reasons7d.data || []).forEach((r) => {
      const k = r.exit_reason
      if (!k) return
      counts[k] = (counts[k] || 0) + 1
    })
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    const hist = Object.entries(counts)
      .map(([reason, count]) => ({
        reason,
        label: EXIT_REASON_LABELS[reason] || reason,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
    setReasonHist(hist)
    setReasonHist((curr) => {
      curr.total = total
      return [...curr]
    })
  }

  const loadDetail = async () => {
    setDetailLoading(true)
    const todayIso = new Date().toISOString().slice(0, 10)

    const [exits, entries] = await Promise.all([
      supabase
        .from('swingx_entries')
        .select('symbol, exit_reason, days_in_swingx, return_pct')
        .eq('exit_date', todayIso)
        .order('return_pct', { ascending: false }),

      supabase
        .from('swingx_entries')
        .select('symbol, entry_rs, entry_vol_ratio, entry_pct_from_30w')
        .eq('entry_date', todayIso)
        .order('entry_rs', { ascending: false }),
    ])

    setDetail({
      exits: exits.data || [],
      entries: entries.data || [],
    })
    setDetailLoading(false)
  }

  const onToggle = () => {
    const next = !expanded
    setExpanded(next)
    if (next && !detail.exits.length && !detail.entries.length) {
      void loadDetail()
    }
  }

  if (!stats) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        Loading SwingX activity...
      </div>
    )
  }

  const histTotal = reasonHist.reduce((s, r) => s + r.count, 0)

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
          padding: '0 16px',
        }}
      >
        SwingX Activity
      </div>

      {/* 4-tile counter row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          padding: '0 16px',
          marginBottom: 12,
        }}
      >
        {[
          { label: 'Active', value: stats.active, icon: '⚡', color: 'var(--accent)' },
          { label: 'New today', value: stats.newToday, icon: '↑', color: 'var(--positive)' },
          { label: 'Exited today', value: stats.exitedToday, icon: '↓', color: 'var(--negative)' },
          { label: 'Warnings', value: stats.warned, icon: '⚠️', color: 'var(--warning)' },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '12px 10px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: stat.color,
                fontFamily: 'var(--font-mono)',
                lineHeight: 1,
                marginBottom: 4,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontSize: 9,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {stat.icon} {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Exit reasons last 7d */}
      {histTotal > 0 && (
        <div
          style={{
            margin: '0 16px 12px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '14px',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            Exit reasons — last 7 days ({histTotal} total)
          </div>

          {reasonHist.map((r) => (
            <div key={r.reason} style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginBottom: 3,
                }}
              >
                <span>{r.label}</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {r.count} ({r.pct}%)
                </span>
              </div>
              <div
                style={{
                  height: 5,
                  background: 'var(--border)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${r.pct}%`,
                    background:
                      r.reason === 'sector_weakened'
                        ? 'var(--warning)'
                        : r.reason === 'conditions_lost'
                        ? 'var(--info)'
                        : r.reason === 'below_30w'
                        ? 'var(--negative)'
                        : 'var(--text-muted)',
                    borderRadius: 3,
                    transition: 'width 0.5s',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expand for detail */}
      <button
        onClick={onToggle}
        style={{
          width: 'calc(100% - 32px)',
          margin: '0 16px',
          padding: '10px 14px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--text-muted)',
          fontSize: 12,
        }}
      >
        <span>Show detail — today's entries + exits</span>
        <i
          className={expanded ? 'ti ti-chevron-up' : 'ti ti-chevron-down'}
          style={{ fontSize: 14 }}
        />
      </button>

      {expanded && (
        <div style={{ margin: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {detailLoading ? (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Loading…
            </div>
          ) : (
            <>
              {/* Today's entries */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--positive)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  ↑ New today ({detail.entries.length})
                </div>
                {detail.entries.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: 'var(--text-hint)', textAlign: 'center' }}>
                    No new SwingX entries today
                  </div>
                ) : (
                  detail.entries.map((e, i) => (
                    <div
                      key={`${e.symbol}-${i}`}
                      style={{
                        padding: '8px 14px',
                        borderBottom: i < detail.entries.length - 1 ? '1px solid var(--bg-elevated)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', minWidth: 90 }}>
                        {e.symbol}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        RS {e.entry_rs != null ? `+${Number(e.entry_rs).toFixed(1)}` : '—'} · vol {e.entry_vol_ratio != null ? `${Number(e.entry_vol_ratio).toFixed(1)}x` : '—'} · {e.entry_pct_from_30w != null ? `+${Number(e.entry_pct_from_30w).toFixed(1)}%` : '—'} vs MA
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Today's exits */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--negative)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  ↓ Exited today ({detail.exits.length})
                </div>
                {detail.exits.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: 'var(--text-hint)', textAlign: 'center' }}>
                    No SwingX exits today
                  </div>
                ) : (
                  detail.exits.map((e, i) => {
                    const ret = Number(e.return_pct || 0)
                    return (
                      <div
                        key={`${e.symbol}-${i}`}
                        style={{
                          padding: '8px 14px',
                          borderBottom: i < detail.exits.length - 1 ? '1px solid var(--bg-elevated)' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', minWidth: 90 }}>
                          {e.symbol}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 10 }}>
                          <span>{EXIT_REASON_LABELS[e.exit_reason] || e.exit_reason}</span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{e.days_in_swingx ?? 0}d</span>
                          <span style={{ fontFamily: 'var(--font-mono)', color: ret >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                            {ret >= 0 ? '+' : ''}{ret.toFixed(1)}%
                          </span>
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default SwingXActivity
