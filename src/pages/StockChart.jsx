// StockChart — full-viewport TradingView chart for a single stock.
// Reachable via `/stock/:symbol/chart` (linked from the StockDetail
// "TradingView" button). Minimal header bar at the top; the chart
// fills calc(100vh - 56px) so it gets the whole rest of the screen.

import { useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import TradingViewChart from '../components/TradingViewChart'
import { C } from '../styles/tokens'

const HEADER_HEIGHT = 56

export default function StockChart() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const sym = String(symbol || '').toUpperCase()

  return (
    <div style={{
      minHeight: '100vh',
      background: C.base || '#05070A',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <Helmet>
        <title>{`${sym} — Chart · PineX`}</title>
      </Helmet>

      <div style={{
        height: HEADER_HEIGHT,
        flexShrink: 0,
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 14px',
      }}>
        <button
          type="button"
          onClick={() => navigate(`/stock/${sym}`)}
          aria-label={`Back to ${sym}`}
          style={{
            background: 'transparent',
            border: 'none',
            color: C.text,
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
            padding: '6px 10px',
            borderRadius: 8,
          }}
        >
          ←
        </button>
        <span style={{
          fontSize: 15,
          fontWeight: 700,
          color: C.text,
          letterSpacing: '-0.01em',
        }}>
          {sym}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 11,
          color: C.textMuted,
          letterSpacing: '0.04em',
        }}>
          Powered by TradingView
        </span>
      </div>

      <div style={{
        flex: 1,
        height: `calc(100vh - ${HEADER_HEIGHT}px)`,
        width: '100%',
      }}>
        <TradingViewChart
          symbol={`NSE:${sym}`}
          height={`calc(100vh - ${HEADER_HEIGHT}px)`}
        />
      </div>
    </div>
  )
}
