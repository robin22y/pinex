/**
 * AdvancedUnlock — full-screen overlay shown when a user has earned
 * the Advanced tab but hasn't accepted it yet.
 *
 * GATING (mirrors AuthContext.advancedUnlockEligible)
 *   render iff
 *     - user signed in
 *     - profile.advanced_unlocked is false
 *     - role is neither admin nor superadmin
 *     - user_points.current_streak >= 5
 *     - 'Not yet' wasn't tapped within the last 3 days
 *     - we have a streak number to fill into the headline
 *
 * Two CTAs, no close affordance:
 *   "I'm ready"  → UPDATE profiles SET advanced_unlocked = true,
 *                       advanced_unlocked_at = now()
 *                  Modal unmounts; the Advanced nav item appears
 *                  immediately because appNav.js reads from the
 *                  same profile prop the AuthContext re-fetches.
 *   "Not yet"    → set localStorage('pinex_advanced_hold_until',
 *                  3-days-from-now) and unmount.
 *
 * The whole component returns null until it's renderable, so it's
 * safe to mount unconditionally at the AuthProvider level (which
 * is what AuthContext does so the modal can overlay any page).
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../../context'
import { supabase } from '../../lib/supabase'

const HOLD_KEY    = 'pinex_advanced_hold_until'
const HOLD_DAYS   = 3
const STREAK_GATE = 5

function nowMs() { return Date.now() }
function isHeldBack() {
  try {
    const until = Number(localStorage.getItem(HOLD_KEY))
    if (!Number.isFinite(until) || until <= 0) return false
    return until > nowMs()
  } catch { return false }
}

function isAdminish(profile) {
  const role = String(profile?.role || '').toLowerCase()
  return role === 'admin' || role === 'superadmin'
}

export default function AdvancedUnlock() {
  const { user, profile } = useAuth()
  const [streak, setStreak]       = useState(null)
  const [dismissed, setDismissed] = useState(() => isHeldBack())
  const [busy, setBusy]           = useState(false)

  // Probe current_streak once user is known. Same fire-and-forget
  // pattern AuthContext uses — failure (RLS, missing table) is
  // tolerated and just hides the modal.
  useEffect(() => {
    if (!user?.id) { setStreak(null); return }
    let cancelled = false
    supabase
      .from('user_points')
      .select('current_streak')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const v = Number(data?.current_streak)
        setStreak(Number.isFinite(v) ? v : null)
      })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [user?.id])

  // ── Gate ───
  if (dismissed) return null
  if (!user || !profile) return null
  if (profile.advanced_unlocked === true) return null
  if (isAdminish(profile)) return null
  if (streak == null || streak < STREAK_GATE) return null

  async function handleReady() {
    if (busy) return
    setBusy(true)
    try {
      await supabase
        .from('profiles')
        .update({
          advanced_unlocked: true,
          advanced_unlocked_at: new Date().toISOString(),
        })
        .eq('id', user.id)
      // Locally reflect the change so this render unmounts even
      // before AuthContext rehydrates. AuthContext picks up the
      // canonical value on its next hydrate (token refresh /
      // visibility change), so the nav item appears soon after.
      profile.advanced_unlocked = true
      try { localStorage.removeItem(HOLD_KEY) } catch { /* ignore */ }
      window.location.assign('/breadth-lab')
    } catch (e) {
      // Migration probably hasn't been applied yet — surface the
      // problem rather than silently swallowing it so the user
      // doesn't tap "I'm ready" repeatedly with no feedback.
      // eslint-disable-next-line no-alert
      window.alert(
        'Could not unlock right now — please try again in a moment.',
      )
      setBusy(false)
    }
  }

  function handleNotYet() {
    try {
      const until = nowMs() + HOLD_DAYS * 24 * 60 * 60 * 1000
      localStorage.setItem(HOLD_KEY, String(until))
    } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Advanced unlock"
      style={{
        position: 'fixed',
        inset: 0,
        // No close affordance per the spec — the dark scrim is
        // not click-to-dismiss either. The user must pick one of
        // the two CTAs.
        background: 'rgba(11, 14, 17, 0.94)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          background: '#0F1217',
          border: '1px solid #1E2530',
          borderRadius: 10,
          padding: '28px 28px 24px',
          color: '#E2E8F0',
        }}
      >
        <p style={{
          margin: 0,
          fontSize: 13,
          color: '#FBBF24',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
          marginBottom: 14,
        }}>
          One more layer
        </p>

        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: '#E2E8F0' }}>
          You&rsquo;ve been watching the market for <strong style={{ color: '#FBBF24' }}>{streak}</strong> days.
        </p>
        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.65, color: '#CBD5E1' }}>
          You notice things most people miss.
        </p>
        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.65, color: '#CBD5E1' }}>
          There&rsquo;s one more layer to PineX &mdash; <em>market internals</em>. The engine beneath everything you&rsquo;ve been reading.
        </p>
        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.65, color: '#CBD5E1' }}>
          It&rsquo;s not for everyone.
        </p>
        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.65, color: '#E2E8F0', fontWeight: 600 }}>
          But you&rsquo;re ready.
        </p>

        <div style={{
          marginTop: 24,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          <button
            type="button"
            onClick={handleReady}
            disabled={busy}
            style={{
              padding: '11px 22px',
              fontSize: 14,
              fontWeight: 700,
              background: '#FBBF24',
              color: '#0B0E11',
              border: 'none',
              borderRadius: 6,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              flex: '1 1 auto',
            }}
          >
            {busy ? 'Unlocking…' : "I'm ready"}
          </button>
          <button
            type="button"
            onClick={handleNotYet}
            disabled={busy}
            style={{
              padding: '11px 22px',
              fontSize: 14,
              fontWeight: 600,
              background: 'transparent',
              color: '#64748B',
              border: '1px solid #1E2530',
              borderRadius: 6,
              cursor: busy ? 'default' : 'pointer',
              flex: '0 0 auto',
            }}
          >
            Not yet
          </button>
        </div>
      </div>
    </div>
  )
}
