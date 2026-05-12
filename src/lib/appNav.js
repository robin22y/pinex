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
