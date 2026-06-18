/**
 * ProUnlockModal — celebration shown the moment a user crosses 1,000
 * points and the free→pro auto-flip lands.
 *
 * TRIGGER
 *   AuthContext sets sessionStorage 'pinex_pro_just_flipped' when its
 *   background plan-flip succeeds. The modal reads that flag once on
 *   mount. A 'pinex:pro-unlocked' CustomEvent is dispatched right
 *   after AuthContext sets the flag, so if the modal mounts before
 *   the async flip resolves, the event re-triggers the check.
 *
 *   sessionStorage (not localStorage) is critical here: a user who
 *   was ALREADY pro in an earlier session never set this flag, so
 *   they never see the celebration retroactively.
 *
 * DEDUPE
 *   On dismiss, localStorage 'pinex_pro_seen_<userId>' = '1' is set.
 *   If a flip somehow re-triggers (e.g. the user manually downgrades
 *   and re-earns) they don't get the celebration twice.
 *
 * MOUNT
 *   AuthContext renders one <ProUnlockModal /> alongside WelcomeModal /
 *   AdvancedUnlock / PointsToast. Self-gates to null when not eligible.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../../context'

function flagKey(userId) {
  return `pinex_pro_seen_${userId}`
}

function flipFlagPresent() {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem('pinex_pro_just_flipped') === '1'
  } catch {
    return false
  }
}

export default function ProUnlockModal() {
  const { user, profile } = useAuth()
  const [shouldShow, setShouldShow] = useState(false)

  // Read the flip flag on mount and on every 'pinex:pro-unlocked' event.
  // AuthContext may set the flag before OR after this component mounts,
  // depending on timing — handling both keeps the modal robust.
  useEffect(() => {
    if (!user?.id) { setShouldShow(false); return }

    // recheck consults BOTH gates every time it runs. The localStorage
    // seen flag wins — once a user has dismissed, no later flip-flag /
    // event combination can re-show the modal in this mount.
    function recheck() {
      try {
        if (localStorage.getItem(flagKey(user.id)) === '1') {
          setShouldShow(false)
          return
        }
      } catch { /* fall through */ }
      setShouldShow(flipFlagPresent())
    }
    recheck()

    window.addEventListener('pinex:pro-unlocked', recheck)
    return () => window.removeEventListener('pinex:pro-unlocked', recheck)
  }, [user?.id])

  if (!user || !shouldShow) return null
  // Defensive — the flip flag should only ever be set after plan = pro
  // lands, but if profile state is stale, hide rather than mis-celebrate.
  if ((profile?.plan || 'free') !== 'pro') return null

  function handleDismiss() {
    try {
      localStorage.setItem(flagKey(user.id), '1')
      sessionStorage.removeItem('pinex_pro_just_flipped')
    } catch { /* ignore */ }
    setShouldShow(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="You are now Pro"
      style={{
        position: 'fixed',
        inset: 0,
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
          border: '1px solid rgba(251, 191, 36, 0.4)',
          borderRadius: 10,
          padding: '28px 28px 24px',
          color: '#E2E8F0',
          maxHeight: '90vh',
          overflowY: 'auto',
          textAlign: 'center',
        }}
      >
        {/* Celebration emoji */}
        <div
          style={{
            fontSize: 56,
            lineHeight: 1,
            marginBottom: 14,
          }}
          aria-hidden
        >
          🎉
        </div>

        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: '#FBBF24',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          You did it
        </p>

        <h2
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 800,
            color: '#E2E8F0',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
            marginBottom: 12,
          }}
        >
          You&rsquo;re now{' '}
          <span style={{ color: '#FBBF24' }}>Pro</span>.
        </h2>

        <p
          style={{
            margin: '0 auto 22px',
            fontSize: 14,
            color: '#CBD5E1',
            lineHeight: 1.6,
            maxWidth: 380,
          }}
        >
          You earned 1,000 points. Every Pro feature is unlocked.
        </p>

        {/* Feature unlocks list */}
        <div
          style={{
            textAlign: 'left',
            background: 'rgba(251, 191, 36, 0.06)',
            border: '1px solid rgba(251, 191, 36, 0.22)',
            borderRadius: 6,
            padding: '16px 18px',
            marginBottom: 22,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#64748B',
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            What you unlocked
          </div>
          <div style={{ fontSize: 13, color: '#E2E8F0', lineHeight: 1.7 }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: '#FBBF24', marginRight: 8 }}>✓</span>
              Unlimited stock searches
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: '#FBBF24', marginRight: 8 }}>✓</span>
              Pro Screener &amp; SwingX
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: '#FBBF24', marginRight: 8 }}>✓</span>
              Historical Conditions Engine
            </div>
            <div>
              <span style={{ color: '#FBBF24', marginRight: 8 }}>✓</span>
              Advanced research tools
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          style={{
            width: '100%',
            padding: '13px 18px',
            background: '#FBBF24',
            color: '#0B0E11',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
          Explore Pro
        </button>
      </div>
    </div>
  )
}
