import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { useAcademy } from '../hooks/useAcademy'

/**
 * AcademyGate — wraps a protected route.
 *
 * Props:
 *   level — 'screener' (default) | 'swingx' | 'advanced'
 *           Drives which set of modules must be
 *           read before the gate opens. Picks
 *           the matching access flag from
 *           useAcademy and forwards it (plus the
 *           still-needed module ids) to the
 *           AcademyRequired bottom sheet so its
 *           copy adapts.
 *
 * Behaviour matrix (user logged in, profile loaded, modules published):
 *
 *   hasAccess for `level`           Deadline state          → Render
 *   ────────────────────────────   ─────────────────────   ───────────────────
 *   true (grandfathered)           expired + !completed    → <DeadlinePassed/>
 *   true (grandfathered)           ≤ 5 days + !completed   → <DeadlineBanner/> + soft <AcademyRequired/> (≤3 days, dismissible) + children
 *   true (grandfathered/completed) otherwise               → children
 *   false                          deadline ≤ 0            → <DeadlinePassed/>
 *   false                          deadline > 0 or null    → hard <AcademyRequired level={level}/>
 *
 * Fail-open safeguards:
 *   - Anonymous users pass through.
 *   - While auth/modules are loading, pass through.
 *   - If no academy modules are published, pass through.
 *
 * AcademyRequired is also exported as a NAMED export
 * so other pages (e.g. Home → sectors view) can render
 * it on demand for click-time gating.
 */
export default function AcademyGate({ children, level = 'screener' }) {
  const { user, profile, loading: authLoading } = useAuth()
  const {
    modules,
    hasScreenerAccess,
    hasSwingXAccess,
    hasAdvancedAccess,
    nextRequiredForScreener,
    nextRequiredForSwingX,
    nextRequiredForAdvanced,
    loading: academyLoading,
  } = useAcademy()
  const [softDismissed, setSoftDismissed] = useState(() => {
    // WHY: sessionStorage so the soft bottom sheet
    // doesn't re-appear on every page navigation.
    // It comes back next time the user opens the app.
    try { return sessionStorage.getItem('academy_soft_dismissed') === '1' }
    catch { return false }
  })

  if (!user || !profile) return children
  if (authLoading || academyLoading) return children
  if (!modules || modules.length === 0) return children

  const deadline = profile.academy_deadline
  const daysLeft =
    deadline != null
      ? Math.ceil(
          (new Date(deadline) - new Date()) /
            (1000 * 60 * 60 * 24),
        )
      : null
  const deadlinePassed = daysLeft !== null && daysLeft <= 0

  // Pick the access flag + outstanding module
  // list that matches the requested level.
  const hasAccess =
    level === 'swingx'
      ? hasSwingXAccess
      : level === 'advanced'
      ? hasAdvancedAccess
      : hasScreenerAccess

  const nextRequired =
    level === 'swingx'
      ? nextRequiredForSwingX
      : level === 'advanced'
      ? nextRequiredForAdvanced
      : nextRequiredForScreener

  const dismissSoft = () => {
    try { sessionStorage.setItem('academy_soft_dismissed', '1') } catch {}
    setSoftDismissed(true)
  }

  if (hasAccess) {
    if (deadlinePassed && !profile.academy_completed) {
      return <DeadlinePassed />
    }
    if (
      daysLeft !== null &&
      daysLeft <= 5 &&
      !profile.academy_completed
    ) {
      return (
        <>
          <DeadlineBanner daysLeft={daysLeft} />
          {children}
          {daysLeft <= 3 && !softDismissed && (
            <AcademyRequired
              variant="soft"
              level={level}
              daysLeft={daysLeft}
              nextRequired={nextRequired}
              onClose={dismissSoft}
            />
          )}
        </>
      )
    }
    return children
  }

  if (deadlinePassed) {
    return <DeadlinePassed />
  }
  // Hard gate — no onClose, can only navigate to /learn or back
  return (
    <AcademyRequired
      level={level}
      daysLeft={daysLeft}
      nextRequired={nextRequired}
    />
  )
}

// Per-level copy + module list shown in the
// "Required to unlock" panel. Keep these labels
// in sync with the academy_modules titles so
// users see consistent names.
const LEVEL_MESSAGES = {
  screener: {
    title: 'Complete 2 modules to unlock',
    subtitle: 'Screener · Stage list · Heatmap',
    modules: ['Core Foundation', 'Volume Rules'],
    time: '~15 minutes',
  },
  swingx: {
    title: 'Complete 4 modules to unlock',
    subtitle: 'SwingX · Advanced signals',
    modules: [
      'Core Foundation',
      'Volume Rules',
      'Stage 2 Advancing',
      'RS & Selection',
    ],
    time: '~35 minutes',
  },
  advanced: {
    title: 'Complete all 8 modules to unlock',
    subtitle: 'Full advanced access',
    modules: ['All 8 modules'],
    time: '~60 minutes',
  },
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function DeadlineBanner({ daysLeft }) {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const urgent = daysLeft <= 2

  return (
    <div
      style={{
        background: urgent
          ? 'rgba(255,59,48,0.1)'
          : 'rgba(251,191,36,0.1)',
        border: `1px solid ${
          urgent
            ? 'rgba(255,59,48,0.3)'
            : 'rgba(251,191,36,0.3)'
        }`,
        borderRadius: 10,
        padding: '10px 16px',
        margin: '0 12px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{urgent ? '🚨' : '⏰'}</span>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: urgent ? 'var(--negative)' : 'var(--warning)',
            }}
          >
            {daysLeft === 1
              ? 'Last day to complete PineX Academy'
              : `${daysLeft} days left to complete PineX Academy`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Complete the quiz to keep full access
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate('/learn')}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            background: urgent ? 'var(--negative)' : 'var(--warning)',
            color: '#000',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Start now →
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/**
 * AcademyRequired — bottom-sheet modal.
 *
 * Props:
 *   daysLeft  — days until academy_deadline.
 *               If > 0 a "⏰ N days remaining"
 *               pill renders above the CTAs.
 *   onClose   — optional. If provided, a × button
 *               appears top-right and the back
 *               button is omitted (the consumer
 *               manages dismissal). Without it,
 *               the sheet is a true gate — only
 *               escape is "Start academy" or "Go back".
 *   variant   — 'hard' (default) shows the strict
 *               "Complete the academy first" copy.
 *               'soft' uses friendlier framing for
 *               grandfathered users who still have
 *               access but should be nudged before
 *               their deadline expires.
 *
 * Behaviour:
 *   - Backdrop is blurred so the page underneath
 *     is visible but un-interactive (creates
 *     curiosity rather than a hard wall).
 *   - Slides up from the bottom on mount via a
 *     30ms-delayed transform toggle — works the
 *     same way iOS Safari sheets animate.
 */
export function AcademyRequired({
  daysLeft,
  onClose,
  variant = 'hard',
  level = 'screener',
  // eslint-disable-next-line no-unused-vars
  nextRequired,
}) {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

  // Animate in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  const isSoft = variant === 'soft'
  const msg = LEVEL_MESSAGES[level] || LEVEL_MESSAGES.screener

  // Soft prompt keeps its friendly framing
  // regardless of level (it fires for
  // grandfathered users who still have access);
  // hard gate adopts the level-specific copy
  // from LEVEL_MESSAGES so the user sees exactly
  // which modules unlock the section they hit.
  const title = isSoft ? 'Make every signal count' : msg.title

  const description = isSoft
    ? 'Your access continues — but completing the academy will deepen your understanding of every signal you see here.'
    : msg.subtitle

  return (
    <>
      {/* Blurred backdrop — the page is visible but un-interactive */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: 900,
        }}
      />

      {/* Bottom sheet */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 901,
          background: 'var(--bg-surface)',
          borderRadius: '20px 20px 0 0',
          borderTop: '1px solid var(--border)',
          padding: '20px 20px 40px',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition:
            'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
          maxWidth: 520,
          margin: '0 auto',
        }}
      >
        {/* Close button — only when consumer manages dismissal */}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Dismiss"
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 18,
              padding: 4,
            }}
          >
            ✕
          </button>
        )}

        {/* Handle bar */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: 'var(--border)',
            margin: '0 auto 20px',
          }}
        />

        {/* Icon */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(0,200,5,0.12)',
              border: '1px solid rgba(0,200,5,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              margin: '0 auto',
            }}
          >
            🎓
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--text-primary)',
            textAlign: 'center',
            marginBottom: 8,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 14,
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.7,
            marginBottom: 20,
            padding: '0 8px',
          }}
        >
          {description}
        </div>

        {/* Required to unlock — only on hard gate.
            Soft prompt skips this to stay friendly. */}
        {!isSoft && (
          <div
            style={{
              background: 'var(--bg-elevated)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 8,
              }}
            >
              Required to unlock
            </div>
            {msg.modules.map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  fontSize: 12,
                }}
              >
                <span style={{ color: 'var(--accent)', fontSize: 10 }}>✓</span>
                <span style={{ color: 'var(--text-secondary)' }}>{m}</span>
              </div>
            ))}
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--border)',
              }}
            >
              ⏱ {msg.time} total
            </div>
          </div>
        )}

        {/* Benefits list */}
        <div
          style={{
            background: 'var(--bg-elevated)',
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 20,
          }}
        >
          {[
            { icon: '⏱', text: 'Takes only 8 minutes' },
            { icon: '🔓', text: 'Unlocks screener, heatmap and sectors' },
            { icon: '📊', text: 'You will actually understand what you see' },
            { icon: '🏆', text: 'Get a shareable certificate on completion' },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: i < 3 ? 10 : 0,
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {item.text}
              </span>
            </div>
          ))}
        </div>

        {/* Days left pill */}
        {daysLeft !== null && daysLeft > 0 && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 14px',
                borderRadius: 20,
                background:
                  daysLeft <= 3
                    ? 'rgba(255,59,48,0.1)'
                    : 'rgba(251,191,36,0.1)',
                border: `1px solid ${
                  daysLeft <= 3
                    ? 'rgba(255,59,48,0.3)'
                    : 'rgba(251,191,36,0.3)'
                }`,
                fontSize: 12,
                fontWeight: 700,
                color:
                  daysLeft <= 3 ? 'var(--negative)' : 'var(--warning)',
              }}
            >
              ⏰ {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
            </span>
          </div>
        )}

        {/* Primary CTA — always present */}
        <button
          onClick={() => navigate('/learn')}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 10,
            border: 'none',
            background: '#00C805',
            color: '#000',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          Start PineX Academy →
        </button>

        {/* Secondary — back button only when no onClose
            (i.e. used as a hard gate, not dismissible) */}
        {!onClose && (
          <button
            onClick={() => navigate(-1)}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Go back
          </button>
        )}

        {/* SEBI note */}
        <div
          style={{
            marginTop: 16,
            fontSize: 10,
            color: 'var(--text-disabled)',
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          PineX Academy is free and takes about 8 minutes. Educational
          purposes only. Not investment advice.
        </div>
      </div>
    </>
  )
}

function DeadlinePassed() {
  const navigate = useNavigate()

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 56 }}>🔒</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--text-primary)',
            marginTop: 16,
            marginBottom: 8,
          }}
        >
          Screener access paused
        </div>
        <div
          style={{
            fontSize: 14,
            color: 'var(--text-muted)',
            lineHeight: 1.7,
            marginBottom: 24,
          }}
        >
          Your 10-day grace period has ended. Complete PineX Academy to
          restore full access. It only takes 8 minutes.
        </div>
        <button
          onClick={() => navigate('/learn')}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 10,
            border: 'none',
            background: '#00C805',
            color: '#000',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          Complete academy now →
        </button>
      </div>
    </div>
  )
}
