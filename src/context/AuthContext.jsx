import { useEffect, useMemo, useRef, useState } from 'react'
import { CONFIG } from '../config'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

async function fetchProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  return data ?? null
}

async function insertProfile(existingUser) {
  const email = (existingUser.email ?? '').trim()
  const fullName =
    existingUser.user_metadata?.full_name ??
    existingUser.user_metadata?.name ??
    ''

  const superEmail = CONFIG.admin.superAdminEmail
  const role =
    superEmail && email && email === superEmail
      ? 'superadmin'
      : 'user'

  const payload = {
    id: existingUser.id,
    email,
    full_name: fullName,
    plan: 'free',
    role,
  }

  const { error } = await supabase.from('profiles').insert(payload)

  if (error) return fetchProfile(existingUser.id)
  return fetchProfile(existingUser.id)
}

async function resolveProfile(existingUser) {
  const profileRow = await fetchProfile(existingUser.id)
  if (profileRow) return profileRow

  return insertProfile(existingUser)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(hasSupabaseEnv)
  const hydrateGenerationRef = useRef(0)

  useEffect(() => {
    if (!hasSupabaseEnv) {
      return
    }

    let mounted = true

    async function hydrate(session) {
      const generation = ++hydrateGenerationRef.current

      if (!session?.user) {
        if (!mounted || generation !== hydrateGenerationRef.current) return
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      if (!mounted) return

      setLoading(true)
      setUser(session.user)

      const profileRow = await resolveProfile(session.user)

      if (!mounted || generation !== hydrateGenerationRef.current) return

      setProfile(profileRow)
      setLoading(false)
    }

    // 8-second safety net — if getSession hangs (Supabase unreachable),
    // unblock the app rather than showing a permanent loading screen.
    const loadingTimeout = setTimeout(() => {
      if (mounted) {
        setUser(null)
        setProfile(null)
        setLoading(false)
      }
    }, 8000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(loadingTimeout)
      if (!mounted) return

      if (session?.expires_at) {
        const expiresAt = session.expires_at * 1000
        const fiveMinutes = 5 * 60 * 1000
        if (expiresAt - Date.now() < fiveMinutes) {
          const { data: refreshed } = await supabase.auth.refreshSession()
          if (mounted) hydrate(refreshed.session)
          return
        }
      }

      hydrate(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return
        // INITIAL_SESSION is already handled by getSession() above
        if (event === 'INITIAL_SESSION') return
        hydrate(session)
      },
    )

    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return
      const { data: { session } } = await supabase.auth.getSession()
      if (mounted) hydrate(session)
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mounted = false
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const value = useMemo(
    () => ({ user, profile, loading }),
    [user, profile, loading],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}
