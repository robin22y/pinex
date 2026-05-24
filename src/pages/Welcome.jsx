import { useNavigate } from 'react-router-dom'

// Welcome screen shown after a user accepts an
// invite. The CTA hierarchy steers new users
// toward the 8-minute academy first — that's
// what actually unlocks the screener — while
// still allowing power users to skip ahead.

export default function Welcome() {
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
      <div
        style={{
          maxWidth: 400,
          width: '100%',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>

        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}
        >
          Welcome to PineX
        </div>

        <div
          style={{
            fontSize: 14,
            color: 'var(--text-muted)',
            lineHeight: 1.7,
            marginBottom: 8,
          }}
        >
          Your access is ready. PineX shows Weinstein Stage Analysis for
          2,100+ NSE stocks.
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(0,200,5,0.08)',
            border: '1px solid rgba(0,200,5,0.2)',
            fontSize: 13,
            color: 'var(--accent)',
            fontWeight: 600,
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>🎓</span>
          Complete the 8-minute academy to unlock the full screener
        </div>

        <div
          style={{
            textAlign: 'left',
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            What to do next
          </div>

          {[
            {
              num: '1',
              title: 'Start PineX Academy first',
              desc: 'Takes 8 minutes. Read the lessons to unlock the full screener and SwingX.',
              highlight: true,
              action: () => navigate('/learn'),
              actionLabel: 'Start learning →',
              color: 'var(--accent)',
            },
            {
              num: '2',
              title: 'Search any NSE stock',
              desc: 'See its Weinstein stage, moving average position, and technical structure.',
              highlight: false,
              color: 'var(--text-muted)',
            },
            {
              num: '3',
              title: 'Check SwingX',
              desc: 'Stocks where all Stage 2 criteria align — unlocked after the academy.',
              highlight: false,
              color: 'var(--text-muted)',
            },
            {
              num: '4',
              title: 'Add stocks to your watchlist',
              desc: 'Track stage changes and price movement from your dashboard.',
              highlight: false,
              color: 'var(--text-muted)',
            },
          ].map((step, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 12,
                marginBottom: i < 3 ? 14 : 0,
                padding: step.highlight ? '12px 14px' : '0',
                borderRadius: step.highlight ? 10 : 0,
                background: step.highlight
                  ? 'rgba(0,200,5,0.08)'
                  : 'transparent',
                border: step.highlight
                  ? '1px solid rgba(0,200,5,0.2)'
                  : 'none',
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: step.highlight
                    ? 'var(--accent)'
                    : 'var(--bg-elevated)',
                  border: step.highlight ? 'none' : '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 800,
                  color: step.highlight ? '#000' : 'var(--text-muted)',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {step.num}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: step.highlight ? 700 : 600,
                    color: step.highlight
                      ? 'var(--accent)'
                      : 'var(--text-primary)',
                    marginBottom: 2,
                  }}
                >
                  {step.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    lineHeight: 1.5,
                  }}
                >
                  {step.desc}
                </div>
                {step.action && (
                  <button
                    onClick={step.action}
                    style={{
                      marginTop: 8,
                      padding: '6px 14px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'var(--accent)',
                      color: '#000',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {step.actionLabel}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Primary CTA — sends them to the academy. */}
        <button
          onClick={() => navigate('/learn')}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent)',
            color: '#000',
            fontSize: 15,
            fontWeight: 800,
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          🎓 Start PineX Academy →
        </button>

        {/* Secondary — equivalent of the old "Go
            to PineX →" button. Sends them to the
            home page so they can poke around
            before learning. */}
        <button
          onClick={() => navigate('/')}
          style={{
            width: '100%',
            padding: '11px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Explore first, learn later
        </button>

        <div
          style={{
            marginTop: 12,
            fontSize: 10,
            color: 'var(--text-disabled)',
          }}
        >
          Educational data only. Not investment advice.
        </div>
      </div>
    </div>
  )
}
