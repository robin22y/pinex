// WHY: BottomNav (mobile) hard-codes its 5 buttons and does NOT
// iterate APP_NAV_TABS, so adding an entry here only surfaces in
// the DesktopSidebar. That's deliberate for experimental routes —
// we want them reachable but not in the primary mobile nav.
// `badge` (optional) renders a small chip next to the label in the
// sidebar (e.g. BETA for /breadth-lab).
export const APP_NAV_TABS = [
  { icon: 'ti-activity',    label: 'Pulse',        path: '/pulse' },
  { icon: 'ti-home',        label: 'Home',         path: '/home' },
  { icon: 'ti-chart-pie',   label: 'Sectors',      path: '/home?tab=sectors' },
  { icon: 'ti-flask',       label: 'Lab',          path: '/lab' },
  // Sits between Lab and the heatmap/screener pair per the PineX
  // rework spec. Surfaces the 10 pre-built exploration cards.
  { icon: 'ti-compass',     label: 'Explore',      path: '/explore' },
  { icon: 'ti-layout-grid', label: 'Heatmap',      path: '/heatmap' },
  { icon: 'ti-bookmark',    label: 'Watchlist',    path: '/dashboard' },
  { icon: 'ti-book',        label: 'Learn',        path: '/learn' },
  { icon: 'ti-test-pipe',   label: 'Breadth Lab',  path: '/breadth-lab',
    badge: 'BETA', badgeColor: '#FBBF24' },
  { icon: 'ti-user',        label: 'Profile',      path: '/profile' },
]

// WHY: Sectors and Home both live at `/home`,
// distinguished only by `?tab=sectors`. The 3rd
// `search` argument lets the matcher tell them
// apart — Home matches /home WITHOUT tab=sectors;
// Sectors matches /home WITH tab=sectors.
export function isAppNavActive(pathname, path, search = '') {
  const tab = new URLSearchParams(search).get('tab')
  if (path === '/pulse') return pathname === '/pulse' || pathname.startsWith('/pulse/')
  if (path === '/home') return pathname === '/home' && tab !== 'sectors'
  if (path === '/home?tab=sectors') return pathname === '/home' && tab === 'sectors'
  if (path === '/lab') return pathname === '/lab'
  if (path === '/explore') return pathname === '/explore' || pathname.startsWith('/explore/')
  if (path === '/breadth-lab') return pathname === '/breadth-lab'
  if (path === '/heatmap') return pathname === '/heatmap'
  if (path === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  if (path === '/profile') return pathname === '/profile' || pathname === '/account'
  if (path === '/learn') return pathname === '/learn' || pathname.startsWith('/learn/')
  return pathname === path || pathname.startsWith(`${path}/`)
}

export const AUTH_NAV_PATHS = ['/login', '/register', '/forgot-password', '/reset-password']

export function shouldShowAppShellNav(pathname) {
  // /learn is now a primary nav tab — show the bottom nav there
  if (pathname === '/') return false
  if (pathname === '/waitlist') return false
  if (pathname === '/welcome') return false
  if (pathname.startsWith('/invite/')) return false
  if (pathname === '/about') return false
  if (pathname === '/terms') return false
  if (pathname === '/privacy') return false
  // Focused academy views — lesson reader & certificate have their own
  // bottom controls and need the full viewport height.
  if (pathname.startsWith('/learn/')) return false
  if (pathname === '/certificate') return false
  if (AUTH_NAV_PATHS.includes(pathname)) return false
  if (pathname.startsWith('/admin')) return false
  // IQjet owns its full viewport — own header, own footer, own gate.
  // The app-shell nav would visually break the standalone-product
  // feel of the page.
  if (pathname === '/iqjet') return false
  return true
}

/** After drilling from Home → Sector Performance → sector → stock, back should reopen Sector Performance. */
export const STOCKIQ_HOME_BACK_TAB_KEY = 'stockiq_home_back_tab'
export const STOCKIQ_HOME_BACK_BASE_KEY = 'stockiq_home_back_base'

export function markHomeBackToSectorsTab(basePathname) {
  sessionStorage.setItem(STOCKIQ_HOME_BACK_TAB_KEY, 'sectors')
  sessionStorage.setItem(
    STOCKIQ_HOME_BACK_BASE_KEY,
    basePathname === '/screener' ? '/screener' : '/home',
  )
}

export function clearHomeBackToSectorsTab() {
  sessionStorage.removeItem(STOCKIQ_HOME_BACK_TAB_KEY)
  sessionStorage.removeItem(STOCKIQ_HOME_BACK_BASE_KEY)
}

/** If user came from sector-performance drill-down, go to Home/Screener with ?tab=sectors. Else false → use navigate(-1). */
export function consumeHomeNavigateFromStock(navigate) {
  const tab = sessionStorage.getItem(STOCKIQ_HOME_BACK_TAB_KEY)
  const base = sessionStorage.getItem(STOCKIQ_HOME_BACK_BASE_KEY) || '/'
  if (tab === 'sectors') {
    clearHomeBackToSectorsTab()
    navigate(`${base}?tab=sectors`)
    return true
  }
  return false
}
