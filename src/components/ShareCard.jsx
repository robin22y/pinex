import { C } from '../styles/tokens'

function statusColor(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'red') return C.red
  if (s === 'amber') return C.amber
  if (s === 'green') return C.green
  return C.textMuted
}

function formatHeadline(headline, severity) {
  const text = String(headline || '').replaceAll('_', ' ')
  const s = String(severity || '').toLowerCase()
  const prefix = s === 'high' ? '⚠️' : '✅'
  return `${prefix} ${text || 'No major changes this quarter'}`
}

export default function ShareCard({
  companyName,
  symbol,
  headline,
  headlineSeverity,
  signals = [],
  swingCount = 0,
  deliveryPct = 0,
  deliveryVs = 0,
  watchText = '',
  quarter = '',
}) {
  const visibleSignals = signals
    .filter((s) => {
      const name = String(s?.name || '').toLowerCase()
      return name !== 'market behaviour' && name !== 'delivery'
    })
    .slice(0, 4)

  return (
    <div
      style={{
        width: 360,
        fontFamily: '"DM Sans", sans-serif',
        background: 'linear-gradient(135deg, #0D1525, #080C14)',
        border: '1px solid #1E293B',
        borderRadius: 16,
        padding: 22,
        color: C.text,
      }}
    >
      <div style={{ height: 3, background: '#38BDF8', borderRadius: 999, marginBottom: 14 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#E2E8F0' }}>{companyName}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748B' }}>{symbol}</p>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: '#64748B' }}>PineX</p>
      </div>

      <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.5, fontWeight: 700, color: statusColor(headlineSeverity) }}>
        {formatHeadline(headline, headlineSeverity)}
      </p>

      <div style={{ height: 1, background: '#1E293B', margin: '14px 0' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {visibleSignals.map((s, idx) => (
          <div key={`${s?.name || 'signal'}-${idx}`} style={{ border: '1px solid #1E293B', borderRadius: 10, padding: '8px 9px' }}>
            <p style={{ margin: 0, fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, display: 'inline-block', background: statusColor(s?.status) }} />
              <span style={{ color: '#E2E8F0' }}>{s?.name || 'Signal'}</span>
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#64748B' }}>{s?.label || ''}</p>
          </div>
        ))}
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 12, color: '#E2E8F0' }}>
        Swing conditions: {swingCount}/5 present today
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#E2E8F0' }}>
        Delivery: {Number(deliveryPct || 0).toFixed(1)}% today ({Number(deliveryVs || 0).toFixed(1)}x normal)
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748B', fontStyle: 'italic' }}>
        👁️ {watchText || 'Watch next quarter developments closely.'}
      </p>

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #1E293B', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: '#64748B' }}>{quarter || '-'}</span>
        <span style={{ color: '#64748B' }}>pinex.in/{symbol}</span>
      </div>
    </div>
  )
}
