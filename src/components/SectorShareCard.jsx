import { useEffect, useRef, useState } from 'react'
import html2canvas from 'html2canvas'

const fmtPct = (n) =>
  n == null ? '—' : (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%'

const periodLabel = { '1D': '1-Day', '1W': '1-Week', '1M': '1-Month', '3M': '3-Month' }
const changeKey   = { '1D': 'change_1d', '1W': 'change_1w', '1M': 'change_1m', '3M': 'change_3m' }

/* ── Card canvas ─────────────────────────────────────────────────── */
export function SectorCardCanvas({ sectors, period }) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const key = changeKey[period] || 'change_1w'
  const sorted = [...sectors]
    .filter(s => s[key] != null)
    .sort((a, b) => (b[key] || 0) - (a[key] || 0))

  const maxAbs = sorted.reduce((m, s) => Math.max(m, Math.abs(s[key] || 0)), 0.01)

  return (
    <div style={{
      width: 390,
      fontFamily: '"DM Sans", system-ui, sans-serif',
      background: 'linear-gradient(160deg, #060D1A 0%, #0A1628 55%, #06101E 100%)',
      borderRadius: 20,
      overflow: 'hidden',
      position: 'relative',
      boxShadow: '0 32px 64px rgba(0,0,0,0.7)',
    }}>
      {/* Grid texture */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(56,189,248,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.03) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }} />
      {/* Glow blobs */}
      <div style={{ position: 'absolute', top: -60, right: -60, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(56,189,248,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -40, left: -40, width: 140, height: 140, borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,211,153,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* Top accent bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #38BDF8, #818CF8, #34D399)', width: '100%' }} />

      <div style={{ padding: '14px 18px 18px', position: 'relative' }}>
        {/* Brand header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7,
              background: 'linear-gradient(135deg, rgba(56,189,248,0.2), rgba(129,140,248,0.2))',
              border: '1px solid rgba(56,189,248,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: '#38BDF8' }}>P</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.02em' }}>
                PineX<span style={{ color: '#38BDF8' }}>.in</span>
              </p>
              <p style={{ margin: 0, fontSize: 8, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Market Intelligence</p>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 9, color: '#475569' }}>{today}</p>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#F1F5F9', letterSpacing: '-0.02em' }}>
              Sector Snapshot
            </p>
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: 'rgba(56,189,248,0.12)', color: '#38BDF8',
              border: '1px solid rgba(56,189,248,0.25)',
              padding: '2px 8px', borderRadius: 99,
            }}>
              {periodLabel[period]}
            </span>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: '#475569' }}>Nifty Sector Performance · India</p>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'linear-gradient(90deg, rgba(56,189,248,0.15), rgba(255,255,255,0.04), transparent)', marginBottom: 12 }} />

        {/* Sector rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {sorted.map((sec, i) => {
            const chg = sec[key] || 0
            const isPos = chg >= 0
            const color = isPos ? '#34D399' : '#F87171'
            const barPct = Math.min(100, (Math.abs(chg) / maxAbs) * 100)
            const name = (sec.display_name || sec.index_name || '').replace(/^Nifty\s*/i, '')
            return (
              <div key={sec.index_name || i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Rank */}
                <span style={{ fontSize: 9, color: '#334155', width: 14, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                {/* Name */}
                <span style={{ fontSize: 11, color: '#CBD5E1', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
                {/* Bar */}
                <div style={{ width: 80, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    background: color,
                    width: barPct + '%',
                    marginLeft: isPos ? 0 : 'auto',
                  }} />
                </div>
                {/* Value */}
                <span style={{
                  fontSize: 11, fontWeight: 700, color,
                  fontFamily: '"DM Mono", monospace',
                  width: 54, textAlign: 'right', flexShrink: 0,
                }}>
                  {fmtPct(chg)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '14px 0 10px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 9, color: '#334155', letterSpacing: '0.04em' }}>Scan India's Markets</p>
          <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: '#38BDF8', letterSpacing: '-0.01em' }}>pinex.in</p>
        </div>
      </div>
    </div>
  )
}

/* ── Modal ───────────────────────────────────────────────────────── */
export default function SectorShareModal({ sectors, onClose }) {
  const cardRef = useRef(null)
  const containerRef = useRef(null)
  const [period, setPeriod] = useState('1W')
  const [capturing, setCapturing] = useState(false)
  const [shared, setShared] = useState(false)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setScale(w > 0 ? Math.min(1, w / 390) : 1)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  async function captureImage() {
    if (!cardRef.current) return null
    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      logging: false,
    })
    return canvas
  }

  async function handleSave() {
    setCapturing(true)
    try {
      const canvas = await captureImage()
      if (!canvas) return
      const link = document.createElement('a')
      link.download = `pinex-sectors-${period.toLowerCase()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } finally {
      setCapturing(false)
    }
  }

  async function handleShare() {
    setCapturing(true)
    try {
      const canvas = await captureImage()
      if (!canvas) return
      canvas.toBlob(async (blob) => {
        if (!blob) return
        try {
          await navigator.share({
            title: `PineX · Sector Snapshot (${period})`,
            files: [new File([blob], `pinex-sectors-${period.toLowerCase()}.png`, { type: 'image/png' })],
          })
          setShared(true)
          setTimeout(() => setShared(false), 2000)
        } catch {
          const link = document.createElement('a')
          link.download = `pinex-sectors-${period.toLowerCase()}.png`
          link.href = canvas.toDataURL('image/png')
          link.click()
        }
      }, 'image/png')
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '20px 16px', overflowY: 'auto',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, maxWidth: 430, width: '100%' }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>Sector Share Card</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94A3B8' }}>
            <i className="ti ti-x" style={{ fontSize: 13 }} />
          </button>
        </div>

        {/* Period selector */}
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          {['1D', '1W', '1M', '3M'].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: `1px solid ${period === p ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.08)'}`,
                background: period === p ? 'rgba(56,189,248,0.12)' : 'transparent',
                color: period === p ? '#38BDF8' : '#64748B',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Card — scale to fit narrow screens, preserve 390px for capture */}
        <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
          <div style={{ transformOrigin: 'top left', transform: `scale(${scale})`, width: 390 }}>
            <div ref={cardRef}>
              <SectorCardCanvas sectors={sectors} period={period} />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            onClick={handleSave}
            disabled={capturing}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12, fontSize: 14, fontWeight: 600,
              background: 'rgba(255,255,255,0.06)', color: '#E2E8F0',
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              opacity: capturing ? 0.6 : 1,
            }}
          >
            <i className="ti ti-download" style={{ fontSize: 16 }} />
            Save Image
          </button>
          <button
            onClick={handleShare}
            disabled={capturing}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12, fontSize: 14, fontWeight: 600,
              background: shared ? 'rgba(52,211,153,0.15)' : 'rgba(56,189,248,0.15)',
              color: shared ? '#34D399' : '#38BDF8',
              border: `1px solid ${shared ? 'rgba(52,211,153,0.3)' : 'rgba(56,189,248,0.3)'}`,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              opacity: capturing ? 0.6 : 1,
            }}
          >
            <i className={`ti ${shared ? 'ti-check' : 'ti-share'}`} style={{ fontSize: 16 }} />
            {capturing ? 'Preparing…' : shared ? 'Shared!' : 'Share'}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 11, color: '#334155' }}>Tap outside to close</p>
      </div>
    </div>
  )
}
