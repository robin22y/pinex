// WHY: BottomNav (mobile) hard-codes its 5 buttons and does NOT
// iterate APP_NAV_TABS, so adding an entry here only surfaces in
// the DesktopSidebar. That's deliberate for experimental routes —
// we want them reachable but not in the primary mobile nav.
// `badge` (optional) renders a small chip next to the label in the
// sidebar (e.g. BETA for /breadth-lab).
// Nav grouping per the rework spec. `group` keys cluster items into
// labelled sections on the DesktopSidebar; mobile BottomNav reads
// the same list but only surfaces a fixed 5-tab subset (see
// BottomNav.jsx). Renames applied:
//   Home        → Today
//   Lab         → Screener
//   Explore     → Discover
//   Breadth Lab → Advanced  (BETA badge dropped — see comment below)
export const APP_NAV_TABS = [
  // Group 1 — no label (primary entry surfaces)
  { icon: 'ti-activity',    label: 'Pulse',     path: '/pulse',            group: 'primary' },
  { icon: 'ti-home',        label: 'Today',     path: '/home',             group: 'primary' },

  // Group 2 — DISCOVER
  { icon: 'ti-compass',     label: 'Discover',  path: '/explore',          group: 'discover' },
  { icon: 'ti-chart-pie',   label: 'Sectors',   path: '/home?tab=sectors', group: 'discover' },
  { icon: 'ti-layout-grid', label: 'Heatmap',   path: '/heatmap',          group: 'discover' },

  // Group 3 — RESEARCH
  // 'Lab' renamed to 'Screener' (Lab is now an internal page concept).
  // 'Breadth Lab' renamed to 'Advanced'; the BETA badge came off
  // per the spec — Breadth Lab is a Pro feature, not a beta surface,
  // and the BETA pill reduced trust.
  { icon: 'ti-flask',       label: 'Screener',  path: '/lab',              group: 'research' },
  { icon: 'ti-test-pipe',   label: 'Advanced',  path: '/breadth-lab',      group: 'research' },
  { icon: 'ti-bookmark',    label: 'Watchlist', path: '/dashboard',        group: 'research' },

  // Group 4 — LEARN & PROFILE
  { icon: 'ti-book',        label: 'Learn',     path: '/learn',            group: 'profile' },
  { icon: 'ti-user',        label: 'Profile',   path: '/profile',          group: 'profile' },
]

// Display labels per group key. The DesktopSidebar can read this
// to print the group header above each cluster; 'primary' is
// intentionally null (no header).
export const APP_NAV_GROUP_LABELS = {
  primary:   null,
  discover:  'Discover',
  research:  'Research',
  profile:   'Learn & Profile',
}

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
