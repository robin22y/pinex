import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { BYOK_MODULE_KEY } from './ByokExplainer'
import { getStoredGeminiKey } from '../lib/researchAssistant'
import { C } from '../styles/tokens'

// ── ResearchDiscoveryBanner ─────────────────────────────────────────────
// Mounted on the home page to surface the Research Assistant feature.
//
// Three render states:
//   1. User has Gemini key in localStorage   -> single-line success indicator
//   2. User has NO key, not dismissed        -> compact full announcement
//   3. User has NO key, dismissed            -> small persistent one-line
//                                               nudge. Earlier this state
//                                               rendered nothing — that
//                                               permanently hid the only
//                                               path to setup once a user
//                                               dismissed. The persistent
//                                               nudge is *much* smaller
//                                               but never goes away while
//                                               a key is missing.
//
// State 2 (the announcement) is intentionally compact — ~140 px tall —
// so the mobile fold gets the search bar, the points widget, AND the
// announcement together on one screen. The CTA routes to the BYOK
// explainer module (the practical "how to get + paste your key"
// lesson), NOT the broader research_assistant overview module which
// was the wrong destination for the "I want to set this up now" intent.
//
// `searchInputRef` (optional) was previously consumed by the State-1
// quick-start card; it stays in the prop signature so existing call
// sites keep compiling, but it's no longer used internally.

const DISMISS_KEY = 'pinex_research_banner_dismissed'

export default function ResearchDiscoveryBanner({ searchInputRef, onPrefillSearch, onDismissed }) {
  const navigate = useNavigate()
  const [hasKey,    setHasKey]    = useState(() => Boolean(getStoredGeminiKey()))
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  // Re-check on cross-tab "storage" event so the active-state card
  // appears immediately after the user saves a key in another tab.
  // Previous revision also had an effect that pulled the live count
  // of distinct askers from usage_events; that line is gone in the
  // compact layout, so the effect dropped with it.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'pinex_gemini_key') {
        setHasKey(Boolean(getStoredGeminiKey()))
      }
      if (e.key === DISMISS_KEY) {
        try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1') } catch {}
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function handleDismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    setDismissed(true)
    // Bubble up so the parent (Home) can unmount the wrapper.
    if (typeof onDismissed === 'function') onDismissed()
  }

  function handleLearnMore() {
    // Route to the BYOK explainer module — the practical "how to get
    // a free Gemini key and paste it into Settings" walkthrough.
    // Previously this routed to research_assistant (broader overview),
    // which made the dismiss-vs-set-up decision needlessly two-click.
    let lang = 'en'
    try { lang = localStorage.getItem('pinex_lang') || 'en' } catch {}
    navigate(`/learn/${BYOK_MODULE_KEY}?lang=${lang}`)
  }

  // State 1 — Active state (key saved). A single line directly under
  // the search bar. Per the colour audit, "active / success" states
  // use C.green (not amber — amber is reserved for Pro / rewards /
  // new-feature attention). The phrase "Research Assistant active"
  // IS a success state, so the indicator reads in green.
  if (hasKey) {
    return (
      <div
        role="status"
        style={{
          textAlign: 'center',
          fontSize: 11,
          color: C.green,
          marginTop: 4,
          marginBottom: 6,
          letterSpacing: '0.02em',
          lineHeight: 1.45,
        }}
      >
        🔬 Research Assistant active · Powered by your Gemini key
      </div>
    )
  }

  // State 3 — dismissed, but key still missing. Earlier this rendered
  // nothing; users who tapped × before they understood the feature
  // never saw the path back. Now we keep a small one-line nudge that
  // links directly to the BYOK explainer module. It can't be
  // dismissed (the × is on the bigger banner only). Disappears the
  // moment a key lands in localStorage.
  if (dismissed) {
    return (
      <button
        type="button"
        onClick={handleLearnMore}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          background: 'transparent',
          border: '1px dashed rgba(245,159,11,0.35)',
          borderRadius: 10,
          color: C.amber,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          padding: '8px 12px',
          marginTop: 4,
          marginBottom: 12,
          letterSpacing: '0.02em',
        }}
      >
        🔬 Add your free Gemini AI key — 2 min guide →
      </button>
    )
  }

  // State 2 — compact announcement banner.
  // ~140 px target on mobile. Feature pills, the "Free · Takes 2
  // minutes" tagline, and the live-count line were all removed; the
  // button below carries the "free, 2 min" framing now.
  return (
    <AnimatePresence>
      <motion.div
        key="research-banner"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'relative',
          overflow: 'hidden',
          marginBottom: 16,
          padding: '14px 16px',
          boxSizing: 'border-box',
          background: 'linear-gradient(135deg, rgba(245,159,11,0.08) 0%, rgba(245,159,11,0.03) 100%)',
          border: '1px solid rgba(245,159,11,0.25)',
          borderRadius: 14,
        }}
      >
        {/* Decorative microscope — 36 px corner accent (was 80 px). */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: 36, top: 10,
            fontSize: 36, opacity: 0.12,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          🔬
        </span>

        {/* Dismiss × */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss banner"
          style={{
            position: 'absolute', right: 8, top: 6,
            background: 'transparent', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 16, padding: 4, lineHeight: 1, zIndex: 2,
          }}
        >
          ×
        </button>

        {/* NEW badge */}
        <span style={{
          display: 'inline-block',
          background: C.amber, color: C.base,
          fontSize: 10, fontWeight: 800,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 5,
          marginBottom: 6,
        }}>
          ✨ New
        </span>

        {/* Title — two-line, tighter type sizes for the compact layout. */}
        <h2 style={{
          margin: 0, fontSize: 17, fontWeight: 800,
          color: 'var(--text-primary)', lineHeight: 1.2,
        }}>
          Private Research Engine
        </h2>

        {/* One-line description. */}
        <p style={{
          margin: '0 0 10px',
          fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
          maxWidth: 520,
        }}>
          Run structural queries across 7 data categories. Your Gemini key stays on your device — PineX never sees your questions or outputs.
        </p>

        {/* Full-width CTA — "free, 2 min" rolled into the button text. */}
        <button
          type="button"
          onClick={handleLearnMore}
          style={{
            width: '100%',
            padding: '10px 18px',
            background: C.amber, color: '#000',
            border: 'none', borderRadius: 10,
            fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          Learn how it works — free, 2 min →
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
