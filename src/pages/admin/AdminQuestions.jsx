import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

// ── /admin/questions ─────────────────────────────────────────────────────
// Two sections:
//   1. Today's question — if none, offer "Generate with Gemini" (calls a
//      Netlify function) or "Write manually" (textarea + save).
//   2. Question history — last 30 days, click to expand responses.
//
// The Gemini path posts to /.netlify/functions/admin-generate-question
// (server holds the API key). If the endpoint isn't deployed yet, the
// button surfaces the error and the admin can fall back to manual.
//
// Mark-featured persists response_id back onto daily_questions row.

const TODAY = () => new Date().toISOString().slice(0, 10)

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

function PrimaryBtn({ children, onClick, disabled, color = C.amber }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 18px',
        background: disabled ? C.surface2 : color,
        border: 'none', borderRadius: 8,
        color: disabled ? C.textMuted : C.accentOn,
        fontSize: 13, fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function GhostBtn({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 18px',
        background: 'transparent', border: `1px solid ${C.border}`,
        borderRadius: 8, color: C.text,
        fontSize: 13, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

// ── Today's question ────────────────────────────────────────────────────
function TodaysQuestion({ todays, onChanged }) {
  const [mode, setMode] = useState('idle') // idle | manual | generating
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function generate() {
    setError('')
    setMode('generating')
    setBusy(true)
    try {
      // Fetch latest breadth for the prompt context
      const { data: mi } = await supabase.from('market_internals')
        .select('above_ma150_pct,stage2_pct').order('date', { ascending: false }).limit(1).maybeSingle()
      const breadth = Number(mi?.above_ma150_pct || mi?.stage2_pct || 0).toFixed(0)

      const res = await fetch('/.netlify/functions/admin-generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ breadth }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setDraft(body.question || '')
    } catch (e) {
      setError(`Generation failed: ${e?.message || e}. You can still write one manually.`)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft.trim()) {
      setError('Question cannot be empty.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error } = await supabase
        .from('daily_questions')
        .upsert(
          { date: TODAY(), question: draft.trim() },
          { onConflict: 'date' },
        )
      if (error) throw error
      setMode('idle')
      setDraft('')
      onChanged()
    } catch (e) {
      setError(e?.message || 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <SectionLabel>Today&apos;s question</SectionLabel>

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 18,
      }}>
        {todays && mode === 'idle' ? (
          <>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
              {TODAY()}
            </div>
            <div style={{ fontSize: 15, color: C.text, fontFamily: 'Newsreader, ui-serif, Georgia, serif', lineHeight: 1.6 }}>
              {todays.question}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <GhostBtn onClick={() => { setDraft(todays.question || ''); setMode('manual') }}>
                Edit
              </GhostBtn>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 16px' }}>
              {todays ? 'Edit today\'s question' : 'No question set for today.'}
            </p>

            {mode === 'idle' && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <PrimaryBtn onClick={generate} disabled={busy}>Generate with Gemini</PrimaryBtn>
                <GhostBtn onClick={() => setMode('manual')}>Write manually</GhostBtn>
              </div>
            )}

            {(mode === 'manual' || mode === 'generating') && (
              <>
                <textarea
                  rows={4}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="Write a plain-English educational question about today's market…"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: 12, marginTop: 10,
                    background: C.surface2, border: `1px solid ${C.border}`,
                    borderRadius: 8, color: C.text,
                    fontSize: 14, fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                    lineHeight: 1.6, resize: 'vertical',
                  }}
                />
                <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <PrimaryBtn onClick={save} disabled={busy || !draft.trim()}>
                    {todays ? 'Approve + Save' : 'Save'}
                  </PrimaryBtn>
                  {mode === 'generating' && (
                    <GhostBtn onClick={generate} disabled={busy}>Regenerate</GhostBtn>
                  )}
                  <GhostBtn onClick={() => { setMode('idle'); setDraft(''); setError('') }}>Cancel</GhostBtn>
                </div>
              </>
            )}

            {error && (
              <div style={{
                marginTop: 12, padding: 10,
                background: C.redBg, border: `1px solid ${C.redBorder}`,
                borderRadius: 8, color: C.red, fontSize: 12,
              }}>
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ── History + featured marker ───────────────────────────────────────────
function QuestionHistory({ rows, responsesByQuestion, onMarkFeatured }) {
  const [open, setOpen] = useState(null)

  return (
    <section>
      <SectionLabel>Question history (last 30 days)</SectionLabel>

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, overflow: 'hidden',
      }}>
        {rows.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: C.textFaint }}>
            No questions in the last 30 days.
          </div>
        ) : rows.map((q, i) => {
          const resp = responsesByQuestion[q.id] || []
          const isOpen = open === q.id
          return (
            <div key={q.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
              <button
                type="button"
                onClick={() => setOpen(prev => prev === q.id ? null : q.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '12px 14px',
                  background: i % 2 ? C.surface : C.base,
                  border: 'none', cursor: 'pointer',
                  color: C.text,
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <span style={{ fontSize: 11, color: C.textMuted, minWidth: 80 }}>
                  {q.date || (q.created_at || '').slice(0, 10)}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: C.text }}>{q.question}</span>
                <span style={{ fontSize: 12, color: C.textMuted, minWidth: 70, textAlign: 'right' }}>
                  {resp.length} {resp.length === 1 ? 'reply' : 'replies'}
                </span>
                <span style={{ color: C.textMuted }}>{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div style={{ padding: '8px 14px 14px', background: C.surface2 }}>
                  {resp.length === 0 ? (
                    <p style={{ color: C.textFaint, fontSize: 12, margin: 0 }}>No responses yet.</p>
                  ) : resp.map(r => (
                    <div key={r.id} style={{
                      padding: '10px 12px',
                      borderLeft: r.is_featured ? `3px solid ${C.amber}` : `3px solid ${C.border}`,
                      background: C.surface,
                      borderRadius: 6,
                      marginBottom: 6,
                    }}>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{r.response || r.text || '—'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: C.textMuted }}>
                          {r.user_email || r.user_id || '—'}
                        </span>
                        {!r.is_featured && (
                          <button
                            type="button"
                            onClick={() => onMarkFeatured(q.id, r.id)}
                            style={{
                              padding: '4px 9px', fontSize: 10, fontWeight: 600,
                              background: 'transparent', border: `1px solid ${C.amberBorder}`,
                              borderRadius: 6, color: C.amber, cursor: 'pointer',
                            }}
                          >
                            ⭐ Mark featured (+25 pts)
                          </button>
                        )}
                        {r.is_featured && (
                          <span style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>⭐ FEATURED</span>
                        )}
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
export default function AdminQuestions() {
  const [todays, setTodays] = useState(null)
  const [rows, setRows] = useState(null)
  const [responses, setResponses] = useState({})
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const today = TODAY()
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

      const [today_, hist, resp] = await Promise.all([
        supabase.from('daily_questions').select('*').eq('date', today).limit(1).maybeSingle().then(r => r).catch(() => ({ data: null })),
        supabase.from('daily_questions').select('*').gte('date', monthAgo).order('date', { ascending: false }).limit(40).then(r => r).catch(() => ({ data: [] })),
        supabase.from('question_responses').select('*').limit(1000).then(r => r).catch(() => ({ data: [] })),
      ])

      if (cancelled) return
      setTodays(today_.data || null)
      setRows(hist.data || [])
      const map = {}
      ;(resp.data || []).forEach(r => {
        if (!r.question_id) return
        map[r.question_id] = map[r.question_id] || []
        map[r.question_id].push(r)
      })
      setResponses(map)
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  async function markFeatured(qId, rId) {
    try {
      // 1. Mark the response as featured
      await supabase.from('question_responses').update({ is_featured: true }).eq('id', rId)
      // 2. Find the user_id on that response and award +25 via admin_bonus
      const { data: rRow } = await supabase.from('question_responses').select('user_id').eq('id', rId).limit(1).maybeSingle()
      if (rRow?.user_id) {
        await supabase.from('points_transactions').insert({
          user_id: rRow.user_id,
          points: 25,
          action_type: 'featured_answer',
          notes: 'Featured daily-question answer',
        })
        const { data: cur } = await supabase.from('user_points').select('total_points,lifetime_points').eq('user_id', rRow.user_id).limit(1).maybeSingle()
        await supabase.from('user_points').update({
          total_points: (Number(cur?.total_points) || 0) + 25,
          lifetime_points: (Number(cur?.lifetime_points) || 0) + 25,
          updated_at: new Date().toISOString(),
        }).eq('user_id', rRow.user_id)
      }
      setRefreshKey(k => k + 1)
    } catch (e) {
      window.alert(`Mark featured failed: ${e?.message || e}`)
    }
  }

  if (rows === null) {
    return <p style={{ color: C.textMuted }}>Loading…</p>
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <H1>Daily Questions</H1>
      <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
        Set today&apos;s prompt, review past responses, and feature the best answer (+25 pts).
      </p>

      <TodaysQuestion todays={todays} onChanged={() => setRefreshKey(k => k + 1)} />
      <QuestionHistory rows={rows} responsesByQuestion={responses} onMarkFeatured={markFeatured} />
    </div>
  )
}
