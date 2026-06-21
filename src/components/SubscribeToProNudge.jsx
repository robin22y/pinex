/**
 * SubscribeToProNudge — global banner that prompts users to redeem
 * Pro starting 2026-06-29 (the day after the universal 7-day Pro
 * grant expires; see scripts/sql/grant_7day_pro_to_all_users.sql).
 *
 * RENDER GATE (returns null otherwise — safe to mount globally)
 *   - User signed in
 *   - Today (local) >= 2026-06-29
 *   - User is NOT on active Pro:
 *       plan == 'pro'        + pro_expires_at in the future   → hidden
 *       plan == 'pro_trial'  + trial_expires_at in the future → hidden
 *       anything else                                         → shown
 *   - Not dismissed this session (sessionStorage flag)
 *
 * The banner is sticky at the bottom above the BottomNav with a
 * dismiss × so users who don't want to act right now aren't nagged
 * for the whole session. Re-fires next session by design — the
 * pitch is genuinely time-sensitive (no Pro access otherwise).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context'
import { C } from '../styles/tokens'

// Activation date — anything on/after this calendar day in the
// user's local zone shows the nudge. Matches the 7-day Pro grant's
// expiry (2026-06-28 23:59:59 UTC → 2026-06-29 ~05:30 IST).
const NUDGE_START_DATE = '2026-06-29'

function isOnOrAfterStart(today, startStr) {
  // Compare as YYYY-MM-DD strings (en-CA locale gives that format
  // in any timezone). String compare on this format == date compare.
  return today >= startStr
}

function hasActivePro(profile) {
  if (!profile) return false
  const plan = String(profile.plan || '').toLowerCase()
  const now = Date.now()
  if (plan === 'pro' && profile.pro_expires_at) {
    const exp = new Date(profile.pro_expires_at).valueOf()
    if (Number.isFinite(exp) && exp > now) return true
  }
  if (plan === 'pro_trial' && profile.trial_expires_at) {
    const exp = new Date(profile.trial_expires_at).valueOf()
    if (Number.isFinite(exp) && exp > now) return true
  }
  return false
}

export default function SubscribeToProNudge() {
  const { user, profile } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  // Probe dismiss flag once per user/session.
  useEffect(() => {
    if (!user?.id) { setDismissed(false); return }
    try {
      const seen = sessionStorage.getItem(`pinex_pro_nudge_dismissed_${user.id}`) === '1'
      setDismissed(seen)
    } catch { setDismissed(false) }
  }, [user?.id])

  if (!user) return null
  if (dismissed) return null
  if (hasActivePro(profile)) return null

  const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
  if (!isOnOrAfterStart(today, NUDGE_START_DATE)) return null

  function handleDismiss() {
    try { sessionStorage.setItem(`pinex_pro_nudge_dismissed_${user.id}`, '1') } catch { /* private mode */ }
    setDismissed(true)
  }

  return (
    <div
      role="region"
      aria-label="Subscribe to Pro"
      style={{
        position: 'fixed',
        // Sits above the BottomNav (~60px tall) on mobile; sidebar
        // layouts on desktop see this just above the page footer.
        bottom: 76,
        left: 12,
        right: 12,
        maxWidth: 540,
        margin: '0 auto',
        zIndex: 8500,
        background: '#0F1217',
        border: `1px solid ${C.amberBorder}`,
        borderLeft: `4px solid ${C.amber}`,
        borderRadius: 12,
        padding: '12px 14px 12px 16px',
        boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: C.amber,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 2,
        }}>
          Your free Pro ended
        </div>
        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.45 }}>
          Keep full screener, SwingX & historical access — redeem from 100 points.
        </div>
      </div>
      <Link
        to="/rewards"
        style={{
          background: C.amber,
          color: '#0B0E11',
          fontSize: 12,
          fontWeight: 700,
          padding: '8px 12px',
          borderRadius: 8,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        Redeem
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: C.textMuted,
          fontSize: 18,
          cursor: 'pointer',
          padding: '4px 6px',
          marginRight: -4,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
