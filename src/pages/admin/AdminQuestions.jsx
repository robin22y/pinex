import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { awardPoints } from '../../lib/pointsAwarder'
import { C } from '../../styles/tokens'

// ── /admin/questions ─────────────────────────────────────────────────────
// Two sections:
//   1. Today's question — Generate with Gemini OR Write manually.
//      The Gemini path POSTs to /.netlify/functions/generate-question
//      (server-side: builds market context from market_internals + sectors,
//      calls Gemini REST, returns { question }). Browser never sees the
//      Gemini API key. See netlify/functions/generate-question.js.
//   2. Question history — last 30 days, click to expand responses,
//      mark a response as featured to award the responder 25 pts.
//
// Schema (verified live before writing this file):
//   daily_questions: id, question_text, question_date, question_type,
//                    points_value, generated_by, created_at
//   question_responses: id, user_id, question_id, response_text,
//                       is_featured, created_at

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
// State machine:
//   idle        — nothing pending. Shows either today's saved question
//                 (with Edit/Regenerate) OR the empty-state CTAs.
//   manual      — admin is typing a question by hand. Submit writes
//                 directly to daily_questions.
//   generating  — server-side Gemini call in flight. Button disabled.
//   preview     — Gemini returned a draft; admin sees Approve / Regenerate
//                 / Discard before any DB write.
//
// All writes use the verified schema column names:
//   question_date, question_text, question_type, points_value, generated_by.
// The previous version of this file wrote `date` and `question` (PG 42703
// column-not-found), so the manual save path silently 400'd. Fixed here.
function TodaysQuestion({ todays, onChanged, onDelete }) {
  const [mode, setMode]       = useState('idle')           // idle | manual | generating | preview
  const [draft, setDraft]     = useState('')               // current text (manual or preview source)
  const [context, setContext] = useState(null)             // { breadth, top_sectors } from server
  const [error, setError]     = useState('')
  const [message, setMessage] = useState('')               // success toast after save
  const [busy, setBusy]       = useState(false)

  function resetToIdle() {
    setMode('idle')
    setDraft('')
    setContext(null)
    setError('')
  }

  // ── Generate with Gemini — calls the Netlify function. Browser never
  // sees the GEMINI_API_KEY. Server builds market context internally.
  async function generate() {
    setError('')
    setMessage('')
    setMode('generating')
    setBusy(true)
    try {
      const res = await fetch('/.netlify/functions/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: false }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setDraft(body.question || '')
      setContext(body.context || null)
      setMode('preview')
    } catch (e) {
      setError(
        `Could not reach generation service: ${e?.message || e}. You can still write one manually.`,
      )
      setMode('idle')
    } finally {
      setBusy(false)
    }
  }

  // ── Save current draft to daily_questions. Used by both the manual
  // mode (admin-written text) and preview mode (approving a Gemini draft).
  async function save({ generatedBy }) {
    const text = draft.trim()
    if (!text) {
      setError('Question cannot be empty.')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { error: err } = await supabase
        .from('daily_questions')
        .upsert(
          {
            question_date: TODAY(),
            question_text: text,
            question_type: 'market',
            points_value:  5,
            generated_by:  generatedBy,
          },
          { onConflict: 'question_date' },
        )
      if (err) throw err
      setMessage('Question saved for today.')
      resetToIdle()
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
        {/* ── Saved question display (idle + has todays row) ─────────── */}
        {todays && mode === 'idle' && (
          <>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
              {TODAY()}
              {todays.generated_by && (
                <span style={{ marginLeft: 8, color: C.textFaint }}>
                  via {todays.generated_by}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 15, color: C.text,
              fontFamily: 'Newsreader, ui-serif, Georgia, serif',
              lineHeight: 1.6,
            }}>
              {todays.question_text}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <GhostBtn onClick={() => { setDraft(todays.question_text || ''); setMode('manual') }}>
                Edit
              </GhostBtn>
              <PrimaryBtn onClick={generate} disabled={busy}>
                Regenerate with Gemini
              </PrimaryBtn>
              {/* Destructive — confirms in onDelete. Right-aligned via
                  margin-left auto so it doesn't sit next to the
                  affirmative Edit/Regenerate buttons. */}
              <button
                type="button"
                onClick={() => onDelete && onDelete(todays)}
                disabled={busy}
                style={{
                  padding: '9px 14px',
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: `1px solid ${C.redBorder}`,
                  borderRadius: 8,
                  color: C.red,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                Delete question
              </button>
            </div>
          </>
        )}

        {/* ── Empty state (idle + no todays row) ─────────────────────── */}
        {!todays && mode === 'idle' && (
          <>
            <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 16px' }}>
              No question set for today.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <PrimaryBtn onClick={generate} disabled={busy}>Generate with Gemini</PrimaryBtn>
              <GhostBtn onClick={() => setMode('manual')}>Write manually</GhostBtn>
            </div>
          </>
        )}

        {/* ── Loading shim for the in-flight Gemini call ─────────────── */}
        {mode === 'generating' && (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            color: C.textMuted, fontSize: 13,
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>✨</div>
            Generating with Gemini…
          </div>
        )}

        {/* ── Preview: Gemini draft awaiting Approve / Regenerate / Discard */}
        {mode === 'preview' && (
          <>
            <div style={{
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: C.amber, marginBottom: 8,
            }}>
              Generated question
            </div>
            <div style={{
              padding: '14px 16px',
              background: C.surface2,
              border: `1px solid ${C.amberBorder}`,
              borderRadius: 8,
              fontFamily: 'Newsreader, ui-serif, Georgia, serif',
              fontSize: 15, lineHeight: 1.6, color: C.text,
            }}>
              {draft}
            </div>
            {context && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.textFaint }}>
                Context: breadth {context.breadth} · top sectors {context.top_sectors}
              </div>
            )}
            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <PrimaryBtn onClick={() => save({ generatedBy: 'gemini' })} disabled={busy || !draft.trim()}>
                ✓ Approve + Save
              </PrimaryBtn>
              <GhostBtn onClick={generate} disabled={busy}>↻ Regenerate</GhostBtn>
              <GhostBtn onClick={resetToIdle} disabled={busy}>× Discard</GhostBtn>
            </div>
          </>
        )}

        {/* ── Manual write/edit mode ─────────────────────────────────── */}
        {mode === 'manual' && (
          <>
            <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 10px' }}>
              {todays ? "Edit today's question" : 'Write a question manually.'}
            </p>
            <textarea
              rows={4}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Write a plain-English educational question about today's market…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: 12,
                background: C.surface2, border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.text,
                fontSize: 14,
                fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                lineHeight: 1.6, resize: 'vertical',
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <PrimaryBtn onClick={() => save({ generatedBy: 'manual' })} disabled={busy || !draft.trim()}>
                {todays ? 'Approve + Save' : 'Save'}
              </PrimaryBtn>
              <GhostBtn onClick={resetToIdle} disabled={busy}>Cancel</GhostBtn>
            </div>
          </>
        )}

        {/* ── Banners ──────────────────────────────────────────────────── */}
        {error && (
          <div style={{
            marginTop: 12, padding: 10,
            background: C.redBg, border: `1px solid ${C.redBorder}`,
            borderRadius: 8, color: C.red, fontSize: 12,
          }}>
            {error}
          </div>
        )}
        {message && (
          <div style={{
            marginTop: 12, padding: 10,
            background: C.greenBg, border: `1px solid ${C.greenBorder}`,
            borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 600,
          }}>
            {message}
          </div>
        )}
      </div>
    </section>
  )
}

// ── History + featured marker ───────────────────────────────────────────
function QuestionHistory({ rows, responsesByQuestion, onMarkFeatured, onDelete }) {
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
              {/* Row container — split into a clickable expand button +
                  a separate × delete button so a click on × doesn't
                  toggle the row. Both visually align with the row's
                  zebra-stripe background. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  background: i % 2 ? C.surface : C.base,
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(prev => prev === q.id ? null : q.id)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '12px 14px',
                    background: 'transparent',
                    border: 'none', cursor: 'pointer',
                    color: C.text,
                    display: 'flex', alignItems: 'center', gap: 12,
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: 11, color: C.textMuted, minWidth: 80 }}>
                    {q.question_date || (q.created_at || '').slice(0, 10)}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: C.text }}>{q.question_text}</span>
                  <span style={{ fontSize: 12, color: C.textMuted, minWidth: 70, textAlign: 'right' }}>
                    {resp.length} {resp.length === 1 ? 'reply' : 'replies'}
                  </span>
                  <span style={{ color: C.textMuted }}>{isOpen ? '−' : '+'}</span>
                </button>
                <button
                  type="button"
                  title="Delete this question"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (onDelete) onDelete(q)
                  }}
                  style={{
                    width: 36,
                    background: 'transparent',
                    border: 'none',
                    borderLeft: `1px solid ${C.border}`,
                    color: C.textMuted,
                    cursor: 'pointer',
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  ×
                </button>
              </div>

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
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
                        {r.response_text || '—'}
                      </div>
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

      // Column names verified live before writing this query:
      //   daily_questions.question_date (NOT 'date')
      //   daily_questions.question_text (NOT 'question')
      //   question_responses.response_text (NOT 'response')
      const [today_, hist, resp] = await Promise.all([
        supabase.from('daily_questions').select('*')
          .eq('question_date', today).limit(1).maybeSingle()
          .then(r => r).catch(() => ({ data: null })),
        supabase.from('daily_questions').select('*')
          .gte('question_date', monthAgo)
          .order('question_date', { ascending: false }).limit(40)
          .then(r => r).catch(() => ({ data: [] })),
        supabase.from('question_responses').select('*').limit(1000)
          .then(r => r).catch(() => ({ data: [] })),
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

  // Destructive — confirm, then delete responses + question.
  // Two-step because there's no ON DELETE CASCADE between
  // question_responses.question_id and daily_questions.id; deleting
  // the parent first would either fail (FK constraint) or orphan
  // rows depending on schema config. Wiping responses first is the
  // explicit, predictable path.
  async function deleteQuestion(q) {
    if (!q?.id) return
    const respCount = (responses[q.id] || []).length
    const tail =
      respCount > 0
        ? `\n\nThis will also delete ${respCount} response${respCount === 1 ? '' : 's'}.`
        : ''
    const ok = window.confirm(
      `Delete the question for ${q.question_date || 'this date'}?${tail}\n\nThis cannot be undone.`,
    )
    if (!ok) return
    try {
      if (respCount > 0) {
        const { error: rErr } = await supabase
          .from('question_responses')
          .delete()
          .eq('question_id', q.id)
        if (rErr) throw rErr
      }
      const { error: qErr } = await supabase
        .from('daily_questions')
        .delete()
        .eq('id', q.id)
      if (qErr) throw qErr
      setRefreshKey(k => k + 1)
    } catch (e) {
      // Most likely an RLS denial on question_responses or
      // daily_questions DELETE. Surface verbatim so we can write the
      // missing policy if needed.
      window.alert(`Delete failed: ${e?.message || e}`)
    }
  }

  async function markFeatured(qId, rId) {
    try {
      // 1. Mark the response as featured
      await supabase.from('question_responses').update({ is_featured: true }).eq('id', rId)

      // 2. Look up the responder and award via the config-driven helper.
      //    Falls back to 25 if points_config hasn't been seeded yet.
      //    Active points_offers (e.g. a 2× learning weekend) auto-apply.
      const { data: rRow } = await supabase.from('question_responses')
        .select('user_id').eq('id', rId).limit(1).maybeSingle()
      if (rRow?.user_id) {
        const { points, error } = await awardPoints(rRow.user_id, 'featured_answer', {
          notes: 'Featured daily-question answer',
          referenceId: rId,
          fallbackPoints: 25,
        })
        if (error) throw error
        // Surface the actually-awarded amount (may differ from base if an
        // offer was applied) so admin can see the effect of any live
        // multiplier when they confirm the featured pick.
        // eslint-disable-next-line no-console
        console.info('[AdminQuestions] featured awarded:', points)
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

      <TodaysQuestion
        todays={todays}
        onChanged={() => setRefreshKey(k => k + 1)}
        onDelete={deleteQuestion}
      />
      <QuestionHistory
        rows={rows}
        responsesByQuestion={responses}
        onMarkFeatured={markFeatured}
        onDelete={deleteQuestion}
      />
    </div>
  )
}
