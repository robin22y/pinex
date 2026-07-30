import { useLocation, useNavigate } from 'react-router-dom'

// Latest spec colours — bright amber active, slate inactive. These
// replace the previous sepia-safe palette: the redesign deliberately
// wants the stronger visual hierarchy (weight + colour) as the
// active affordance, no dot.
const ACTIVE_COLOR   = '#FBBF24'
const INACTIVE_COLOR = '#64748B'
const TOP_BORDER     = '#1E2530'

// Five tabs: Today (home) → Structure (explore) → Sectors (watchlist) →
// Journal (decision tracking) → Profile (account). Journal sits between
// Sectors and Profile to keep decision-making in the daily flow.
const TABS = [
  { key: 'today',         label: 'Today',         path: '/home'             },
  { key: 'opportunities', label: 'Structure',     path: '/explore'          },
  // QuickScanner took the slot that held Sectors. Sectors was the only
  // one of the five with another way in — it is /home?tab=sectors, a tab
  // INSIDE Today, so it stays one tap away. Dropping Today, Structure,
  // Journal or Profile would have orphaned a top-level destination.
  //
  // `external` is load-bearing: /quickscanner is a generated static page
  // served by a netlify.toml rewrite, not a React route. navigate() would
  // do a client-side transition, match nothing and render the app's 404.
  //
  // Label is 'Scanner', not 'QuickScanner' — at 390px each tab is ~78px
  // and the 12px uppercase label has to fit on one line.
  { key: 'scanner',       label: 'Scanner',       path: '/quickscanner', external: true },
  { key: 'journal',       label: 'Journal',       path: '/journal'          },
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
function IconScanner() {
  // Funnel — the tab filters a universe down to a shortlist.
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h14l-5.25 6.25V16L8.25 17.5v-7.25L3 4z" />
    </svg>
  )
}
function IconJournal() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3h10a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path d="M8 7h4M8 11h4M8 15h2" />
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
  scanner:       IconScanner,
  journal:       IconJournal,
  profile:       IconProfile,
}

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const tabParam = new URLSearchParams(location.search).get('tab')

  // 'today' wins for /home WITHOUT ?tab=sectors so Sectors gets its
  // own active state. Structure matches /explore and nested
  // explore routes. Journal matches /journal and its subroutes.
  // Profile shadows both /profile and /account (Account is the same
  // surface under a different URL).
  function isActive(key) {
    const onSectors = pathname === '/home' && tabParam === 'sectors'
    // Sectors keeps its own active state on /home?tab=sectors even though
    // it no longer has a tab — otherwise Today would highlight while the
    // user is looking at the sectors view.
    if (key === 'today')         return pathname === '/home' && !onSectors
    // Never active: /quickscanner is served outside React, so this
    // component is not mounted while the scanner is open.
    if (key === 'scanner')       return false
    if (key === 'opportunities') return pathname === '/explore' || pathname.startsWith('/explore/')
    if (key === 'journal')       return pathname === '/journal' || pathname.startsWith('/journal/')
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
            onClick={() => {
              // See the `external` note on the TABS entry — a static page
              // outside React needs a real document load, not navigate().
              if (tab.external) window.location.assign(tab.path)
              else navigate(tab.path)
            }}
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
