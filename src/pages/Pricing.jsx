import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import PineXMark from '../components/PineXMark'

import Icon from '../components/ui/Icon'
// ── /pricing ────────────────────────────────────────────────────────────────
// "Coming soon" placeholder. No prices are displayed — pricing tiers and the
// payment surface are still being finalised. Until then this page exists to
// (a) catch every existing CTA / Pro-gate link in the app so users don't hit
// a 404, and (b) collect interest via the waitlist CTA.
//
// IMPORTANT: do NOT add a numeric price here without product + legal sign-off.
// Once we ship paid tiers, Terms & Privacy must include refund / cancellation
// language (already added in June 2026 update) — re-read them before launch.

const C = {
  bg: 'var(--bg-primary)',
  surface: 'var(--bg-surface)',
  card: 'var(--bg-elevated)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  textMuted: 'var(--text-muted)',
  textFaint: 'var(--text-disabled)',
  accent: 'var(--info)',
  amber: '#FBBF24',
}

const PLANNED_FEATURES = [
  {
    icon: 'ti-stack-2',
    title: 'Full screener access',
    desc: 'Every SwingX criterion, every filter, every sector — unlocked.',
  },
  {
    icon: 'ti-bell-ringing',
    title: 'Personal watchlist alerts',
    desc: 'Stage changes and criteria matches delivered to your inbox or Telegram.',
  },
  {
    icon: 'ti-chart-histogram',
    title: 'Deeper cycle narratives',
    desc: 'Extended cycle commentary, sector-flow tie-ins, and weekly briefs.',
  },
  {
    icon: 'ti-history',
    title: 'Historical archive',
    desc: 'Multi-year price + delivery history, replay any past criteria state.',
  },
]

export default function Pricing() {
  const navigate = useNavigate()

  return (
    <>
      <Helmet>
        <title>Pricing — PineX</title>
        <meta
          name="description"
          content="PineX paid tiers are launching soon. Educational data only — not investment advice. Join the waitlist to be notified."
        />
      </Helmet>

      <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
        {/* Header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 40,
            background: C.bg,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            height: 52,
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              background: 'none',
              border: 'none',
              color: C.textMuted,
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
            aria-label="Go back"
          >
            <Icon name="arrow-left" style={{ fontSize: 20 }} />
          </button>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>
            Pricing
          </span>
        </div>

        {/* Content */}
        <div
          style={{
            maxWidth: 680,
            margin: '0 auto',
            padding: '48px 20px 96px',
            textAlign: 'center',
          }}
        >
          {/* Coming-soon badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              background: 'rgba(251, 191, 36, 0.10)',
              border: '1px solid rgba(251, 191, 36, 0.30)',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              color: C.amber,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 24,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: C.amber,
                display: 'inline-block',
              }}
            />
            Coming soon
          </div>

          {/* Hero */}
          <h1
            style={{
              margin: '0 0 14px',
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            <PineXMark /> Pro is on the way
          </h1>
          <p
            style={{
              margin: '0 auto 32px',
              maxWidth: 520,
              fontSize: 15,
              color: C.textMuted,
              lineHeight: 1.7,
            }}
          >
            We're finalising the paid tier. Until then, every existing feature
            stays free. When pricing goes live, you'll see it here first.
          </p>

          {/* Planned features */}
          <div
            style={{
              background: C.surface,
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '24px 20px',
              marginBottom: 32,
              textAlign: 'left',
            }}
          >
            <p
              style={{
                margin: '0 0 18px',
                fontSize: 11,
                fontWeight: 700,
                color: C.textMuted,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                textAlign: 'center',
              }}
            >
              What Pro will include
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {PLANNED_FEATURES.map((f) => (
                <div
                  key={f.title}
                  style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'var(--info-dim)',
                      border: '1px solid var(--info-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <i
                      className={`ti ${f.icon}`}
                      style={{ fontSize: 17, color: C.accent }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 700,
                        color: C.text,
                      }}
                    >
                      {f.title}
                    </p>
                    <p
                      style={{
                        margin: '3px 0 0',
                        fontSize: 13,
                        color: C.textMuted,
                        lineHeight: 1.6,
                      }}
                    >
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CTAs */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              maxWidth: 340,
              margin: '0 auto',
            }}
          >
            <button
              type="button"
              onClick={() => navigate('/home')}
              style={{
                width: '100%',
                padding: '13px 0',
                background: C.accent,
                color: 'var(--bg-primary)',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: '-0.01em',
              }}
            >
              Continue exploring PineX (free)
            </button>
            <Link
              to="/methodology"
              style={{
                width: '100%',
                padding: '12px 0',
                background: 'transparent',
                color: C.textMuted,
                border: '1px solid var(--border)',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'center',
                textDecoration: 'none',
                boxSizing: 'border-box',
              }}
            >
              See how we calculate criteria
            </Link>
          </div>

          {/* Legal footer */}
          <p
            style={{
              marginTop: 40,
              fontSize: 11,
              color: C.textFaint,
              lineHeight: 1.7,
              fontStyle: 'italic',
            }}
          >
            Educational data only. Not investment advice. PineX is not a SEBI
            registered investment advisor. Pricing, refund, and cancellation
            terms will be published in our{' '}
            <Link to="/terms" style={{ color: C.textMuted, textDecoration: 'underline' }}>
              Terms of Service
            </Link>{' '}
            before any paid tier launches.
          </p>
        </div>
      </div>
    </>
  )
}
