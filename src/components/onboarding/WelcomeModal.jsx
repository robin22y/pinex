/**
 * WelcomeModal — full-screen first-login intro.
 *
 * Shown once per user, gated by a localStorage flag
 * ('pinex_welcome_seen_<userId>') so a sign-out / sign-in or a
 * sign-in on a fresh device shows it again exactly once.
 *
 * Render only when:
 *   - User signed in
 *   - profile.plan is not 'pro' (Pro users already past this)
 *   - localStorage flag for this user is not set
 *   - We have a balance to display (avoids the flash where 500
 *     would render as '0' before user_points loads)
 *
 * One CTA, no skip. 'Start exploring' dismisses + stamps the
 * localStorage flag. Per spec the user must tap to proceed.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../../context'
import { supabase } from '../../lib/supabase'

function flagKey(userId) {
  return `pinex_welcome_seen_${userId}`
}

export default function WelcomeModal() {
  const { user, profile } = useAuth()
  const [points, setPoints] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      // Optimistic — assume dismissed until we know the userId.
      // The effect below flips it back when the user changes.
      return true
    } catch { return true }
  })

  // Probe local flag once the user id is known.
  useEffect(() => {
    if (!user?.id) { setDismissed(true); return }
    try {
      const seen = localStorage.getItem(flagKey(user.id)) === '1'
      setDismissed(seen)
    } catch { setDismissed(true) }
  }, [user?.id])

  // Pull current balance for the headline.
  //
  // Race-resilient — three triggers refresh the balance:
  //   1. Initial mount read.
  //   2. Any pinex:points-awarded CustomEvent (the awardPoints helper
  //      dispatches this every successful insert, including the
  //      welcome bonus in AuthContext). Catches the case where the
  //      bonus lands AFTER the modal first reads.
  //   3. One defensive retry 1.2 s after mount if the first read
  //      returned 0 or null — covers the case where the event was
  //      missed during the listener-attach race (event fired between
  //      our render and the useEffect attach).
  useEffect(() => {
    if (!user?.id) { setPoints(null); return }
    let cancelled = false

    async function refresh() {
      try {
        const { data } = await supabase
          .from('user_points')
          .select('total_points')
          .eq('user_id', user.id)
          .maybeSingle()
        if (cancelled) return
        const n = Number(data?.total_points)
        setPoints(Number.isFinite(n) ? n : null)
        return Number.isFinite(n) ? n : null
      } catch {
        return null
      }
    }

    refresh().then((initial) => {
      if (cancelled) return
      // Defensive retry: if the welcome bonus is en route and we
      // just raced ahead, give it one beat then re-read.
      if (initial == null || initial === 0) {
        window.setTimeout(() => { if (!cancelled) refresh() }, 1200)
      }
    })

    function onAward() { refresh() }
    window.addEventListener('pinex:points-awarded', onAward)
    return () => {
      cancelled = true
      window.removeEventListener('pinex:points-awarded', onAward)
    }
  }, [user?.id])

  if (!user || dismissed) return null
  if ((profile?.plan || 'free') === 'pro') return null
  if (points == null) return null

  // The remainder banner — '500 / 1000 pts to Pro'. Computed at
  // render time so the number reflects the user_points read above.
  const remaining = Math.max(0, 1000 - points)

  function handleStart() {
    try { localStorage.setItem(flagKey(user.id), '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to PineX"
      style={{
        position: 'fixed',
        inset: 0,
        // Dark scrim, theme-independent because the modal frame
        // itself is dark — the user-facing surface here is the
        // amber-accented card, not the page beneath.
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
          maxWidth: 480,
          width: '100%',
          background: '#0F1217',
          border: '1px solid #1E2530',
          borderRadius: 10,
          padding: '28px 28px 24px',
          color: '#E2E8F0',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <p style={{
          margin: 0,
          fontSize: 13,
          color: '#FBBF24',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
          marginBottom: 12,
        }}>
          Welcome to PineX
        </p>

        <h2 style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 700,
          color: '#E2E8F0',
          letterSpacing: '-0.01em',
          lineHeight: 1.25,
          marginBottom: 16,
        }}>
          You have <span style={{ color: '#FBBF24' }}>{points.toLocaleString('en-IN')} points</span>.
        </h2>

        <div style={{ fontSize: 14, color: '#CBD5E1', lineHeight: 1.65, marginBottom: 18 }}>
          Here&rsquo;s what that means:
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#E2E8F0' }}>
            <li style={{ marginBottom: 4 }}>Search any stock (3 per day)</li>
            <li style={{ marginBottom: 4 }}>Today&rsquo;s market feel</li>
            <li style={{ marginBottom: 4 }}>Sector pulse</li>
            <li>Academy — first module</li>
          </ul>
        </div>

        <div style={{
          margin: '4px 0 18px',
          padding: '14px 16px',
          background: 'rgba(251, 191, 36, 0.08)',
          border: '1px solid rgba(251, 191, 36, 0.28)',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', marginBottom: 8 }}>
            Want full access?
          </div>
          <div style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 1.6 }}>
            Earn <strong style={{ color: '#FBBF24' }}>{remaining.toLocaleString('en-IN')} more points</strong>{' '}
            to unlock Pro.
          </div>
        </div>

        <div style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 1.7, marginBottom: 18 }}>
          <div style={{
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#64748B',
            marginBottom: 8,
            fontWeight: 700,
          }}>
            How to earn 500 more points
          </div>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#FBBF24', marginRight: 6 }}>→</span>
            Complete Academy modules{' '}
            <span style={{ color: '#94A3B8' }}>+100 pts each (8 modules)</span>
          </div>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#FBBF24', marginRight: 6 }}>→</span>
            Come back daily{' '}
            <span style={{ color: '#94A3B8' }}>+2 pts</span>
          </div>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#FBBF24', marginRight: 6 }}>→</span>
            Refer a friend{' '}
            <span style={{ color: '#94A3B8' }}>+100 pts</span>
          </div>
          <div>
            <span style={{ color: '#FBBF24', marginRight: 6 }}>→</span>
            Check stocks{' '}
            <span style={{ color: '#94A3B8' }}>+1 pt each</span>
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6, marginBottom: 22 }}>
          Fastest path: complete 5 modules ={' '}
          <strong style={{ color: '#CBD5E1' }}>500 points</strong> = Pro access.
        </div>

        <button
          type="button"
          onClick={handleStart}
          style={{
            width: '100%',
            padding: '12px 18px',
            background: '#FBBF24',
            color: '#0B0E11',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Start exploring
        </button>
      </div>
    </div>
  )
}
