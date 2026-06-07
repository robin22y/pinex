import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell } from 'recharts'
import { supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

// ── /admin/engagement ────────────────────────────────────────────────────
// Three sections (all read-only):
//   1. Streak overview — bar chart of users per streak bucket + quick stats
//   2. Referral tracking — table of referrals.* with status colour coding
//   3. Daily question responses — last 7 days, expandable per row
//
// Referrals + daily_questions tables exist but may be empty. Both render
// graceful empty states.

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

function H1({ children }) {
  return (
    <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
      {children}
    </h1>
  )
}

function SectionLabel({ children }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: C.textMuted,
      margin: '24px 0 12px',
    }}>
      {children}
    </p>
  )
}

function Stat({ label, value, color = C.text }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '14px 16px',
      minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

// ── Section 1: Streak overview ──────────────────────────────────────────
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
      <SectionLabel>Streak overview</SectionLabel>

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

// ── Section 2: Referral tracking ────────────────────────────────────────
function ReferralTracking({ rows }) {
  const total = rows.length
  const registered = rows.filter(r => r.status && r.status !== 'pending').length
  const clicked = rows.length // proxy if no separate click metric
  const conversionRate = clicked > 0 ? Math.round((registered / clicked) * 100) : 0

  return (
    <section>
      <SectionLabel>Referral tracking</SectionLabel>

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

// ── Section 3: Daily question responses ─────────────────────────────────
function DailyQuestions({ questions, responses }) {
  const [expanded, setExpanded] = useState(null)

  // Group responses by question_id
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
      <SectionLabel>Daily question responses (last 7 days)</SectionLabel>

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

// ── Top level ───────────────────────────────────────────────────────────
export default function AdminEngagement() {
  const [streaks, setStreaks] = useState(null)
  const [referrals, setReferrals] = useState(null)
  const [questions, setQuestions] = useState(null)
  const [responses, setResponses] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const sevenDayDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

      const [pts, refs, qs, resp] = await Promise.all([
        supabase.from('user_points').select('current_streak').limit(5000),
        // referrals table may not exist with all columns the user expects;
        // pull * defensively and let render handle missing fields.
        supabase.from('referrals').select('*').order('created_at', { ascending: false }).limit(200).then(r => r).catch(() => ({ data: [] })),
        supabase.from('daily_questions').select('*').gte('date', sevenDayDate).order('date', { ascending: false }).limit(20).then(r => r).catch(() => ({ data: [] })),
        supabase.from('question_responses').select('*').gte('created_at', weekAgo).limit(500).then(r => r).catch(() => ({ data: [] })),
      ])

      if (cancelled) return
      setStreaks((pts.data || []).map(r => Number(r.current_streak) || 0))
      setReferrals(refs.data || [])
      setQuestions(qs.data || [])
      setResponses(resp.data || [])
    })()
    return () => { cancelled = true }
  }, [])

  if (streaks === null) {
    return <p style={{ color: C.textMuted }}>Loading…</p>
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <H1>Engagement</H1>
      <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
        Streak distribution, referral funnel, and daily-question responses.
      </p>

      <StreakOverview streaks={streaks} />
      <ReferralTracking rows={referrals} />
      <DailyQuestions questions={questions} responses={responses} />
    </div>
  )
}
