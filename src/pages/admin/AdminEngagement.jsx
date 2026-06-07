import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell,
  LineChart, Line,
} from 'recharts'
import { supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

// ── /admin/engagement ────────────────────────────────────────────────────
// Four tabs:
//   1. Streak Overview   — bar chart of users per streak bucket + quick stats
//   2. Referrals         — table of referrals.* with status colour coding
//   3. Questions         — daily-question responses, last 7 days, expandable
//   4. 🔬 Research AI    — BYOK Gemini usage (counts only; never content)
//
// All four pull their own data on first render and cache in state. Switching
// tabs does not refetch.

const STREAK_BUCKETS = [
  { label: '0 days',  test: d => d === 0 },
  { label: '1-3',     test: d => d >= 1 && d <= 3 },
  { label: '4-7',     test: d => d >= 4 && d <= 7 },
  { label: '8-14',    test: d => d >= 8 && d <= 14 },
  { label: '15-30',   test: d => d >= 15 && d <= 30 },
  { label: '30+',     test: d => d > 30 },
]

const STATUS_COLOURS = {
  pending:        C.amber,
  registered:     C.blue,
  module1_done:   C.green,
  active_30_days: C.green,
  fully_rewarded: C.amber,
}

// ── Helpers ─────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

function fmtDateShort(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  } catch {
    return iso.slice(5, 10)
  }
}

function fmtRelative(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return fmtDate(iso)
  const mins  = Math.floor(ms / 60000)
  const hours = Math.floor(ms / 3600000)
  const days  = Math.floor(ms / 86400000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  < 7)  return `${days}d ago`
  return fmtDate(iso)
}

function firstNameLastInitial(fullName, email) {
  const n = (fullName || '').trim()
  if (n) {
    const parts = n.split(/\s+/)
    if (parts.length === 1) return parts[0]
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
  }
  const e = (email || '').trim()
  if (e) return e.split('@')[0]
  return '—'
}

function H1({ children }) {
  return (
    <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
      {children}
    </h1>
  )
}

function Stat({ label, value, color = C.text, sub }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '14px 16px',
      minWidth: 160,
      flex: '1 1 160px',
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub ? <div style={{ marginTop: 2, fontSize: 11, color: C.textMuted }}>{sub}</div> : null}
    </div>
  )
}

// ── Tab bar (matches AdminPoints pattern) ───────────────────────────────
function TabBar({ value, onChange, tabs }) {
  return (
    <div style={{
      display: 'flex', gap: 4, flexWrap: 'wrap',
      borderBottom: `1px solid ${C.border}`,
      marginBottom: 18,
    }}>
      {tabs.map(t => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              padding: '10px 16px',
              background: active ? C.surface2 : 'transparent',
              border: 'none',
              borderBottom: `2px solid ${active ? C.amber : 'transparent'}`,
              color: active ? C.text : C.textMuted,
              fontSize: 13, fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Tab 1: Streak overview ──────────────────────────────────────────────
function StreakOverview({ streaks }) {
  const chartData = useMemo(() => STREAK_BUCKETS.map(b => ({
    name: b.label,
    users: streaks.filter(s => b.test(s)).length,
  })), [streaks])

  const activeStreaks = streaks.filter(s => s > 0)
  const avg = activeStreaks.length
    ? Math.round(activeStreaks.reduce((a, b) => a + b, 0) / activeStreaks.length)
    : 0
  const longest = streaks.length ? Math.max(...streaks) : 0
  const sevenPlus = streaks.filter(s => s >= 7).length
  const zero = streaks.filter(s => s === 0).length

  return (
    <section>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Average streak"        value={`${avg}d`} />
        <Stat label="Longest active streak" value={`${longest}d`} color={C.amber} />
        <Stat label="Users 7+ day streak"   value={sevenPlus} color={C.green} />
        <Stat label="Users with 0 streak"   value={zero} color={C.textMuted} />
      </div>

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 16, height: 280,
      }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
            <Tooltip
              contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }}
              labelStyle={{ color: C.textMuted }}
              cursor={{ fill: `${C.amber}22` }}
            />
            <Bar dataKey="users" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.users > 0 ? C.amber : C.border} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

// ── Tab 2: Referral tracking ────────────────────────────────────────────
function ReferralTracking({ rows }) {
  const total = rows.length
  const registered = rows.filter(r => r.status && r.status !== 'pending').length
  const conversionRate = total > 0 ? Math.round((registered / total) * 100) : 0

  return (
    <section>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <Stat label="Total referrals"   value={total} />
        <Stat label="Conversion rate"   value={`${conversionRate}%`} color={C.green} />
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Referrer', 'Referee', 'Status', 'Points awarded', 'Date'].map(h => (
                <th key={h} style={{
                  padding: '10px 12px', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: C.textMuted, textAlign: 'left',
                  borderBottom: `1px solid ${C.border}`,
                  background: C.surface,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: C.textFaint }}>
                No referrals tracked yet.
              </td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.id || i} style={{ background: i % 2 ? C.surface : C.base }}>
                <td style={{ padding: '10px 12px', color: C.text }}>{r.referrer_email || r.referrer_id || '—'}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{r.referee_email || r.referee_id || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 99,
                    background: `${STATUS_COLOURS[r.status] || C.textMuted}22`,
                    color: STATUS_COLOURS[r.status] || C.textMuted,
                    fontSize: 10, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>
                    {(r.status || 'pending').replace(/_/g, ' ')}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: C.amber, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {r.points_awarded ? `+${r.points_awarded}` : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: C.textMuted }}>{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Tab 3: Daily question responses ─────────────────────────────────────
function DailyQuestions({ questions, responses }) {
  const [expanded, setExpanded] = useState(null)

  const responsesByQ = useMemo(() => {
    const m = {}
    for (const r of responses) {
      if (!r.question_id) continue
      m[r.question_id] = m[r.question_id] || []
      m[r.question_id].push(r)
    }
    return m
  }, [responses])

  return (
    <section>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {questions.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: C.textFaint }}>
            No daily questions in the last 7 days yet.
          </div>
        ) : questions.map((q, i) => {
          const resp = responsesByQ[q.id] || []
          const isOpen = expanded === q.id
          const featured = resp.find(r => r.is_featured)

          return (
            <div key={q.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
              <button
                type="button"
                onClick={() => setExpanded(prev => prev === q.id ? null : q.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '12px 14px',
                  background: i % 2 ? C.surface : C.base,
                  border: 'none', cursor: 'pointer',
                  color: C.text,
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <span style={{ fontSize: 11, color: C.textMuted, minWidth: 60 }}>{fmtDate(q.date || q.created_at)}</span>
                <span style={{ flex: 1, fontSize: 13, color: C.text, fontWeight: isOpen ? 700 : 500 }}>
                  {q.question || '—'}
                </span>
                <span style={{ fontSize: 12, color: C.textMuted, minWidth: 80, textAlign: 'right' }}>
                  {resp.length} {resp.length === 1 ? 'reply' : 'replies'}
                </span>
                <span style={{ fontSize: 12, color: featured ? C.amber : C.textMuted, minWidth: 90 }}>
                  {featured ? '⭐ featured' : '—'}
                </span>
                <span style={{ color: C.textMuted }}>{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div style={{ padding: '8px 14px 14px', background: C.surface2 }}>
                  {resp.length === 0 ? (
                    <p style={{ color: C.textFaint, fontSize: 12, margin: 0 }}>No responses yet.</p>
                  ) : resp.map((r, j) => (
                    <div key={r.id || j} style={{
                      padding: '8px 10px',
                      borderLeft: r.is_featured ? `3px solid ${C.amber}` : `3px solid ${C.border}`,
                      background: C.surface,
                      borderRadius: 4,
                      marginBottom: 6,
                    }}>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{r.response || r.text || '—'}</div>
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                        {r.user_email || r.user_id || '—'} · {fmtDate(r.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Tab 4: 🔬 Research AI ───────────────────────────────────────────────
// Aggregated usage_events view. We never read question or response text —
// that data was never logged in the first place. The table here shows
// counts + last-used timestamps only.
function ResearchAI({ events, profilesById }) {
  // Aggregations
  const totalEvents = events.length

  const thirtyDaysAgoMs = Date.now() - 30 * 86400000
  const todayUtcMidnight = new Date()
  todayUtcMidnight.setUTCHours(0, 0, 0, 0)
  const todayMs = todayUtcMidnight.getTime()

  const activeUserIds = new Set()
  let questionsToday = 0
  const byUser = {}      // uid -> { count, last_used, days: Set<yyyy-mm-dd> }
  const byDay  = {}      // yyyy-mm-dd -> count

  for (const ev of events) {
    const uid = ev.user_id || (ev.metadata && ev.metadata.user_id) || null
    const ts  = new Date(ev.created_at).getTime()
    const day = (ev.created_at || '').slice(0, 10)

    if (uid && ts >= thirtyDaysAgoMs) activeUserIds.add(uid)
    if (ts >= todayMs) questionsToday += 1

    if (uid) {
      const u = byUser[uid] || { count: 0, last_used: null, days: new Set() }
      u.count += 1
      if (!u.last_used || ts > new Date(u.last_used).getTime()) u.last_used = ev.created_at
      if (day) u.days.add(day)
      byUser[uid] = u
    }

    if (day) byDay[day] = (byDay[day] || 0) + 1
  }

  // User list with profile join
  const userRows = useMemo(() => {
    return Object.entries(byUser).map(([uid, u]) => {
      const p = profilesById[uid] || {}
      return {
        uid,
        name: firstNameLastInitial(p.full_name, p.email),
        email: p.email || '—',
        plan: p.plan || (p.plan === null ? '—' : (p.plan || 'free')),
        question_count: u.count,
        active_days: u.days.size,
        last_used: u.last_used,
      }
    }).sort((a, b) => b.question_count - a.question_count)
  }, [byUser, profilesById])

  // Top researcher card
  const topResearcher = userRows[0] || null

  // Last 14 days line chart
  const trendData = useMemo(() => {
    const out = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setUTCHours(0, 0, 0, 0)
      d.setUTCDate(d.getUTCDate() - i)
      const key = d.toISOString().slice(0, 10)
      out.push({ date: key, label: fmtDateShort(key), count: byDay[key] || 0 })
    }
    return out
  }, [byDay])

  return (
    <section>
      {/* SECTION A — summary stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <Stat
          label="Total AI questions asked"
          value={totalEvents.toLocaleString('en-IN')}
          color={C.amber}
        />
        <Stat
          label="Users with active key"
          value={activeUserIds.size}
          color={C.green}
          sub="Used in last 30 days"
        />
        <Stat
          label="Questions today"
          value={questionsToday}
          color={C.amber}
        />
        <Stat
          label="Most active researcher"
          value={topResearcher ? topResearcher.name : '—'}
          color={C.text}
          sub={topResearcher
            ? `${topResearcher.question_count} question${topResearcher.question_count === 1 ? '' : 's'}`
            : 'No activity yet'}
        />
      </div>

      {/* SECTION B — user list */}
      <h3 style={{
        fontSize: 13, fontWeight: 700, color: C.text,
        margin: '0 0 8px', letterSpacing: '0.02em',
      }}>
        Who uses Research Assistant
      </h3>

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, overflow: 'hidden', marginBottom: 8,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Name', 'Email', 'Questions Asked', 'Active Days', 'Last Used', 'Plan'].map(h => (
                <th key={h} style={{
                  padding: '10px 12px', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: C.textMuted, textAlign: 'left',
                  borderBottom: `1px solid ${C.border}`,
                  background: C.surface,
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {userRows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: C.textFaint }}>
                No Research Assistant questions yet. Once users save a Gemini key
                and ask a question, they will appear here.
              </td></tr>
            ) : userRows.map((r) => (
              <tr key={r.uid} style={{ background: C.surface }}>
                <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 11 }}>{r.email}</td>
                <td style={{ padding: '10px 12px', color: C.amber, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {r.question_count.toLocaleString('en-IN')}
                </td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                  {r.active_days}
                </td>
                <td style={{ padding: '10px 12px', color: C.textMuted }}>{fmtRelative(r.last_used)}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 99,
                    background: r.plan === 'paid' ? `${C.amber}22` : `${C.textMuted}22`,
                    color: r.plan === 'paid' ? C.amber : C.textMuted,
                    fontSize: 10, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>
                    {r.plan || 'free'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Privacy note */}
      <p style={{
        fontSize: 11, color: C.textFaint, margin: '0 0 22px',
        lineHeight: 1.5, fontStyle: 'italic',
      }}>
        ⓘ Question content is never logged. PineX only records that a question
        was asked and which stock context was used. API keys are never sent to
        PineX servers — they live in the user&apos;s browser only.
      </p>

      {/* SECTION C — usage trend (last 14 days) */}
      <h3 style={{
        fontSize: 13, fontWeight: 700, color: C.text,
        margin: '0 0 8px', letterSpacing: '0.02em',
      }}>
        Usage trend — last 14 days
      </h3>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 16, height: 240,
      }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }}
              labelStyle={{ color: C.textMuted }}
              cursor={{ stroke: C.amber, strokeWidth: 1, strokeDasharray: '3 3' }}
              formatter={(v) => [v, 'Questions']}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={C.amber}
              strokeWidth={2}
              dot={{ r: 3, fill: C.amber, stroke: C.amber }}
              activeDot={{ r: 5, fill: C.amber }}
              isAnimationActive={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

// ── Top level ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'streaks',   label: 'Streak Overview' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'questions', label: 'Questions' },
  { key: 'research',  label: '🔬 Research AI' },
]

export default function AdminEngagement() {
  const [tab, setTab] = useState('streaks')
  const [streaks, setStreaks] = useState(null)
  const [referrals, setReferrals] = useState(null)
  const [questions, setQuestions] = useState(null)
  const [responses, setResponses] = useState(null)
  const [researchEvents, setResearchEvents] = useState(null)
  const [profilesById, setProfilesById] = useState({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const sevenDayDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

      // All four datasets pulled in parallel. Each individual query catches
      // its own error so one missing table doesn't blank the whole page.
      const [pts, refs, qs, resp, researchData] = await Promise.all([
        supabase.from('user_points').select('current_streak').limit(5000)
          .then(r => r).catch(() => ({ data: [] })),
        supabase.from('referrals').select('*').order('created_at', { ascending: false }).limit(200)
          .then(r => r).catch(() => ({ data: [] })),
        supabase.from('daily_questions').select('*').gte('date', sevenDayDate).order('date', { ascending: false }).limit(20)
          .then(r => r).catch(() => ({ data: [] })),
        supabase.from('question_responses').select('*').gte('created_at', weekAgo).limit(500)
          .then(r => r).catch(() => ({ data: [] })),
        // Research events — capped at 5000 most recent to keep client work
        // bounded. We aggregate counts/active-days client-side from this
        // window. If a single user ever exceeds 5000 events the count is
        // still right within the window; surface that limit if it becomes
        // an issue.
        supabase.from('usage_events')
          .select('user_id,metadata,created_at')
          .eq('event_type', 'research_question_asked')
          .order('created_at', { ascending: false })
          .limit(5000)
          .then(r => r).catch(() => ({ data: [] })),
      ])

      if (cancelled) return
      setStreaks((pts.data || []).map(r => Number(r.current_streak) || 0))
      setReferrals(refs.data || [])
      setQuestions(qs.data || [])
      setResponses(resp.data || [])
      setResearchEvents(researchData.data || [])

      // Pull profile rows for the union of user_ids we'll need for the
      // Research AI tab. Falls back gracefully if profiles is unreadable.
      const uids = new Set()
      for (const ev of (researchData.data || [])) {
        const uid = ev.user_id || (ev.metadata && ev.metadata.user_id) || null
        if (uid) uids.add(uid)
      }
      if (uids.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id,email,full_name,plan')
          .in('id', Array.from(uids))
          .then(r => r).catch(() => ({ data: [] }))
        if (cancelled) return
        const map = {}
        for (const p of (profs || [])) map[p.id] = p
        setProfilesById(map)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const stillLoading =
    streaks === null ||
    referrals === null ||
    questions === null ||
    responses === null ||
    researchEvents === null

  if (stillLoading) {
    return <p style={{ color: C.textMuted }}>Loading…</p>
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <H1>Engagement</H1>
      <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 18px' }}>
        Streak distribution, referral funnel, daily-question responses, and
        Research Assistant usage (counts only — question content is never logged).
      </p>

      <TabBar value={tab} onChange={setTab} tabs={TABS} />

      {tab === 'streaks'   && <StreakOverview streaks={streaks} />}
      {tab === 'referrals' && <ReferralTracking rows={referrals} />}
      {tab === 'questions' && <DailyQuestions questions={questions} responses={responses} />}
      {tab === 'research'  && <ResearchAI events={researchEvents} profilesById={profilesById} />}
    </div>
  )
}
