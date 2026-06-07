import { useEffect, useState } from 'react'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'
import { awardPoints } from '../lib/pointsAwarder'
import { C } from '../styles/tokens'

// ── DailyQuestion — Home/Learn earn-points-by-answering card ─────────────
// One question per calendar day. Three states:
//   A. No question for today          → render null (admin hasn't set one)
//   B. Question exists, not answered  → textarea + Submit (awards +N pts)
//   C. Question exists, answered      → read-only response display
//
// Optimistic submit: we flip to the answered state immediately and only
// roll back if the insert errors. 23505 (unique violation on
// user_id+question_id) counts as success — they've answered before from
// a different surface.
//
// Points award: awardPoints() handles the config + active offer lookup,
// the transaction insert and the user_points bump. We pass fallbackPoints
// from the daily_questions.points_value column so even an unseeded
// points_config still grants the right amount.
//
// showOnHome is currently a no-op flag — both placements render the same
// card. Reserved for future divergence (e.g. compact-on-home, full-on-learn).

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)
const MAX_LEN = 1000

export default function DailyQuestion({ showOnHome }) {
  void showOnHome // accepted for forward-compat; both surfaces render identically
  const { user } = useAuth()
  const [question, setQuestion]     = useState(null)
  const [myResponse, setMyResponse] = useState(null)
  const [count, setCount]           = useState(0)
  const [draft, setDraft]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        // 1. Today's question (may not exist if admin hasn't set one)
        const { data: q } = await supabase
          .from('daily_questions')
          .select('id, question_text, question_type, points_value, question_date')
          .eq('question_date', TODAY_ISO())
          .limit(1)
          .maybeSingle()

        if (cancelled) return
        if (!q) {
          setQuestion(null)
          setLoading(false)
          return
        }
        setQuestion(q)

        // 2 + 3. My response (if any) + total response count, in parallel
        const myRespP = user?.id
          ? supabase
              .from('question_responses')
              .select('id, response_text')
              .eq('question_id', q.id)
              .eq('user_id', user.id)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null })

        const countP = supabase
          .from('question_responses')
          .select('id', { count: 'exact', head: true })
          .eq('question_id', q.id)

        const [{ data: myR }, { count: c }] = await Promise.all([myRespP, countP])
        if (cancelled) return
        setMyResponse(myR || null)
        setCount(typeof c === 'number' ? c : 0)
      } catch (e) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('[DailyQuestion] load failed:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  // Loading or STATE A — render nothing.
  if (loading) return null
  if (!question) return null

  const hasAnswered = Boolean(myResponse)
  const pts = Number(question.points_value) || 5

  async function handleSubmit() {
    if (!user?.id) {
      setError('Please sign in to answer.')
      return
    }
    const txt = draft.trim()
    if (!txt || submitting) return

    setSubmitting(true)
    setError('')

    // Optimistic UI flip — show success immediately.
    const optimistic = { id: 'pending', response_text: txt }
    setMyResponse(optimistic)
    setCount(c => c + 1)

    try {
      const { error: insertErr } = await supabase
        .from('question_responses')
        .insert({
          user_id: user.id,
          question_id: question.id,
          response_text: txt.slice(0, MAX_LEN),
        })
      // 23505 = unique violation (user_id, question_id) — they already
      // answered, treat as success. Anything else is a real error.
      if (insertErr && insertErr.code !== '23505') throw insertErr

      // Config-driven award. Falls back to question.points_value if
      // points_config doesn't have a 'daily_question' row yet.
      await awardPoints(user.id, 'daily_question', {
        notes: 'Daily question answered',
        referenceId: question.id,
        fallbackPoints: pts,
      })
    } catch (e) {
      // Roll back optimistic update
      setMyResponse(null)
      setCount(c => Math.max(0, c - 1))
      setError(e?.message || 'Submission failed. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '16px 18px',
      marginBottom: 16,
    }}>
      {/* Header — label + points badge / answered tick */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: C.textMuted,
        }}>
          Today's question
        </span>
        {hasAnswered ? (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.green,
            letterSpacing: '0.04em',
          }}>
            ✓ Answered · +{pts} pts
          </span>
        ) : (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            background: C.amberBg,
            border: `1px solid ${C.amberBorder}`,
            color: C.amber,
            padding: '2px 8px',
            borderRadius: 10,
          }}>
            +{pts} pts
          </span>
        )}
      </div>

      {/* Question text — serif, comfortable reading */}
      <p style={{
        fontFamily: 'Newsreader, ui-serif, Georgia, serif',
        fontSize: '0.95rem',
        lineHeight: 1.65,
        color: C.text,
        margin: '0 0 14px',
      }}>
        {question.question_text}
      </p>

      {/* STATE B — unanswered */}
      {!hasAnswered && (
        <>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Your thinking..."
            rows={3}
            disabled={submitting}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              background: C.surface2,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.text,
              fontSize: 13,
              fontFamily: 'Inter, system-ui, sans-serif',
              resize: 'vertical',
              minHeight: 80,
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!draft.trim() || submitting || !user?.id}
            style={{
              marginTop: 10,
              padding: '9px 18px',
              background: (!draft.trim() || submitting || !user?.id) ? C.surface2 : C.amber,
              border: 'none',
              borderRadius: 8,
              color: (!draft.trim() || submitting || !user?.id) ? C.textMuted : C.base,
              fontSize: 13,
              fontWeight: 700,
              cursor: (!draft.trim() || submitting || !user?.id) ? 'not-allowed' : 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '-0.01em',
            }}
          >
            {submitting
              ? 'Submitting…'
              : !user?.id
              ? 'Sign in to answer'
              : `Submit — earn ${pts} pts`}
          </button>
          {error && (
            <div style={{
              marginTop: 10, padding: 10,
              background: C.redBg,
              border: `1px solid ${C.redBorder}`,
              borderRadius: 8, color: C.red, fontSize: 12,
            }}>
              {error}
            </div>
          )}
        </>
      )}

      {/* STATE C — answered */}
      {hasAnswered && (
        <div style={{ marginTop: 4 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.textMuted,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}>
            Your answer
          </div>
          <p style={{
            fontFamily: 'Newsreader, ui-serif, Georgia, serif',
            fontSize: 13,
            color: C.textMuted,
            margin: 0,
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
          }}>
            {myResponse.response_text}
          </p>
        </div>
      )}

      {/* Response count — community proof */}
      <div style={{
        marginTop: 10,
        fontSize: 11,
        color: C.textMuted,
        textAlign: 'right',
      }}>
        {count.toLocaleString('en-IN')} {count === 1 ? 'trader' : 'traders'} answered today
      </div>
    </div>
  )
}
