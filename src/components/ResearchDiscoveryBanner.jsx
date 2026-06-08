import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { getStoredGeminiKey } from '../lib/researchAssistant'
import { C } from '../styles/tokens'

// ── ResearchDiscoveryBanner ─────────────────────────────────────────────
// Mounted on the home page to surface the Research Assistant feature.
//
// Three render states:
//   1. User has Gemini key in localStorage   -> compact active-state card
//   2. User has NO key, not dismissed         -> full announcement banner
//   3. User has NO key, dismissed             -> render nothing
//
// State 2 is the discovery banner described in the spec. The CTA routes
// to /learn so the user can read Module 9 first; from there the module
// page itself routes them to /account#research to add their key.
//
// `searchInputRef` (optional) is consumed by the active-state card so
// the "Try: Search RELIANCE" button can focus + prefill the search bar
// without prop-drilling through the parent.

const DISMISS_KEY = 'pinex_research_banner_dismissed'

const FEATURE_PILLS = [
  { icon: '📊', label: 'Valuation' },
  { icon: '👥', label: 'Shareholding' },
  { icon: '🔄', label: 'Cycle' },
  { icon: '🎯', label: 'Trading Framework' },
  { icon: '📋', label: 'Results' },
  { icon: '📈', label: 'Growth' },
]

export default function ResearchDiscoveryBanner({ searchInputRef, onPrefillSearch }) {
  const navigate = useNavigate()
  const [hasKey,    setHasKey]    = useState(() => Boolean(getStoredGeminiKey()))
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  const [activeUsers, setActiveUsers] = useState(null) // number or null while loading

  // Live count of distinct users who have asked at least one Research
  // Assistant question. Computed by pulling user_id (de-duped) from the
  // most recent 5,000 events — bounded so we don't pay for a full scan.
  useEffect(() => {
    if (hasKey || dismissed) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('usage_events')
          .select('user_id,metadata')
          .eq('event_type', 'research_question_asked')
          .order('created_at', { ascending: false })
          .limit(5000)
        if (cancelled) return
        const ids = new Set()
        for (const ev of (data || [])) {
          const uid = ev.user_id || (ev.metadata && ev.metadata.user_id) || null
          if (uid) ids.add(uid)
        }
        setActiveUsers(ids.size)
      } catch {
        setActiveUsers(0)
      }
    })()
    return () => { cancelled = true }
  }, [hasKey, dismissed])

  // Re-check on cross-tab "storage" event so the active-state card
  // appears immediately after the user saves a key in another tab.
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
  }

  function handleLearnMore() {
    // Direct-open Module 9 — DB-driven academy at /learn/:moduleId.
    // Lang is picked from the user's saved preference (pinex_lang) and
    // falls back to 'en'. ModuleLesson.jsx reads ?lang= first so this
    // honours the choice without re-prompting.
    let lang = 'en'
    try { lang = localStorage.getItem('pinex_lang') || 'en' } catch {}
    navigate(`/learn/research_assistant?lang=${lang}`)
  }

  function handleTrySearch() {
    if (onPrefillSearch) {
      onPrefillSearch('RELIANCE')
    } else if (searchInputRef?.current) {
      searchInputRef.current.focus()
    } else {
      navigate('/home?tab=search')
    }
  }

  // State 1 — Active state card.
  //
  // Previous version: a tiny 70-px-tall pill with the badge + a single CTA.
  // Looked great in isolation but inside the wrapper Home reserves for the
  // banner area (minHeight 360, sized for the big State-2 announcement) it
  // sat as a small card floating in ~290 px of empty wrapper, with the hero
  // text + search input below it pushed to the bottom of the viewport by
  // the search section's flex-center. End result: a huge dead-zone screenshot
  // exactly like the user reported.
  //
  // New version: same amber-card aesthetic, but pre-loaded with quick-start
  // chips so the user has something to scan and tap instead of empty space.
  // Each chip prefills the search bar with that query through the same
  // onPrefillSearch path the CTA uses. Card now fills the reserved height
  // naturally with useful content — no more dead zone.
  if (hasKey) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
        style={{
          marginBottom: 16,
          padding: 20,
          background: 'linear-gradient(135deg, rgba(245,159,11,0.10) 0%, rgba(245,159,11,0.03) 100%)',
          border: `1px solid rgba(245,159,11,0.30)`,
          borderRadius: 14,
        }}
      >
        {/* Header — badge + headline */}
        <div style={{
          fontSize: 13, fontWeight: 700, color: C.amber,
          display: 'flex', alignItems: 'center', gap: 6,
          marginBottom: 6,
        }}>
          🔬 Research Assistant Active
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text-muted)',
          lineHeight: 1.5, marginBottom: 14,
        }}>
          Ask anything about any Indian stock. Private AI analysis powered
          by your own Gemini key.
        </div>

        {/* Quick-start label */}
        <div style={{
          fontSize: 11, fontWeight: 600,
          color: 'var(--text-hint)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Quick starts
        </div>

        {/* Chip grid — each prefills the search and parses it.
            Mix of stocks (most-known names) and sector labels covers
            both "lookup a stock" and "explore a theme" intent. Tap
            target: 30 px tall, padded for thumb-friendly hits. */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          marginBottom: 16,
        }}>
          {['RELIANCE', 'TCS', 'HDFC BANK', 'INFY', 'Pharma', 'Banking', 'IT sector'].map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPrefillSearch && onPrefillSearch(q)}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                padding: '6px 12px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Primary CTA — kept distinct as the high-affordance action even
            though the chips above also prefill. Same handler. */}
        <button
          type="button"
          onClick={handleTrySearch}
          style={{
            width: '100%',
            padding: '11px 16px',
            background: C.amber, color: '#000',
            border: 'none', borderRadius: 10,
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Try: Search RELIANCE →
        </button>
      </motion.div>
    )
  }

  // State 3 — dismissed, render nothing
  if (dismissed) return null

  // State 2 — full announcement banner
  return (
    <AnimatePresence>
      <motion.div
        key="research-banner"
        // Opacity-only enter. The previous y-translate registered as a
        // layout shift on mount even though it was a transform; framer-
        // motion's initial render also flickered the height when the
        // active-users line populated, hence the explicit min-height
        // below to lock the box on first paint.
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'relative',
          overflow: 'hidden',
          marginBottom: 24,
          padding: 20,
          // Reserve the full final height so the page below doesn't
          // jump when the live user-count text resolves (~280px is the
          // rendered height on mobile per the Lighthouse trace).
          minHeight: 360,
          boxSizing: 'border-box',
          background: 'linear-gradient(135deg, rgba(245,159,11,0.08) 0%, rgba(245,159,11,0.03) 100%)',
          border: '1px solid rgba(245,159,11,0.25)',
          borderRadius: 16,
        }}
      >
        {/* Decorative faded emoji top-right */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: -10, top: -10,
            fontSize: 80, opacity: 0.08,
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
            position: 'absolute', right: 10, top: 10,
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
          padding: '3px 8px', borderRadius: 6,
          marginBottom: 10,
        }}>
          ✨ New
        </span>

        {/* Title + amber subtitle */}
        <h2 style={{
          margin: 0, fontSize: 20, fontWeight: 800,
          color: 'var(--text-primary)', lineHeight: 1.2,
        }}>
          Your Personal AI Analyst
        </h2>
        <h2 style={{
          margin: '0 0 8px', fontSize: 20, fontWeight: 800,
          color: C.amber, lineHeight: 1.2,
        }}>
          is now on PineX
        </h2>

        {/* Description */}
        <p style={{
          margin: '0 0 12px',
          fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6,
          maxWidth: 520,
        }}>
          Ask anything about any Indian stock. Valuation. Shareholding.
          Cycle position. Trading framework. All private. Powered by
          your own Gemini key.
        </p>

        {/* Feature pills — horizontal scroll on narrow */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 10,
        }}>
          {FEATURE_PILLS.map((p) => (
            <span key={p.label} style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              padding: '4px 10px',
              fontSize: 11,
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span>{p.icon}</span> {p.label}
            </span>
          ))}
        </div>

        <p style={{
          margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)',
        }}>
          Free · Takes 2 minutes
        </p>

        {/* Full-width CTA */}
        <button
          type="button"
          onClick={handleLearnMore}
          style={{
            width: '100%',
            padding: '12px 20px',
            background: C.amber, color: '#000',
            border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          Learn how it works →
        </button>

        {/* Live count line */}
        <p style={{
          textAlign: 'center',
          margin: '10px 0 0',
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          {activeUsers == null
            ? ' '
            : activeUsers === 0
              ? 'Be among the first to activate this'
              : `${activeUsers} trader${activeUsers === 1 ? '' : 's'} already using this`}
        </p>
      </motion.div>
    </AnimatePresence>
  )
}
