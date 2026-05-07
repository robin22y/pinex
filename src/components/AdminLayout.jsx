import { NavLink, Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { C } from '../styles/tokens'

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/descriptions', label: 'Descriptions' },
  { to: '/admin/announcements', label: 'Announcements' },
  { to: '/admin/users', label: 'Users' },
]

export default function AdminLayout({ children }) {
  const { isAdmin, isSuperAdmin } = useAuth()

  if (!isAdmin && !isSuperAdmin) {
    return <Navigate to="/" replace />
  }

  const roleLabel = isSuperAdmin ? 'Super Admin' : 'Admin'

  return (
    <div className="min-h-screen" style={{ background: C.base }}>
      <div className="mx-auto grid max-w-7xl grid-cols-1 md:grid-cols-[240px_1fr]">
        <aside className="border-r p-4" style={{ borderColor: C.border, background: C.surface }}>
          <p className="mb-3 text-xs uppercase tracking-wider" style={{ color: C.textMuted }}>
            Admin Navigation
          </p>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) =>
                  `block rounded-lg border px-3 py-2 text-sm ${isActive ? '' : ''}`
                }
                style={({ isActive }) => ({
                  borderColor: C.border,
                  background: isActive ? C.surface2 : 'transparent',
                  color: isActive ? C.text : C.textMuted,
                })}
              >
                {item.label}
              </NavLink>
            ))}
            {isSuperAdmin ? (
              <NavLink
                to="/admin/stats"
                className={({ isActive }) => `block rounded-lg border px-3 py-2 text-sm ${isActive ? '' : ''}`}
                style={({ isActive }) => ({
                  borderColor: C.border,
                  background: isActive ? C.surface2 : 'transparent',
                  color: isActive ? C.text : C.textMuted,
                })}
              >
                Usage Stats
              </NavLink>
            ) : null}
          </nav>
        </aside>

        <main className="min-w-0">
          <header
            className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: C.border, background: C.surface }}
          >
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold" style={{ color: C.text }}>
                StockIQ Admin
              </h1>
              <span
                className="rounded-full border px-2 py-0.5 text-xs"
                style={{ borderColor: C.border, color: C.textMuted }}
              >
                {roleLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: C.border, color: C.text }}
            >
              Sign out
            </button>
          </header>
          <div className="p-4">{children}</div>
        </main>
      </div>
    </div>
  )
}
