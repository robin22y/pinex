import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import Icon from './ui/Icon'
// localStorage key tracking whether the user has already opened the
// Module 9 (Research Assistant) deep-link. Set on first visit to
// /learn?from=research or any /learn page after the dot is shown.
const LEARN_DOT_DISMISSED_KEY = 'pinex_learn_research_dot_dismissed'

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const tab = new URLSearchParams(location.search).get('tab')

  const isSectors = pathname === '/home' && tab === 'sectors'
  const isHome = pathname === '/home' && !isSectors
  const isLearn = pathname === '/learn'
  const isProfile = pathname === '/profile' || pathname === '/account'

  // ── Amber-dot "something new" indicator on Learn tab ─────────────────
  // Shown when:
  //   - user has NOT dismissed the dot (i.e. hasn't tapped Learn yet)
  //   - user has NOT already saved a Gemini key (no point promoting it)
  // Dismissed automatically the first time the user opens /learn.
  const [showLearnDot, setShowLearnDot] = useState(() => {
    try {
      const dismissed = localStorage.getItem(LEARN_DOT_DISMISSED_KEY) === '1'
      const hasKey    = Boolean(localStorage.getItem('pinex_gemini_key'))
      return !dismissed && !hasKey
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (isLearn && showLearnDot) {
      try { localStorage.setItem(LEARN_DOT_DISMISSED_KEY, '1') } catch {}
      setShowLearnDot(false)
    }
  }, [isLearn, showLearnDot])

  const btn = () => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '4px 0',
  })

  const ic = (active) => ({
    fontSize: 21,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    lineHeight: 1,
  })

  const lbl = (active) => ({
    fontSize: 10,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    lineHeight: 1,
  })

  return (
    <nav
      className="mobile-bottom-nav md:hidden"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        height: 60,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Home */}
      <button type="button" onClick={() => navigate('/home?tab=search')} style={btn()}>
        <Icon name="home" style={ic(isHome)} />
        <span style={lbl(isHome)}>Home</span>
      </button>

      {/* Sectors */}
      <button type="button" onClick={() => navigate('/home?tab=sectors')} style={btn()}>
        <Icon name="chart-pie" style={ic(isSectors)} />
        <span style={lbl(isSectors)}>Sectors</span>
      </button>

      {/* Center: Lab — the primary user-run screener (replaces the search FAB) */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button
          type="button"
          aria-label="Lab"
          onClick={() => navigate('/lab')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent)',
            borderRadius: '50%',
            width: 48,
            height: 48,
            border: 'none',
            cursor: 'pointer',
            marginTop: -12,
            boxShadow: '0 4px 16px rgba(0,200,5,0.35)',
            flexShrink: 0,
          }}
        >
          <Icon name="flask" style={{ fontSize: 21, color: '#000' }} />
        </button>
      </div>

      {/* Learn — with amber "new feature" dot when the user hasn't yet
          opened the Learn tab post-Research-Assistant launch (and they
          don't already have a Gemini key). Dot clears the moment they
          tap the tab. */}
      <button type="button" onClick={() => navigate('/learn')} style={{ ...btn(), position: 'relative' }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Icon name="book" style={ic(isLearn)} />
          {showLearnDot && (
            <span
              aria-hidden
              style={{
                position: 'absolute', top: -2, right: -4,
                width: 8, height: 8, borderRadius: '50%',
                background: '#FBBF24',
                boxShadow: '0 0 0 2px var(--bg-surface)',
              }}
            />
          )}
        </span>
        <span style={lbl(isLearn)}>Learn</span>
      </button>

      {/* Profile */}
      <button type="button" onClick={() => navigate('/profile')} style={btn()}>
        <Icon name="user" style={ic(isProfile)} />
        <span style={lbl(isProfile)}>Profile</span>
      </button>
    </nav>
  )
}
