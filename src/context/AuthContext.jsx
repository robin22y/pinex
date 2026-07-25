import { useEffect, useMemo, useRef, useState } from 'react'
import { CONFIG } from '../config'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

// DEV BYPASS — localhost only
// Simulates logged-in user for testing
// NEVER ships to production (Vite strips import.meta.env.DEV=true only in dev mode)
const IS_DEV_BYPASS =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_BYPASS === 'true'

const DEV_USER = {
  id: 'dev-user-local',
  email: 'dev@localhost',
  user_metadata: { full_name: 'Dev User' },
}

const DEV_PROFILE = {
  id: 'dev-user-local',
  email: 'dev@localhost',
  full_name: 'Dev User',
  plan: 'free',
  role: 'user',
}

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

  // Only create profiles for invited users (admin used inviteUserByEmail).
  // Block new OAuth sign-ins that weren't invited — sign them out immediately.
  const isInvited = existingUser.user_metadata?.invited_from_waitlist === true
  const provider = existingUser.app_metadata?.provider ?? 'email'
  if (!isInvited && provider !== 'email') {
    await supabase.auth.signOut()
    window.location.assign('/?access=blocked')
    return null
  }

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
    () => IS_DEV_BYPASS
      ? { user: DEV_USER, profile: DEV_PROFILE, loading: false }
      : { user, profile, loading },
    [user, profile, loading],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}
