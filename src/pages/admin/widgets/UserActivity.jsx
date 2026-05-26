import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// ── User Activity (DAU / WAU / absent users / academy graduates) ─────────────
// Lets admin send re-engagement or congratulations
// emails via the admin-send-email Netlify function.

const UserActivity = () => {
  const [stats, setStats] = useState(null)
  const [absentUsers, setAbsentUsers] = useState([])
  const [graduatedUsers, setGraduatedUsers] = useState([])
  const [showAbsent, setShowAbsent] = useState(false)
  const [showGraduated, setShowGraduated] = useState(false)
  const [sending, setSending] = useState(false)
  const [emailResult, setEmailResult] = useState(null)
  const [selected, setSelected] = useState([])

  useEffect(() => {
    loadStats()
  }, [])

  // WHY: Every count and list excludes rows with a null / empty
  // email. Those are orphan profile rows (OAuth sign-ups that
  // never persisted the email, manual SQL inserts, etc.). They
  // can't be re-engaged via email so showing them as "absent
  // users" overstates the real reachable audience.
  // `.not('email', 'is', null).neq('email', '')` runs as a
  // single AND on every query.
  const loadStats = async () => {
    const now = new Date()
    const day1ago  = new Date(now - 1  * 24 * 60 * 60 * 1000).toISOString()
    const day7ago  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString()
    const day10ago = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()

    const withRealEmail = (q) =>
      q.eq('is_active', true)
       .not('email', 'is', null)
       .neq('email', '')

    const [activeToday, active7d, absent10d, graduated] = await Promise.all([
      withRealEmail(
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .gte('last_active_at', day1ago)
      ),
      withRealEmail(
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .gte('last_active_at', day7ago)
      ),
      withRealEmail(
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .or(`last_active_at.lt.${day10ago},last_active_at.is.null`)
      ),
      withRealEmail(
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('academy_completed', true)
      ),
    ])

    setStats({
      today: activeToday.count || 0,
      week: active7d.count || 0,
      absent: absent10d.count || 0,
      graduated: graduated.count || 0,
    })
  }

  const loadAbsentUsers = async () => {
    const day10ago = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, last_active_at, created_at, academy_completed')
      .or(`last_active_at.lt.${day10ago},last_active_at.is.null`)
      .eq('is_active', true)
      .not('email', 'is', null)
      .neq('email', '')
      .order('last_active_at', { ascending: true, nullsFirst: true })
    setAbsentUsers(data || [])
    setShowAbsent(true)
  }

  const loadGraduatedUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, academy_completed_at, academy_score')
      .eq('academy_completed', true)
      .eq('is_active', true)
      .not('email', 'is', null)
      .neq('email', '')
      .order('academy_completed_at', { ascending: false })
    setGraduatedUsers(data || [])
    setShowGraduated(true)
  }

  const sendEmails = async (type, userIds) => {
    if (!userIds.length) return
    setSending(true)
    setEmailResult(null)

    const { data: { session } } = await supabase.auth.getSession()

    try {
      const res = await fetch('/.netlify/functions/admin-send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ type, userIds }),
      })
      const result = await res.json()
      setEmailResult(result)
    } catch (err) {
      setEmailResult({ error: err.message })
    }
    setSending(false)
  }

  const toggleSelect = (id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  const selectAll = (users) => {
    setSelected(users.map((u) => u.id))
  }

  if (!stats) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        Loading activity...
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Section header */}
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
        User Activity
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
          padding: '0 16px',
          marginBottom: 12,
        }}
      >
        {[
          { label: 'Active today', value: stats.today, color: 'var(--positive)', icon: '🟢' },
          { label: 'Active this week', value: stats.week, color: 'var(--info)', icon: '📅' },
          { label: 'Absent 10+ days', value: stats.absent, color: 'var(--warning)', icon: '😴', onClick: loadAbsentUsers, clickable: true },
          { label: 'Academy graduates', value: stats.graduated, color: 'var(--accent)', icon: '🎓', onClick: loadGraduatedUsers, clickable: true },
        ].map((stat) => (
          <div
            key={stat.label}
            onClick={stat.onClick}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '14px',
              cursor: stat.clickable ? 'pointer' : 'default',
              transition: 'all 0.15s',
            }}
          >
            <div
              style={{
                fontSize: 24,
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
                fontSize: 11,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{stat.icon}</span>
              {stat.label}
              {stat.clickable && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: stat.color }}>tap →</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Email result */}
      {emailResult && (
        <div
          style={{
            margin: '0 16px 12px',
            padding: '10px 14px',
            borderRadius: 8,
            background: emailResult.error ? 'var(--negative-dim)' : 'var(--accent-dim)',
            border: `1px solid ${emailResult.error ? 'var(--negative-dim)' : 'var(--accent-border)'}`,
            fontSize: 12,
            color: emailResult.error ? 'var(--negative)' : 'var(--accent)',
          }}
        >
          {emailResult.error
            ? `Error: ${emailResult.error}`
            : `✓ Sent: ${emailResult.sent} · Failed: ${emailResult.failed}`}
        </div>
      )}

      {/* Absent users panel */}
      {showAbsent && absentUsers.length > 0 && (
        <div
          style={{
            margin: '0 16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            marginBottom: 12,
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
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              Absent 10+ days ({absentUsers.length})
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => selectAll(absentUsers)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Select all
              </button>
              <button
                onClick={() =>
                  sendEmails(
                    'reengagement',
                    selected.filter((id) => absentUsers.some((u) => u.id === id)),
                  )
                }
                disabled={!selected.length || sending}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: selected.length ? 'var(--warning)' : 'var(--border)',
                  color: '#000',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: selected.length ? 'pointer' : 'default',
                }}
              >
                {sending
                  ? 'Sending...'
                  : `Send re-engagement (${selected.filter((id) => absentUsers.some((u) => u.id === id)).length})`}
              </button>
              <button
                onClick={() => { setShowAbsent(false); setSelected([]) }}
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
          </div>

          {absentUsers.map((u) => (
            <div
              key={u.id}
              onClick={() => toggleSelect(u.id)}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                background: selected.includes(u.id) ? 'rgba(251,191,36,0.06)' : 'transparent',
              }}
            >
              {/* Checkbox */}
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `2px solid ${selected.includes(u.id) ? 'var(--warning)' : 'var(--border)'}`,
                  background: selected.includes(u.id) ? 'var(--warning)' : 'transparent',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: '#000',
                }}
              >
                {selected.includes(u.id) && '✓'}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {u.full_name || u.email?.split('@')[0]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--warning)' }}>
                  {u.last_active_at
                    ? `${Math.floor((Date.now() - new Date(u.last_active_at)) / (1000 * 60 * 60 * 24))}d ago`
                    : 'Never'}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-disabled)', marginTop: 1 }}>
                  {u.academy_completed ? '🎓 graduated' : '📚 not completed'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Graduates panel */}
      {showGraduated && graduatedUsers.length > 0 && (
        <div
          style={{
            margin: '0 16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            marginBottom: 12,
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
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              Academy graduates ({graduatedUsers.length})
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => selectAll(graduatedUsers)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Select all
              </button>
              <button
                onClick={() =>
                  sendEmails(
                    'congratulations',
                    selected.filter((id) => graduatedUsers.some((u) => u.id === id)),
                  )
                }
                disabled={!selected.length || sending}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: selected.length ? 'var(--accent)' : 'var(--border)',
                  color: '#000',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: selected.length ? 'pointer' : 'default',
                }}
              >
                {sending
                  ? 'Sending...'
                  : `Send congrats (${selected.filter((id) => graduatedUsers.some((u) => u.id === id)).length})`}
              </button>
              <button
                onClick={() => { setShowGraduated(false); setSelected([]) }}
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
          </div>

          {graduatedUsers.map((u) => (
            <div
              key={u.id}
              onClick={() => toggleSelect(u.id)}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                background: selected.includes(u.id) ? 'rgba(0,200,5,0.06)' : 'transparent',
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `2px solid ${selected.includes(u.id) ? 'var(--accent)' : 'var(--border)'}`,
                  background: selected.includes(u.id) ? 'var(--accent)' : 'transparent',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: '#000',
                }}
              >
                {selected.includes(u.id) && '✓'}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {u.full_name || u.email?.split('@')[0]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {u.academy_score || 0}%
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-disabled)', marginTop: 1 }}>
                  {u.academy_completed_at
                    ? new Date(u.academy_completed_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })
                    : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default UserActivity
