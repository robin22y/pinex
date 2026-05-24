import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { useAcademy } from '../hooks/useAcademy'

/**
 * AcademyGate — wraps a protected route.
 *
 * Behaviour matrix (user logged in, profile loaded, modules published):
 *
 *   hasScreenerAccess              Deadline state       → Render
 *   ────────────────────────────   ──────────────────   ───────────────────
 *   true (grandfathered)           expired + !completed → <DeadlinePassed/>
 *   true (grandfathered)           ≤ 5 days + !completed → <DeadlineBanner/> + children
 *   true (grandfathered/completed) otherwise            → children
 *   false                          deadline ≤ 0          → <DeadlinePassed/>
 *   false                          deadline > 0 or null  → <AcademyRequired/>
 *
 * Fail-open safeguards (do not break the app while DB is empty / loading):
 *   - Anonymous users pass through.
 *   - While auth/modules are loading, pass through.
 *   - If no academy modules are published, pass through.
 */
export default function AcademyGate({ children }) {
  const { user, profile, loading: authLoading } = useAuth()
  const { modules, hasScreenerAccess, loading: academyLoading } = useAcademy()

  if (!user || !profile) return children
  if (authLoading || academyLoading) return children
  if (!modules || modules.length === 0) return children

  // HOW IT'S DERIVED
  //   daysLeft = ceil((deadline − now) / 1 day)
  // > 0  = deadline still in the future
  // = 0  = deadline today (treated as expired)
  // < 0  = deadline already passed
  // null = no deadline column set (legacy users)
  const deadline = profile.academy_deadline
  const daysLeft =
    deadline != null
      ? Math.ceil(
          (new Date(deadline) - new Date()) /
            (1000 * 60 * 60 * 24),
        )
      : null
  const deadlinePassed = daysLeft !== null && daysLeft <= 0

  if (hasScreenerAccess) {
    // Grandfathered who let the deadline lapse → lock out.
    if (deadlinePassed && !profile.academy_completed) {
      return <DeadlinePassed />
    }
    // Approaching deadline (5d window) and not yet
    // completed → show inline banner but allow access.
    if (
      daysLeft !== null &&
      daysLeft <= 5 &&
      !profile.academy_completed
    ) {
      return (
        <>
          <DeadlineBanner daysLeft={daysLeft} />
          {children}
        </>
      )
    }
    return children
  }

  // No screener access — must complete academy.
  if (deadlinePassed) {
    return <DeadlinePassed />
  }
  return <AcademyRequired daysLeft={daysLeft} />
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

function AcademyRequired({ daysLeft }) {
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
        <div style={{ fontSize: 56 }}>🎓</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--text-primary)',
            marginTop: 16,
            marginBottom: 8,
            letterSpacing: '-0.02em',
          }}
        >
          Complete the academy first
        </div>
        <div
          style={{
            fontSize: 14,
            color: 'var(--text-muted)',
            lineHeight: 1.7,
            marginBottom: 8,
          }}
        >
          Pass Module 1 to unlock the stock screener. Takes about 8 minutes.
        </div>

        {daysLeft !== null && daysLeft > 0 && (
          <div
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
              marginBottom: 24,
            }}
          >
            ⏰ {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
          </div>
        )}

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
            marginTop: 16,
            marginBottom: 10,
          }}
        >
          Start PineX Academy →
        </button>

        <button
          onClick={() => navigate('/profile')}
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
          Go to profile
        </button>
      </div>
    </div>
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
