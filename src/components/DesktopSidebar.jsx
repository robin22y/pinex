import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { APP_NAV_TABS, isAppNavActive } from '../lib/appNav'

const C = {
  bg: '#05070A',
  surface: '#0B0F18',
  surface2: '#111620',
  border: '#1E2530',
  text: '#E2E8F0',
  muted: '#64748B',
  faint: '#3D4F63',
  blue: '#38BDF8',
  blueBg: 'rgba(56,189,248,0.08)',
  blueBorder: 'rgba(56,189,248,0.2)',
}

function getInitials(name, email) {
  const n = name?.trim()
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    return parts[0]?.slice(0, 2).toUpperCase() || '?'
  }
  return (email?.split('@')[0] ?? '?').slice(0, 2).toUpperCase()
}

export default function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile, isAdmin } = useAuth()

  const displayName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.user_metadata?.name?.trim() ||
    user?.email?.split('@')[0] ||
    'User'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
  const initials = getInitials(displayName, user?.email)

  return (
    <aside
      className="desktop-sidebar"
      style={{
        width: 220,
        minWidth: 220,
        flexShrink: 0,
        flexDirection: 'column',
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
      }}
    >
      {/* Brand */}
      <div style={{ padding: '20px 16px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: C.blueBg, border: `1px solid ${C.blueBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.blue, letterSpacing: '-0.02em' }}>P</span>
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.02em' }}>PineX</p>
            <p style={{ fontSize: 10, color: C.muted, margin: 0, letterSpacing: '0.05em' }}>Market Intelligence</p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '10px 10px 0' }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.faint, padding: '6px 8px', marginBottom: 2 }}>
          Navigate
        </p>
        {APP_NAV_TABS.map((tab) => {
          const active = isAppNavActive(location.pathname, tab.path)
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              title={tab.label}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '9px 10px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                marginBottom: 2,
                background: active ? C.blueBg : 'transparent',
                color: active ? C.blue : C.muted,
                transition: 'background 0.15s, color 0.15s',
                textAlign: 'left',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.background = C.surface2
                  e.currentTarget.style.color = C.text
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = C.muted
                }
              }}
            >
              <i
                className={`ti ${tab.icon}`}
                style={{ fontSize: 17, flexShrink: 0, width: 20, textAlign: 'center' }}
              />
              <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{tab.label}</span>
              {active && (
                <span style={{
                  marginLeft: 'auto', width: 4, height: 16, borderRadius: 2,
                  background: C.blue, flexShrink: 0,
                }} />
              )}
            </button>
          )
        })}

        {/* Admin link */}
        {isAdmin && (() => {
          const active = location.pathname.startsWith('/admin')
          return (
            <>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.faint, padding: '14px 8px 4px', marginBottom: 2 }}>
                Admin
              </p>
              <button
                type="button"
                onClick={() => navigate('/admin')}
                title="Admin"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 11,
                  padding: '9px 10px', borderRadius: 8, border: 'none',
                  cursor: 'pointer', marginBottom: 2,
                  background: active ? C.blueBg : 'transparent',
                  color: active ? C.blue : C.muted,
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  if (!active) { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.text }
                }}
                onMouseLeave={e => {
                  if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted }
                }}
              >
                <i className="ti ti-settings" style={{ fontSize: 17, flexShrink: 0, width: 20, textAlign: 'center' }} />
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>Settings</span>
                {active && <span style={{ marginLeft: 'auto', width: 4, height: 16, borderRadius: 2, background: C.blue, flexShrink: 0 }} />}
              </button>
            </>
          )
        })()}
      </nav>

      {/* User block */}
      {user && (
        <div style={{ padding: '10px', borderTop: `1px solid ${C.border}`, marginTop: 'auto' }}>
          <button
            type="button"
            onClick={() => navigate('/account')}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer',
              textAlign: 'left', transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.surface2 }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {/* Avatar */}
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: C.surface2, border: `1px solid ${C.border}`,
              overflow: 'hidden', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.text,
            }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                : initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </p>
              <p style={{ fontSize: 10, color: C.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => signOut()}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 11,
              padding: '8px 10px', borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: C.muted, transition: 'background 0.15s, color 0.15s',
              marginTop: 2,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.text }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted }}
          >
            <i className="ti ti-logout" style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' }} />
            <span style={{ fontSize: 12 }}>Sign out</span>
          </button>
        </div>
      )}

      {/* Not logged in */}
      {!user && (
        <div style={{ padding: '10px', borderTop: `1px solid ${C.border}`, marginTop: 'auto' }}>
          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.blueBg, color: C.blue, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </div>
      )}
    </aside>
  )
}
