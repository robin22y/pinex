import { useLocation, useNavigate } from 'react-router-dom'

const BORDER = '#1E2530'
const ACTIVE = '#00C805'
const INACTIVE = '#475569'

const tabs = [
  { icon: 'ti-home', label: 'Home', path: '/' },
  { icon: 'ti-chart-bar', label: 'Screener', path: '/screener' },
  { icon: 'ti-bookmark', label: 'Watchlist', path: '/dashboard' },
  { icon: 'ti-user', label: 'Profile', path: '/profile' },
]

function isTabActive(pathname, path) {
  if (path === '/') return pathname === '/' || pathname === '/screener'
  if (path === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  if (path === '/profile') return pathname === '/profile' || pathname === '/account'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden"
      style={{
        height: 60,
        background: '#0F1217',
        borderTop: `1px solid ${BORDER}`,
        paddingBottom: 'max(env(safe-area-inset-bottom), 0px)',
      }}
    >
      {tabs.map((tab) => {
        const active = isTabActive(location.pathname, tab.path)
        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => navigate(tab.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              minHeight: 44,
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              color: active ? ACTIVE : INACTIVE,
            }}
          >
            <i className={`ti ${tab.icon}`} style={{ fontSize: 20 }} />
            <span style={{ fontSize: 9 }}>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
