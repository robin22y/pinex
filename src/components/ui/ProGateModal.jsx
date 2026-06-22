/**
 * ProGateModal — shown when a Free user taps a Pro-locked feature.
 *
 * Replaces the generic "Upgrade to Pro" lock with a teaser that frames
 * the current points balance against the 1,000-point unlock threshold
 * and computes how many days of daily logins it'd take to close the gap
 * (20 pts/day after the June 2026 rebalance).
 *
 * PROPS
 *   open          boolean — render iff truthy
 *   onClose()     dismiss handler — backdrop click + close button fire it
 *   currentPoints integer — user_points.total_points
 *   featureName   string (optional) — e.g. "Pro Screener", "SwingX". Lets
 *                 the headline read "This is where … appear first" instead
 *                 of a generic "Pro feature locked".
 *
 * COPY follows Robin's spec verbatim — single CTA-less card focused on
 * the gap; secondary nudge under the bar says "Come back tomorrow → +20
 * pts" so the user has a concrete next step.
 */
import { useEffect } from 'react'

const PRO_THRESHOLD = 1000
const POINTS_PER_DAY = 20

export default function ProGateModal({ open, onClose, currentPoints = 0, featureName }) {
  // Close on Esc — matches the rest of the codebase's modal pattern.
  useEffect(() => {
    if (!open) return
    function onEsc(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, onClose])

  if (!open) return null

  const points = Math.max(0, Number(currentPoints) || 0)
  const clampedForBar = Math.min(points, PRO_THRESHOLD)
  const pct = Math.round((clampedForBar / PRO_THRESHOLD) * 100)
  const remaining = Math.max(0, PRO_THRESHOLD - points)
  const daysAway = Math.max(1, Math.ceil(remaining / POINTS_PER_DAY))
  const isAtThreshold = remaining === 0

  const headline = featureName
    ? `${featureName} adds deeper market-structure context.`
    : 'This area adds deeper market-structure context.'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unlock Pro"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(11,14,17,0.94)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420,
          width: '100%',
          background: '#0F1217',
          border: '1px solid rgba(251, 191, 36, 0.32)',
          borderRadius: 10,
          padding: '28px 24px 22px',
          color: '#E2E8F0',
          fontFamily: 'inherit',
        }}
      >
        {/* Headline */}
        <p style={{
          margin: '0 0 18px',
          fontSize: 16,
          fontWeight: 700,
          lineHeight: 1.4,
          color: '#E2E8F0',
        }}>
          {headline}
        </p>

        {/* Balance + threshold */}
        <p style={{ margin: '0 0 4px', fontSize: 13, color: '#CBD5E1', lineHeight: 1.55 }}>
          You have <strong style={{ color: '#FBBF24' }}>{points.toLocaleString('en-IN')}</strong> {points === 1 ? 'point' : 'points'}.
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#CBD5E1', lineHeight: 1.55 }}>
          Pro unlocks at <strong style={{ color: '#FBBF24' }}>{PRO_THRESHOLD.toLocaleString('en-IN')}</strong>.
        </p>

        {/* Progress bar */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={PRO_THRESHOLD}
          aria-valuenow={points}
          style={{
            height: 8,
            background: '#1E2530',
            borderRadius: 4,
            overflow: 'hidden',
            marginBottom: 6,
          }}
        >
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: '#FBBF24',
            transition: 'width 0.4s ease',
          }} />
        </div>
        <p style={{
          margin: '0 0 18px',
          fontSize: 11,
          color: '#64748B',
          letterSpacing: '0.04em',
          textAlign: 'right',
        }}>
          {points.toLocaleString('en-IN')}/{PRO_THRESHOLD.toLocaleString('en-IN')}
        </p>

        {/* Gap line */}
        {!isAtThreshold ? (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: '#E2E8F0', lineHeight: 1.55 }}>
              <strong style={{ color: '#FBBF24' }}>{remaining.toLocaleString('en-IN')}</strong> {remaining === 1 ? 'point' : 'points'} remaining.
            </p>

            {/* Divider */}
            <div style={{
              height: 1,
              background: '#1E2530',
              margin: '0 0 16px',
            }} />

            {/* Daily nudge */}
            <p style={{ margin: '0 0 6px', fontSize: 13, color: '#CBD5E1', lineHeight: 1.55 }}>
              Come back tomorrow → <strong style={{ color: '#FBBF24' }}>+20 pts</strong>
            </p>
            <p style={{ margin: 0, fontSize: 12, color: '#64748B', lineHeight: 1.5 }}>
              You're <strong style={{ color: '#CBD5E1' }}>{daysAway}</strong> {daysAway === 1 ? 'day' : 'days'} away.
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: '#86EFAC', lineHeight: 1.55 }}>
            You've crossed the Pro threshold — refresh to unlock.
          </p>
        )}

        {/* Close — tiny, low-emphasis. The card itself is dismissible
            via backdrop click + Esc; a visible × is here for users who
            don't realise that. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: 'transparent',
            border: 'none',
            color: '#64748B',
            fontSize: 18,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 6,
            fontFamily: 'inherit',
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
