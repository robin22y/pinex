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

// WHY: id must be a syntactically valid UUID
// (Postgres uuid type) so DB queries that filter
// by user_id don't 22P02 on dev bypass. The value
// itself doesn't exist in auth.users, so RLS-
// protected reads simply return zero rows — which
// renders as empty states across the app.
const DEV_USER = {
  id: '00000000-0000-0000-0000-0000000000d1',
  email: 'dev@localhost',
  user_metadata: { full_name: 'Dev User' },
}

const DEV_PROFILE = {
  id: '00000000-0000-0000-0000-0000000000d1',
  email: 'dev@localhost',
  full_name: 'Dev User',
  plan: 'free',
  role: 'user',
  // Dev-only short-circuits so VITE_DEV_BYPASS
  // doesn't get trapped on the ToS or Academy
  // screens (the hardcoded id 'dev-user-local'
  // doesn't exist in Supabase, so any UPDATE
  // would silently no-op and reload the loop).
  tos_accepted: true,
  tos_accepted_at: '2026-01-01T00:00:00Z',
  academy_grandfathered: true,
  academy_completed: true,
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
  // WHY: Multiple auth events can fire in quick
  // succession (INITIAL_SESSION + TOKEN_REFRESH
  // + visibilitychange). Each hydrate() call
  // bumps this counter; in-flight async work
  // checks "is my generation still current?"
  // before calling setState, so stale fetches
  // don't overwrite fresh data.
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

      // WHY: We update last_active_at on every
      // login so admin can track daily/weekly
      // active users and identify users absent
      // 10+ days. Fire-and-forget — do not await
      // so the login flow isn't slowed down by
      // a slow write.
      if (session.user?.id) {
        supabase
          .from('profiles')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', session.user.id)
          .then(() => {})
      }

      // WHY: First-login academy deadline.
      // Every new user gets 10 days from their
      // first session to complete Module 1. We
      // set this once (when the column is null)
      // and never touch it again — even on
      // re-logins after the deadline expires.
      // Grandfathered users and users who have
      // already completed the academy are skipped.
      if (
        profileRow &&
        !profileRow.academy_deadline &&
        !profileRow.academy_completed &&
        !profileRow.academy_grandfathered
      ) {
        const deadlineIso = new Date(
          Date.now() + 10 * 24 * 60 * 60 * 1000,
        ).toISOString()
        try {
          await supabase
            .from('profiles')
            .update({ academy_deadline: deadlineIso })
            .eq('id', session.user.id)
          profileRow.academy_deadline = deadlineIso
        } catch {
          // Non-fatal — gate falls back to no deadline.
        }
      }

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
