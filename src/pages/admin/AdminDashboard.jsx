import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../../components/ui/Modal'
import Skeleton from '../../components/ui/Skeleton'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'

const C = {
  bg: '#05070A', surface: '#0B0F18', card: '#111620',
  border: 'var(--border)', text: 'var(--text-primary)', muted: 'var(--text-muted)', faint: '#3D4F63',
  green: '#34D399', greenDim: 'rgba(52,211,153,0.1)',
  red: '#F87171', redDim: 'rgba(248,113,113,0.1)',
  amber: 'var(--warning)', amberDim: 'rgba(251,191,36,0.1)',
  blue: '#38BDF8', blueDim: 'rgba(56,189,248,0.08)',
}
const HOVER = 'var(--bg-elevated)'
const INDIAN_API_CAP = 500

function parseMeta(meta) {
  if (meta == null) return {}
  if (typeof meta === 'object') return meta
  if (typeof meta === 'string') { try { return JSON.parse(meta) } catch { return {} } }
  return {}
}

function istCalendarDateParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = f.formatToParts(d)
  const pick = (t) => parts.find((p) => p.type === t)?.value || ''
  return { y: pick('year'), m: pick('month'), day: pick('day') }
}
function istTodayStartISO() {
  const { y, m, day } = istCalendarDateParts()
  return `${y}-${m}-${day}T00:00:00+05:30`
}
function istLastNDatesStrings(nDays) {
  const out = []
  for (let i = 0; i < nDays; i++) {
    const { y, m, day } = istCalendarDateParts(new Date(Date.now() - i * 86400000))
    out.push(`${y}-${m}-${day}`)
  }
  return out
}
function formatISTLine(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  return `${time} IST, ${date}`
}
function pickLatestRow(usageRow, adminRow, parseUsageMeta, parseAdminValue) {
  const uT = usageRow?.created_at ? new Date(usageRow.created_at).getTime() : 0
  const aT = adminRow?.created_at ? new Date(adminRow.created_at).getTime() : 0
  if (!uT && !aT) return null
  if (uT >= aT) return { source: 'usage_events', created_at: usageRow.created_at, meta: parseUsageMeta(usageRow) }
  return { source: 'admin_log', created_at: adminRow.created_at, meta: parseAdminValue(adminRow?.new_value) }
}
function isOverrideActive(row) {
  if (!row?.stage_override) return false
  const exp = row.stage_override_expires_at
  if (!exp) return true
  const t = new Date(exp).getTime()
  return Number.isFinite(t) && t > Date.now()
}
function fmtIntTotal(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }) }
async function safeTableCount(table) {
  try {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
    if (error) return null
    return typeof count === 'number' ? count : 0
  } catch { return null }
}
function failureScriptFromType(t) {
  const s = String(t || '')
  if (s.includes('price_data')) return 'fetch_price_data.py'
  if (s.includes('indianapi')) return 'fetch_indianapi.py'
  return s || '—'
}

// ── UI primitives ──────────────────────────────────────────────────

function SectionHeading({ icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <i className={`ti ${icon}`} style={{ fontSize: 14, color: C.muted }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
        {title}
      </span>
    </div>
  )
}

function Card({ children, style }) {
  return (
    <div style={{ background: C.card, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

function StatCard({ icon, label, value, color, dim }) {
  return (
    <Card>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: 0 }}>{label}</p>
          {icon && (
            <span style={{ width: 28, height: 28, borderRadius: 6, background: dim || C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={`ti ${icon}`} style={{ fontSize: 13, color: color || C.muted }} />
            </span>
          )}
        </div>
        <p style={{ fontSize: 24, fontWeight: 700, color: color || C.text, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      </div>
    </Card>
  )
}

function StatusDot({ ok }) {
  const color = ok === true ? C.green : ok === false ? C.red : C.muted
  const dim   = ok === true ? C.greenDim : ok === false ? C.redDim : 'transparent'
  return (
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, display: 'inline-block', flexShrink: 0 }} />
  )
}

const TH = {
  padding: '9px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: C.muted, textAlign: 'left',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const TD = { padding: '9px 14px', fontSize: 12, color: C.text, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

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

  const loadStats = async () => {
    const now = new Date()
    const day1ago = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
    const day7ago = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    const day10ago = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()

    const [activeToday, active7d, absent10d, graduated] = await Promise.all([
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('last_active_at', day1ago)
        .eq('is_active', true),

      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('last_active_at', day7ago)
        .eq('is_active', true),

      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .or(`last_active_at.lt.${day10ago},last_active_at.is.null`)
        .eq('is_active', true),

      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('academy_completed', true)
        .eq('is_active', true),
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

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(hasSupabaseEnv)
  const [stats, setStats]     = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [authUserCount, setAuthUserCount] = useState(null)
  const [logRows, setLogRows] = useState([])
  const [health, setHealth]   = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [failures, setFailures]   = useState([])
  const [confirmEodOpen, setConfirmEodOpen] = useState(false)
  const [eodBusy, setEodBusy] = useState(false)
  const [eodMsg,  setEodMsg]  = useState('')
  const [hoverRow, setHoverRow] = useState(null)
  const [calendarStatus, setCalendarStatus] = useState(null)

  useEffect(() => {
    if (!hasSupabaseEnv) return
    supabase
      .from('waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count || 0))
  }, [])

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true
    ;(async () => {
      try {
        const today = new Date().toISOString().split('T')[0]
        const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

        const [{ data: upcoming }, { data: latest }] = await Promise.all([
          supabase
            .from('result_calendar')
            .select('result_date, symbol')
            .gte('result_date', today)
            .lte('result_date', nextWeek)
            .limit(1),
          supabase
            .from('result_calendar')
            .select('created_at, result_date')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        if (!active) return

        const lastUpdated = latest?.created_at
        const daysSinceUpdate = lastUpdated
          ? Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 86400000)
          : 999

        setCalendarStatus({
          hasUpcoming: (upcoming?.length || 0) > 0,
          daysSinceUpdate,
          lastDate: latest?.result_date || null,
        })
      } catch (err) {
        if (!active) return
        console.warn('[AdminDashboard] result_calendar status check failed', err)
        setCalendarStatus(null)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const showCalendarBanner = Boolean(
    calendarStatus && (calendarStatus.daysSinceUpdate >= 5 || !calendarStatus.hasUpcoming),
  )

  useEffect(() => {
    if (!hasSupabaseEnv) { queueMicrotask(() => setLoading(false)); return }
    let active = true;
    (async () => {
      setLoading(true)
      const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString()
      const dauCutoff = new Date(Date.now() - 86400000).toISOString()
      const istToday = istTodayStartISO()

      const [
        totalCompaniesRes, approvedRes, profilesTotalRes,
        stage2Res, stage4Res, liteCosRes, logsRes,
        ueFinishedRes, alFinishedRes, indianSymCountRes,
        priceCt, delCt, newsCt, finCt, dauRes, failRes,
      ] = await Promise.all([
        supabase.from('companies').select('id', { count: 'exact', head: true }),
        supabase.from('companies').select('id', { count: 'exact', head: true }).eq('description_approved', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('price_data').select('id', { count: 'exact', head: true }).eq('is_latest', true).eq('stage', 'Stage 2'),
        supabase.from('price_data').select('id', { count: 'exact', head: true }).eq('is_latest', true).eq('stage', 'Stage 4'),
        supabase.from('companies').select('id,description,description_approved,stage_override,stage_override_expires_at,data_quality_flag').limit(20000),
        supabase.from('admin_log').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('usage_events').select('created_at,metadata').eq('event_type', 'fetch_price_data_finished').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('admin_log').select('created_at,new_value').eq('action', 'fetch_price_data_finished').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('event_type', 'fetch_indianapi_symbol').gte('created_at', istToday),
        safeTableCount('price_data'), safeTableCount('delivery_data'), safeTableCount('stock_news'),
        safeTableCount('financials'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active_at', dauCutoff),
        supabase.from('usage_events').select('created_at,event_type,metadata').in('event_type', ['fetch_price_data_failed', 'fetch_indianapi_failed']).gte('created_at', cutoff7d).order('created_at', { ascending: false }).limit(200),
      ])

      const viewDates = istLastNDatesStrings(7)
      let topViewed = []
      try {
        const { data: viewRows } = await supabase.from('daily_views').select('company_id').in('viewed_date', viewDates).limit(25000)
        const freq = {}
        for (const r of viewRows || []) { if (r.company_id) freq[r.company_id] = (freq[r.company_id] || 0) + 1 }
        const ranked = Object.entries(freq).map(([company_id, ct]) => ({ company_id, ct })).sort((a, b) => b.ct - a.ct).slice(0, 10)
        const ids = ranked.map((x) => x.company_id).filter(Boolean)
        if (ids.length) {
          const { data: symbols } = await supabase.from('companies').select('id,symbol').in('id', ids)
          const symById = Object.fromEntries((symbols || []).map((c) => [c.id, c.symbol]))
          topViewed = ranked.map((r) => ({ symbol: symById[r.company_id] || r.company_id, count: r.ct }))
        }
      } catch { topViewed = [] }

      const cos = liteCosRes.data || []
      const pendingDesc = cos.filter((c) => String(c.description || '').trim().length > 0 && c.description_approved !== true).length
      const overrides = cos.filter(isOverrideActive).length
      const dq = cos.filter((c) => { const f = c.data_quality_flag; return f != null && String(f).trim() !== '' }).length

      const lastEod = pickLatestRow(ueFinishedRes.data, alFinishedRes.data, (row) => parseMeta(row?.metadata), parseMeta)
      let eodSuccess = null, eodRowsText = '—'
      if (lastEod?.meta && typeof lastEod.meta === 'object') {
        const m = lastEod.meta
        const fail = Number(m.failed_symbols ?? m.failed ?? NaN)
        const ok = Number(m.success_symbols ?? m.success ?? NaN)
        if (Number.isFinite(fail) && Number.isFinite(ok)) { eodSuccess = fail === 0 && ok > 0; eodRowsText = `${ok} symbols` }
        else if (Number.isFinite(ok)) { eodSuccess = true; eodRowsText = `${ok} symbols` }
      }

      const apiUsed = indianSymCountRes.count ?? 0
      const dbTotals = [priceCt ?? 0, delCt ?? 0, newsCt ?? 0, finCt ?? 0]
      const dbLabels = ['price_data', 'delivery_data', 'stock_news', 'financials']

      if (!active) return
      setHealth({
        eodAt: lastEod?.created_at ?? null, eodOk: eodSuccess, eodRowsText,
        apiUsed, apiPctCap: Math.min(100, (apiUsed / INDIAN_API_CAP) * 100),
        dbCounts: dbLabels.map((name, i) => ({ name, count: dbTotals[i] ?? 0 })),
        dbSum: dbTotals.reduce((s, x) => s + x, 0),
      })
      setAnalytics({ dau: dauRes.count ?? 0, topViewed })
      setFailures((failRes.data || []).map((row) => {
        const meta = parseMeta(row.metadata)
        const err = meta.error ?? meta.message ?? ''
        return { id: `${row.created_at}-${row.event_type}-${meta.symbol || ''}`, created_at: row.created_at, symbol: meta.symbol ?? '—', error: String(err || '').slice(0, 500), script: failureScriptFromType(row.event_type) }
      }))
      setStats({
        row1: { totalCompanies: totalCompaniesRes.count ?? '—', approvedDesc: approvedRes.count ?? '—', overrides, profilesCt: profilesTotalRes.count ?? '—' },
        row2: { stage2: stage2Res.count ?? '—', stage4: stage4Res.count ?? '—', dq, pendingDesc },
      })
      setLogRows(logsRes.error ? [] : logsRes.data || [])
      setLoading(false)

      // Fetch real auth user count separately — doesn't block dashboard render
      fetch('/.netlify/functions/admin-list-users')
        .then(r => r.ok ? r.json() : null)
        .then(body => { if (active && body?.total != null) setAuthUserCount(body.total) })
        .catch(() => {})
    })()
    return () => { active = false }
  }, [])

  async function confirmRunEod() {
    setEodMsg(''); setEodBusy(true)
    try {
      const res = await fetch('/.netlify/functions/admin-trigger-eod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setEodMsg(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`); return }
      setEodMsg(typeof body?.message === 'string' ? body.message : 'Dispatch sent.')
      setConfirmEodOpen(false)
    } catch (e) {
      setEodMsg(e?.message || 'Network error.')
    } finally { setEodBusy(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[132, 220, 48, 200, 88, 220].map((h, i) => <Skeleton key={i} height={h} />)}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 1100 }}>

      {/* Result-calendar reminder */}
      {showCalendarBanner && (
        <div
          onClick={() => navigate('/admin/result-calendar')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/admin/result-calendar')
          }}
          style={{
            background: calendarStatus.daysSinceUpdate >= 7 ? 'var(--negative-dim)' : 'var(--warning-dim)',
            border: `1px solid ${calendarStatus.daysSinceUpdate >= 7 ? 'rgba(255,59,48,.3)' : 'rgba(251,191,36,.3)'}`,
            borderRadius: 8,
            padding: '12px 16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>{calendarStatus.daysSinceUpdate >= 7 ? '🔴' : '🟡'}</span>
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: calendarStatus.daysSinceUpdate >= 7 ? 'var(--negative)' : 'var(--warning)',
                  marginBottom: 2,
                }}
              >
                {calendarStatus.daysSinceUpdate >= 7 ? 'Result Calendar Overdue' : 'Result Calendar Update Needed'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {calendarStatus.daysSinceUpdate >= 999
                  ? "No calendar data found — paste this week's NSE board meetings"
                  : calendarStatus.daysSinceUpdate >= 7
                  ? `Last updated ${calendarStatus.daysSinceUpdate} days ago — paste new week`
                  : `Last updated ${calendarStatus.daysSinceUpdate} days ago — consider updating`}
                {calendarStatus.lastDate && (
                  <span style={{ marginLeft: 8, color: 'var(--text-hint)' }}>
                    · Last entry: {calendarStatus.lastDate}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Update now</span>
            <i className="ti ti-arrow-right" style={{ fontSize: 14 }} />
          </div>
        </div>
      )}

      {/* Page title */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>System health, analytics and recent activity</p>
      </div>

      {/* EOD confirm modal */}
      <Modal isOpen={confirmEodOpen} onClose={() => { if (!eodBusy) setConfirmEodOpen(false) }} title="Force run EOD pipeline">
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: '0 0 16px' }}>
          This dispatches the GitHub Actions workflow for daily market data (<code style={{ color: C.text }}>daily.yml</code>).
          Requires Netlify env <code style={{ color: C.text }}>GITHUB_DISPATCH_TOKEN</code> + <code style={{ color: C.text }}>GITHUB_REPOSITORY</code>.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={eodBusy} onClick={() => setConfirmEodOpen(false)}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: C.text, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" disabled={eodBusy} onClick={() => void confirmRunEod()}
            style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.green}33`, background: C.greenDim, color: C.green, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {eodBusy ? <><i className="ti ti-loader-2 animate-spin" style={{ fontSize: 15 }} />Running…</> : 'Confirm run'}
          </button>
        </div>
      </Modal>

      {/* ── System Health ── */}
      <section>
        <SectionHeading icon="ti-heartbeat" title="System Health" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>

          {/* EOD */}
          <Card>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: 0 }}>Last EOD Scrape</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot ok={health?.eodOk} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: health?.eodOk === true ? C.green : health?.eodOk === false ? C.red : C.muted }}>
                    {health?.eodOk === true ? 'Success' : health?.eodOk === false ? 'Failed' : 'Unknown'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: C.muted }}>Time</span>
                  <span style={{ fontSize: 11, color: C.text }}>{formatISTLine(health?.eodAt)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: C.muted }}>Updated</span>
                  <span style={{ fontSize: 11, color: C.text }}>{health?.eodRowsText}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* API */}
          <Card>
            <div style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: '0 0 12px' }}>IndianAPI Today (IST)</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{health?.apiUsed ?? 0}</span>
                <span style={{ fontSize: 12, color: C.muted }}>/ {INDIAN_API_CAP} calls</span>
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{
                  height: '100%', borderRadius: 99, transition: 'width 0.4s',
                  width: `${health?.apiPctCap ?? 0}%`,
                  background: (health?.apiPctCap ?? 0) < 60 ? C.green : (health?.apiPctCap ?? 0) <= 80 ? C.amber : C.red,
                }} />
              </div>
              <p style={{ fontSize: 10, color: C.faint, margin: 0 }}>Developer plan limit</p>
            </div>
          </Card>

          {/* DB counts */}
          <Card>
            <div style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: '0 0 12px' }}>Database Row Counts</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {(health?.dbCounts || []).map((row) => (
                  <div key={row.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: C.muted }}>{row.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtIntTotal(row.count)}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: C.muted }}>Total</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtIntTotal(health?.dbSum)}</span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ── KPIs ── */}
      <section>
        <SectionHeading icon="ti-chart-bar" title="KPIs — Volume" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          <StatCard icon="ti-building" label="Companies tracked" value={stats?.row1.totalCompanies ?? '—'} color={C.blue} dim={C.blueDim} />
          <StatCard icon="ti-file-check" label="Approved descriptions" value={stats?.row1.approvedDesc ?? '—'} color={C.green} dim={C.greenDim} />
          <StatCard icon="ti-users" label="Registered users" value={authUserCount ?? stats?.row1.profilesCt ?? '—'} color={C.text} />
          <StatCard icon="ti-replace" label="Stage overrides" value={stats?.row1.overrides ?? '—'} color={C.amber} dim={C.amberDim} />
        </div>
      </section>

      {/* ── Market Snapshot ── */}
      <section>
        <SectionHeading icon="ti-chart-candle" title="Market Snapshot" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          <StatCard icon="ti-trending-up" label="Uptrend stocks (Stage 2)" value={stats?.row2.stage2 ?? '—'} color={C.green} dim={C.greenDim} />
          <StatCard icon="ti-trending-down" label="Stage 4 stocks" value={stats?.row2.stage4 ?? '—'} color={C.red} dim={C.redDim} />
          <StatCard icon="ti-alert-triangle" label="Data quality flags" value={stats?.row2.dq ?? '—'} color={C.amber} dim={C.amberDim} />
          <StatCard icon="ti-clock" label="Pending descriptions" value={stats?.row2.pendingDesc ?? '—'} color={C.muted} />
        </div>
      </section>

      {/* ── User Analytics ── */}
      <section>
        <SectionHeading icon="ti-users" title="User Analytics" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          <Card>
            <div style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: '0 0 8px' }}>Daily Active Users (24h)</p>
              <p style={{ fontSize: 32, fontWeight: 800, color: C.text, margin: '0 0 6px', fontVariantNumeric: 'tabular-nums' }}>{analytics?.dau ?? 0}</p>
              <p style={{ fontSize: 11, color: C.faint, margin: 0 }}>Profiles active in the last 24 hours</p>
            </div>
          </Card>
          <Card>
            <div style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: '0 0 8px' }}>Top Viewed Stocks (7 days)</p>
              {(analytics?.topViewed?.length ?? 0) ? (
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {analytics.topViewed.map((item, idx) => (
                    <li key={item.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6, background: idx % 2 ? 'transparent' : HOVER }}>
                      <span style={{ fontSize: 10, color: C.faint, width: 14, textAlign: 'right' }}>{idx + 1}</span>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.text }}>{item.symbol}</span>
                      <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{item.count} opens</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>No view data yet.</p>
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* ── User Activity ── */}
      <section>
        <UserActivity />
      </section>

      {/* ── Waitlist ── */}
      <section>
        <SectionHeading icon="ti-users" title="Access" />
        <button
          type="button"
          onClick={() => navigate('/admin/waitlist')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '14px 16px', background: C.card, border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', marginBottom: 8, textAlign: 'left' }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Waitlist</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Manage access requests</div>
          </div>
          {pendingCount > 0 && (
            <span style={{ fontSize: 20, color: C.amber, fontWeight: 700 }}>{pendingCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate('/admin/email')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '14px 16px', background: C.card, border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', marginBottom: 8, textAlign: 'left' }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Email Templates</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Edit and preview system emails</div>
          </div>
          <span style={{ fontSize: 18 }}>✉️</span>
        </button>
      </section>

      {/* ── Manual Controls ── */}
      <section>
        <SectionHeading icon="ti-player-play" title="Manual Controls" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => { setEodMsg(''); setConfirmEodOpen(true) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', borderRadius: 8, border: `1px solid ${C.green}44`,
              background: C.greenDim, color: C.green, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <i className="ti ti-player-play" style={{ fontSize: 15 }} />
            Force run EOD pipeline
          </button>
          {eodMsg && <span style={{ fontSize: 12, color: C.muted }}>{eodMsg}</span>}
        </div>
      </section>

      {/* ── Pipeline Failures ── */}
      <section>
        <SectionHeading icon="ti-bug" title="Pipeline Failures (last 7 days)" />
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ background: C.card }}>
                  {['Time (IST)', 'Symbol', 'Error', 'Script'].map((h) => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {failures.length ? failures.map((r) => (
                  <tr key={r.id}
                    style={{ background: hoverRow === r.id ? HOVER : 'transparent' }}
                    onMouseEnter={() => setHoverRow(r.id)} onMouseLeave={() => setHoverRow(null)}>
                    <td style={{ ...TD, whiteSpace: 'nowrap', color: C.muted }}>{formatISTLine(r.created_at)}</td>
                    <td style={{ ...TD, fontWeight: 600 }}>{r.symbol}</td>
                    <td style={{ ...TD, wordBreak: 'break-all' }}>{r.error || '—'}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: C.muted }}>{r.script}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} style={{ ...TD, color: C.faint, textAlign: 'center', padding: '20px 14px' }}>No pipeline failures in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* ── Recent Admin Activity ── */}
      <section>
        <SectionHeading icon="ti-history" title="Recent Admin Activity" />
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ background: C.card }}>
                  {['Time (IST)', 'Admin', 'Action', 'Target', 'Change'].map((h) => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logRows.length ? logRows.map((r, idx) => (
                  <tr key={r.id || idx}
                    style={{ background: hoverRow === `log-${idx}` ? HOVER : 'transparent' }}
                    onMouseEnter={() => setHoverRow(`log-${idx}`)} onMouseLeave={() => setHoverRow(null)}>
                    <td style={{ ...TD, whiteSpace: 'nowrap', color: C.muted }}>{formatISTLine(r.created_at ?? r.createdAt)}</td>
                    <td style={{ ...TD }}>{r.admin_email ?? r.adminEmail ?? '—'}</td>
                    <td style={{ ...TD }}>{r.action ?? '—'}</td>
                    <td style={{ ...TD, fontSize: 11 }}>{[r.target_type, r.target_id].filter(Boolean).join(': ') || '—'}</td>
                    <td style={{ ...TD, fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={`${r.old_value || ''} → ${r.new_value || ''}`}>
                      <span style={{ color: C.muted }}>{r.old_value || '∅'}</span>
                      <span style={{ color: C.faint, margin: '0 4px' }}>→</span>
                      {r.new_value || '∅'}
                      {r.notes ? <span style={{ color: C.faint }}> — {r.notes}</span> : null}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} style={{ ...TD, color: C.faint, textAlign: 'center', padding: '20px 14px' }}>No admin log entries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  )
}
