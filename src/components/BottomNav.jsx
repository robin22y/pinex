import { useLocation, useNavigate } from 'react-router-dom'

// Spec colours per the nav-redesign rework — fixed hex per the brief
// instead of C tokens, because the bottom-nav is identical across
// dark + sepia (always sits on a translucent surface bar). #FBBF24
// matches the amber accent the rest of the app uses; #64748B is the
// inactive slate.
const ACTIVE_COLOR   = '#FBBF24'
const INACTIVE_COLOR = '#64748B'

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
        height: 60,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
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
              // Spec: 11 px, uppercase, amber when active / slate
              // when not.
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: active ? 700 : 500,
              color: active ? ACTIVE_COLOR : INACTIVE_COLOR,
              lineHeight: 1.1,
            }}>
              {tab.label}
            </span>
            {/* 4-px active dot underneath — same affordance the old
                BottomNav used, kept so the active tab reads at a
                glance even on dimmer screens. */}
            {active && (
              <span
                aria-hidden
                style={{
                  display: 'block',
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: ACTIVE_COLOR,
                  marginTop: 2,
                }}
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
