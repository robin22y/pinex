import { useLocation, useNavigate } from 'react-router-dom'
import { APP_NAV_TABS, isAppNavActive } from '../lib/appNav'

const BORDER = '#1E2530'
const ACTIVE = '#00C805'
const INACTIVE = '#475569'

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-50 h-[60px] pb-safe md:hidden"
      style={{
        background: '#0F1217',
        borderTop: `1px solid ${BORDER}`,
      }}
    >
      {APP_NAV_TABS.map((tab) => {
        const active = isAppNavActive(location.pathname, tab.path)
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
