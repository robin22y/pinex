import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'
import { C } from '../styles/tokens'
import Icon from '../components/ui/Icon'

// ── ResearchNotes ───────────────────────────────────────────────────────
// Saved AI insights from the Research Assistant. Each note is a single
// row in research_notes scoped to the current user via RLS.
//
// Categories that can appear here:
//   valuation | growth | shareholding | quarterly | cycle | trading |
//   freetext | watchlist_summary | compare:<other-symbol>
// (plus *_followup variants when the user saved a follow-up answer)
//
// PRIVACY: the listing path uses the supabase JS client, which sends
// the user's JWT. RLS ("user reads own notes") guarantees the SELECT
// only returns rows where user_id = auth.uid(). A signed-out user
// cannot reach this route (PrivateRoute wraps it in App.jsx).

const CATEGORY_LABELS = {
  valuation:          { label: 'Valuation',          emoji: '📊' },
  growth:             { label: 'Growth & Momentum',  emoji: '📈' },
  shareholding:       { label: 'Shareholding',       emoji: '👥' },
  quarterly:          { label: 'Quarterly Results',  emoji: '📋' },
  cycle:              { label: 'Cycle Position',     emoji: '🔄' },
  trading:            { label: 'Trading Framework',  emoji: '🎯' },
  freetext:           { label: 'Ask Anything',       emoji: '✍️' },
  watchlist_summary:  { label: 'Watchlist Summary',  emoji: '🔬' },
}

// Map a raw category string to {label, emoji}. Handles the dynamic
// 'compare:<sym>' prefix and *_followup suffix.
function categoryMeta(raw) {
  const r = String(raw || '')
  if (r.startsWith('compare')) {
    const sym = r.split(':')[1]?.replace('_followup', '') || ''
    const isFollowup = r.endsWith('_followup')
    return {
      label: sym ? `Compare with ${sym}${isFollowup ? ' — follow-up' : ''}` : 'Comparison',
      emoji: '⚖️',
    }
  }
  if (r.endsWith('_followup')) {
    const base = r.replace('_followup', '')
    const meta = CATEGORY_LABELS[base]
    if (meta) return { label: `${meta.label} — follow-up`, emoji: meta.emoji }
  }
  return CATEGORY_LABELS[r] || { label: r || 'Note', emoji: '📝' }
}

function formatSavedAt(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export default function ResearchNotes() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Per-note UI state: which notes are expanded (Set of id) and which is
  // currently being deleted (single id). Keeping these in component state
  // avoids re-fetching on toggle.
  const [expanded, setExpanded] = useState(() => new Set())
  const [deletingId, setDeletingId] = useState(null)

  // Auth gate — bounce signed-out users to login (mirrors other private
  // pages). Done as an effect so SSR/static prerender doesn't redirect.
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login?next=/research-notes', { replace: true })
    }
  }, [authLoading, user, navigate])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: fetchErr } = await supabase
          .from('research_notes')
          .select('id,symbol,company_name,category,response_text,saved_at')
          .order('saved_at', { ascending: false })
          .limit(500)
        if (cancelled) return
        if (fetchErr) {
          setError(fetchErr.message || 'Failed to load notes.')
          setNotes([])
        } else {
          setNotes(data || [])
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load notes.')
          setNotes([])
        }
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [user?.id])

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleDelete(note) {
    const ok = window.confirm(
      `Delete this research note?\n\n${note.symbol} · ${categoryMeta(note.category).label}\n\nThis cannot be undone.`,
    )
    if (!ok) return
    setDeletingId(note.id)
    try {
      const { error: delErr } = await supabase
        .from('research_notes')
        .delete()
        .eq('id', note.id)
      if (delErr) {
        window.alert(`Delete failed: ${delErr.message}`)
      } else {
        setNotes((prev) => prev.filter((n) => n.id !== note.id))
        setExpanded((prev) => {
          const next = new Set(prev)
          next.delete(note.id)
          return next
        })
      }
    } catch (e) {
      window.alert(`Delete failed: ${e?.message || e}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={{ padding: '20px 16px 48px', maxWidth: 760, margin: '0 auto' }}>
      <Helmet>
        <title>My Research Notes — PineX</title>
      </Helmet>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            background: 'transparent', border: 'none',
            color: C.textMuted, fontSize: 12,
            padding: 0, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginBottom: 12,
          }}
        >
          <Icon name="arrow-left" size={12} /> Back
        </button>
        <h1 style={{
          margin: 0, fontSize: 22, fontWeight: 800,
          color: C.text, letterSpacing: '-0.02em',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 22 }}>🔬</span> My Research Notes
        </h1>
        <p style={{
          margin: '6px 0 0', fontSize: 12, color: C.textMuted,
          lineHeight: 1.55,
        }}>
          AI insights you saved from the Research Assistant.
          Newest first. Only you can see these.
        </p>
      </div>

      {/* States */}
      {(authLoading || loading) && (
        <div style={{
          padding: 32, textAlign: 'center',
          color: C.textMuted, fontSize: 13,
        }}>
          Loading your notes…
        </div>
      )}

      {!loading && error && (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(248,113,113,0.10)',
          border: `1px solid ${C.redBorder}`,
          borderRadius: 8,
          color: C.red, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {!loading && !error && notes.length === 0 && (
        <div style={{
          padding: '32px 24px', textAlign: 'center',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📝</div>
          <div style={{
            fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 6,
          }}>
            No saved notes yet
          </div>
          <div style={{
            fontSize: 12, color: C.textMuted, lineHeight: 1.6,
            maxWidth: 360, margin: '0 auto 16px',
          }}>
            Open any stock, ask your Research Assistant, then tap
            "💾 Save this insight" under an answer. Saved notes appear here.
          </div>
          <Link
            to="/home"
            style={{
              display: 'inline-block',
              padding: '9px 18px',
              background: C.amber, color: '#000',
              borderRadius: 8, textDecoration: 'none',
              fontSize: 13, fontWeight: 700,
            }}
          >
            Browse stocks →
          </Link>
        </div>
      )}

      {/* Note cards */}
      {!loading && !error && notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notes.map((note) => {
            const meta = categoryMeta(note.category)
            const isExpanded = expanded.has(note.id)
            const preview = (note.response_text || '').slice(0, 140)
            const hasMore = (note.response_text || '').length > 140
            return (
              <div
                key={note.id}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 8,
                  marginBottom: 8,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    flexWrap: 'wrap',
                  }}>
                    <Link
                      to={`/stock/${encodeURIComponent(note.symbol)}`}
                      style={{
                        fontSize: 14, fontWeight: 800,
                        color: C.text,
                        textDecoration: 'none',
                      }}
                    >
                      {note.symbol}
                    </Link>
                    {note.company_name && (
                      <span style={{
                        fontSize: 11, color: C.textMuted,
                      }}>
                        {note.company_name}
                      </span>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10, color: C.textMuted,
                    whiteSpace: 'nowrap',
                  }}>
                    {formatSavedAt(note.saved_at)}
                  </span>
                </div>

                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, color: C.amber,
                  background: 'rgba(245,159,11,0.08)',
                  border: `1px solid ${C.amberBorder}`,
                  borderRadius: 6,
                  padding: '2px 8px',
                  marginBottom: 10,
                }}>
                  <span style={{ fontSize: 12 }}>{meta.emoji}</span>
                  {meta.label}
                </div>

                <div style={{
                  color: C.text,
                  fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                  fontSize: '0.95rem', lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {isExpanded ? note.response_text : preview}
                  {!isExpanded && hasMore && <span style={{ color: C.textMuted }}>…</span>}
                </div>

                {/* Actions */}
                <div style={{
                  marginTop: 12,
                  display: 'flex', gap: 8, alignItems: 'center',
                }}>
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(note.id)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${C.border}`,
                        color: C.text,
                        padding: '5px 12px',
                        borderRadius: 6,
                        fontSize: 11, fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {isExpanded ? 'Collapse' : 'Expand'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(note)}
                    disabled={deletingId === note.id}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: C.red,
                      padding: '5px 8px',
                      borderRadius: 6,
                      fontSize: 11, fontWeight: 600,
                      cursor: deletingId === note.id ? 'wait' : 'pointer',
                      marginLeft: 'auto',
                    }}
                  >
                    {deletingId === note.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
