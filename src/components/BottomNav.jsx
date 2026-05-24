import { useLocation, useNavigate } from 'react-router-dom'

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const tab = new URLSearchParams(location.search).get('tab')

  const isSectors = pathname === '/home' && tab === 'sectors'
  const isHome = pathname === '/home' && !isSectors
  const isLearn = pathname === '/learn'
  const isProfile = pathname === '/profile' || pathname === '/account'

  const btn = () => ({
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
  })

  const ic = (active) => ({
    fontSize: 21,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    lineHeight: 1,
  })

  const lbl = (active) => ({
    fontSize: 10,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    lineHeight: 1,
  })

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
        alignItems: 'center',
        height: 60,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Home */}
      <button type="button" onClick={() => navigate('/home?tab=search')} style={btn()}>
        <i className="ti ti-home" style={ic(isHome)} />
        <span style={lbl(isHome)}>Home</span>
      </button>

      {/* Sectors */}
      <button type="button" onClick={() => navigate('/home?tab=sectors')} style={btn()}>
        <i className="ti ti-chart-pie" style={ic(isSectors)} />
        <span style={lbl(isSectors)}>Sectors</span>
      </button>

      {/* Center Search */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => {
            if (pathname !== '/home') {
              navigate('/home?tab=search')
            } else {
              const input = document.querySelector('input[placeholder*="Search"]')
              if (input) {
                input.focus()
                input.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent)',
            borderRadius: '50%',
            width: 48,
            height: 48,
            border: 'none',
            cursor: 'pointer',
            marginTop: -12,
            boxShadow: '0 4px 16px rgba(0,200,5,0.35)',
            flexShrink: 0,
          }}
        >
          <i className="ti ti-search" style={{ fontSize: 20, color: '#000' }} />
        </button>
      </div>

      {/* Learn */}
      <button type="button" onClick={() => navigate('/learn')} style={btn()}>
        <i className="ti ti-book" style={ic(isLearn)} />
        <span style={lbl(isLearn)}>Learn</span>
      </button>

      {/* Profile */}
      <button type="button" onClick={() => navigate('/profile')} style={btn()}>
        <i className="ti ti-user" style={ic(isProfile)} />
        <span style={lbl(isProfile)}>Profile</span>
      </button>
    </nav>
  )
}
