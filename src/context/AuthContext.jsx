import posthog from 'posthog-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CONFIG } from '../config'
import { awardPoints } from '../lib/pointsAwarder'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { ensureUserPoints } from '../lib/userBootstrap'
import { AuthContext } from './auth-context'
// Progressive Advanced unlock — modal lives at the AuthProvider
// level so it can overlay any page and uses useAuth() to pull the
// current profile + role. The component self-gates to null when
// the user is locked out / already unlocked / admin / on hold, so
// it's safe to mount unconditionally here.
import AdvancedUnlock from '../components/home/AdvancedUnlock'
// First-login welcome modal — full-screen, single CTA, no skip.
// Self-gates to null after the localStorage flag lands, so mounting
// unconditionally at the AuthProvider level is safe.
import WelcomeModal from '../components/onboarding/WelcomeModal'
// Global +N pts feedback surface. Self-gates to null when the toast
// queue is empty, so mounting unconditionally here is safe.
import PointsToast from '../components/points/PointsToast'
// Pro-unlock celebration — fires the first session a user's plan
// auto-flips from free → pro. Self-gates to null otherwise.
import ProUnlockModal from '../components/onboarding/ProUnlockModal'

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

  // No upsert here. The auth-trigger writes the base profile
  // (id, email, full_name, plan='free', role='user', is_active=true)
  // synchronously on auth.users INSERT. The previous upsert re-fired
  // every UNIQUE check on the row, which crashed with 23505 whenever
  // a different row already held the same email (soft-deleted
  // accounts, orphans from partial prior signups, case-mismatch).
  //
  // Frontend now only patches columns the trigger doesn't fill:
  //   - role='superadmin' when the email matches CONFIG.admin
  //   - referral_code (race-safe backfill, retry on UNIQUE collision)
  // Each is a targeted UPDATE WHERE id = X — zero overlap with
  // trigger-written UNIQUE columns. All failures non-fatal so a
  // missed backfill never blocks signup itself.

  if (role === 'superadmin') {
    try {
      await supabase
        .from('profiles')
        .update({ role: 'superadmin' })
        .eq('id', existingUser.id)
        .neq('role', 'superadmin')
    } catch {
      // Non-fatal — admin can be re-stamped manually.
    }
  }

  // referral_code is now generated server-side by the auth-insert
  // trigger. Frontend must never write it — the prior backfill UPDATE
  // raced the trigger's own write and crashed with 23505 on the
  // referral_code UNIQUE constraint, which surfaced to users as
  // "duplicate key" on signup.

  // Seed the points row — idempotent. We always seed regardless of
  // earlier UPDATE outcomes because the user_points row is what every
  // streak/balance read keys off, and a missing row breaks the
  // homepage points chip.
  await ensureUserPoints(existingUser.id)

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
          //
          // STREAK BONUSES — silent. When the RPC reports that
          // current_streak ticked to 7 or 30 *today* (unchanged=false),
          // award the matching bonus action_type. The daily-cap
          // safety check below dedupes across multiple hydrate calls
          // within the same UTC day; no toast, no fanfare per spec.
          supabase
            .rpc('update_user_streak')
            .then(async ({ data }) => {
              if (!data?.ok || data.unchanged) return
              const streak = Number(data.streak)
              if (!Number.isFinite(streak)) return

              // Streak milestone bonuses — values match the rebalance
              // in scripts/sql/rebalance_points.sql (Jun 2026):
              //   7-day  → 150 pts  (was 35)
              //   14-day → 300 pts  (new — fills the gap between 7 + 30)
              //   30-day → 500 pts  (was 150)
              let bonusAction = null
              let fallback    = 0
              if (streak === 7)        { bonusAction = 'streak_7_day_bonus';  fallback = 150 }
              else if (streak === 14)  { bonusAction = 'streak_14_day_bonus'; fallback = 300 }
              else if (streak === 30)  { bonusAction = 'streak_30_day_bonus'; fallback = 500 }
              if (!bonusAction) return

              // Dedupe: if today already carries this action_type for
              // this user, don't double-award (catches the case where
              // a new tab triggers another hydrate after the bonus
              // landed).
              try {
                const todayUTC = new Date().toISOString().slice(0, 10)
                const { data: existing } = await supabase
                  .from('points_transactions')
                  .select('id')
                  .eq('user_id', session.user.id)
                  .eq('action_type', bonusAction)
                  .gte('created_at', `${todayUTC}T00:00:00Z`)
                  .limit(1)
                if (Array.isArray(existing) && existing.length > 0) return
              } catch { /* silent — fall through to award */ }

              // Fire-and-forget. awardPoints reads the value from
              // points_config (set in scripts/sql/add_feature_unlock_costs.sql
              // — 35 for the 7-day, 150 for the 30-day) and falls
              // back to the inline value if the config row hasn't
              // been seeded yet.
              try {
                await awardPoints(session.user.id, bonusAction, {
                  notes: `${streak}-day streak bonus`,
                  fallbackPoints: fallback,
                })
              } catch { /* silent */ }
            })
            .catch(() => {})

          // ── Pro auto-flip at 1000 pts ───────────────────────
          // Background check — silent for now. When the user's
          // total_points crosses the 1000-pt Pro threshold AND
          // profile.plan is still 'free', flip to 'pro' and stamp
          // plan_activated_at. The Pro unlock celebration modal
          // is held until you spec it; the underlying plan flip
          // ships here so feature gates can read profile.plan
          // without waiting on the UI work.
          if (profileRow && (profileRow.plan || 'free') === 'free') {
            ;(async () => {
              try {
                const { data: ptsRow } = await supabase
                  .from('user_points')
                  .select('total_points')
                  .eq('user_id', session.user.id)
                  .maybeSingle()
                const total = Number(ptsRow?.total_points || 0)
                if (total < 1000) return
                await supabase
                  .from('profiles')
                  .update({
                    plan: 'pro',
                    plan_activated_at: new Date().toISOString(),
                  })
                  .eq('id', session.user.id)
                profileRow.plan = 'pro'
                profileRow.plan_activated_at = new Date().toISOString()
                // Trigger the Pro celebration modal. sessionStorage
                // (not localStorage) so the flag is scoped to THIS
                // tab/session — modal reads it once on mount, then
                // clears it. Pre-existing pro users (already flipped
                // in earlier sessions) never set this flag, so they
                // never see the celebration retroactively.
                try {
                  sessionStorage.setItem('pinex_pro_just_flipped', '1')
                  // Tell ProUnlockModal to re-check immediately — it
                  // may have mounted before the flip completed.
                  window.dispatchEvent(new CustomEvent('pinex:pro-unlocked'))
                } catch { /* silent */ }
              } catch { /* silent */ }
            })()
          }
        }

        // ── Welcome bonus (500 pts, one-time) — self-healing ────
        // Lives OUTSIDE the `pinex_session_active` gate above so a
        // user who missed the bonus on first signup (deploy gap,
        // pre-RPC code path, browser-crash mid-flow, etc.) gets
        // healed on their NEXT hydrate. The RPC is idempotent
        // server-side, so calling it on every hydrate is safe — the
        // localStorage flag below makes it cheap, capping the network
        // cost at one successful RPC per (browser, user) pair.
        //
        // Flag is scoped to user_id so signing out / signing in as a
        // different account doesn't leak the flag across users.
        //
        // award_user_bonus is the SECURITY DEFINER RPC defined in
        // scripts/sql/add_award_user_bonus_fn.sql — needed because
        // security_restrict_points_transactions_insert.sql does NOT
        // whitelist 'welcome_bonus' for client-side INSERT.
        ;(async () => {
          const flagKey = `pinex_welcome_bonus_${session.user.id}`
          let already = false
          try { already = localStorage.getItem(flagKey) === '1' } catch { /* private mode */ }
          if (already) return
          try {
            const { data: newTotal, error: rpcErr } = await supabase.rpc(
              'award_user_bonus',
              {
                p_action_type: 'welcome_bonus',
                p_fallback_points: 500,
                p_notes: 'Welcome to PineX',
              },
            )
            if (rpcErr) {
              // eslint-disable-next-line no-console
              console.error('[welcome_bonus] award_user_bonus RPC failed:', rpcErr)
              return
            }
            try { localStorage.setItem(flagKey, '1') } catch { /* ignore */ }
            if (typeof window !== 'undefined' && Number.isFinite(Number(newTotal))) {
              try {
                window.dispatchEvent(new CustomEvent('pinex:points-awarded', {
                  detail: {
                    points: 500,
                    actionType: 'welcome_bonus',
                    notes: 'Welcome to PineX',
                  },
                }))
              } catch { /* no-op */ }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[welcome_bonus] unexpected:', e)
          }
        })()

        // ── Referral 3-visit gate ───────────────────────────────
        // Bumps profiles.visit_count once per IST day for the signed-in
        // user. When the count crosses 3 AND auth.users metadata
        // carries an invited_by_user, the RPC awards 100 pts to the
        // INVITER (not the caller). Idempotency lives server-side
        // (points_transactions notes contain 'invitee:<UUID>'), so
        // calling on every hydrate is safe — same-day calls are
        // server-side no-ops.
        //
        // SQL: scripts/sql/add_referral_visit_gate.sql.
        //
        // The award is fire-and-forget: the inviter is a DIFFERENT
        // user, so we don't dispatch the points-awarded toast event
        // here (that surface targets the current viewer). The inviter
        // sees the bump on their next refresh.
        ;(async () => {
          try {
            const { data, error: rpcErr } = await supabase.rpc(
              'record_visit_and_claim_referral'
            )
            if (rpcErr) {
              // Pre-migration: function not found → silent no-op.
              if (!/function/i.test(String(rpcErr.message || ''))) {
                // eslint-disable-next-line no-console
                console.warn('[referral_gate] RPC failed:', rpcErr.message)
              }
              return
            }
            // data shape:
            //   { visit_count, awarded, reason?, points?, inviter_id? }
            // Only log the awarded case in dev — the rejected reasons
            // are normal flow (visits_lt_3 on day 1/2, no_inviter for
            // direct signups, already_awarded on day 4+).
            if (data?.awarded && import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.log('[referral_gate] +100 to inviter', data)
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[referral_gate] unexpected:', e)
          }
        })()
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
                  fallbackPoints: 20,
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
      <WelcomeModal />
      <AdvancedUnlock />
      <PointsToast />
      <ProUnlockModal />
    </AuthContext.Provider>
  )
}
