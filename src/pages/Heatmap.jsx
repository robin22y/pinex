import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import HeatMap from '../components/HeatMap'

/** Standalone heatmap route for terminal Home sidebar. */
export default function Heatmap() {
  const navigate = useNavigate()
  return (
    <>
      <Helmet>
        <title>NSE Sector Heatmap — Market Breadth | PineX</title>
        <meta
          name="description"
          content="Visual heatmap of Nifty sector performance and market breadth. Spot leading and lagging sectors across Indian equities."
        />
      </Helmet>
    <div style={{ minHeight: '100vh', background: '#0B0E11', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid #1E2530',
          background: '#0F1217',
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
            background: '#141820',
            color: '#E2E8F0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <i className="ti ti-home" style={{ fontSize: 17 }} aria-hidden />
          Home
        </button>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#E2E8F0' }}>Heat map</span>
      </div>
      <div style={{ flex: 1, padding: 16 }}>
        <HeatMap navigate={navigate} />
      </div>
    </div>
    </>
  )
}
