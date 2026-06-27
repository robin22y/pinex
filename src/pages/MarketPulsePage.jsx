import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import MarketPulse from '../components/MarketPulse'
import PineXMark from '../components/PineXMark'
import { C } from '../styles/tokens'

export default function MarketPulsePage() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  useEffect(() => {
    // Sample data - in production this would come from your API
    setData({
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
      breadth: 55.3,
      breadth_change: 2.1,
      advances: 654,
      advances_change: 8.7,
      declines: 1450,
      declines_change: 6.1,
      ad_ratio: 0.45,
      vix: 13.4,
      vix_change: -4.2,
      highs52: 105,
      lows52: 35,
      stages: {
        advancing: { value: 992, change: 7.5, icon: '🐂' },
        basing: { value: 594, change: 3.1, icon: '〰️' },
        topping: { value: 162, change: -4.6, icon: '∧' },
        declining: { value: 259, change: -5.2, icon: '🐻' }
      },
      strongest_sectors: [
        { name: 'IT', change: 2.8 },
        { name: 'Capital Goods', change: 2.3 },
        { name: 'Auto', change: 1.9 }
      ],
      weakest_sectors: [
        { name: 'FMCG', change: -1.6 },
        { name: 'Realty', change: -1.2 },
        { name: 'Media', change: -0.8 }
      ]
    })
  }, [])

  if (!data) return <div style={{ padding: '20px', color: '#A0AAB8' }}>Loading...</div>

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <header
        style={{
          borderBottom: `1px solid ${C.border}`,
          padding: '16px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: C.surfaceCard,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <PineXMark size={24} />
          <span style={{ fontSize: '18px', fontWeight: 600, color: C.text }}>PineX</span>
        </div>

        <nav style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: C.textSecondary,
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.target.style.color = C.text)}
            onMouseLeave={(e) => (e.target.style.color = C.textSecondary)}
          >
            Home
          </button>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: C.textSecondary,
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.target.style.color = C.text)}
            onMouseLeave={(e) => (e.target.style.color = C.textSecondary)}
          >
            Share
          </button>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: C.textSecondary,
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.target.style.color = C.text)}
            onMouseLeave={(e) => (e.target.style.color = C.textSecondary)}
          >
            Sign in
          </button>
        </nav>
      </header>

      {/* Content */}
      <main style={{ padding: '32px' }}>
        <MarketPulse data={data} />
      </main>
    </div>
  )
}
