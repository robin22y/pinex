import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import HeatMap from '../components/HeatMap'
import { useAuth } from '../context'

import Icon from '../components/ui/Icon'
/** Standalone heatmap route for terminal Home sidebar. */
export default function Heatmap() {
  const navigate = useNavigate()
  const { user } = useAuth()

  if (!user) {
    return (
      <>
        <Helmet>
          <title>NSE Sector Heatmap — Market Breadth | PineX</title>
        </Helmet>
        <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <button type="button" onClick={() => navigate('/')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, border: '1px solid #1E293B', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="home" style={{ fontSize: 17 }} aria-hidden />
              Home
            </button>
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>Heat map</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16, textAlign: 'center' }}>
            <Icon name="layout-grid" style={{ fontSize: 48, color: 'var(--text-hint)' }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Sector Map</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 280, lineHeight: 1.6 }}>
              See which sectors are leading the market today. Sign in free to access the full sector map.
            </div>
            <button
              onClick={() => navigate('/login')}
              style={{ padding: '10px 24px', borderRadius: 8, background: 'var(--accent)', border: 'none', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Sign in free →
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Helmet>
        <title>NSE Sector Heatmap — Market Breadth | PineX</title>
        <meta
          name="description"
          content="Visual heatmap of Nifty sector performance and market breadth. Spot leading and lagging sectors across Indian equities."
        />
      </Helmet>
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          title="Home"
          aria-label="Go to Home"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #1E293B',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Icon name="home" style={{ fontSize: 17 }} aria-hidden />
          Home
        </button>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>Heat map</span>
      </div>
      <div style={{ flex: 1, padding: 16 }}>
        <HeatMap navigate={navigate} />
      </div>
      <div style={{ padding: '8px 16px', fontSize: 10, color: 'var(--text-disabled)', textAlign: 'center', borderTop: '1px solid var(--border)', lineHeight: 1.6 }}>
        Data is for educational purposes only. Not investment advice.
      </div>
    </div>
    </>
  )
}
