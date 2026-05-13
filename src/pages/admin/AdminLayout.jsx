import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context'
import { signOut } from '../../lib/auth'

const C = {
  bg: '#05070A',
  surface: '#0B0F18',
  surface2: '#111620',
  card: '#111620',
  border: '#1E2530',
  text: '#E2E8F0',
  muted: '#64748B',
  faint: '#3D4F63',
  blue: '#38BDF8',
  blueBg: 'rgba(56,189,248,0.08)',
  blueBorder: 'rgba(56,189,248,0.18)',
  green: '#34D399',
  amber: '#FBBF24',
  red: '#F87171',
}

const NAV = [
  { to: '/admin',                 label: 'Dashboard',        icon: 'ti-layout-dashboard', end: true },
  { to: '/admin/stocks',          label: 'Stocks',           icon: 'ti-chart-candle' },
  { to: '/admin/companies',       label: 'Companies',        icon: 'ti-building' },
  { to: '/admin/descriptions',    label: 'Descriptions',     icon: 'ti-file-description' },
  { to: '/admin/users',           label: 'Users',            icon: 'ti-users' },
  { to: '/admin/announcements',   label: 'Announcements',    icon: 'ti-speakerphone' },
  { to: '/admin/corporate-actions', label: 'Corp. Actions',  icon: 'ti-briefcase' },
  { to: '/admin/stats',           label: 'Stats',            icon: 'ti-chart-dots' },
]

const PAGE_TITLES = {
  '/admin': 'Dashboard',
  '/admin/stocks': 'Stocks',
  '/admin/companies': 'Companies',
  '/admin/descriptions': 'Descriptions',
  '/admin/users': 'Users',
  '/admin/announcements': 'Announcements',
  '/admin/corporate-actions': 'Corporate Actions',
  '/admin/stats': 'Stats',
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

export default function AdminLayout() {
  const location = useLocation()
  const { user, profile } = useAuth()

  const displayName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.user_metadata?.name?.trim() ||
    user?.email?.split('@')[0] || 'Admin'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
  const initials = getInitials(displayName, user?.email)

  const pageTitle = Object.entries(PAGE_TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => location.pathname === path || location.pathname.startsWith(path + '/'))?.[1] || 'Admin'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, color: C.text }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 220, minWidth: 220, flexShrink: 0,
        background: C.surface, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh',
        overflowY: 'auto', scrollbarWidth: 'none',
      }}>

        {/* Brand */}
        <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: C.blueBg, border: `1px solid ${C.blueBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.blue }}>P</span>
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.02em' }}>PineX</p>
              <p style={{ fontSize: 10, color: C.muted, margin: 0, letterSpacing: '0.04em' }}>Admin Console</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 10px 0' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: C.faint, padding: '6px 8px', margin: '0 0 2px' }}>
            Manage
          </p>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="admin-nav-link"
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8, marginBottom: 2,
                textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
                background: isActive ? C.blueBg : 'transparent',
                color: isActive ? C.blue : C.muted,
                transition: 'background 0.12s, color 0.12s',
              })}
            >
              {({ isActive }) => (
                <>
                  <i className={`ti ${item.icon}`} style={{ fontSize: 16, flexShrink: 0, width: 18, textAlign: 'center' }} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {isActive && (
                    <span style={{ width: 3, height: 14, borderRadius: 2, background: C.blue, flexShrink: 0 }} />
                  )}
                </>
              )}
            </NavLink>
          ))}

          {/* Back to app */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <NavLink
              to="/"
              className="admin-nav-link"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                textDecoration: 'none', fontSize: 13, color: C.muted,
              }}
            >
              <i className="ti ti-arrow-left" style={{ fontSize: 15, width: 18, textAlign: 'center' }} />
              <span>Back to App</span>
            </NavLink>
          </div>
        </nav>

        {/* User block */}
        <div style={{ padding: '10px', borderTop: `1px solid ${C.border}` }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '8px 10px', borderRadius: 8, marginBottom: 4,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: C.surface2, border: `1px solid ${C.border}`,
              overflow: 'hidden', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 10, fontWeight: 700, color: C.text,
            }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                : initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </p>
              <p style={{ fontSize: 9, color: C.amber, margin: 0, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Admin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 9,
              padding: '7px 10px', borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: C.muted, fontSize: 12, transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.text }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted }}
          >
            <i className="ti ti-logout" style={{ fontSize: 14, width: 18, textAlign: 'center' }} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Top header */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', height: 52, borderBottom: `1px solid ${C.border}`,
          background: C.surface, flexShrink: 0, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Admin</span>
            <span style={{ fontSize: 10, color: C.faint }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{pageTitle}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              background: 'rgba(251,191,36,0.1)', color: C.amber,
              border: '1px solid rgba(251,191,36,0.2)', letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              Internal
            </span>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px', overflowX: 'hidden' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
