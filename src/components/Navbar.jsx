import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signInWithGoogle, signOut } from '../lib/auth'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

function initials(name, email) {
  const source = String(name || email || '').trim()
  if (!source) return 'U'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || 'U'
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function Tab({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      className="flex flex-col items-center justify-center gap-0.5 text-[11px]"
      style={({ isActive }) => ({ color: isActive ? C.blue : C.textMuted })}
    >
      <span className="text-base">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

export default function Navbar() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const loggedIn = Boolean(user)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  const displayName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.user_metadata?.name?.trim() ||
    user?.email ||
    'User'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null

  useEffect(() => {
    if (!hasSupabaseEnv) return
    const q = query.trim()
    const t = window.setTimeout(async () => {
      if (!q) {
        setResults([])
        return
      }
      try {
        const { data } = await supabase
          .from('companies')
          .select('name,symbol,sector')
          .or(`name.ilike.%${q}%,symbol.ilike.%${q}%`)
          .limit(10)
        setResults(data || [])
      } catch {
        setResults([])
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [query])

  const resultList = useMemo(() => (
    <div className="mt-2 space-y-1">
      {results.map((r) => (
        <button
          key={`${r.symbol}-${r.name}`}
          type="button"
          onClick={() => {
            setQuery('')
            setMobileSearchOpen(false)
            navigate(`/stock/${r.symbol}`)
          }}
          className="w-full rounded-md border px-2 py-2 text-left"
          style={{ borderColor: C.border, background: C.surface2 }}
        >
          <p className="text-sm" style={{ color: C.text }}>
            {r.name} ({r.symbol})
          </p>
          <p className="text-xs" style={{ color: C.textMuted }}>
            {r.sector || 'Unknown sector'}
          </p>
        </button>
      ))}
      {!results.length && query.trim() ? (
        <p className="px-2 py-1 text-xs" style={{ color: C.textMuted }}>
          No results found.
        </p>
      ) : null}
    </div>
  ), [results, query, navigate])

  return (
    <>
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: C.border, background: C.surface }}>
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:px-6">
          <Link to="/" className="text-xl font-bold" style={{ color: C.blue }}>
            PineX
          </Link>

          <div className="hidden flex-1 md:block">
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stocks..."
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ borderColor: C.border, background: C.surface2, color: C.text }}
              />
              {query.trim() ? (
                <div className="absolute left-0 right-0 top-full rounded-lg border p-2" style={{ borderColor: C.border, background: C.surface }}>
                  {resultList}
                </div>
              ) : null}
            </div>
          </div>

          <div className="ml-auto hidden items-center gap-2 md:flex">
            {!loggedIn ? (
              <>
                <Link to="/login" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
                  Sign in
                </Link>
                <button type="button" onClick={signInWithGoogle} className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: C.border, color: C.blue, background: C.blueBg }}>
                  Get started
                </button>
              </>
            ) : (
              <>
                <button type="button" className="rounded-full border p-2 text-sm" style={{ borderColor: C.border, color: C.textMuted }} aria-label="Notifications">
                  🔔
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAvatarOpen((v) => !v)}
                    className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border text-xs"
                    style={{ borderColor: C.border, background: C.surface2, color: C.text }}
                  >
                    {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(displayName, user?.email)}
                  </button>
                  {avatarOpen ? (
                    <div className="absolute right-0 mt-2 w-44 rounded-lg border p-1" style={{ borderColor: C.border, background: C.surface }}>
                      <button type="button" onClick={() => { setAvatarOpen(false); navigate('/account') }} className="block w-full rounded px-2 py-2 text-left text-sm" style={{ color: C.text }}>
                        Account
                      </button>
                      <button type="button" onClick={() => { setAvatarOpen(false); signOut() }} className="block w-full rounded px-2 py-2 text-left text-sm" style={{ color: C.textMuted }}>
                        Sign out
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMobileSearchOpen(true)}
              className="rounded-full border p-2 text-sm"
              style={{ borderColor: C.border, color: C.textMuted }}
              aria-label="Search"
            >
              🔍
            </button>
            {loggedIn ? (
              <button
                type="button"
                onClick={() => navigate('/account')}
                className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border text-xs"
                style={{ borderColor: C.border, background: C.surface2, color: C.text }}
              >
                {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(displayName, user?.email)}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {mobileSearchOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" style={{ background: C.base }}>
          <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: C.border }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stocks..."
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: C.border, background: C.surface2, color: C.text }}
            />
            <button
              type="button"
              onClick={() => setMobileSearchOpen(false)}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: C.border, color: C.textMuted }}
            >
              Close
            </button>
          </div>
          <div className="p-3">{resultList}</div>
        </div>
      ) : null}

      {loggedIn ? (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 grid h-14 grid-cols-4 border-t pb-[max(env(safe-area-inset-bottom),0px)] md:hidden"
          style={{ borderColor: C.border, background: C.surface }}
        >
          <Tab to="/" icon="🏠" label="Home" />
          <Tab to="/sector/All" icon="🏭" label="Sectors" />
          <Tab to="/portfolio" icon="💼" label="Portfolio" />
          <Tab to="/account" icon="👤" label="Account" />
        </nav>
      ) : null}
    </>
  )
}
