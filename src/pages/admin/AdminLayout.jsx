import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context'
import { signOut } from '../../lib/auth'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import PineXMark from '../../components/PineXMark'

import Icon from '../../components/ui/Icon'
const C = {
  bg: '#05070A',
  surface: '#0B0F18',
  surface2: '#111620',
  card: '#111620',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  faint: '#3D4F63',
  blue: '#38BDF8',
  blueBg: 'rgba(56,189,248,0.08)',
  blueBorder: 'rgba(56,189,248,0.18)',
  green: '#34D399',
  amber: 'var(--warning)',
  red: '#F87171',
}

// Grouped navigation. Each group renders under a small uppercase label
// inside the sidebar. The flat NAV is a fallback / iterator for routes
// that need to register hooks (e.g. PAGE_TITLES lookup). New pages live
// in the USERS / CONTENT / DATA groups; existing pages we preserved
// (Stocks, Result Calendar, Corp Actions, Telegram, Waitlist, Email,
// Academy) slot into the most natural group.
const NAV_GROUPS = [
  {
    label: 'OVERVIEW',
    items: [
      { to: '/admin',                   label: 'Dashboard',       icon: 'ti-layout-dashboard', end: true },
      { to: '/admin/stats',             label: 'Stats',           icon: 'ti-chart-dots' },
    ],
  },
  {
    label: 'USERS',
    items: [
      { to: '/admin/users',             label: 'All Users',       icon: 'ti-users' },
      { to: '/admin/points',            label: 'Points & Rewards', icon: 'ti-star' },
      { to: '/admin/engagement',        label: 'Engagement',      icon: 'ti-flame' },
      { to: '/admin/waitlist',          label: 'Waitlist',        icon: 'ti-list-check' },
    ],
  },
  {
    label: 'CONTENT',
    items: [
      { to: '/admin/descriptions',      label: 'Descriptions',    icon: 'ti-file-description' },
      { to: '/admin/announcements',     label: 'Announcements',   icon: 'ti-speakerphone' },
      { to: '/admin/questions',         label: 'Daily Questions', icon: 'ti-message-question' },
      { to: '/admin/academy',           label: 'Academy',         icon: 'ti-school' },
    ],
  },
  {
    label: 'DATA',
    items: [
      { to: '/admin/companies',         label: 'Companies',       icon: 'ti-building' },
      { to: '/admin/stocks',            label: 'Stocks',          icon: 'ti-chart-candle' },
      { to: '/admin/pipeline',          label: 'Pipeline Logs',   icon: 'ti-activity' },
      { to: '/admin/result-calendar',   label: 'Result Calendar', icon: 'ti-calendar-event' },
      { to: '/admin/corporate-actions', label: 'Corp. Actions',   icon: 'ti-briefcase' },
    ],
  },
  {
    label: 'COMMS',
    items: [
      { to: '/admin/telegram',          label: 'Telegram',        icon: 'ti-brand-telegram' },
      { to: '/admin/email',             label: 'Email Templates', icon: 'ti-mail' },
    ],
  },
]

const NAV = NAV_GROUPS.flatMap(g => g.items)

const PAGE_TITLES = {
  '/admin': 'Dashboard',
  '/admin/stocks': 'Stocks',
  '/admin/companies': 'Companies',
  '/admin/descriptions': 'Descriptions',
  '/admin/users': 'Users',
  '/admin/points': 'Points & Rewards',
  '/admin/engagement': 'Engagement',
  '/admin/questions': 'Daily Questions',
  '/admin/pipeline': 'Pipeline Logs',
  '/admin/announcements': 'Announcements',
  '/admin/academy': 'Academy',
  '/admin/result-calendar': 'Result Calendar',
  '/admin/corporate-actions': 'Corporate Actions',
  '/admin/telegram': 'Telegram',
  '/admin/stats': 'Stats',
  '/admin/waitlist': 'Waitlist',
  '/admin/email': 'Email Templates',
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

function SidebarContent({ onClose, displayName, avatarUrl, initials, resultCalendarPending }) {
  return (
    <>
      {/* Brand */}
      <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: C.blueBg, border: `1px solid ${C.blueBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.blue }}>p</span>
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.02em' }}><PineXMark /></p>
              <p style={{ fontSize: 10, color: C.muted, margin: 0, letterSpacing: '0.04em' }}>Admin Console</p>
            </div>
          </div>
          {/* Mobile close */}
          <button
            onClick={onClose}
            className="admin-mobile-close"
            style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4, display: 'none' }}
          >
            <Icon name="x" style={{ fontSize: 18 }} />
          </button>
        </div>
      </div>

      {/* Nav — grouped sections, each under a small uppercase label.
          Same visual styling as before for the individual links, just
          with group headers interleaved. */}
      <nav style={{ flex: 1, padding: '10px 10px 0', overflowY: 'auto', scrollbarWidth: 'none' }}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} style={{ marginTop: gi === 0 ? 0 : 12 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: C.faint,
              padding: '6px 8px', margin: '0 0 2px',
            }}>
              {group.label}
            </p>
            {group.items.map((item) => (
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
                    {item.to === '/admin/result-calendar' && resultCalendarPending > 0 && (
                      <span style={{ background: 'var(--negative)', color: 'white', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, minWidth: 16, textAlign: 'center', lineHeight: 1.4 }}>
                        {resultCalendarPending}
                      </span>
                    )}
                    {isActive && (
                      <span style={{ width: 3, height: 14, borderRadius: 2, background: C.blue, flexShrink: 0 }} />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}

        {/* Back to app */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <NavLink
            to="/"
            className="admin-nav-link"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, textDecoration: 'none', fontSize: 13, color: C.muted }}
          >
            <Icon name="arrow-left" style={{ fontSize: 15, width: 18, textAlign: 'center' }} />
            <span>Back to App</span>
          </NavLink>
        </div>
      </nav>

      {/* User block */}
      <div style={{ padding: '10px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, marginBottom: 4 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: C.surface2, border: '1px solid var(--border)',
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
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted, fontSize: 12, transition: 'background 0.12s, color 0.12s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.text }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted }}
        >
          <Icon name="logout" style={{ fontSize: 14, width: 18, textAlign: 'center' }} />
          Sign out
        </button>
      </div>
    </>
  )
}

export default function AdminLayout() {
  const location = useLocation()
  const { user, profile } = useAuth()
  const [resultCalendarPending, setResultCalendarPending] = useState(0)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true
    ;(async () => {
      try {
        const today = new Date().toISOString().split('T')[0]
        const { data, error } = await supabase
          .from('result_calendar')
          .select('id')
          .eq('result_date', today)
          .eq('indianapi_fetched', false)
          .limit(500)
        if (!active || error) return
        setResultCalendarPending(data?.length || 0)
      } catch {
        if (active) setResultCalendarPending(0)
      }
    })()
    return () => { active = false }
  }, [location.pathname])

  useEffect(() => { setMobileNavOpen(false) }, [location.pathname])

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

  const sidebarProps = { onClose: () => setMobileNavOpen(false), displayName, avatarUrl, initials, resultCalendarPending }

  return (
    <>
      <Helmet>
        <title>{pageTitle} — PineX Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
    <div data-admin-panel style={{ display: 'flex', minHeight: '100vh', background: C.bg, color: C.text }}>

      {/* ── Mobile overlay backdrop ── */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
          }}
        />
      )}

      {/* ── Sidebar (desktop: sticky) ── */}
      <aside
        className="admin-sidebar"
        style={{
          width: 220, minWidth: 220, flexShrink: 0,
          background: C.surface, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          position: 'sticky', top: 0, height: '100vh',
          overflowY: 'auto', scrollbarWidth: 'none',
        }}
      >
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* ── Mobile slide-in nav ── */}
      <aside
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
          width: 240, background: C.surface, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          transform: mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
        }}
        className="admin-mobile-nav"
      >
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* ── Main ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Top header */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 52, borderBottom: '1px solid var(--border)',
          background: C.surface, flexShrink: 0, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Hamburger — mobile only */}
            <button
              className="admin-hamburger"
              onClick={() => setMobileNavOpen(o => !o)}
              style={{
                background: 'none', border: 'none', color: C.muted,
                cursor: 'pointer', padding: 4, display: 'none',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Icon name="menu-2" style={{ fontSize: 20 }} />
            </button>
            <span style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Admin</span>
            <span style={{ fontSize: 10, color: C.faint }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{pageTitle}</span>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
            background: 'rgba(251,191,36,0.1)', color: C.amber,
            border: '1px solid rgba(251,191,36,0.2)', letterSpacing: '0.06em', textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            Internal
          </span>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', overflowX: 'hidden' }}>
          <Outlet />
        </main>
      </div>

      {/* Mobile responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .admin-sidebar { display: none !important; }
          .admin-hamburger { display: flex !important; }
          .admin-mobile-close { display: flex !important; }
          .admin-mobile-nav .admin-mobile-close { display: flex !important; }
        }
      `}</style>
    </div>
    </>
  )
}
