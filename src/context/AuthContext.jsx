import posthog from 'posthog-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CONFIG } from '../config'
import { awardPoints } from '../lib/pointsAwarder'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { ensureUserPoints, generateReferralCode } from '../lib/userBootstrap'
import { AuthContext } from './auth-context'
// Progressive Advanced unlock — modal lives at the AuthProvider
// level so it can overlay any page and uses useAuth() to pull the
// current profile + role. The component self-gates to null when
// the user is locked out / already unlocked / admin / on hold, so
// it's safe to mount unconditionally here.
import AdvancedUnlock from '../components/home/AdvancedUnlock'

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
    // Referral code matches the email-signup path (lib/auth.js).
    // OAuth-signup users also get their share URL on day one.
    referral_code: generateReferralCode(email),
  }

  const { error } = await supabase.from('profiles').insert(payload)

  // Seed the points row regardless of insert error — the conflict
  // case (profile already existed) is exactly the case where we
  // still want a points row to exist if one is missing.
  await ensureUserPoints(existingUser.id)

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
        // Clear PostHog person identity on logout so a subsequent
        // anonymous session doesn't carry the prior user's properties.
        if (import.meta.env.VITE_POSTHOG_KEY) {
          try { posthog.reset() } catch { /* ignore */ }
        }
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
      //
      // GATE: A sessionStorage flag throttles this
      // to ONE write per browser session — multiple
      // hydrate() calls (token refresh, visibility
      // change) within the same session no longer
      // re-stamp the row.
      //
      // SNAPSHOT: Before the write, we cache the
      // *pre-update* last_active_at into
      // sessionStorage('pinex_prev_last_active_at')
      // so the While-You-Were-Away component on Home
      // can see how long it had been since the prior
      // visit. Without this snapshot, reading
      // profile.last_active_at would always see today
      // (because we just overwrote it).
      if (session.user?.id) {
        let alreadyActiveThisSession = false
        try {
          alreadyActiveThisSession =
            sessionStorage.getItem('pinex_session_active') === '1'
        } catch { /* sessionStorage unavailable */ }

        if (!alreadyActiveThisSession) {
          try {
            sessionStorage.setItem(
              'pinex_prev_last_active_at',
              profileRow?.last_active_at || '',
            )
            sessionStorage.setItem('pinex_session_active', '1')
          } catch { /* ignore */ }
          supabase
            .from('profiles')
            .update({ last_active_at: new Date().toISOString() })
            .eq('id', session.user.id)
            .then(() => {})

          // STREAK: refresh user_points.current_streak immediately on
          // login. The RPC is a same-day no-op when called twice, so
          // the sessionStorage gate is belt-and-braces — even without
          // it the worst case is one extra round-trip per refresh.
          //
          // PREVIOUS BUG
          //   The RPC only ran when a user opened /account. Anyone
          //   logging in from Home, /lab, /pulse, or via Telegram
          //   never got their streak refreshed in-session — they
          //   were stuck on whatever calc_streaks.py (nightly, 12:00
          //   UTC) had last written, which meant IST evening users
          //   saw 1-day streaks even after 5 days of logins.
          //
          // Pre-migration safety: try/catch + .then ignores the
          // 'function not found' error so a deploy that ships this
          // file before the SQL just no-ops gracefully.
          supabase
            .rpc('update_user_streak')
            .then(() => {})
            .catch(() => {})
        }
      }

      // Identify the user in PostHog. Skipped when the key is unset
      // (dev / preview) so posthog.init was never called. profileRow can
      // be null on a brand-new OAuth signup before insertProfile finishes
      // — that's fine, plan defaults to 'free'.
      if (session.user?.id && import.meta.env.VITE_POSTHOG_KEY) {
        try {
          posthog.identify(session.user.id, {
            email: session.user.email,
            plan: profileRow?.plan || 'free',
          })
        } catch { /* ignore */ }
      }

      // Award daily_login points immediately — instant feedback for the user.
      // Guarded by a same-day check so it only fires once per UTC day.
      // calc_streaks.py is the idempotent safety net that runs at 17:30 IST.
      if (session.user?.id) {
        const todayUTC = new Date().toISOString().slice(0, 10)
        const lastAwardKey = `pinex_daily_login_${session.user.id}_${todayUTC}`

        if (!localStorage.getItem(lastAwardKey)) {
          // Check if already awarded today in DB (handles multi-device)
          supabase
            .from('points_transactions')
            .select('id')
            .eq('user_id', session.user.id)
            .eq('action_type', 'daily_login')
            .gte('created_at', `${todayUTC}T00:00:00Z`)
            .limit(1)
            .then(({ data }) => {
              if (!data || data.length === 0) {
                // Not yet awarded today — award now
                awardPoints(session.user.id, 'daily_login', {
                  notes: 'Daily login — awarded on session resolve',
                  fallbackPoints: 2,
                }).then(() => {
                  localStorage.setItem(lastAwardKey, '1')
                })
              } else {
                // Already awarded — just set the localStorage flag
                localStorage.setItem(lastAwardKey, '1')
              }
            })
        }
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
    <AuthContext.Provider value={value}>
      {children}
      <AdvancedUnlock />
    </AuthContext.Provider>
  )
}
