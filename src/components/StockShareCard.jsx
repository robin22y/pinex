import { useRef, useState } from 'react'
import html2canvas from 'html2canvas'

/* ── helpers ──────────────────────────────────────────────────────── */
const fmt = (n) =>
  n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const fmtPct = (n) =>
  n == null ? null : (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%'

function stageColor(stage) {
  if (stage === 'Stage 2') return { text: '#34D399', bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.3)' }
  if (stage === 'Stage 3') return { text: '#FBBF24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.3)' }
  if (stage === 'Stage 4') return { text: '#F87171', bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.3)' }
  return { text: '#60A5FA', bg: 'rgba(96,165,250,0.15)', border: 'rgba(96,165,250,0.3)' }
}

function MiniBar({ value, max = 100, color }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: pct + '%', borderRadius: 99, background: color }} />
    </div>
  )
}

function MetricCell({ label, value, sub, color, barValue, barMax = 100 }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '10px 10px' }}>
      <p style={{ margin: 0, fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</p>
      <p style={{ margin: '5px 0 0', fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{value ?? '—'}</p>
      {sub && <p style={{ margin: '3px 0 0', fontSize: 9, color: '#475569', lineHeight: 1.2 }}>{sub}</p>}
      {barValue != null && <MiniBar value={Math.abs(barValue)} max={barMax} color={color} />}
    </div>
  )
}

/* ── The card itself (rendered off-screen for capture) ─────────────── */
export function ShareCardCanvas({ symbol, company, price, delivery, shareholding, pctFromMa, rsVsNifty, sectorPerf }) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  const stage = price?.stage || 'Unclassified'
  const sc = stageColor(stage)
  const close = price?.close
  const rsi = price?.rsi != null ? Number(price.rsi) : null
  const delPct = delivery?.avg_delivery_30d != null ? Number(delivery.avg_delivery_30d) : null
  const pledge = shareholding?.[0]?.promoter_pledge_pct ?? null

  const maColor = pctFromMa == null ? '#94A3B8' : pctFromMa > 5 ? '#34D399' : pctFromMa < -5 ? '#F87171' : '#FBBF24'
  const rsColor = rsVsNifty == null ? '#94A3B8' : rsVsNifty > 0 ? '#34D399' : '#F87171'
  const delColor = delPct == null ? '#94A3B8' : delPct > 55 ? '#34D399' : delPct < 35 ? '#F87171' : '#FBBF24'
  const rsiColor = rsi == null ? '#94A3B8' : rsi > 70 ? '#F87171' : rsi < 40 ? '#FBBF24' : '#34D399'
  const secColor = sectorPerf == null ? '#94A3B8' : sectorPerf > 0 ? '#34D399' : '#F87171'

  const sector = company?.sector || null
  const industry = company?.industry || null

  return (
    <div
      style={{
        width: 390,
        fontFamily: '"DM Sans", system-ui, sans-serif',
        background: 'linear-gradient(160deg, #060D1A 0%, #0A1628 55%, #06101E 100%)',
        borderRadius: 20,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 32px 64px rgba(0,0,0,0.7)',
      }}
    >
      {/* Subtle grid texture */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(56,189,248,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.03) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }} />

      {/* Glow blobs */}
      <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -40, left: -40, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,211,153,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* Top accent bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #38BDF8, #818CF8, #34D399)', width: '100%' }} />

      <div style={{ padding: '16px 20px 20px', position: 'relative' }}>

        {/* Brand header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7, flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(56,189,248,0.2), rgba(129,140,248,0.2))',
              border: '1px solid rgba(56,189,248,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: '#38BDF8', letterSpacing: '-0.03em' }}>P</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.02em' }}>PineX<span style={{ color: '#38BDF8' }}>.in</span></p>
              <p style={{ margin: 0, fontSize: 8, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Market Intelligence</p>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 9, color: '#475569' }}>{today}</p>
        </div>

        {/* Stock hero */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color: '#F1F5F9', letterSpacing: '-0.03em', lineHeight: 1 }}>{symbol}</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94A3B8', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company?.name || symbol}</p>
            </div>
            <span style={{
              flexShrink: 0, marginTop: 2,
              background: sc.bg, color: sc.text,
              border: `1px solid ${sc.border}`,
              fontSize: 10, fontWeight: 700,
              padding: '3px 10px', borderRadius: 99, letterSpacing: '0.04em',
            }}>
              {stage}
            </span>
          </div>

          {/* Sector & Industry row */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {sector && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
                background: 'rgba(96,165,250,0.1)', color: '#60A5FA',
                border: '1px solid rgba(96,165,250,0.2)',
              }}>
                {sector}
              </span>
            )}
            {industry && industry !== sector && (
              <span style={{
                fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 99,
                background: 'rgba(148,163,184,0.08)', color: '#94A3B8',
                border: '1px solid rgba(148,163,184,0.15)',
              }}>
                {industry}
              </span>
            )}
          </div>

          {/* Price row */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 14 }}>
            <p style={{
              margin: 0, fontSize: 30, fontWeight: 900,
              fontFamily: '"DM Mono", monospace',
              color: maColor,
              letterSpacing: '-0.03em', lineHeight: 1,
            }}>
              {fmt(close)}
            </p>
            {pctFromMa != null && (
              <span style={{
                fontSize: 12, fontWeight: 700, color: maColor,
                background: maColor + '18',
                border: `1px solid ${maColor}30`,
                padding: '2px 9px', borderRadius: 99,
              }}>
                {fmtPct(pctFromMa)} vs 30W MA
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'linear-gradient(90deg, rgba(56,189,248,0.15), rgba(255,255,255,0.04), transparent)', margin: '0 0 14px' }} />

        {/* Metrics grid — 2×2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <MetricCell
            label="Delivery 30D"
            value={delPct != null ? delPct.toFixed(1) + '%' : null}
            sub={delPct != null ? (delPct > 55 ? 'High conviction' : delPct < 35 ? 'Low conviction' : 'Moderate') : undefined}
            color={delColor}
            barValue={delPct}
            barMax={100}
          />
          <MetricCell
            label="RSI"
            value={rsi != null ? rsi.toFixed(0) : null}
            sub={rsi != null ? (rsi > 70 ? 'Overbought' : rsi < 40 ? 'Oversold' : 'Neutral') : undefined}
            color={rsiColor}
            barValue={rsi ?? 0}
            barMax={100}
          />
          <MetricCell
            label="RS vs Nifty (1Y)"
            value={rsVsNifty != null ? fmtPct(rsVsNifty) : null}
            sub={rsVsNifty != null ? (rsVsNifty > 0 ? 'Outperforming' : 'Underperforming') : undefined}
            color={rsColor}
            barValue={Math.abs(rsVsNifty ?? 0)}
            barMax={50}
          />
          <MetricCell
            label="Sector Perf (1W)"
            value={sectorPerf != null ? fmtPct(sectorPerf) : sector ? sector.split(' ')[0] : null}
            sub={sectorPerf != null ? (sectorPerf > 0 ? 'Sector rising' : 'Sector falling') : (sector ? 'Sector' : undefined)}
            color={sectorPerf != null ? secColor : '#64748B'}
            barValue={sectorPerf != null ? Math.abs(sectorPerf) : null}
            barMax={10}
          />
        </div>

        {/* Pledge pill */}
        <div style={{ display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '4px 11px', borderRadius: 99,
            background: pledge != null && pledge > 0 ? 'rgba(248,113,113,0.12)' : 'rgba(52,211,153,0.1)',
            color: pledge != null && pledge > 0 ? '#F87171' : '#34D399',
            border: `1px solid ${pledge != null && pledge > 0 ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.2)'}`,
          }}>
            {pledge != null && pledge > 0 ? `⚠ Pledge ${pledge.toFixed(1)}%` : '✓ Zero Pledge'}
          </span>
          {delPct != null && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '4px 11px', borderRadius: 99,
              background: delPct > 55 ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)',
              color: delPct > 55 ? '#34D399' : '#FBBF24',
              border: `1px solid ${delPct > 55 ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.2)'}`,
            }}>
              {delPct > 55 ? '↑ High Delivery' : '~ Normal Delivery'}
            </span>
          )}
        </div>

        {/* Footer */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', marginBottom: 12 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 9, color: '#334155', letterSpacing: '0.04em' }}>
            Scan India's Markets
          </p>
          <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: '#38BDF8', letterSpacing: '-0.01em' }}>
            pinex.in/{symbol?.toLowerCase()}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Modal shell + capture logic ───────────────────────────────────── */
export default function StockShareModal({ symbol, company, price, delivery, shareholding, pctFromMa, rsVsNifty, sectorPerf, onClose }) {
  const cardRef = useRef(null)
  const [capturing, setCapturing] = useState(false)
  const [shared, setShared] = useState(false)

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

  async function handleDownload() {
    setCapturing(true)
    try {
      const canvas = await captureImage()
      if (!canvas) return
      const link = document.createElement('a')
      link.download = `${symbol}-PineX.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    } finally {
      setCapturing(false)
    }
  }

  async function handleShare() {
    setCapturing(true)
    try {
      const canvas = await captureImage()
      if (!canvas) return

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      const file = new File([blob], `${symbol}-PineX.png`, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${symbol} on PineX`,
          text: `Check out ${company?.name || symbol} on PineX — India's Market Intelligence`,
        })
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      } else {
        await handleDownload()
      }
    } catch {
      /* dismissed */
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
        padding: '20px 16px',
        overflowY: 'auto',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, maxWidth: 430, width: '100%' }}>

        {/* Close pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#94A3B8' }}>Share Card</p>
          <button
            type="button" onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 99, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B', fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        {/* The card */}
        <div ref={cardRef}>
          <ShareCardCanvas
            symbol={symbol}
            company={company}
            price={price}
            delivery={delivery}
            shareholding={shareholding}
            pctFromMa={pctFromMa}
            rsVsNifty={rsVsNifty}
            sectorPerf={sectorPerf}
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            type="button"
            onClick={handleDownload}
            disabled={capturing}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#E2E8F0', fontSize: 14, fontWeight: 600,
              cursor: capturing ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
          >
            <i className="ti ti-download" style={{ fontSize: 16 }} />
            {capturing ? 'Saving…' : 'Save Image'}
          </button>

          <button
            type="button"
            onClick={handleShare}
            disabled={capturing}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12,
              background: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
              border: 'none',
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: capturing ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              boxShadow: '0 4px 20px rgba(14,165,233,0.3)',
              transition: 'opacity 0.15s, transform 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            <i className="ti ti-share" style={{ fontSize: 16 }} />
            {shared ? '✓ Shared!' : capturing ? 'Preparing…' : 'Share'}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 11, color: '#334155', textAlign: 'center' }}>
          Tap outside to close
        </p>
      </div>
    </div>
  )
}
