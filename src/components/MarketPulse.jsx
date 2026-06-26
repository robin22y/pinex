import { useState, useEffect } from 'react'
import { C } from '../styles/tokens'

export default function MarketPulse({ data }) {
  const [pulseData, setPulseData] = useState(normalizeData(data))

  useEffect(() => {
    setPulseData(normalizeData(data))
  }, [data])

  function normalizeData(d) {
    return {
      date: d?.date || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
      breadth: d?.breadth || 55.3,
      breadth_change: d?.breadth_change || 2.1,
      advances: d?.advances || 654,
      advances_change: d?.advances_change || 8.7,
      declines: d?.declines || 1450,
      declines_change: d?.declines_change || 6.1,
      ad_ratio: d?.ad_ratio || 0.45,
      vix: d?.vix || 13.4,
      vix_change: d?.vix_change || -4.2,
      highs52: d?.highs52 || 105,
      lows52: d?.lows52 || 35,
      stages: d?.stages || {
        advancing: { value: 992, change: 7.5, icon: '🐂' },
        basing: { value: 594, change: 3.1, icon: '〰️' },
        topping: { value: 162, change: -4.6, icon: '∧' },
        declining: { value: 259, change: -5.2, icon: '🐻' }
      },
      strongest_sectors: d?.strongest_sectors || [
        { name: 'IT', change: 2.8 },
        { name: 'Capital Goods', change: 2.3 },
        { name: 'Auto', change: 1.9 }
      ],
      weakest_sectors: d?.weakest_sectors || [
        { name: 'FMCG', change: -1.6 },
        { name: 'Realty', change: -1.2 },
        { name: 'Media', change: -0.8 }
      ]
    }
  }

  function generateSparkline(values, color = 'currentColor') {
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max - min || 1
    const points = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * 100
        const y = 40 - ((v - min) / range) * 40
        return `${x},${y}`
      })
      .join(' ')

    return (
      <svg style={{ width: '100%', height: '24px', marginTop: '2px' }} viewBox="0 0 100 40" preserveAspectRatio="none">
        <polyline points={points} stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    )
  }

  function generateGauge(value) {
    const angle = (value / 100) * 180 - 90
    const rad = (angle * Math.PI) / 180
    const x = 160 + 110 * Math.cos(rad)
    const y = 140 + 110 * Math.sin(rad)

    return (
      <svg style={{ width: '100%', maxWidth: '280px', height: '120px', overflow: 'visible' }} viewBox="0 0 320 160">
        <defs>
          <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: '#FF6464', stopOpacity: 1 }} />
            <stop offset="50%" style={{ stopColor: '#FFC107', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: '#06E5FF', stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <path d="M 40 140 A 110 110 0 0 1 280 140" stroke="url(#gauge-grad)" strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M 40 140 A 110 110 0 0 1 280 140" stroke="rgba(6, 229, 255, 0.1)" strokeWidth="10" fill="none" strokeLinecap="round" opacity="0.3" />
        <line x1="160" y1="140" x2={x} y2={y} stroke="#E0E8F5" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="160" cy="140" r="6" fill="#E0E8F5" />
      </svg>
    )
  }

  const advances = [5, 8, 12, 15, 18, 22, 25, 28, 30, 35]
  const declines = [35, 32, 28, 25, 22, 18, 15, 12, 10, 5]

  return (
    <div
      style={{
        width: '100%',
        background: 'linear-gradient(135deg, #0F1419 0%, #1A1F2E 100%)',
        padding: '32px 48px',
        borderRadius: '16px',
        color: '#E0E8F5',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          paddingBottom: '16px',
          borderBottom: '1px solid rgba(6, 229, 255, 0.2)',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #06E5FF, #00B4FF)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0F1419',
              fontWeight: 700,
              fontSize: '18px',
            }}
          >
            PX
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 600 }}>pinex.in</div>
            <div style={{ fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#06E5FF', fontWeight: 500 }}>
              Market Pulse
            </div>
          </div>
        </div>
        <div style={{ fontSize: '13px', color: '#A0AAB8', padding: '8px 16px', border: '1px solid rgba(160, 170, 184, 0.3)', borderRadius: '20px' }}>
          📅 {pulseData.date}
        </div>
      </div>

      {/* Headline Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '24px', alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: '12px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A0AAB8', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Breadth Reading
            <div style={{ display: 'flex', gap: '2px' }}>
              <span style={{ width: '3px', height: '12px', background: '#06E5FF', borderRadius: '1px' }}></span>
              <span style={{ width: '3px', height: '12px', background: '#06E5FF', borderRadius: '1px' }}></span>
              <span style={{ width: '3px', height: '12px', background: '#06E5FF', borderRadius: '1px' }}></span>
            </div>
          </div>
          <h1 style={{ fontSize: '48px', fontWeight: 700, background: 'linear-gradient(135deg, #06E5FF, #00D9FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.1, marginBottom: '12px' }}>
            {pulseData.breadth >= 50 ? 'Improving Breadth' : 'Weakening Breadth'}
          </h1>
          <p style={{ fontSize: '15px', color: '#A0AAB8', lineHeight: 1.6 }}>
            {pulseData.breadth >= 50 ? 'More stocks are participating in the move.' : 'Market participation is narrowing.'}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          {generateGauge(pulseData.breadth)}
          <div style={{ fontSize: '12px', color: '#06E5FF', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>
            Positive Breadth
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(6, 229, 255, 0.15)', borderRadius: '12px', borderColor: 'rgba(6, 229, 255, 0.3)' }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A0AAB8', fontWeight: 500 }}>
            Breadth
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#06E5FF', margin: 0, lineHeight: 1.1 }}>
            {pulseData.breadth}%
          </div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: '#06E5FF', margin: 0, lineHeight: 1 }}>
            ↑ Improving
          </div>
          {generateSparkline([40, 42, 44, 46, 48, 50, 52, 53, 54, 55.3], '#06E5FF')}
        </div>

        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(6, 229, 255, 0.15)', borderRadius: '12px', borderColor: 'rgba(6, 229, 255, 0.3)' }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A0AAB8', fontWeight: 500 }}>
            Advances
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#06E5FF', margin: 0, lineHeight: 1.1 }}>
            {pulseData.advances.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: '#06E5FF', margin: 0, lineHeight: 1 }}>
            ↑ {pulseData.advances_change}% vs yesterday
          </div>
          {generateSparkline(advances, '#06E5FF')}
        </div>

        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 100, 100, 0.2)', borderRadius: '12px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A0AAB8', fontWeight: 500 }}>
            Declines
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#FF6464', margin: 0, lineHeight: 1.1 }}>
            {pulseData.declines.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: '#FF6464', margin: 0, lineHeight: 1 }}>
            ↓ {pulseData.declines_change}% vs yesterday
          </div>
          {generateSparkline(declines, '#FF6464')}
        </div>
      </div>

      {/* Secondary Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(6, 229, 255, 0.1)', borderRadius: '12px', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A0AAB8', fontWeight: 500 }}>
            A/D Ratio
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#E0E8F5' }}>{pulseData.ad_ratio}</div>
        </div>
        <div>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A0AAB8', fontWeight: 500 }}>
            VIX
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#E0E8F5' }}>
            {pulseData.vix} <span style={{ fontSize: '11px', color: pulseData.vix_change >= 0 ? '#FF6464' : '#06E5FF' }}>
              {pulseData.vix_change >= 0 ? '↑' : '↓'} {Math.abs(pulseData.vix_change)}%
            </span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A0AAB8', fontWeight: 500 }}>
            52W H/L
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#E0E8F5' }}>
            <span style={{ color: '#06E5FF' }}>{pulseData.highs52}</span> / <span style={{ color: '#FF6464' }}>{pulseData.lows52}</span>
          </div>
        </div>
      </div>

      {/* Structure Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', margin: '16px 0' }}>
        {Object.entries(pulseData.stages).map(([key, stage]) => (
          <div
            key={key}
            style={{
              padding: '14px 12px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(6, 229, 255, 0.1)',
              borderColor: key === 'advancing' ? 'rgba(6, 229, 255, 0.3)' : key === 'declining' ? 'rgba(255, 100, 100, 0.2)' : 'rgba(6, 229, 255, 0.1)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                fontSize: '20px',
                background: key === 'advancing' ? 'rgba(6, 229, 255, 0.15)' : key === 'basing' ? 'rgba(255, 193, 7, 0.15)' : key === 'topping' ? 'rgba(255, 140, 20, 0.15)' : 'rgba(255, 100, 100, 0.15)',
              }}
            >
              {stage.icon}
            </div>
            <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A0AAB8', fontWeight: 500 }}>
              {key}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#E0E8F5', margin: 0, lineHeight: 1.1 }}>
              {stage.value.toLocaleString()}
            </div>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 500,
                color: stage.change >= 0 ? '#06E5FF' : '#FF6464',
                margin: 0,
                lineHeight: 1,
              }}
            >
              {stage.change >= 0 ? '▲' : '▼'} {Math.abs(stage.change)}%
            </div>
          </div>
        ))}
      </div>

      {/* Sectors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', margin: '16px 0' }}>
        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(6, 229, 255, 0.2)', borderRadius: '12px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '8px', color: '#06E5FF', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>📈</span>
            Strongest Sectors
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {pulseData.strongest_sectors.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: '4px 10px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(6, 229, 255, 0.3)',
                  borderRadius: '16px',
                  fontSize: '11px',
                  color: '#06E5FF',
                  fontWeight: 500,
                }}
              >
                {s.name} <span style={{ fontSize: '9px', opacity: 0.8 }}>▲ {s.change}%</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 100, 100, 0.15)', borderRadius: '12px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '8px', color: '#FF6464', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>📉</span>
            Weakest Sectors
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {pulseData.weakest_sectors.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: '4px 10px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 100, 100, 0.3)',
                  borderRadius: '16px',
                  fontSize: '11px',
                  color: '#FF6464',
                  fontWeight: 500,
                }}
              >
                {s.name} <span style={{ fontSize: '9px', opacity: 0.8 }}>▼ {s.change}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ fontSize: '10px', color: '#6A727E', paddingTop: '8px', borderTop: '1px solid rgba(6, 229, 255, 0.1)', textAlign: 'center' }}>
        🛡️ Data only • Not investment advice • Not SEBI registered • Visit <a href="https://www.pinex.in" style={{ color: '#06E5FF', textDecoration: 'none' }}>
          www.pinex.in
        </a>
      </div>
    </div>
  )
}
