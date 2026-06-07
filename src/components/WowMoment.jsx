// ── WowMoment ──────────────────────────────────────────────────────────────
// One-time celebration modal. Fires on Home mount when the signed-in user
// has an unshown row in pending_wow_moments. Shows ONE moment per session
// (the most recent unshown), marks it shown on any close action so it
// never reappears.
//
// Three exit paths, all set shown_at = now():
//   1. "See {symbol} now"  → mark shown, navigate to /stock/{symbol}
//   2. "Share this"        → mark shown, open share sheet / clipboard
//   3. "Close"             → mark shown, dismiss
//
// If the share-sheet API isn't available (desktop browsers), the share
// button falls back to writing the text to the clipboard and showing an
// inline "Copied!" confirmation for 1.5s before closing.
//
// Schema this reads (from extend_user_classifications_and_wow_moments.sql):
//   pending_wow_moments(id, user_id, classification_id, symbol,
//     company_name, classified_phase, classified_at,
//     criteria_score_at_classification, criteria_score_now,
//     days_elapsed, was_early, shown_at, created_at)

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context'
import { C } from '../styles/tokens'

import Icon from './ui/Icon'
const PHASE_COLOR = {
  Advancing: C.green,
  Basing:    C.amber,
  Topping:   C.red,
  Declining: C.red,
}

// Date formatter — "May 3" style, no year per spec.
function formatShortDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function WowMoment() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [moment, setMoment] = useState(null)      // null = loading; false = none; obj = present
  const [mounted, setMounted] = useState(false)   // slide-in animation toggle
  const [shareCopied, setShareCopied] = useState(false)
  const [closing, setClosing] = useState(false)

  // ── Fetch the latest unshown wow moment ────────────────────────
  useEffect(() => {
    if (!user?.id) {
      setMoment(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('pending_wow_moments')
          .select('id, symbol, company_name, classified_phase, classified_at, criteria_score_at_classification, criteria_score_now, days_elapsed, was_early')
          .eq('user_id', user.id)
          .is('shown_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (cancelled) return
        if (error || !data) {
          setMoment(false)
          return
        }
        setMoment(data)
        // Slide-in: small delay so the transform transition fires.
        setTimeout(() => { if (!cancelled) setMounted(true) }, 30)
      } catch {
        if (!cancelled) setMoment(false)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  // ── Mark shown helper — called by every close path ─────────────
  const markShown = async () => {
    if (!moment?.id || closing) return
    setClosing(true)
    try {
      await supabase
        .from('pending_wow_moments')
        .update({ shown_at: new Date().toISOString() })
        .eq('id', moment.id)
    } catch {
      // Non-fatal — even if write fails, hide locally so we don't
      // trap the user in a re-rendering modal.
    }
  }

  // ── Action handlers ─────────────────────────────────────────────
  const handleSeeStock = async () => {
    await markShown()
    setMoment(false)
    navigate(`/stock/${moment.symbol}`)
  }

  const handleShare = async () => {
    const text = buildShareText(moment)
    let sharedViaNative = false
    try {
      if (navigator.share) {
        await navigator.share({ text, title: 'PineX — My analysis' })
        sharedViaNative = true
      }
    } catch {
      // User cancelled the share sheet — fall back to clipboard.
    }
    if (!sharedViaNative) {
      try {
        await navigator.clipboard.writeText(text)
        setShareCopied(true)
        // Brief confirmation, then close.
        setTimeout(() => {
          markShown().then(() => setMoment(false))
        }, 1200)
        return
      } catch {
        // Clipboard blocked (rare). Just close.
      }
    }
    await markShown()
    setMoment(false)
  }

  const handleClose = async () => {
    await markShown()
    setMoment(false)
  }

  // ── Bail-outs (silent) ──────────────────────────────────────────
  if (!user) return null
  if (moment === null) return null   // still loading
  if (!moment) return null           // no unshown moment

  const phase = moment.classified_phase
  const phaseColor = PHASE_COLOR[phase] || C.text
  const wasEarly = Boolean(moment.was_early)
  const score = moment.criteria_score_at_classification

  return (
    <>
      {/* Backdrop — click to dismiss (still marks shown). */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 980,
        }}
      />

      {/* Centered card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your classification was confirmed"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${mounted ? 1 : 0.96})`,
          opacity: mounted ? 1 : 0,
          transition: 'transform 0.28s cubic-bezier(0.34, 1.4, 0.64, 1), opacity 0.2s',
          zIndex: 981,
          width: 'calc(100% - 32px)',
          maxWidth: 340,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
          color: C.text,
          // Safe-area inset for iOS notch / home bar
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
        }}
      >
        {/* "Your analysis" label */}
        <div style={{
          fontSize: 11,
          color: C.textMuted,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          Your analysis
        </div>

        {/* Stock name (large) */}
        <div style={{
          fontSize: 22,
          fontWeight: 700,
          color: C.text,
          lineHeight: 1.2,
          marginBottom: 4,
        }}>
          {moment.company_name || moment.symbol}
        </div>

        {/* Phase line — colored per phase */}
        <div style={{
          fontSize: 16,
          fontWeight: 600,
          color: phaseColor,
          marginBottom: 18,
        }}>
          {phase}
        </div>

        {/* The story — 3 lines (line 2 only if was_early) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>
            You called this on <strong style={{ color: C.text, fontWeight: 600 }}>{formatShortDate(moment.classified_at)}</strong>.
          </div>
          {wasEarly && score != null && (
            <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
              Criteria score was{' '}
              <strong style={{ color: C.textMuted, fontWeight: 600 }}>
                {Number(score).toFixed(0)}/5
              </strong>
              {' '}then.
            </div>
          )}
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>
            The data confirmed it{' '}
            <strong style={{ color: C.text, fontWeight: 600 }}>
              {moment.days_elapsed}
            </strong>
            {' '}day{moment.days_elapsed === 1 ? '' : 's'} later.
          </div>
        </div>

        {/* Celebration line */}
        <div style={{
          marginTop: 16,
          marginBottom: 18,
          fontSize: 15,
          fontWeight: 600,
          color: C.green,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}>
          {wasEarly && <Icon name="confetti" style={{ fontSize: 18 }} />}
          {wasEarly ? 'You saw it early.' : 'Your read was right.'}
        </div>

        {/* Primary CTA — "See {symbol} now" */}
        <button
          type="button"
          onClick={handleSeeStock}
          disabled={closing}
          style={{
            display: 'block',
            width: '100%',
            padding: 12,
            borderRadius: 8,
            background: 'rgba(52,211,153,0.15)',
            border: '1px solid rgba(52,211,153,0.30)',
            color: C.green,
            fontSize: 14,
            fontWeight: 700,
            cursor: closing ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            marginBottom: 6,
          }}
        >
          See {moment.symbol} now
        </button>

        {/* Secondary — Share */}
        <button
          type="button"
          onClick={handleShare}
          disabled={closing}
          style={{
            display: 'block',
            width: '100%',
            padding: 8,
            background: 'transparent',
            border: 'none',
            color: shareCopied ? C.green : C.blue,
            fontSize: 13,
            fontWeight: 500,
            cursor: closing ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            transition: 'color 0.15s',
          }}
        >
          {shareCopied ? 'Copied!' : 'Share this'}
        </button>

        {/* Close link */}
        <button
          type="button"
          onClick={handleClose}
          disabled={closing}
          style={{
            display: 'block',
            margin: '4px auto 0',
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            color: C.textMuted,
            fontSize: 11,
            cursor: closing ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Close
        </button>
      </div>
    </>
  )
}

// Build the share text body. Includes the educational disclaimer
// so anyone re-sharing the screenshot/text carries the SEBI-safe
// framing forward.
function buildShareText(m) {
  const company = m.company_name || m.symbol
  const date = formatShortDate(m.classified_at)
  const days = m.days_elapsed
  const phase = m.classified_phase
  return [
    `I classified ${company} as ${phase} on ${date}.`,
    '',
    `Criteria confirmed it ${days} day${days === 1 ? '' : 's'} later.`,
    '',
    'Not luck. Process.',
    '',
    'pinex.in',
    '',
    'Educational analysis · Not advice',
  ].join('\n')
}
