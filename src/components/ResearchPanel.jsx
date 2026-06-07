import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context'
import { awardPoints } from '../lib/pointsAwarder'
import {
  askGemini,
  getStoredGeminiKey,
  isBlockedQuestion,
  logResearchUsage,
  REFUSAL_TEXT,
} from '../lib/researchAssistant'
import { C } from '../styles/tokens'

// ── ResearchPanel — Bring-Your-Own-Key Gemini chat on stock detail ──────
// Two render states:
//   no-key teaser → "Add your Gemini key in Settings to unlock"
//   active        → text input + Ask button + answer pane
//
// Both states assume the caller already passed the Pro gate. The Pro
// gate lives in StockDetail (around the call site) because deciding
// who is Pro is page-level concern, not panel-level.
//
// Every Gemini call goes directly from browser → google.com.
// PineX never sees the question or answer. We log only the event type
// + symbol for admin aggregate reporting.

export default function ResearchPanel({ symbol, company, conditions, description }) {
  const { user } = useAuth()
  const hasKey = Boolean(getStoredGeminiKey())

  // ── No-key teaser ──────────────────────────────────────────────────
  if (!hasKey) {
    return (
      <div style={{
        marginTop: 28,
        background: C.surface,
        border: `1px solid ${C.amberBorder}`,
        borderLeft: `4px solid ${C.amber}`,
        borderRadius: 12,
        padding: '18px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>🔬</span>
          <span style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: C.amber,
          }}>
            Research Assistant
          </span>
        </div>
        <p style={{
          fontSize: 14,
          color: C.text,
          margin: '0 0 6px',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          Ask anything about this stock using your own AI key.
        </p>
        <p style={{
          fontSize: 13,
          color: C.textMuted,
          margin: '0 0 14px',
          lineHeight: 1.6,
          fontFamily: 'Newsreader, ui-serif, Georgia, serif',
        }}>
          Add your free Gemini key in Settings to activate. Your key stays on
          this device — PineX never sees it.
        </p>
        <Link
          to="/account#research"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: C.amber,
            color: '#000',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Go to Settings →
        </Link>
      </div>
    )
  }

  // ── Active state ─────────────────────────────────────────────────────
  return <ActivePanel
    symbol={symbol}
    company={company}
    conditions={conditions}
    description={description}
    userId={user?.id}
  />
}

function ActivePanel({ symbol, company, conditions, description, userId }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer]     = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [refused, setRefused]   = useState(false)

  async function handleAsk() {
    const q = question.trim()
    if (!q || busy) return

    // Local refusal — never leaves the browser when blocked.
    if (isBlockedQuestion(q)) {
      setAnswer('')
      setError('')
      setRefused(true)
      return
    }

    setBusy(true)
    setAnswer('')
    setError('')
    setRefused(false)

    try {
      const { text, usage, finishReason, responseTimeMs } = await askGemini(q, {
        symbol,
        companyName: company?.name,
        phase: description?.phase || description?.phase_label,
        criteriaScore: conditions?.conditions_met,
        daysInPhase: description?.days_in_phase,
        sector: company?.sector || description?.sector,
        sectorBreadth: description?.sector_breadth_pct,
        narrative: description?.narrative,
      })
      setAnswer(text)

      // Fire-and-forget usage log + points award. Neither blocks the UI.
      logResearchUsage({
        userId, symbol,
        contextType: 'stock_page', category: 'freetext',
        usage, finishReason, responseTimeMs,
      })
      if (userId) {
        awardPoints(userId, 'research_question', {
          fallbackPoints: 2,
          notes: `Research on ${symbol}`,
          referenceId: null,
        }).catch(() => {})
      }
    } catch (e) {
      // SAFETY-blocked: still log so admin count is accurate.
      if (e && e.code === 'SAFETY') {
        logResearchUsage({
          userId, symbol,
          contextType: 'stock_page', category: 'freetext',
          usage: e.usage, finishReason: e.finishReason || 'SAFETY',
          responseTimeMs: e.responseTimeMs,
        })
      }
      setError(e?.message || 'Could not reach Gemini. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function handleKeyDown(e) {
    // Cmd/Ctrl-Enter to submit — convenient for short questions
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleAsk()
    }
  }

  return (
    <div style={{
      marginTop: 28,
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '18px 20px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>🔬</span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: C.amber,
        }}>
          Your Research Assistant
        </span>
      </div>
      <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 14px' }}>
        Powered by your Gemini key · Direct browser → Google
      </p>

      {/* Question textarea */}
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`Ask about ${symbol || 'this stock'}…`}
        rows={3}
        disabled={busy}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          background: C.surface2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          color: C.text,
          fontSize: 13,
          lineHeight: 1.5,
          resize: 'vertical',
          minHeight: 70,
          outline: 'none',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      />

      <button
        type="button"
        onClick={handleAsk}
        disabled={!question.trim() || busy}
        style={{
          marginTop: 10,
          padding: '10px 22px',
          background: (!question.trim() || busy) ? C.surface2 : C.amber,
          color: (!question.trim() || busy) ? C.textMuted : '#000',
          border: 'none',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          cursor: (!question.trim() || busy) ? 'not-allowed' : 'pointer',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {busy ? 'Thinking…' : 'Ask'}
      </button>

      {/* Loading state — animated dots */}
      {busy && (
        <div style={{
          marginTop: 14,
          padding: '12px 14px',
          background: C.surface2,
          borderRadius: 8,
          color: C.textMuted,
          fontSize: 13,
        }}>
          <span style={{ display: 'inline-block', animation: 'pinex-dot 1.4s infinite' }}>•</span>
          <span style={{ display: 'inline-block', animation: 'pinex-dot 1.4s 0.2s infinite' }}>•</span>
          <span style={{ display: 'inline-block', animation: 'pinex-dot 1.4s 0.4s infinite' }}>•</span>
          <span style={{ marginLeft: 8 }}>Asking your research assistant</span>
          <style>{`
            @keyframes pinex-dot {
              0%, 60%, 100% { opacity: 0.3 }
              30% { opacity: 1 }
            }
          `}</style>
        </div>
      )}

      {/* Refusal banner — never hits the API */}
      {refused && (
        <div style={{
          marginTop: 14,
          padding: '12px 14px',
          background: C.amberBg,
          border: `1px solid ${C.amberBorder}`,
          borderRadius: 8,
          color: C.amber,
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: 'Newsreader, ui-serif, Georgia, serif',
        }}>
          {REFUSAL_TEXT}
        </div>
      )}

      {/* Answer pane */}
      {answer && (
        <div style={{
          marginTop: 14,
          padding: '14px 16px',
          background: C.surface2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          color: C.textMuted,
          fontSize: 14,
          lineHeight: 1.7,
          fontFamily: 'Newsreader, ui-serif, Georgia, serif',
          whiteSpace: 'pre-wrap',
        }}>
          {answer}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          marginTop: 14,
          padding: '10px 12px',
          background: C.redBg,
          border: `1px solid ${C.redBorder}`,
          borderRadius: 8,
          color: C.red,
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* Footer — re-state the privacy stance + SEBI disclaimer */}
      <div style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: `1px solid ${C.border}`,
        fontSize: 10,
        color: C.textFaint,
        lineHeight: 1.6,
        fontStyle: 'italic',
        textAlign: 'center',
      }}>
        ⓘ Your key · Your AI · PineX sees nothing<br />
        Not investment advice. Consult a SEBI-registered adviser for buy/sell decisions.
      </div>
    </div>
  )
}
