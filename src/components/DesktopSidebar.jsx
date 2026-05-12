import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { APP_NAV_TABS, isAppNavActive } from '../lib/appNav'

const BORDER = '#1E2530'
const SURFACE = '#0F1217'
const ACTIVE = '#E2E8F0'
const INACTIVE = '#64748B'
const ACTIVE_BG = '#1E2530'
const GREEN = '#00C805'

export default function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  return (
    <aside
      className="desktop-sidebar sticky top-0 flex min-h-screen w-[52px] shrink-0 flex-col items-center border-r py-3"
      style={{
        background: SURFACE,
        borderColor: BORDER,
      }}
    >
      <div
        className="mb-2 flex items-center justify-center"
        title="PineX"
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 6,
            background: 'rgba(0,200,5,.15)',
            color: GREEN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          P
        </div>
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1">
        {APP_NAV_TABS.map((tab) => {
          const active = isAppNavActive(location.pathname, tab.path)
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              title={tab.label}
              aria-label={tab.label}
              className="flex items-center justify-center rounded-md"
              style={{
                width: 36,
                height: 36,
                border: 'none',
                cursor: 'pointer',
                background: active ? ACTIVE_BG : 'transparent',
                color: active ? ACTIVE : INACTIVE,
              }}
            >
              <i className={`ti ${tab.icon}`} style={{ fontSize: 18 }} />
            </button>
          )
        })}
      </nav>

      {isAdmin ? (
        <button
          type="button"
          onClick={() => navigate('/admin')}
          title="Admin"
          aria-label="Admin"
          className="flex items-center justify-center rounded-md"
          style={{
            width: 36,
            height: 36,
            border: 'none',
            cursor: 'pointer',
            background: location.pathname.startsWith('/admin') ? ACTIVE_BG : 'transparent',
            color: location.pathname.startsWith('/admin') ? ACTIVE : INACTIVE,
          }}
        >
          <i className="ti ti-settings" style={{ fontSize: 18 }} />
        </button>
      ) : null}
    </aside>
  )
}
