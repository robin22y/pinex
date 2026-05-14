export const APP_NAV_TABS = [
  { icon: 'ti-home', label: 'Home', path: '/' },
  { icon: 'ti-layout-grid', label: 'Map', path: '/heatmap' },
  { icon: 'ti-chart-bar', label: 'Screener', path: '/screener' },
  { icon: 'ti-bookmark', label: 'Watchlist', path: '/dashboard' },
  { icon: 'ti-user', label: 'Profile', path: '/profile' },
]

export function isAppNavActive(pathname, path) {
  if (path === '/') return pathname === '/'
  if (path === '/screener') return pathname === '/screener'
  if (path === '/heatmap') return pathname === '/heatmap'
  if (path === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  if (path === '/profile') return pathname === '/profile' || pathname === '/account'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export const AUTH_NAV_PATHS = ['/login', '/register', '/forgot-password', '/reset-password']

export function shouldShowAppShellNav(pathname) {
  if (AUTH_NAV_PATHS.includes(pathname)) return false
  if (pathname.startsWith('/admin')) return false
  return true
}

/** After drilling from Home → Sector Performance → sector → stock, back should reopen Sector Performance. */
export const STOCKIQ_HOME_BACK_TAB_KEY = 'stockiq_home_back_tab'
export const STOCKIQ_HOME_BACK_BASE_KEY = 'stockiq_home_back_base'

export function markHomeBackToSectorsTab(basePathname) {
  sessionStorage.setItem(STOCKIQ_HOME_BACK_TAB_KEY, 'sectors')
  sessionStorage.setItem(
    STOCKIQ_HOME_BACK_BASE_KEY,
    basePathname === '/screener' ? '/screener' : '/',
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
