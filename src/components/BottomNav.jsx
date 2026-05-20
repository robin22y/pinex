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
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
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
              padding: '4px 0',
            }}
          >
            <i
              className={`ti ${tab.icon}`}
              style={{
                fontSize: 21,
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                lineHeight: 1,
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--text-muted)',
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
