import { useLocation, useNavigate } from 'react-router-dom'
import { APP_NAV_TABS, isAppNavActive } from '../lib/appNav'

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

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
        background: 'rgba(11,15,24,0.97)',
        borderTop: '1px solid #1E2A3A',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
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
              gap: 3,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '6px 0',
              position: 'relative',
              transition: 'opacity 0.15s',
            }}
          >
            {active && (
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 28,
                  height: 2,
                  borderRadius: '0 0 2px 2px',
                  background: '#3B82F6',
                }}
              />
            )}
            <i
              className={`ti ${tab.icon}`}
              style={{
                fontSize: 21,
                color: active ? '#3B82F6' : '#4B5A6E',
                lineHeight: 1,
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                letterSpacing: '0.02em',
                color: active ? '#3B82F6' : '#4B5A6E',
                lineHeight: 1,
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
