import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { APP_NAV_TABS, isAppNavActive } from '../lib/appNav'
import ThemeToggle from './ThemeToggle'
import PineXMark from './PineXMark'

import Icon from './ui/Icon'
const C = {
  bg: 'var(--bg-primary)',
  surface: 'var(--bg-surface)',
  surface2: 'var(--bg-elevated)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  faint: 'var(--text-hint)',
  blue: 'var(--info)',
  blueBg: 'var(--info-dim)',
  blueBorder: 'var(--accent-border)',
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
        flexShrink: 0,
        flexDirection: 'column',
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 50,
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
            background: '#F4ECD8', border: '1px solid #D4C5A8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#1E1E1E', letterSpacing: '-0.02em' }}>p</span>
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.02em' }}><PineXMark /></p>
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
          const active = isAppNavActive(location.pathname, tab.path, location.search)
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
              {tab.badge && (
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: `${tab.badgeColor || '#FBBF24'}26`, // 15% alpha
                  color: tab.badgeColor || '#FBBF24',
                  marginLeft: 6,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}>
                  {tab.badge}
                </span>
              )}
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
                <Icon name="settings" style={{ fontSize: 17, flexShrink: 0, width: 20, textAlign: 'center' }} />
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>Settings</span>
                {active && <span style={{ marginLeft: 'auto', width: 4, height: 16, borderRadius: 2, background: C.blue, flexShrink: 0 }} />}
              </button>
            </>
          )
        })()}
      </nav>

      {/* Invite friends — pinned above the user block so it is
          discoverable from every page in the app, not just buried
          on Dashboard. Links to the invite-section anchor; the
          Dashboard page handles the smooth-scroll. */}
      {user && (
        <div style={{ padding: '6px 10px 0' }}>
          <button
            type="button"
            onClick={() => navigate('/dashboard#invite-section')}
            title="Invite friends"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 11,
              padding: '9px 10px', borderRadius: 8, border: `1px solid ${C.blueBorder}`,
              background: C.blueBg, color: C.blue,
              cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
              textAlign: 'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dim)' }}
            onMouseLeave={e => { e.currentTarget.style.background = C.blueBg }}
          >
            <Icon name="user-plus" style={{ fontSize: 17, flexShrink: 0, width: 20, textAlign: 'center' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Invite friends</span>
          </button>
        </div>
      )}

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
            <Icon name="logout" style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' }} />
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

      <div style={{ padding: '8px 16px 4px', borderTop: `1px solid ${C.border}` }}>
        <ThemeToggle />
      </div>

      <div style={{ padding: '8px 16px 14px', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {[['About', '/about'], ['Methodology', '/methodology'], ['Terms', '/terms'], ['Privacy', '/privacy']].map(([label, path]) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            style={{ background: 'none', border: 'none', color: C.faint, fontSize: 11, cursor: 'pointer', padding: 0, letterSpacing: '0.03em' }}
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  )
}
