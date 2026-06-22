import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { APP_NAV_TABS, isAppNavActive, isAppNavVisible } from '../lib/appNav'
import ThemeToggle from './ThemeToggle'
import PineXMark from './PineXMark'
import ProAccessProgress from './points/ProAccessProgress'

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

  // Points balance read + chip rendering moved into the shared
  // ProAccessProgress component (src/components/points/
  // ProAccessProgress.jsx). The component self-fetches, subscribes
  // to pinex:points-awarded for live updates, and hides itself for
  // signed-out / Pro users. See the rendered <ProAccessProgress
  // variant="sidebar" /> in the footer cluster below.

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

      {/* ── Nav items — three-tier hierarchy ─────────────────────
          PRIMARY    — daily entry points (15 px, prominent)
          SECONDARY  — analytical surfaces (13 px, quieter)
          UTILITY    — reference / settings (12 px, muted)

          Labels are pulled from APP_NAV_TABS so paths and active
          predicates stay in one place; the three arrays below are
          ordered presentation only and live in this file because
          the tiering is a visual-design call, not a data shape. */}
      <nav style={{ flex: 1, padding: '24px 0 0' }}>
        {(() => {
          const tabByLabel = Object.fromEntries(
            APP_NAV_TABS.map((t) => [t.label, t]),
          )
          // Items with requiresUnlock get filtered out for users who
          // haven't earned the surface yet (Advanced gates on
          // profiles.advanced_unlocked + role). Admins/superadmins
          // see everything per isAppNavVisible's branch.
          const visible = (l) => {
            const item = tabByLabel[l]
            return item && isAppNavVisible(item, profile) ? item : null
          }
          const PRIMARY   = ['Today', 'Structure', 'Sectors']
            .map(visible).filter(Boolean)
          const SECONDARY = ['Screener', 'Advanced', 'Watchlist', 'Heatmap']
            .map(visible).filter(Boolean)
          const UTILITY   = ['Learn', 'Profile', 'Pulse']
            .map(visible).filter(Boolean)

          const isActive = (tab) =>
            isAppNavActive(location.pathname, tab.path, location.search)

          // ── PRIMARY — 15 px / 500 inactive, 600 active with bg
          //            + amber 2 px left border.
          const PrimaryItem = (tab) => {
            const active = isActive(tab)
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => navigate(tab.path)}
                title={tab.label}
                style={{
                  width: '100%',
                  display: 'block',
                  textAlign: 'left',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '10px 16px',
                  fontSize: 15,
                  fontWeight: active ? 600 : 500,
                  color: active ? '#E2E8F0' : '#CBD5E1',
                  background: active ? '#141820' : 'transparent',
                  // Left amber rule — only active primary items
                  // get it. Sized to match the 2 px stroke spec.
                  borderLeft: `2px solid ${active ? '#FBBF24' : 'transparent'}`,
                  marginBottom: 2,
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = '#E2E8F0'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = '#CBD5E1'
                }}
              >
                {tab.label}
              </button>
            )
          }

          // ── SECONDARY — 13 px, no background even when active;
          //                weight + color shift carries the state.
          const SecondaryItem = (tab) => {
            const active = isActive(tab)
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => navigate(tab.path)}
                title={tab.label}
                style={{
                  width: '100%',
                  display: 'block',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  color: active ? '#CBD5E1' : '#64748B',
                  marginBottom: 1,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = '#CBD5E1'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = '#64748B'
                }}
              >
                {tab.label}
              </button>
            )
          }

          // ── UTILITY — 12 px, deepest muted; small weight bump
          //              on hover/active so the row is still tappable.
          const UtilityItem = (tab) => {
            const active = isActive(tab)
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => navigate(tab.path)}
                title={tab.label}
                style={{
                  width: '100%',
                  display: 'block',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '6px 16px',
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  color: active ? '#64748B' : '#475569',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = '#64748B'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = '#475569'
                }}
              >
                {tab.label}
              </button>
            )
          }

          // ── Hairline divider used between tiers.
          const Divider = () => (
            <div style={{ height: 1, background: '#1E2530', margin: '8px 16px' }} />
          )

          return (
            <>
              {PRIMARY.map(PrimaryItem)}
              <Divider />
              {SECONDARY.map(SecondaryItem)}
              <Divider />
              {UTILITY.map(UtilityItem)}
              {isAdmin && (() => {
                const active = location.pathname.startsWith('/admin')
                return (
                  <>
                    <Divider />
                    {/* Admin lives in the utility tier — same
                        typographic weight as Learn/Profile/Pulse.
                        Keeping it ungrouped with a separator above
                        keeps the regular nav tiers tidy. */}
                    <button
                      type="button"
                      onClick={() => navigate('/admin')}
                      title="Admin"
                      style={{
                        width: '100%',
                        display: 'block',
                        textAlign: 'left',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '6px 16px',
                        fontSize: 12,
                        fontWeight: active ? 500 : 400,
                        color: active ? '#64748B' : '#475569',
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.color = '#64748B'
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.color = '#475569'
                      }}
                    >
                      Settings
                    </button>
                  </>
                )
              })()}
            </>
          )
        })()}
      </nav>

      {/* Pro-access progress bar — replaces the old "⭐ N pts" chip.
          Self-gating: signed-out, Pro plan, and still-loading states
          all render nothing. Taps to /rewards. The wrapper provides
          the same padding the chip used so the surrounding footer
          cluster looks identical. */}
      {user && (
        <div style={{ padding: '10px 10px 0' }}>
          <ProAccessProgress variant="sidebar" />
        </div>
      )}

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
