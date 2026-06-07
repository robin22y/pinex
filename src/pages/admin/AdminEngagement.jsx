import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell,
  LineChart, Line, Legend, PieChart, Pie,
} from 'recharts'
import { supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'
import { calculateCostInr } from '../../lib/researchAssistant'

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
// only the telemetry written by logResearchUsage: token counts, finish
// reason, latency, and an estimated INR cost (calculateCostInr applied
// to the same input/output token counts the user spent on their own
// Gemini quota).
//
// Two queries feed this view: the research_question_asked events, and
// the separate trading_framework_consent events. The trading consent
// count is shown both directly (in the user-cost row) and via the
// category breakdown bar chart.

const CATEGORY_LABELS = {
  valuation:    '📊 Valuation',
  growth:       '📈 Growth',
  shareholding: '👥 Shareholding',
  quarterly:    '📋 Quarterly',
  cycle:        '🔄 Cycle',
  trading:      '🎯 Trading',
  freetext:     '✍️ Free-text',
}

const FINISH_REASON_COLORS = {
  STOP:        C.green,
  SAFETY:      C.red,
  MAX_TOKENS:  C.amber,
  RECITATION:  C.amber,
  ERROR:       C.amber,
  OTHER:       C.textMuted,
  UNKNOWN:     C.textMuted,
}

function ResearchAI({ events, profilesById, tradingConsentCount, keySaveEvents }) {
  const thirtyDaysAgoMs = Date.now() - 30 * 86400000
  const sevenDaysAgoMs  = Date.now() - 7  * 86400000
  const todayUtcMidnight = new Date()
  todayUtcMidnight.setUTCHours(0, 0, 0, 0)
  const todayMs = todayUtcMidnight.getTime()

  // ── Single pass aggregation ─────────────────────────────────────────
  const agg = useMemo(() => {
    let total = 0
    let today = 0
    let week  = 0
    let blocked = 0
    let totalTokens = 0
    let totalResponseTime = 0
    let totalCost = 0
    let timedRows = 0      // rows that actually carried a response_time_ms
    let tokenRows = 0      // rows that actually carried token counts
    const activeUsers = new Set()
    const finishReasonCounts = {}
    const categoryCounts = {}
    const byUser = {}      // uid -> { count, tokens, time_sum, time_n, blocked, last_used, days }
    const byDayTokens = {} // yyyy-mm-dd -> { input, output, count }

    for (const ev of events) {
      total += 1
      const meta = ev.metadata || {}
      const uid = ev.user_id || meta.user_id || null
      const ts  = new Date(ev.created_at).getTime()
      const day = (ev.created_at || '').slice(0, 10)
      const inputTok  = Number(meta.input_tokens)  || 0
      const outputTok = Number(meta.output_tokens) || 0
      const totalTok  = Number(meta.total_tokens)  || (inputTok + outputTok)
      const responseMs = Number(meta.response_time_ms) || 0
      const cost = Number(meta.cost_inr) || calculateCostInr(inputTok, outputTok)
      const fr  = meta.finish_reason || 'UNKNOWN'
      const cat = meta.category || 'freetext'
      const wasBlocked = meta.was_blocked === true || fr === 'SAFETY'

      if (ts >= todayMs)        today += 1
      if (ts >= sevenDaysAgoMs) week  += 1
      if (uid && ts >= thirtyDaysAgoMs) activeUsers.add(uid)
      if (wasBlocked) blocked += 1
      if (totalTok > 0) { totalTokens += totalTok; tokenRows += 1 }
      if (responseMs > 0) { totalResponseTime += responseMs; timedRows += 1 }
      totalCost += cost

      finishReasonCounts[fr] = (finishReasonCounts[fr] || 0) + 1
      categoryCounts[cat]    = (categoryCounts[cat] || 0) + 1

      if (uid) {
        const u = byUser[uid] || {
          count: 0, tokens: 0, time_sum: 0, time_n: 0,
          blocked: 0, last_used: null, days: new Set(),
        }
        u.count   += 1
        u.tokens  += totalTok
        if (responseMs > 0) { u.time_sum += responseMs; u.time_n += 1 }
        if (wasBlocked) u.blocked += 1
        if (!u.last_used || ts > new Date(u.last_used).getTime()) u.last_used = ev.created_at
        if (day) u.days.add(day)
        byUser[uid] = u
      }

      if (day) {
        const d = byDayTokens[day] || { input: 0, output: 0, count: 0 }
        d.input  += inputTok
        d.output += outputTok
        d.count  += 1
        byDayTokens[day] = d
      }
    }

    return {
      total, today, week, blocked,
      activeUsers: activeUsers.size,
      avgTokens: tokenRows > 0 ? Math.round(totalTokens / tokenRows) : 0,
      avgResponseTime: timedRows > 0 ? Math.round(totalResponseTime / timedRows) : 0,
      totalCost: Math.round(totalCost * 1000) / 1000,
      finishReasonCounts,
      categoryCounts,
      byUser,
      byDayTokens,
    }
  }, [events])

  const userRows = useMemo(() => {
    return Object.entries(agg.byUser).map(([uid, u]) => {
      const p = profilesById[uid] || {}
      return {
        uid,
        name: firstNameLastInitial(p.full_name, p.email),
        email: p.email || '—',
        plan: p.plan || 'free',
        question_count: u.count,
        total_tokens: u.tokens,
        avg_time_ms: u.time_n > 0 ? Math.round(u.time_sum / u.time_n) : 0,
        blocked: u.blocked,
        last_used: u.last_used,
      }
    }).sort((a, b) => b.question_count - a.question_count)
  }, [agg.byUser, profilesById])

  // Last 30 days token trend
  const tokenTrend = useMemo(() => {
    const out = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setUTCHours(0, 0, 0, 0)
      d.setUTCDate(d.getUTCDate() - i)
      const key = d.toISOString().slice(0, 10)
      const row = agg.byDayTokens[key] || { input: 0, output: 0 }
      out.push({ date: key, label: fmtDateShort(key), input: row.input, output: row.output })
    }
    return out
  }, [agg.byDayTokens])

  // Finish reason pie data
  const finishPieData = useMemo(() => {
    return Object.entries(agg.finishReasonCounts)
      .map(([key, value]) => ({ name: key, value }))
      .sort((a, b) => b.value - a.value)
  }, [agg.finishReasonCounts])

  // Category bar data
  const categoryBarData = useMemo(() => {
    return Object.entries(agg.categoryCounts)
      .map(([key, value]) => ({ key, name: CATEGORY_LABELS[key] || key, value }))
      .sort((a, b) => b.value - a.value)
  }, [agg.categoryCounts])

  // Latency tier
  const latencyTier =
    agg.avgResponseTime === 0 ? { label: '—',         icon: '',   color: C.textMuted } :
    agg.avgResponseTime < 1500 ? { label: 'Fast',     icon: '✅', color: C.green } :
    agg.avgResponseTime < 3000 ? { label: 'Normal',   icon: '🟡', color: C.amber } :
                                 { label: 'Slow',     icon: '🔴', color: C.red }

  // ── Funnel: registered (saved a key) vs. active (asked at least one question)
  // 'registered' counts distinct user_ids from research_key_saved events.
  // A user who deletes + re-adds a key generates multiple rows — DISTINCT
  // de-dupes. Activation = active / registered.
  // sevenDaysAgoMs is computed inside the useMemo (the outer agg useMemo
  // declares the same constant at component scope; redeclaring it here
  // would be a hoisting collision — keep it block-scoped).
  const funnel = useMemo(() => {
    const sevenAgo = Date.now() - 7 * 86400000
    const registeredUsers = new Set()
    const registeredWeek  = new Set()
    for (const ev of (keySaveEvents || [])) {
      const uid = ev.user_id || (ev.metadata && ev.metadata.user_id) || null
      if (!uid) continue
      registeredUsers.add(uid)
      const ts = new Date(ev.created_at).getTime()
      if (ts >= sevenAgo) registeredWeek.add(uid)
    }
    // 'asked at least one' = the user-question Set we already built.
    const askedUsers = new Set(Object.keys(agg.byUser))
    // Activation rate: of users with a key, how many actually used it?
    const activationRate = registeredUsers.size > 0
      ? Math.round((askedUsers.size / registeredUsers.size) * 100)
      : 0
    return {
      registered: registeredUsers.size,
      registeredWeek: registeredWeek.size,
      asked: askedUsers.size,
      activationRate,
    }
  }, [keySaveEvents, agg.byUser])

  return (
    <section>
      {/* Safety notice — top of tab */}
      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.blue}`,
        borderRadius: 10,
        padding: '12px 14px',
        marginBottom: 18,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <span style={{ color: C.blue, fontSize: 16, lineHeight: 1.2 }}>ℹ️</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            NSE &amp; SEBI Safe
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.55 }}>
            These metrics are API usage telemetry — not market data. NSE and SEBI
            have no interest in how many AI questions users asked. Question content
            is never logged anywhere.
          </div>
        </div>
      </div>

      {/* Row 0 — registration funnel
          Registered    = distinct user_ids with research_key_saved events
          Asked at least 1 question = distinct user_ids in research_question_asked
          Activation rate = asked / registered (as %)
          New keys this week = registered with created_at >= 7d ago
          Use this to spot drop-off: high registered, low asked = users
          set up the key but never used it (onboarding issue). */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat
          label="Keys Registered"
          value={funnel.registered.toLocaleString('en-IN')}
          color={C.amber}
          sub="users who saved a verified key"
        />
        <Stat
          label="Actually Used It"
          value={funnel.asked.toLocaleString('en-IN')}
          color={C.green}
          sub="asked ≥ 1 question"
        />
        <Stat
          label="Activation Rate"
          value={`${funnel.activationRate}%`}
          color={
            funnel.activationRate >= 70 ? C.green
            : funnel.activationRate >= 40 ? C.amber
            : C.red
          }
          sub="used / registered"
        />
        <Stat
          label="New Keys This Week"
          value={funnel.registeredWeek.toLocaleString('en-IN')}
          color={C.blue}
        />
      </div>

      {/* Row 1 — volume stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Total Questions" value={agg.total.toLocaleString('en-IN')} color={C.amber} />
        <Stat label="Today"            value={agg.today} color={C.amber} />
        <Stat label="This Week"        value={agg.week} />
        <Stat label="Active Users (30d)" value={agg.activeUsers} color={C.green} />
      </div>

      {/* Row 2 — quality + cost stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <Stat
          label="Blocked Responses"
          value={agg.blocked}
          color={agg.blocked > 0 ? C.red : C.textMuted}
          sub={agg.total > 0 ? `${((agg.blocked / agg.total) * 100).toFixed(1)}% of all` : '—'}
        />
        <Stat
          label="Avg Tokens"
          value={agg.avgTokens.toLocaleString('en-IN')}
          sub="per question"
        />
        <Stat
          label="Avg Response Time"
          value={agg.avgResponseTime > 0 ? `${agg.avgResponseTime}ms` : '—'}
          color={latencyTier.color}
          sub={`${latencyTier.icon} ${latencyTier.label}`}
        />
        <Stat
          label="Est User Cost"
          value={`Rs. ${agg.totalCost.toFixed(2)}`}
          color={C.text}
          sub="paid by users (not PineX)"
        />
      </div>

      {/* Cost disclaimer */}
      <p style={{
        fontSize: 11, color: C.textFaint,
        margin: '0 0 18px', lineHeight: 1.55, fontStyle: 'italic',
      }}>
        ⓘ This is your users&apos; estimated API cost — not PineX&apos;s cost.
        PineX pays Rs.0 for this feature. Each user pays Google directly via
        their own Gemini key (free tier covers up to 1,500 requests/day).
      </p>

      {/* Row 3 — token trend chart */}
      <h3 style={{
        fontSize: 13, fontWeight: 700, color: C.text,
        margin: '0 0 8px', letterSpacing: '0.02em',
      }}>
        Token usage — last 30 days
      </h3>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 16, height: 260, marginBottom: 22,
      }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={tokenTrend} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }}
              labelStyle={{ color: C.textMuted }}
              cursor={{ stroke: C.amber, strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: C.textMuted }}
              iconType="line"
            />
            <Line
              type="monotone" dataKey="input"  name="Input tokens"  stroke={C.blue}
              strokeWidth={2} dot={{ r: 2, fill: C.blue }}
              isAnimationActive={true}
            />
            <Line
              type="monotone" dataKey="output" name="Output tokens" stroke={C.amber}
              strokeWidth={2} dot={{ r: 2, fill: C.amber }}
              isAnimationActive={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Row 4 + 5 — quality breakdown + category bar (side-by-side on wide) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 16, marginBottom: 22,
      }}>
        {/* Quality breakdown */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: 16,
        }}>
          <h3 style={{
            fontSize: 13, fontWeight: 700, color: C.text,
            margin: '0 0 10px',
          }}>
            Response quality
          </h3>
          {finishPieData.length === 0 ? (
            <p style={{ color: C.textMuted, fontSize: 12, margin: 0 }}>No data yet.</p>
          ) : (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ width: 140, height: 140, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={finishPieData}
                      dataKey="value" nameKey="name"
                      cx="50%" cy="50%"
                      innerRadius={32} outerRadius={62}
                      paddingAngle={2}
                      isAnimationActive={true}
                    >
                      {finishPieData.map((entry, i) => (
                        <Cell key={i} fill={FINISH_REASON_COLORS[entry.name] || C.textMuted} stroke={C.surface} strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, fontSize: 12 }}>
                {finishPieData.map((row) => (
                  <div key={row.name} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 0',
                  }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: 3,
                      background: FINISH_REASON_COLORS[row.name] || C.textMuted,
                      flexShrink: 0,
                    }} />
                    <span style={{ color: C.text, fontWeight: 600, flex: 1 }}>{row.name}</span>
                    <span style={{ color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                      {row.value.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Category breakdown bar */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: 16,
        }}>
          <h3 style={{
            fontSize: 13, fontWeight: 700, color: C.text,
            margin: '0 0 10px',
          }}>
            Most-used category
          </h3>
          {categoryBarData.length === 0 ? (
            <p style={{ color: C.textMuted, fontSize: 12, margin: 0 }}>No category data yet.</p>
          ) : (
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryBarData} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                  <XAxis type="number" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: C.text, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 11 }}
                    cursor={{ fill: `${C.amber}22` }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {categoryBarData.map((d, i) => (
                      <Cell key={i} fill={d.key === 'trading' ? C.red : C.amber} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {tradingConsentCount > 0 && (
            <p style={{
              fontSize: 11, color: C.textMuted, margin: '8px 0 0', lineHeight: 1.5,
            }}>
              <strong style={{ color: C.amber }}>{tradingConsentCount}</strong> user{tradingConsentCount === 1 ? '' : 's'} {' '}
              passed the Trading Framework consent gate — shows demand for this category.
            </p>
          )}
        </div>
      </div>

      {/* Row 6 — user list */}
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
              {['Name', 'Email', 'Questions', 'Total Tokens', 'Avg Time (ms)', 'Blocked', 'Last Used'].map(h => (
                <th key={h} style={{
                  padding: '10px 12px', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: C.textMuted, textAlign: 'left',
                  borderBottom: `1px solid ${C.border}`,
                  background: C.surface, whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {userRows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: C.textFaint }}>
                No Research Assistant questions yet.
              </td></tr>
            ) : userRows.map((r) => (
              <tr key={r.uid} style={{ background: C.surface }}>
                <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 11 }}>{r.email}</td>
                <td style={{ padding: '10px 12px', color: C.amber, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {r.question_count.toLocaleString('en-IN')}
                </td>
                <td style={{ padding: '10px 12px', color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                  {r.total_tokens.toLocaleString('en-IN')}
                </td>
                <td style={{ padding: '10px 12px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                  {r.avg_time_ms > 0 ? r.avg_time_ms.toLocaleString('en-IN') : '—'}
                </td>
                <td style={{
                  padding: '10px 12px',
                  color: r.blocked > 0 ? C.red : C.textMuted,
                  fontWeight: r.blocked > 0 ? 700 : 400,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {r.blocked}
                </td>
                <td style={{ padding: '10px 12px', color: C.textMuted }}>{fmtRelative(r.last_used)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Privacy note (same copy as before — re-stated here so it sits
          immediately below the data it qualifies). */}
      <p style={{
        fontSize: 11, color: C.textFaint, margin: '0 0 8px',
        lineHeight: 1.5, fontStyle: 'italic',
      }}>
        ⓘ Question content is never logged. PineX only records that a question
        was asked, which stock context was used, token counts, finish reason,
        and response latency. API keys live in the user&apos;s browser only.
      </p>
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
  const [keySaveEvents,  setKeySaveEvents]  = useState(null)
  const [tradingConsentCount, setTradingConsentCount] = useState(0)
  const [profilesById, setProfilesById] = useState({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const sevenDayDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

      // All four datasets pulled in parallel. Each individual query catches
      // its own error so one missing table doesn't blank the whole page.
      const [pts, refs, qs, resp, researchData, consentData, keySaveData] = await Promise.all([
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
        // Separate event_type for trading-consent gates passed —
        // counted independently of the actual AI calls.
        supabase.from('usage_events')
          .select('user_id,created_at', { count: 'exact', head: true })
          .eq('event_type', 'trading_framework_consent')
          .then(r => r).catch(() => ({ count: 0 })),
        // Research key saves — registration funnel. We need the full
        // rows (not just count) so we can compute distinct-user counts
        // and the new-keys-this-week breakdown client-side. Capped at
        // 5000 most recent. A single user re-saving generates multiple
        // rows; the Set in ResearchAI dedupes.
        supabase.from('usage_events')
          .select('user_id,metadata,created_at')
          .eq('event_type', 'research_key_saved')
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
      setKeySaveEvents(keySaveData.data || [])
      setTradingConsentCount(Number(consentData?.count) || 0)

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
    researchEvents === null ||
    keySaveEvents === null

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
      {tab === 'research'  && <ResearchAI events={researchEvents} profilesById={profilesById} tradingConsentCount={tradingConsentCount} keySaveEvents={keySaveEvents} />}
    </div>
  )
}
