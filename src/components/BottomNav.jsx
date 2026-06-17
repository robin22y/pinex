import { useLocation, useNavigate } from 'react-router-dom'

// Sepia-safe palette per the contrast brief. The bar always
// sits on the page tone, so dark-amber + medium-brown read
// clearly without relying on slate / yellow contrast that
// disappears on sepia.
//   active   #92400E  dark amber — also used for the active dot
//   inactive #6B5744  medium brown
//   border   #D4C5A9  subtle hairline above the bar
const ACTIVE_COLOR   = '#92400E'
const INACTIVE_COLOR = '#6B5744'
const TOP_BORDER     = '#D4C5A9'

// Five tabs per the spec. Text-only labels (no icons), 11 px, all
// caps. Each tab's active rule is computed below in BottomNav().
const TABS = [
  { key: 'today',    label: 'Today',    path: '/home'             },
  { key: 'discover', label: 'Discover', path: '/explore'          },
  { key: 'sectors',  label: 'Sectors',  path: '/home?tab=sectors' },
  { key: 'advanced', label: 'Advanced', path: '/lab'              },
  { key: 'profile',  label: 'Profile',  path: '/profile'          },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const tabParam = new URLSearchParams(location.search).get('tab')

  // ── Active-tab predicate ───────────────────────────────────
  // 'today' wins for /home WITHOUT ?tab=sectors so Sectors gets
  // its own active state. 'advanced' lights up on both /lab and
  // /breadth-lab so the merged Advanced page reads as one tab.
  function isActive(key) {
    const onSectors = pathname === '/home' && tabParam === 'sectors'
    if (key === 'today')    return pathname === '/home' && !onSectors
    if (key === 'sectors')  return onSectors
    if (key === 'discover') return pathname === '/explore' || pathname.startsWith('/explore/')
    if (key === 'advanced') {
      return pathname === '/lab'
        || pathname.startsWith('/lab/')
        || pathname === '/breadth-lab'
        || pathname.startsWith('/breadth-lab/')
    }
    if (key === 'profile')  return pathname === '/profile' || pathname === '/account'
    return false
  }

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
        alignItems: 'stretch',
        // Height bumped 60 → 64 px so the larger 12 px labels +
        // 3 px active dot have room without crowding the safe-
        // area inset.
        height: 64,
        background: 'var(--bg-surface)',
        borderTop: `1px solid ${TOP_BORDER}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((tab) => {
        const active = isActive(tab.key)
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
              minHeight: 48,
              minWidth: 48,
            }}
          >
            <span style={{
              // Per the contrast brief — 12 px / weight 600 /
              // no letter-spacing. Dark amber active, medium
              // brown inactive; both read against the sepia bar.
              fontSize: 12,
              letterSpacing: '0',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: active ? ACTIVE_COLOR : INACTIVE_COLOR,
              lineHeight: 1.1,
            }}>
              {tab.label}
            </span>
            {/* Active dot bumped 4 → 3 px (spec) — still reads as
                the affordance under the label without crowding it. */}
            {active && (
              <span
                aria-hidden
                style={{
                  display: 'block',
                  width: 3,
                  height: 3,
                  borderRadius: '50%',
                  background: ACTIVE_COLOR,
                  marginTop: 3,
                }}
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
