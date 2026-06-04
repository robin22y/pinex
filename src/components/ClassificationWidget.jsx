// ── ClassificationWidget ───────────────────────────────────────────────────
// 1-tap phase classifier for a single stock. Lets every user record what
// phase THEY think the stock is currently in, then surfaces the community
// distribution once they've classified (or once anyone has).
//
// Writes to user_classifications with the v2 schema:
//   classified_phase (text — one of Basing/Advancing/Topping/Declining)
//   company_id (uuid)
//   criteria_score_at_classification (numeric — today's conditions_met)
//   classified_at (timestamptz, defaults to now())
//
// Reads three things on mount (all in parallel for snappy first paint):
//   1. The user's existing classification for this symbol (if any)
//   2. The community distribution — COUNT grouped by classified_phase
//   3. Today's criteria score from swing_conditions.conditions_met
//
// All four states (empty / picked / community / loading / unauth) live in
// this one file; no sub-components. Inline styles only, tokens from
// src/styles/tokens.js.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context'
import { C } from '../styles/tokens'
import Skeleton from './ui/Skeleton'

const PHASES = ['Basing', 'Advancing', 'Topping', 'Declining']

// Color per phase — matches the spec exactly. Used both for the badge
// text when a user has classified and the filled portion of each
// distribution bar.
const PHASE_COLOR = {
  Basing:    C.amber,
  Advancing: C.green,
  Topping:   C.red,
  Declining: C.red,
}

// Days-elapsed helper, calendar-day diff in local TZ. Returns 0 for
// "today", 1 for "yesterday", etc.
function daysAgo(iso) {
  if (!iso) return null
  const now = new Date()
  const then = new Date(iso)
  // Strip time to compare calendar days, not 24-hour spans.
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const b = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())
  return Math.max(0, Math.floor((a - b) / 86_400_000))
}

export default function ClassificationWidget({ symbol, companyId }) {
  const { user } = useAuth()

  // Existing classification (own row)
  const [mine, setMine] = useState(null)        // null = loading; {} = none; {classified_phase, ...} = present
  // Community distribution (counts keyed by phase name)
  const [communityCounts, setCommunityCounts] = useState(null) // null = loading
  // Today's criteria score (conditions_met from swing_conditions)
  const [todayScore, setTodayScore] = useState(null)
  // Are we in "edit" mode (showing the 4 buttons even though a row exists)?
  const [editing, setEditing] = useState(false)
  // Saving / inline messages
  const [saving, setSaving] = useState(false)
  const [unauthError, setUnauthError] = useState('')

  // ── Initial fetch ───────────────────────────────────────────────
  useEffect(() => {
    if (!symbol) return
    let cancelled = false
    setMine(null)
    setCommunityCounts(null)
    ;(async () => {
      try {
        // Three queries in parallel for snappy first paint.
        const [
          { data: ownRow },
          { data: allRows },
          { data: swingRow },
        ] = await Promise.all([
          // 1. Own row (returns either the row or null via maybeSingle).
          user?.id
            ? supabase
                .from('user_classifications')
                .select('id, classified_phase, classification, classified_at, criteria_score_at_classification')
                .eq('user_id', user.id)
                .eq('symbol', symbol)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          // 2. Community rows — bring back ALL classifications for this symbol.
          //    We aggregate client-side because PostgREST has no GROUP BY.
          //    Cap at 5000 to bound payload even if a stock somehow has more.
          supabase
            .from('user_classifications')
            .select('classified_phase, classification')
            .eq('symbol', symbol)
            .limit(5000),
          // 3. Latest criteria score for this symbol.
          supabase
            .from('swing_conditions')
            .select('conditions_met')
            .eq('symbol', symbol)
            .order('trading_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        if (cancelled) return

        // Normalise own row: prefer classified_phase, fall back to legacy
        // classification column (some pre-migration rows still write to it).
        if (ownRow) {
          const phase = ownRow.classified_phase || ownRow.classification || null
          setMine(phase ? { ...ownRow, phase } : {})
        } else {
          setMine({})
        }

        // Aggregate counts client-side.
        const counts = { Basing: 0, Advancing: 0, Topping: 0, Declining: 0 }
        for (const r of allRows || []) {
          const phase = r.classified_phase || r.classification
          if (phase && counts[phase] !== undefined) counts[phase] += 1
        }
        setCommunityCounts(counts)

        // Today's score for the save payload.
        if (swingRow?.conditions_met != null) {
          setTodayScore(Number(swingRow.conditions_met))
        }
      } catch (e) {
        if (!cancelled) {
          // Soft fail — empty state is better than blocking the page.
          console.warn('[ClassificationWidget] fetch error:', e)
          setMine({})
          setCommunityCounts({ Basing: 0, Advancing: 0, Topping: 0, Declining: 0 })
        }
      }
    })()
    return () => { cancelled = true }
  }, [user?.id, symbol])

  // Total community classifications (for the "Based on N analyses" text)
  const communityTotal = useMemo(() => {
    if (!communityCounts) return 0
    return Object.values(communityCounts).reduce((a, b) => a + b, 0)
  }, [communityCounts])

  // ── Save handler ────────────────────────────────────────────────
  const handlePick = async (phase) => {
    // Unauthenticated: surface a clear inline message instead of throwing.
    if (!user?.id) {
      setUnauthError('signin')
      return
    }
    if (saving) return
    setSaving(true)
    setUnauthError('')

    const nowIso = new Date().toISOString()
    const payload = {
      user_id: user.id,
      symbol,
      company_id: companyId || null,
      classified_phase: phase,
      // Keep writing the legacy column too so the older MyClassification
      // component (still referenced anywhere) keeps working until that's
      // retired. Cheap; same value.
      classification: phase,
      classified_at: nowIso,
      criteria_score_at_classification: todayScore,
    }

    try {
      const { data, error } = await supabase
        .from('user_classifications')
        .upsert(payload, { onConflict: 'user_id,symbol' })
        .select()
        .maybeSingle()
      if (error) throw error

      // Optimistic local update — populate row + bump community count.
      const previous = mine?.phase
      setMine({
        ...(data || payload),
        phase,
        classified_at: nowIso,
        criteria_score_at_classification: todayScore,
      })
      setEditing(false)
      setCommunityCounts((c) => {
        const next = { ...(c || { Basing: 0, Advancing: 0, Topping: 0, Declining: 0 }) }
        // If this is a re-classification (had a phase before), decrement that
        // bucket. If this is the user's first classification, increment only.
        if (previous && next[previous] != null && previous !== phase) {
          next[previous] = Math.max(0, next[previous] - 1)
          next[phase] = (next[phase] || 0) + 1
        } else if (!previous) {
          next[phase] = (next[phase] || 0) + 1
        }
        return next
      })
    } catch (e) {
      console.warn('[ClassificationWidget] save failed:', e)
      // Roll back optimistic state if needed — leave the buttons up so user
      // can retry. (Skipping a toast — the page never blocks on this widget.)
    } finally {
      setSaving(false)
    }
  }

  // "Update my analysis" — flip back to buttons. We do NOT delete the row
  // server-side; the next tap upserts over it on conflict. Keeps the row's
  // `id` stable for the confirmation / wow-moment join.
  const handleEdit = () => {
    setEditing(true)
  }

  // ── Render ──────────────────────────────────────────────────────
  // Loading: skeleton matching final widget height (~150px).
  const isLoading = mine === null || communityCounts === null
  if (isLoading) {
    return (
      <div style={cardStyle}>
        <Header />
        <Skeleton height={14} width="50%" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
        <Disclaimer />
      </div>
    )
  }

  const userPhase = mine?.phase
  const showButtons = !userPhase || editing

  return (
    <div style={cardStyle}>
      <Header />

      {/* ── Picked state header ────────────────────────────────────── */}
      {userPhase && !editing && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: PHASE_COLOR[userPhase] || C.text }}>
            Your analysis: {userPhase}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
            Classified {classifiedSinceText(mine?.classified_at)}
            {mine?.criteria_score_at_classification != null && (
              <> when criteria score was{' '}
                <strong style={{ color: C.text, fontWeight: 600 }}>
                  {Number(mine.criteria_score_at_classification).toFixed(0)}/5
                </strong>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 4 buttons (initial pick OR edit mode) ──────────────────── */}
      {showButtons && (
        <>
          {!userPhase && (
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
              What phase is this stock in?
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {PHASES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePick(p)}
                disabled={saving}
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 8,
                  background: C.surface2,
                  border: `1px solid ${C.border}`,
                  color: C.textMuted,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: saving ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (saving) return
                  e.currentTarget.style.borderColor = PHASE_COLOR[p]
                  e.currentTarget.style.color = PHASE_COLOR[p]
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = C.border
                  e.currentTarget.style.color = C.textMuted
                }}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Empty-state hint when no community has classified yet */}
          {!userPhase && communityTotal === 0 && (
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>
              Be the first to analyse this stock
            </div>
          )}

          {/* Unauth inline prompt — appears only after a tap, never blocks UI */}
          {!user && unauthError === 'signin' && (
            <div style={{
              fontSize: 12, color: C.textMuted, marginTop: 12,
              padding: '10px 12px', borderRadius: 8,
              background: C.surface, border: `1px solid ${C.border}`,
              lineHeight: 1.5,
            }}>
              Sign in to save your analysis and track if you were right.
              <div style={{ marginTop: 6 }}>
                <Link to="/login" style={{ color: C.blue, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>
                  Sign in →
                </Link>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Community distribution (only shown to users who've picked) ── */}
      {userPhase && !editing && communityTotal > 0 && (
        <div style={{ marginTop: 8 }}>
          <Distribution
            counts={communityCounts}
            total={communityTotal}
            userPhase={userPhase}
          />
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>
            Based on {communityTotal} PineX analys{communityTotal === 1 ? 'is' : 'es'}
          </div>
          <button
            type="button"
            onClick={handleEdit}
            style={{
              marginTop: 10,
              background: 'none',
              border: 'none',
              padding: 0,
              color: C.blue,
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
          >
            Update my analysis
          </button>
        </div>
      )}

      <Disclaimer />
    </div>
  )
}

// ── Inline subcomponents ──────────────────────────────────────────

const cardStyle = {
  background: C.surfaceCard,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
}

function Header() {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      color: C.textMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      marginBottom: 12,
    }}>
      My Analysis
    </div>
  )
}

function Disclaimer() {
  return (
    <div style={{
      marginTop: 12,
      fontSize: 10,
      color: C.textMuted,
      lineHeight: 1.4,
    }}>
      Educational analysis only · Not investment advice
    </div>
  )
}

function Distribution({ counts, total, userPhase }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {PHASES.map((phase) => {
        const n = counts?.[phase] || 0
        const pct = total > 0 ? Math.round((n / total) * 100) : 0
        const fillColor = PHASE_COLOR[phase] || C.textMuted
        const isUserPhase = phase === userPhase
        return (
          <div key={phase} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 40px', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontSize: 12,
              color: isUserPhase ? C.text : C.textMuted,
              fontWeight: isUserPhase ? 600 : 400,
            }}>
              {phase}
            </span>
            <div style={{
              position: 'relative',
              height: 4,
              borderRadius: 2,
              background: C.border,
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                inset: 0,
                width: `${pct}%`,
                background: fillColor,
                borderRadius: 2,
                transition: 'width 0.3s ease-out',
              }} />
            </div>
            <span style={{
              fontSize: 12,
              color: C.text,
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              fontWeight: isUserPhase ? 600 : 400,
            }}>
              {pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function classifiedSinceText(iso) {
  const d = daysAgo(iso)
  if (d === null) return ''
  if (d === 0) return 'today'
  if (d === 1) return '1 day ago'
  return `${d} days ago`
}
