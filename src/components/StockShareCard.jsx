import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'

/* ── helpers ──────────────────────────────────────────────────────── */
const fmt = (n) =>
  n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const fmtPct = (n) =>
  n == null ? null : (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%'

function stageColor(stage) {
  if (stage === 'Stage 2') return { text: 'var(--stage2-color)', bg: 'var(--stage2-bg)', border: 'var(--stage2-border)' }
  if (stage === 'Stage 3') return { text: 'var(--stage3-color)', bg: 'var(--stage3-bg)', border: 'var(--stage3-border)' }
  if (stage === 'Stage 4') return { text: 'var(--stage4-color)', bg: 'var(--stage4-bg)', border: 'var(--stage4-border)' }
  return { text: 'var(--stage1-color)', bg: 'var(--stage1-bg)', border: 'var(--stage1-border)' }
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
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '9px 10px' }}>
      <p style={{ margin: 0, fontSize: 9, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{value ?? '—'}</p>
      {sub && <p style={{ margin: '3px 0 0', fontSize: 9, color: 'var(--text-hint)', lineHeight: 1.2 }}>{sub}</p>}
      {barValue != null && <MiniBar value={Math.abs(barValue)} max={barMax} color={color} />}
    </div>
  )
}

/* ── Mini candlestick chart (pure SVG — no Recharts, captures cleanly) ── */
function MiniCandleChart({ priceHistory = [], width = 350, height = 116 }) {
  const bars = useMemo(() => {
    const asc = [...priceHistory].reverse()
    // show last 60 bars
    return asc.slice(-60)
  }, [priceHistory])

  if (!bars.length) return (
    <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>No chart data</span>
    </div>
  )

  const PAD_T = 6, PAD_R = 3, PAD_B = 26, PAD_L = 3
  const chartW = width - PAD_L - PAD_R
  const innerH = height - PAD_T - PAD_B

  const VOL_H = 18
  const PRICE_H = innerH - VOL_H - 4

  const allPrices = bars.flatMap(b => [Number(b.high), Number(b.low)]).filter(v => Number.isFinite(v) && v > 0)
  const pMin = Math.min(...allPrices) * 0.99
  const pMax = Math.max(...allPrices) * 1.01
  const allVols = bars.map(b => Number(b.volume)).filter(v => Number.isFinite(v))
  const vMax = allVols.length ? Math.max(...allVols) * 1.1 : 1

  const n = bars.length
  const slotW = chartW / n
  const cw = Math.max(0.8, slotW * 0.65)

  const toX  = i => PAD_L + i * slotW + slotW / 2
  const toY  = p => PAD_T + PRICE_H * (1 - (p - pMin) / (pMax - pMin))
  const toVY = v => PAD_T + PRICE_H + 4 + VOL_H * (1 - v / vMax)

  // MA polyline points — only consecutive valid points, split on gaps
  function maPoints(key) {
    const segs = [], cur = []
    bars.forEach((b, i) => {
      const v = Number(b[key])
      if (Number.isFinite(v) && v > 0) {
        cur.push(`${toX(i)},${toY(v)}`)
      } else if (cur.length) {
        segs.push(cur.join(' '))
        cur.length = 0
      }
    })
    if (cur.length) segs.push(cur.join(' '))
    return segs
  }

  const ma20segs = maPoints('ma20')
  const ma50segs = maPoints('ma50')

  // x-axis date labels — first, mid, last
  const labelIdxs = [0, Math.floor(n / 2), n - 1]
  function shortDate(iso) {
    if (!iso) return ''
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  }

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', overflow: 'visible' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Candles + volume */}
      {bars.map((b, i) => {
        const cx = toX(i)
        const high  = Number(b.high),  low   = Number(b.low)
        const open  = Number(b.open),  close = Number(b.close)
        if (![high, low, open, close].every(v => Number.isFinite(v))) return null
        const bullish = close >= open
        const color = bullish ? '#34D399' : '#F87171' /* chart - keep hex */
        const yH = toY(high), yL = toY(low)
        const yO = toY(open), yC = toY(close)
        const bodyTop = Math.min(yO, yC)
        const bodyH   = Math.max(0.8, Math.abs(yO - yC))
        const vol = Number(b.volume)
        const volH2 = Number.isFinite(vol) && vMax > 0 ? Math.max(1, VOL_H * (vol / vMax)) : 0
        const volY  = PAD_T + PRICE_H + 4 + VOL_H - volH2
        return (
          <g key={i}>
            <line x1={cx} y1={yH} x2={cx} y2={yL} stroke={color} strokeWidth={0.7} />
            <rect
              x={cx - cw / 2} y={bodyTop} width={cw} height={bodyH}
              fill={bullish ? color : 'none'} stroke={color} strokeWidth={0.7}
            />
            {volH2 > 0 && (
              <rect
                x={cx - cw / 2} y={volY} width={cw} height={volH2}
                fill={bullish ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}
              />
            )}
          </g>
        )
      })}

      {/* MA lines */}
      {ma50segs.map((pts, i) => (
        <polyline key={'ma50-' + i} points={pts} fill="none" stroke="#60A5FA" strokeWidth={0.9} strokeOpacity={0.75} />
      ))}
      {ma20segs.map((pts, i) => (
        <polyline key={'ma20-' + i} points={pts} fill="none" stroke="#FBBF24" strokeWidth={0.9} strokeOpacity={0.65} strokeDasharray="3 2" />
      ))}

      {/* X-axis date labels */}
      {labelIdxs.filter(idx => idx < n).map(idx => (
        <text
          key={idx}
          x={toX(idx)}
          y={height - 6}
          textAnchor="middle"
          fontSize={8}
          fill="#334155"
          fontFamily="system-ui, sans-serif"
        >
          {shortDate(bars[idx]?.date)}
        </text>
      ))}

      {/* Legend */}
      <line x1={PAD_L} y1={height - 16} x2={PAD_L + 10} y2={height - 16} stroke="#60A5FA" strokeWidth={1} />
      <text x={PAD_L + 13} y={height - 13} fontSize={7.5} fill="#475569" fontFamily="system-ui, sans-serif">MA50</text>
      <line x1={PAD_L + 44} y1={height - 16} x2={PAD_L + 54} y2={height - 16} stroke="#FBBF24" strokeWidth={1} strokeDasharray="3 2" />
      <text x={PAD_L + 57} y={height - 13} fontSize={7.5} fill="#475569" fontFamily="system-ui, sans-serif">MA20</text>
    </svg>
  )
}

/* ── Compact tech stat cell ──────────────────────────────────────── */
function TechCell({ label, value, color = 'var(--text-secondary)' }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 8,
      padding: '6px 8px',
    }}>
      <p style={{ margin: 0, fontSize: 7.5, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, lineHeight: 1 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 800, color, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value ?? '—'}</p>
    </div>
  )
}

/* ── The card itself (rendered off-screen for capture) ─────────────── */
export function ShareCardCanvas({ symbol, company, price, delivery, shareholding, pctFromMa, rsVsNifty, sectorPerf, priceHistory = [] }) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  const stage    = price?.stage || 'Unclassified'
  const substage = price?.weinstein_substage || null
  const sc       = stageColor(stage)
  const close    = price?.close
  const rsi      = price?.rsi  != null ? Number(price.rsi)  : null
  const del7     = delivery?.avg_delivery_7d != null ? Number(delivery.avg_delivery_7d) : null
  const delPct   = del7
  const pledge   = shareholding?.[0]?.promoter_pledge_pct ?? null

  // 30W slope
  const slopeRaw = price?.ma30w_slope
  const slopeNum = slopeRaw != null && slopeRaw !== '' ? Number(slopeRaw) : null

  // % from 52W high
  const hi52raw  = price?.high_52w
  const hi52     = hi52raw != null && hi52raw !== '' ? Number(hi52raw) : null
  const closeNum = close != null && close !== '' ? Number(close) : null
  const pct52    = hi52 && closeNum && hi52 > 0 ? ((closeNum - hi52) / hi52) * 100 : null

  // OBV
  const obvSlope = parseFloat(String(price?.obv_slope ?? '')) || 0
  const obvLabel = obvSlope > 0.02 ? '↑ Rising' : obvSlope < -0.02 ? '↓ Falling' : '→ Flat'
  const obvColor = obvSlope > 0.02 ? 'var(--positive)' : obvSlope < -0.02 ? 'var(--negative)' : 'var(--text-secondary)'

  // MA values
  const fmtInr = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—' }

  // Colors
  const maColor  = pctFromMa == null ? 'var(--text-secondary)' : pctFromMa > 5 ? 'var(--positive)' : pctFromMa < -5 ? 'var(--negative)' : 'var(--warning)'
  const rsColor  = rsVsNifty == null ? 'var(--text-secondary)' : rsVsNifty > 0 ? 'var(--positive)' : 'var(--negative)'
  const delColor = delPct == null ? 'var(--text-secondary)' : delPct > 55 ? 'var(--positive)' : delPct < 35 ? 'var(--negative)' : 'var(--warning)'
  const rsiColor = rsi == null ? 'var(--text-secondary)' : rsi > 70 ? 'var(--negative)' : rsi < 40 ? 'var(--warning)' : 'var(--positive)'
  const slopeColor = slopeNum == null ? 'var(--text-secondary)' : slopeNum > 0 ? 'var(--positive)' : 'var(--negative)'
  const pct52Color = pct52 == null ? 'var(--text-secondary)' : pct52 > -5 ? 'var(--positive)' : pct52 > -15 ? 'var(--warning)' : 'var(--negative)'
  const stageDisplayColor = sc.text

  const sector   = company?.sector  || null
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

      <div style={{ padding: '14px 18px 18px', position: 'relative' }}>

        {/* Brand header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 7, flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(56,189,248,0.2), rgba(129,140,248,0.2))',
              border: '1px solid rgba(56,189,248,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--info)', letterSpacing: '-0.03em' }}>P</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>PineX<span style={{ color: 'var(--info)' }}>.in</span></p>
              <p style={{ margin: 0, fontSize: 7.5, color: 'var(--text-hint)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Market Intelligence</p>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 9, color: 'var(--text-hint)' }}>{today}</p>
        </div>

        {/* Stock hero */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1 }}>{symbol}</p>
              <p style={{ margin: '3px 0 0', fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company?.name || symbol}</p>
            </div>
            <span style={{
              flexShrink: 0, marginTop: 2,
              background: sc.bg, color: sc.text,
              border: `1px solid ${sc.border}`,
              fontSize: 9, fontWeight: 700,
              padding: '3px 9px', borderRadius: 99, letterSpacing: '0.04em',
            }}>
              {stage}
            </span>
          </div>

          {/* Sector & Industry row */}
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {sector && (
              <span style={{
                fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                background: 'rgba(96,165,250,0.1)', color: 'var(--info)',
                border: '1px solid rgba(96,165,250,0.2)',
              }}>
                {sector}
              </span>
            )}
            {industry && industry !== sector && (
              <span style={{
                fontSize: 9, fontWeight: 500, padding: '2px 8px', borderRadius: 99,
                background: 'rgba(148,163,184,0.08)', color: 'var(--text-secondary)',
                border: '1px solid rgba(148,163,184,0.15)',
              }}>
                {industry}
              </span>
            )}
          </div>

          {/* Price row */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
            <p style={{
              margin: 0, fontSize: 28, fontWeight: 900,
              fontFamily: '"DM Mono", monospace',
              color: maColor,
              letterSpacing: '-0.03em', lineHeight: 1,
            }}>
              {fmt(close)}
            </p>
            {pctFromMa != null && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: maColor,
                background: maColor + '18',
                border: `1px solid ${maColor}30`,
                padding: '2px 8px', borderRadius: 99,
              }}>
                {fmtPct(pctFromMa)} vs 30W MA
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'linear-gradient(90deg, rgba(56,189,248,0.15), rgba(255,255,255,0.04), transparent)', margin: '0 0 10px' }} />

        {/* ── Mini chart ── */}
        <div style={{
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
          padding: '8px 8px 2px',
          marginBottom: 10,
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-disabled)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Price Chart (3M)</span>
            <span style={{ fontSize: 8, color: 'var(--text-disabled)' }}>Daily · Last 60 bars</span>
          </div>
          <MiniCandleChart priceHistory={priceHistory} width={350} height={116} />
        </div>

        {/* Technicals grid — 3 cols × 4 rows */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: 7 }}>
          <TechCell label="Stage"         value={substage || stage}                                                    color={stageDisplayColor} />
          <TechCell label="RS vs Nifty"   value={rsVsNifty != null ? fmtPct(rsVsNifty) : null}                        color={rsColor} />
          <TechCell label="OBV Trend"     value={obvLabel}                                                             color={obvColor} />

          <TechCell label="RSI (14)"      value={rsi != null ? rsi.toFixed(1) : null}                                  color={rsiColor} />
          <TechCell label="30W Slope"     value={slopeNum != null ? (slopeNum > 0 ? '+' : '') + slopeNum.toFixed(2) + '%' : null} color={slopeColor} />
          <TechCell label="Delivery 7D"   value={delPct != null ? delPct.toFixed(1) + '%' : null}                     color={delColor} />

          <TechCell label="30W MA"        value={fmtInr(price?.ma30w)}                                                color="#60A5FA" />
          <TechCell label="50D MA"        value={fmtInr(price?.ma50)}                                                 color="#60A5FA" />
          <TechCell label="150D MA"       value={fmtInr(price?.ma150)}                                                color="#60A5FA" />

          <TechCell label="52W High"      value={fmtInr(price?.high_52w)}                                             color="#94A3B8" />
          <TechCell label="52W Low"       value={fmtInr(price?.low_52w)}                                              color="#94A3B8" />
          <TechCell label="% from 52W Hi" value={pct52 != null ? (pct52 > 0 ? '+' : '') + pct52.toFixed(1) + '%' : null} color={pct52Color} />
        </div>

        {/* Pledge pill */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
            background: pledge != null && pledge > 0 ? 'var(--negative-dim)' : 'var(--stage2-bg)',
            color: pledge != null && pledge > 0 ? 'var(--negative)' : 'var(--positive)',
            border: `1px solid ${pledge != null && pledge > 0 ? 'var(--negative-dim)' : 'var(--stage2-border)'}`,
          }}>
            {pledge != null && pledge > 0 ? `⚠ Pledge ${pledge.toFixed(1)}%` : '✓ Zero Pledge'}
          </span>
          {delPct != null && (
            <span style={{
              fontSize: 9, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
              background: delPct > 55 ? 'var(--stage2-bg)' : 'var(--warning-dim)',
              color: delPct > 55 ? 'var(--positive)' : 'var(--warning)',
              border: `1px solid ${delPct > 55 ? 'var(--stage2-border)' : 'var(--warning-dim)'}`,
            }}>
              {delPct > 55 ? '↑ High Delivery' : '~ Normal Delivery'}
            </span>
          )}
        </div>

        {/* Footer */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', marginBottom: 10 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 9, color: 'var(--text-disabled)', letterSpacing: '0.04em' }}>
            Scan India's Markets
          </p>
          <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: 'var(--info)', letterSpacing: '-0.01em' }}>
            pinex.in/{symbol?.toLowerCase()}
          </p>
        </div>
      </div>
    </div>
  )
}

const CARD_WIDTH = 390

/* ── Modal shell + capture logic ───────────────────────────────────── */
export default function StockShareModal({ symbol, company, price, delivery, shareholding, pctFromMa, rsVsNifty, sectorPerf, priceHistory = [], onClose }) {
  const cardRef = useRef(null)
  const wrapRef = useRef(null)
  const [capturing, setCapturing] = useState(false)
  const [shared, setShared] = useState(false)
  const [scale, setScale] = useState(1)
  const [scaledHeight, setScaledHeight] = useState(null)

  useEffect(() => {
    function updateScale() {
      const vw = window.innerWidth
      const vh = window.innerHeight
      // fit width with side margins
      const scaleByW = Math.min(1, (vw - 40) / CARD_WIDTH)
      // also cap so card height leaves room for buttons below (~130px)
      if (wrapRef.current) {
        const cardH = wrapRef.current.offsetHeight
        const scaleByH = Math.min(1, (vh - 180) / cardH)
        const s = Math.min(scaleByW, scaleByH)
        setScale(s)
        setScaledHeight(Math.ceil(cardH * s))
      } else {
        setScale(scaleByW)
      }
    }
    const raf = requestAnimationFrame(updateScale)
    window.addEventListener('resize', updateScale)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', updateScale) }
  }, [])

  async function captureImage() {
    if (!cardRef.current) return null
    const wrap = wrapRef.current
    const prevTransform = wrap?.style.transform
    if (wrap) wrap.style.transform = 'none'
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      })
      return canvas
    } finally {
      if (wrap && prevTransform !== undefined) wrap.style.transform = prevTransform
    }
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
        background: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '16px 16px',
        overflowY: 'auto',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 430, width: '100%' }}>

        {/* Close pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Share Card</p>
          <button
            type="button" onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 99, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        {/* Card — scaled to fit viewport, full-size for capture */}
        <div style={{ width: CARD_WIDTH * scale, height: scaledHeight ?? undefined, overflow: 'hidden', margin: '0 auto' }}>
          <div ref={wrapRef} style={{ transformOrigin: 'top left', transform: `scale(${scale})`, width: CARD_WIDTH }}>
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
                priceHistory={priceHistory}
              />
            </div>
          </div>
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
              color: 'var(--text-primary)', fontSize: 14, fontWeight: 600,
              cursor: capturing ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
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
            }}
          >
            <i className="ti ti-share" style={{ fontSize: 16 }} />
            {shared ? '✓ Shared!' : capturing ? 'Preparing…' : 'Share'}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-disabled)', textAlign: 'center' }}>
          Tap outside to close
        </p>
      </div>
    </div>
  )
}
