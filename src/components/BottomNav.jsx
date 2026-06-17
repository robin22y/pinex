import { useLocation, useNavigate } from 'react-router-dom'

// Latest spec colours — bright amber active, slate inactive. These
// replace the previous sepia-safe palette: the redesign deliberately
// wants the stronger visual hierarchy (weight + colour) as the
// active affordance, no dot.
const ACTIVE_COLOR   = '#FBBF24'
const INACTIVE_COLOR = '#64748B'
const TOP_BORDER     = '#1E2530'

// Four tabs only — Discover renamed to Opportunities; Advanced and
// Learn moved out of the primary mobile nav into Profile (they're
// reference surfaces, not daily flow). The four left model the
// trader's actual loop: understand the market (Today) → find trades
// (Opportunities) → track flow (Sectors) → manage self (Profile).
const TABS = [
  { key: 'today',         label: 'Today',         path: '/home'             },
  { key: 'opportunities', label: 'Opportunities', path: '/explore'          },
  { key: 'sectors',       label: 'Sectors',       path: '/home?tab=sectors' },
  { key: 'profile',       label: 'Profile',       path: '/profile'          },
]

// Inline SVG icons — 20×20, stroke 1.5, currentColor — kept inline
// (no icon-library dependency for the bottom nav) so each glyph
// inherits tab colour cleanly and the bundle stays lean.
function IconToday() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3"    y="11" width="3" height="6"  />
      <rect x="8.5"  y="7"  width="3" height="10" />
      <rect x="14"   y="3"  width="3" height="14" />
    </svg>
  )
}
function IconOpportunities() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="9" r="6" />
      <path d="m17 17-3.5-3.5" />
    </svg>
  )
}
function IconSectors() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3"  y="3"  width="6" height="6" rx="0.5" />
      <rect x="11" y="3"  width="6" height="6" rx="0.5" />
      <rect x="3"  y="11" width="6" height="6" rx="0.5" />
      <rect x="11" y="11" width="6" height="6" rx="0.5" />
    </svg>
  )
}
function IconProfile() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="7.5" r="3" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  )
}

const ICONS = {
  today:         IconToday,
  opportunities: IconOpportunities,
  sectors:       IconSectors,
  profile:       IconProfile,
}

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const tabParam = new URLSearchParams(location.search).get('tab')

  // 'today' wins for /home WITHOUT ?tab=sectors so Sectors gets its
  // own active state. Opportunities matches /explore and nested
  // explore routes. Profile shadows both /profile and /account
  // (Account is the same surface under a different URL).
  function isActive(key) {
    const onSectors = pathname === '/home' && tabParam === 'sectors'
    if (key === 'today')         return pathname === '/home' && !onSectors
    if (key === 'sectors')       return onSectors
    if (key === 'opportunities') return pathname === '/explore' || pathname.startsWith('/explore/')
    if (key === 'profile')       return pathname === '/profile' || pathname === '/account'
    return false
  }

  return (
    <nav
      className="mobile-bottom-nav md:hidden"
      style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'stretch',
        height: 64,
        background: 'var(--bg-surface)',
        borderTop: `1px solid ${TOP_BORDER}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        // iPhone home-bar inset — keeps the bar above the system
        // gesture area on devices with no physical home button.
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((tab) => {
        const active = isActive(tab.key)
        const IconComp = ICONS[tab.key]
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(tab.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '6px 0',
              // 44 × 44 minimum per the accessibility brief — the
              // tab fills the nav height so the visible target is
              // always ≥ 56 px even before the safe-area inset.
              minHeight: 44,
              minWidth: 44,
              // Icon + label both inherit this colour via
              // currentColor / explicit color below.
              color: active ? ACTIVE_COLOR : INACTIVE_COLOR,
            }}
          >
            {IconComp && <IconComp />}
            <span style={{
              fontSize: 12,
              letterSpacing: 0,
              textTransform: 'uppercase',
              // Weight is the primary active affordance — 700
              // against 400 reads as a clear difference without
              // needing a dot beneath the label.
              fontWeight: active ? 700 : 400,
              color: 'inherit',
              lineHeight: 1.1,
            }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
