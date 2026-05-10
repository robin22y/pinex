import { NavLink, Outlet } from 'react-router-dom'
import { signOut } from '../../lib/auth'

const BG = '#080C14'
const SIDEBAR = '#0D1525'
const SIDEBAR_BORDER = '#1E293B'
const MUTED = '#94a3b8'
const TEXT = '#e2e8f0'

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/stocks', label: 'Stocks' },
  { to: '/admin/descriptions', label: 'Descriptions' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/corporate-actions', label: 'Corporate Actions' },
]

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen" style={{ background: BG, color: TEXT }}>
      <aside
        className="flex shrink-0 flex-col border-r"
        style={{
          width: 200,
          background: SIDEBAR,
          borderColor: SIDEBAR_BORDER,
        }}
      >
        <div className="border-b px-3 py-4" style={{ borderColor: SIDEBAR_BORDER }}>
          <p className="text-sm font-bold tracking-tight">PineX Admin</p>
          <p className="text-[10px]" style={{ color: MUTED }}>
            Internal
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm no-underline transition-colors ${
                  isActive ? 'font-semibold' : ''
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'rgba(148,163,184,0.12)' : 'transparent',
                color: isActive ? TEXT : MUTED,
              })}
            >
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/"
            className="mt-auto rounded-md px-3 py-2 text-sm font-medium no-underline"
            style={{ color: '#38bdf8' }}
          >
            ← Back to App
          </NavLink>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: SIDEBAR_BORDER, background: BG }}
        >
          <span className="text-xs" style={{ color: MUTED }}>
            Admin console
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            className="rounded-md border px-3 py-1.5 text-xs"
            style={{ borderColor: SIDEBAR_BORDER, color: TEXT }}
          >
            Sign out
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
