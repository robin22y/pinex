import { useNavigate } from 'react-router-dom'

const STEPS = [
  'Search any NSE stock to see its stage',
  'Check SwingX for aligned stocks',
  'Visit Learn to understand the method',
  'Add stocks to your watchlist',
]

export default function Welcome() {
  const navigate = useNavigate()

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        maxWidth: 400,
        width: '100%',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 32,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>

        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Welcome to PineX
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
          Your access has been activated. You now have access to Stage Analysis for 2,100+ NSE stocks.
        </div>

        <div style={{
          textAlign: 'left',
          background: 'var(--bg-elevated)',
          borderRadius: 8,
          padding: '14px 16px',
          marginBottom: 24,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
          }}>
            What to do next
          </div>
          {STEPS.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
              {step}
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate('/')}
          style={{
            width: '100%',
            padding: 13,
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: '#000',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Go to PineX →
        </button>

        <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-disabled)' }}>
          Educational data only. Not investment advice.
        </div>
      </div>
    </div>
  )
}
