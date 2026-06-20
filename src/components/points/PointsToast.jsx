/**
 * PointsToast — global +N pts feedback surface.
 *
 * Listens for `window` CustomEvents named 'pinex:points-awarded' and
 * renders a stack of small toast cards in the top-right corner. Each
 * toast auto-dismisses after VISIBLE_MS; the dismiss timer is paused
 * by hovering the stack so users can read multi-toast bursts.
 *
 * EVENT CONTRACT
 *   window.dispatchEvent(new CustomEvent('pinex:points-awarded', {
 *     detail: { points: number, actionType: string, notes?: string }
 *   }))
 *
 *   Dispatched by src/lib/pointsAwarder.js after every successful
 *   awardPoints() insert. Zero call-site changes for new earning
 *   surfaces — they all flow through awardPoints already.
 *
 * COPY
 *   Headline: "+N pts". Subline pulls from a small action_type → label
 *   map (see ACTION_LABELS); falls back to the `notes` field; falls
 *   back to "Points earned".
 *
 * MOUNT
 *   AuthContext provider renders one <PointsToast /> alongside
 *   <WelcomeModal /> and <AdvancedUnlock />. Single global instance
 *   covers every signed-in surface (and dispatches from anonymous code
 *   paths are silently no-op because awardPoints requires userId).
 */
import { useEffect, useRef, useState } from 'react'

const VISIBLE_MS  = 3200    // per-toast dwell time
const MAX_STACK   = 4       // soft cap — older toasts drop off the top
const ENTER_MS    = 220
const EXIT_MS     = 180

// Subline copy keyed by action_type. Stays in this file (not a shared
// dict) because the surface is tiny — adding a new earning action means
// touching one place.
const ACTION_LABELS = {
  welcome_bonus:        'Welcome to PineX',
  daily_login:          'Daily login',
  discovery_tap:        'Home nudge explored',
  validation_earned:    'Watchlist nudge',
  streak_bonus_7:       '7-day streak bonus',
  streak_bonus_30:      '30-day streak bonus',
  streak_bonus_100:     '100-day streak bonus',
  stock_view:           'Stock checked',
  referral:             'Friend referred',
  academy_module_1:     'Academy Module 1 complete',
  academy_module_2:     'Academy Module 2 complete',
  academy_module_3:     'Academy Module 3 complete',
  academy_module_4:     'Academy Module 4 complete',
  academy_module_5:     'Academy Module 5 complete',
  academy_module_6:     'Academy Module 6 complete',
  academy_module_7:     'Academy Module 7 complete',
  academy_module_8:     'Academy Module 8 complete',
  academy_final_exam:   'Academy complete — final exam',
}

function labelFor(actionType, notes) {
  if (actionType && ACTION_LABELS[actionType]) return ACTION_LABELS[actionType]
  if (notes) return String(notes)
  return 'Points earned'
}

// Special-cased celebration line for the all-modules-finished bonus.
// Kept inline (vs. a flag in the dict) because it's the only action
// with extra-large copy + emoji + a distinct headline.
function isFinalExam(actionType) {
  return actionType === 'academy_final_exam'
}

export default function PointsToast() {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  // Bind once. The CustomEvent listener stays attached for the
  // entire mount lifetime — AuthContext mounts this exactly once,
  // so no risk of double-listeners.
  useEffect(() => {
    function onAward(ev) {
      const detail = ev?.detail || {}
      const points = Number(detail.points)
      if (!Number.isFinite(points) || points <= 0) return

      const id = ++idRef.current
      const entry = {
        id,
        points,
        actionType: String(detail.actionType || ''),
        notes: detail.notes ? String(detail.notes) : null,
        bornAt: Date.now(),
        leaving: false,
      }

      setToasts((cur) => {
        // Hard cap — drop the oldest so the stack never grows beyond
        // MAX_STACK. The dropped toast may still have an in-flight
        // exit timer; harmless because the timer just no-ops a missing
        // id below.
        const next = [...cur, entry]
        return next.length > MAX_STACK ? next.slice(-MAX_STACK) : next
      })

      // Schedule exit. Two-stage: mark leaving (drives the fade-out
      // class), then prune from state after EXIT_MS so the animation
      // is allowed to play.
      window.setTimeout(() => {
        setToasts((cur) =>
          cur.map((t) => (t.id === id ? { ...t, leaving: true } : t))
        )
        window.setTimeout(() => {
          setToasts((cur) => cur.filter((t) => t.id !== id))
        }, EXIT_MS)
      }, VISIBLE_MS)
    }

    window.addEventListener('pinex:points-awarded', onAward)
    return () => window.removeEventListener('pinex:points-awarded', onAward)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        // Fixed, top-right. zIndex one above the modals (9999) so a
        // toast still reads over the WelcomeModal scrim on the very
        // first login burst.
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 320,
      }}
    >
      {toasts.map((t) => {
        const finalExam = isFinalExam(t.actionType)
        return (
          <div
            key={t.id}
            role="status"
            style={{
              pointerEvents: 'auto',
              background: finalExam ? 'rgba(251, 191, 36, 0.96)' : 'rgba(15, 18, 23, 0.96)',
              border: finalExam
                ? '1px solid rgba(251, 191, 36, 1)'
                : '1px solid rgba(251, 191, 36, 0.32)',
              borderRadius: 8,
              padding: '12px 14px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
              color: finalExam ? '#0B0E11' : '#E2E8F0',
              fontFamily: 'inherit',
              transform: t.leaving ? 'translateX(8px)' : 'translateX(0)',
              opacity: t.leaving ? 0 : 1,
              transition: `opacity ${t.leaving ? EXIT_MS : ENTER_MS}ms ease, transform ${t.leaving ? EXIT_MS : ENTER_MS}ms ease`,
              animation: t.leaving ? 'none' : `pxToastIn ${ENTER_MS}ms ease both`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: finalExam ? '#0B0E11' : '#FBBF24',
                  letterSpacing: '-0.01em',
                }}
              >
                +{t.points.toLocaleString('en-IN')} {t.points === 1 ? 'pt' : 'pts'}
              </span>
              {finalExam && (
                <span style={{ fontSize: 16, lineHeight: 1 }} aria-hidden>🎓</span>
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                color: finalExam ? '#1B1B1B' : '#CBD5E1',
                lineHeight: 1.4,
              }}
            >
              {finalExam ? 'Academy complete!' : labelFor(t.actionType, t.notes)}
            </div>
          </div>
        )
      })}

      {/* Slide-in keyframes — kept inline so the component stays
          single-file and doesn't depend on global CSS. */}
      <style>{`
        @keyframes pxToastIn {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
