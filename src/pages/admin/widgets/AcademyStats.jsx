import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// ── Academy Progress (completion rate + module breakdown + pending list) ────
// Pure read view over `profiles` (for the
// completion stats + pending list) and
// `user_module_progress` (for the per-module
// breakdown). No writes — admin uses this as a
// dashboard, not an editor.

const AcademyStats = () => {
  const [stats, setStats] = useState(null)
  const [daily, setDaily] = useState([])
  const [pending, setPending] = useState([])
  const [showPending, setShowPending] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    const now = new Date()
    const day1ago = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
    const day7ago = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [
      completedToday,
      completedWeek,
      completedTotal,
      pendingUsers,
      dailyData,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('academy_completed', true)
        .eq('is_active', true)
        .gte('academy_completed_at', day1ago),

      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('academy_completed', true)
        .eq('is_active', true)
        .gte('academy_completed_at', day7ago),

      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('academy_completed', true)
        .eq('is_active', true),

      // Pending = active, not completed, not grandfathered
      supabase
        .from('profiles')
        .select(
          'id, email, full_name, created_at, last_active_at, academy_deadline',
        )
        .eq('is_active', true)
        .eq('academy_completed', false)
        .eq('academy_grandfathered', false)
        .order('created_at', { ascending: false }),

      // Daily completions over last 14 days
      supabase
        .from('profiles')
        .select('academy_completed_at')
        .eq('academy_completed', true)
        .eq('is_active', true)
        .gte(
          'academy_completed_at',
          new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
        )
        .order('academy_completed_at', { ascending: true }),
    ])

    setStats({
      today: completedToday.count || 0,
      week: completedWeek.count || 0,
      total: completedTotal.count || 0,
      pending: pendingUsers.data?.length || 0,
    })
    setPending(pendingUsers.data || [])

    // HOW IT'S DERIVED — daily bar chart
    //   Take each profile's academy_completed_at,
    //   bucket by YYYY-MM-DD, then fill in zeros
    //   for any day in the 14-day window that
    //   had no completions so the bar gaps don't
    //   collapse.
    const dayMap = {}
    ;(dailyData.data || []).forEach((r) => {
      const day = r.academy_completed_at?.slice(0, 10)
      if (day) dayMap[day] = (dayMap[day] || 0) + 1
    })

    const days = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      days.push({
        date: key,
        label: d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
        }),
        count: dayMap[key] || 0,
      })
    }
    setDaily(days)
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading academy stats...
      </div>
    )
  }

  const maxCount = Math.max(...daily.map((d) => d.count), 1)

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
        Academy Progress
      </div>

      {/* Stat tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          padding: '0 16px',
          marginBottom: 16,
        }}
      >
        {[
          { label: 'Today', value: stats.today, color: 'var(--accent)', icon: '🎓' },
          { label: 'This week', value: stats.week, color: 'var(--info)', icon: '📅' },
          { label: 'Total done', value: stats.total, color: '#A78BFA', icon: '✅' },
          {
            label: 'Pending',
            value: stats.pending,
            color: 'var(--warning)',
            icon: '⏳',
            onClick: () => setShowPending((p) => !p),
            clickable: true,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            onClick={stat.onClick}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '12px 10px',
              cursor: stat.clickable ? 'pointer' : 'default',
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

      {/* 14-day bar chart */}
      <div
        style={{
          margin: '0 16px 14px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '14px 14px 10px',
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
          Completions — last 14 days
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
          {daily.map((d) => (
            <div
              key={d.date}
              title={`${d.label}: ${d.count} completed`}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                height: '100%',
                justifyContent: 'flex-end',
                gap: 3,
              }}
            >
              <div
                style={{
                  width: '100%',
                  borderRadius: '3px 3px 0 0',
                  background: d.count > 0 ? 'var(--accent)' : 'var(--border)',
                  height:
                    d.count > 0
                      ? `${Math.max((d.count / maxCount) * 52, 6)}px`
                      : '3px',
                  transition: 'height 0.3s',
                  position: 'relative',
                }}
              >
                {d.count > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -16,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--accent)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {d.count}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* X-axis labels — every 3rd day to avoid overlap */}
        <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
          {daily.map((d, i) => (
            <div
              key={d.date}
              style={{
                flex: 1,
                fontSize: 8,
                color: 'var(--text-hint)',
                textAlign: 'center',
                overflow: 'hidden',
              }}
            >
              {i % 3 === 0 ? d.label.split(' ')[0] : ''}
            </div>
          ))}
        </div>
      </div>

      {/* Module breakdown */}
      <ModuleBreakdown />

      {/* Pending users — expand by clicking the "Pending" tile */}
      {showPending && pending.length > 0 && (
        <div
          style={{
            margin: '0 16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}
            >
              Pending academy ({pending.length})
            </div>
            <button
              onClick={() => setShowPending(false)}
              aria-label="Dismiss"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 14,
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>

          {pending.map((u) => {
            const deadline = u.academy_deadline
            const daysLeft = deadline
              ? Math.ceil(
                  (new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24),
                )
              : null
            const isUrgent = daysLeft !== null && daysLeft <= 3

            return (
              <div
                key={u.id}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--bg-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {u.full_name || u.email?.split('@')[0]}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {u.email}
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {daysLeft !== null ? (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: isUrgent
                          ? 'var(--negative)'
                          : daysLeft <= 5
                          ? 'var(--warning)'
                          : 'var(--text-muted)',
                      }}
                    >
                      {daysLeft <= 0 ? 'Overdue' : `${daysLeft}d left`}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                      No deadline
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 9,
                      color: 'var(--text-disabled)',
                      marginTop: 2,
                    }}
                  >
                    Joined{' '}
                    {new Date(u.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ModuleBreakdown — completions per module ─────────────────────────────────
// Friendly names mapped from the academy
// content ids. Keep this in sync with
// scripts/academy/content/module*.json.

const MODULE_NAMES = {
  core_foundation: 'Core Foundation',
  volume_rules: 'Volume Rules',
  stage1_basing: 'Stage 1 Basing',
  stage2_advancing: 'Stage 2 Advancing',
  stage3_topping: 'Stage 3 Topping',
  stage4_declining: 'Stage 4 Declining',
  relative_strength_selection: 'RS & Selection',
  shortterm_50day: 'Short-term 50D',
}

const ModuleBreakdown = () => {
  const [data, setData] = useState([])

  useEffect(() => {
    supabase
      .from('user_module_progress')
      .select('module_id')
      .eq('lessons_completed', true)
      .then(({ data: rows }) => {
        if (!rows) return
        const counts = {}
        rows.forEach((r) => {
          counts[r.module_id] = (counts[r.module_id] || 0) + 1
        })

        const sorted = Object.entries(counts)
          .map(([id, count]) => ({
            id,
            name: MODULE_NAMES[id] || id,
            count,
          }))
          .sort((a, b) => b.count - a.count)

        setData(sorted)
      })
  }, [])

  if (!data.length) return null

  const max = Math.max(...data.map((d) => d.count), 1)

  return (
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
        Completions per module
      </div>

      {data.map((mod, i) => (
        <div key={mod.id} style={{ marginBottom: 8 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--text-muted)',
              marginBottom: 3,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '75%',
              }}
            >
              {mod.name}
            </span>
            <span
              style={{
                fontWeight: 700,
                color: 'var(--text-primary)',
                flexShrink: 0,
              }}
            >
              {mod.count}
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
                width: `${(mod.count / max) * 100}%`,
                background:
                  i === 0
                    ? 'var(--accent)'
                    : i === 1
                    ? 'var(--info)'
                    : 'var(--text-muted)',
                borderRadius: 3,
                transition: 'width 0.5s',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default AcademyStats
