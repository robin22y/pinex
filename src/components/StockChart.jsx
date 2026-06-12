import { useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
  CartesianGrid, useXAxisScale, useYAxisScale,
} from 'recharts'

// ─── Color tokens ─────────────────────────────────────────────────
const C = {
  surface: 'var(--bg-surface)', card: 'var(--bg-elevated)', border: 'var(--border)',
  text: 'var(--text-primary)', muted: 'var(--text-muted)', faint: 'var(--text-hint)',
  green: '#34D399', red: '#F87171', amber: 'var(--warning)', /* chart - keep hex */
  purple: '#A78BFA', blue: 'var(--info)',
}

// ─── Data helpers ─────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function weekKey(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  const thu = new Date(d)
  thu.setDate(d.getDate() + (4 - (d.getDay() || 7)))
  const y = thu.getFullYear()
  const w = Math.ceil(((thu - new Date(y, 0, 1)) / 86400000 + 1) / 7)
  return `${y}-W${String(w).padStart(2, '0')}`
}

function toWeekly(ascRows) {
  const grouped = {}, order = []
  for (const r of ascRows) {
    const k = weekKey(r.date)
    if (!grouped[k]) { grouped[k] = []; order.push(k) }
    grouped[k].push(r)
  }
  return order.map(k => {
    const grp = grouped[k], last = grp[grp.length - 1]
    return {
      date:   last.date,
      open:   Number(grp[0].open)  || null,
      high:   Math.max(...grp.map(r => Number(r.high) || 0)),
      low:    Math.min(...grp.map(r => Number(r.low)  || Infinity)),
      close:  Number(last.close)   || null,
      volume: grp.reduce((s, r) => s + (Number(r.volume) || 0), 0),
      ma20:   Number(last.ma20)    || null,
      ma50:   Number(last.ma50)    || null,
      ma150:  Number(last.ma150)   || null,
      rsi:    Number(last.rsi)     || null,
    }
  })
}

function computeExtras(rows) {
  return rows.map((row, i) => {
    const close  = Number(row.close)  || null
    const ma20   = Number(row.ma20)   || null
    const volume = Number(row.volume) || 0

    const volWindow = rows.slice(Math.max(0, i - 20), i)
    const avgVol = volWindow.length
      ? volWindow.reduce((s, r) => s + (Number(r.volume) || 0), 0) / volWindow.length
      : null

    const isBase     = !!(ma20 && close && Math.abs(close - ma20) / ma20 < 0.04 && avgVol && volume < avgVol * 0.85)
    const isSpike    = !!(avgVol && volume > avgVol * 2)
    const prevHigh   = i > 0 ? Math.max(...rows.slice(Math.max(0, i - 50), i).map(r => Number(r.high) || 0)) : null
    const isBreakout = !!(prevHigh && close && close >= prevHigh)

    return {
      ...row,
      avgVol,
      spikeThreshold: avgVol ? avgVol * 2 : null,
      ma20upper: ma20 ? ma20 * 1.03 : null,
      ma20lower: ma20 ? ma20 * 0.97 : null,
      isBase, isSpike, isBreakout,
    }
  })
}

function computeBaseZones(rows) {
  const zones = []
  let start = null
  rows.forEach((r, i) => {
    if (r.isBase) {
      if (start === null) start = i
    } else {
      if (start !== null && i - start >= 5)
        zones.push({ x1: rows[start].date, x2: rows[i - 1].date })
      start = null
    }
  })
  if (start !== null && rows.length - start >= 5)
    zones.push({ x1: rows[start].date, x2: rows[rows.length - 1].date })
  return zones
}

// ─── Candlestick layer — Recharts v3 approach ────────────────────
function CandleLayer({ data }) {
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  if (!xScale || !yScale) return null

  const bw   = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 4
  const barW = Math.max(1, bw * 0.72)

  return (
    <g className="recharts-candles">
      {(data || []).map((d, i) => {
        const x = xScale(d.date)
        if (x == null || !Number.isFinite(x)) return null

        const high  = Number(d.high)
        const low   = Number(d.low)
        const open  = Number(d.open)
        const close = Number(d.close)
        if (!Number.isFinite(high) || !Number.isFinite(low) ||
            !Number.isFinite(open) || !Number.isFinite(close)) return null

        const cx   = x + bw / 2
        const yH   = yScale(high)
        const yL   = yScale(low)
        const yO   = yScale(open)
        const yC   = yScale(close)
        if ([yH, yL, yO, yC].some(v => !Number.isFinite(v))) return null

        const bullish = close >= open
        const color   = d.isBreakout ? 'var(--accent)' : (bullish ? '#34D399' : '#F87171')
        const bodyTop = Math.min(yO, yC)
        const bodyH   = Math.max(1, Math.abs(yO - yC))

        return (
          <g key={d.date || i}>
            <line x1={cx} y1={yH} x2={cx} y2={yL} stroke={color} strokeWidth={1} />
            <rect
              x={cx - barW / 2}
              y={bodyTop}
              width={barW}
              height={bodyH}
              fill={bullish ? color : 'none'}
              stroke={color}
              strokeWidth={1}
            />
          </g>
        )
      })}
    </g>
  )
}

// ─── Volume bar shape ─────────────────────────────────────────────
function VolumeBar({ x, y, width, height, payload }) {
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return null
  return (
    <rect
      x={x} y={y}
      width={Math.max(1, width)}
      height={height}
      fill={payload?.isSpike ? 'rgba(248,113,113,0.7)' : 'rgba(96,165,250,0.35)'}
    />
  )
}

// ─── SwingX panel ─────────────────────────────────────────────────
const CONDITIONS = [
  { key: 'condition_stage2',             label: 'Advancing', desc: 'Price above rising 30W Trend Line' },
  { key: 'condition_delivery_above_avg', label: 'Delivery',  desc: 'Delivery >30% above 30D avg' },
  { key: 'condition_near_ma50',          label: 'Near MA50', desc: 'Price within ±3% of 50D MA' },
  { key: 'condition_rsi_healthy',        label: 'RSI 40–65', desc: 'RSI in healthy accumulation zone' },
  { key: 'condition_volume_contracting', label: 'Low Vol',   desc: 'Volume contracting (base building)' },
]

function SwingPanel({ swing }) {
  if (!swing) return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', color: C.muted, fontSize: 12 }}>
      No SwingX data available for this stock today.
    </div>
  )
  const metCount = CONDITIONS.filter(c => swing[c.key]).length
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>SwingX Conditions</span>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
          background: metCount >= 4 ? 'var(--stage2-bg)' : metCount >= 3 ? 'var(--warning-dim)' : 'var(--bg-elevated)',
          color: metCount >= 4 ? C.green : metCount >= 3 ? C.amber : C.muted,
          border: `1px solid ${metCount >= 4 ? 'var(--stage2-border)' : metCount >= 3 ? 'var(--warning-dim)' : C.border}`,
        }}>
          {metCount} / 5
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {CONDITIONS.map(c => {
          const ok = !!swing[c.key]
          return (
            <div key={c.key} style={{
              background: ok ? 'var(--stage2-bg)' : 'var(--negative-dim)',
              border: `1px solid ${ok ? 'var(--stage2-border)' : 'var(--negative-dim)'}`,
              borderRadius: 8, padding: '8px 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: ok ? C.green : C.red, fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: ok ? C.green : C.muted }}>{c.label}</span>
              </div>
              <p style={{ fontSize: 10, color: C.faint, margin: 0 }}>{c.desc}</p>
            </div>
          )
        })}
      </div>
      {swing.breakout_52w && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>⚡ Near 52-week historical level</span>
        </div>
      )}
      <p style={{ fontSize: 9, color: C.faint, margin: '10px 0 0' }}>
        Historical zone analysis for informational purposes only. Not investment advice.
      </p>
    </div>
  )
}

// ─── Tooltips ─────────────────────────────────────────────────────
function PriceTooltip({ active, payload }) {
  if (!active || !payload?.[0]?.payload) return null
  const d = payload[0].payload
  const bullish = (Number(d.close) || 0) >= (Number(d.open) || 0)
  return (
    <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 11, minWidth: 130 }}>
      <div style={{ color: C.muted, marginBottom: 5 }}>{String(d.date || '').slice(0, 10)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: '2px 8px' }}>
        <span style={{ color: C.muted }}>O</span><span style={{ color: C.text, fontWeight: 600 }}>₹{Number(d.open || 0).toFixed(2)}</span>
        <span style={{ color: C.muted }}>H</span><span style={{ color: C.green, fontWeight: 600 }}>₹{Number(d.high || 0).toFixed(2)}</span>
        <span style={{ color: C.muted }}>L</span><span style={{ color: C.red, fontWeight: 600 }}>₹{Number(d.low || 0).toFixed(2)}</span>
        <span style={{ color: C.muted }}>C</span><span style={{ color: bullish ? C.green : C.red, fontWeight: 700 }}>₹{Number(d.close || 0).toFixed(2)}</span>
      </div>
      {d.volume != null && (
        // Volume spikes are already signalled by the red text colour
        // (`d.isSpike ? C.red : C.muted`). The ⚡ symbol added emoji-
        // style emphasis that read more like a directive than a
        // factual observation — colour-coding is enough.
        <div style={{ marginTop: 5, color: d.isSpike ? C.red : C.muted }}>
          Vol: {Number(d.volume).toLocaleString('en-IN')}
        </div>
      )}
    </div>
  )
}

function RsiTooltip({ active, payload }) {
  if (!active || !payload?.[0]?.payload) return null
  const rsi = Number(payload[0].payload.rsi)
  if (!Number.isFinite(rsi)) return null
  return (
    <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
      <span style={{ color: C.muted }}>RSI </span>
      <span style={{ color: rsi > 70 ? C.red : rsi < 30 ? C.green : C.purple, fontWeight: 700 }}>{rsi.toFixed(1)}</span>
    </div>
  )
}

// ─── Zoom preset config ───────────────────────────────────────────
const ZOOM_PRESETS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: null },
]

// ─── Main component ───────────────────────────────────────────────
export default function StockChart({
  priceHistory = [],
  symbol = '',
  companyName = '',
  stage = '',
  swing = null,
}) {
  const [timeframe, setTimeframe] = useState('daily')
  const [showSwing, setShowSwing] = useState(false)

  // Zoom state
  const [activePreset, setActivePreset] = useState('All')
  const [dragStart, setDragStart]       = useState(null)
  const [dragEnd, setDragEnd]           = useState(null)
  const [zoomedRange, setZoomedRange]   = useState(null) // { from: dateStr, to: dateStr } | null

  const dailyAsc  = useMemo(() => [...priceHistory].reverse(), [priceHistory])
  const weeklyAsc = useMemo(() => toWeekly(dailyAsc), [dailyAsc])

  const baseRows = timeframe === 'weekly' ? weeklyAsc : dailyAsc
  const rows     = useMemo(() => computeExtras(baseRows), [baseRows])

  // Apply zoom window to rows
  const visibleRows = useMemo(() => {
    if (!zoomedRange) return rows
    return rows.filter(r => r.date >= zoomedRange.from && r.date <= zoomedRange.to)
  }, [rows, zoomedRange])

  const zones        = useMemo(() => computeBaseZones(visibleRows), [visibleRows])
  const spikeCount   = useMemo(() => visibleRows.filter(r => r.isSpike).length, [visibleRows])
  const swingActive  = showSwing && !!swing

  if (!rows.length) {
    return (
      <div style={{ background: C.surface, border: '1px solid var(--border)', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
        No price history available yet.
      </div>
    )
  }

  const lows     = visibleRows.map(r => Number(r.low)).filter(v => Number.isFinite(v) && v > 0)
  const highs    = visibleRows.map(r => Number(r.high)).filter(Number.isFinite)
  const priceMin = (lows.length  ? Math.min(...lows)  : 0) * 0.98
  const priceMax = (highs.length ? Math.max(...highs) : 0) * 1.02
  const vols     = visibleRows.map(r => Number(r.volume)).filter(Number.isFinite)
  const volMax   = (vols.length ? Math.max(...vols) : 0) * 1.3 || 1

  const fmtVol = v =>
    v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' :
    v >= 1e5 ? (v / 1e5).toFixed(0) + 'L'  :
    v >= 1e3 ? (v / 1e3).toFixed(0) + 'K'  : String(Math.round(v))

  const fmtPx = v => '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })

  // ── Zoom helpers ──────────────────────────────────────────────

  function applyPreset(label, days) {
    setActivePreset(label)
    setZoomedRange(null) // clear drag zoom first
    if (!days) { setZoomedRange(null); return }
    const last = rows[rows.length - 1]?.date
    if (!last) return
    const from = new Date(last + 'T00:00:00')
    from.setDate(from.getDate() - days)
    const fromStr = from.toISOString().slice(0, 10)
    setZoomedRange({ from: fromStr, to: last })
  }

  function handleMouseDown(e) {
    if (e?.activeLabel) setDragStart(e.activeLabel)
  }

  function handleMouseMove(e) {
    if (dragStart && e?.activeLabel) setDragEnd(e.activeLabel)
  }

  function handleMouseUp() {
    if (dragStart && dragEnd && dragStart !== dragEnd) {
      const from = dragStart < dragEnd ? dragStart : dragEnd
      const to   = dragStart < dragEnd ? dragEnd   : dragStart
      setZoomedRange({ from, to })
      setActivePreset(null)
    }
    setDragStart(null)
    setDragEnd(null)
  }

  function resetZoom() {
    setZoomedRange(null)
    setActivePreset('All')
  }

  const isZoomed = !!zoomedRange

  // Normalise drag selection so x1 < x2
  const selX1 = dragStart && dragEnd ? (dragStart < dragEnd ? dragStart : dragEnd) : null
  const selX2 = dragStart && dragEnd ? (dragStart < dragEnd ? dragEnd : dragStart) : null

  return (
    <div style={{ background: C.surface, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{symbol}</span>
        {companyName && <span style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{companyName}</span>}
        {stage && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            background: stage === 'Stage 2' ? 'var(--stage2-bg)' : 'var(--bg-elevated)',
            color:      stage === 'Stage 2' ? C.green : C.muted,
            border:    `1px solid ${stage === 'Stage 2' ? 'var(--stage2-border)' : C.border}`,
          }}>{stage}</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {spikeCount > 0 && (
            <span style={{ fontSize: 10, color: C.red, background: 'var(--negative-dim)', border: '1px solid var(--negative-dim)', borderRadius: 20, padding: '2px 7px', whiteSpace: 'nowrap' }}>
              {spikeCount} vol spike{spikeCount !== 1 ? 's' : ''}
            </span>
          )}
          {['daily', 'weekly'].map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
              border:    `1px solid ${timeframe === tf ? C.blue : C.border}`,
              background: timeframe === tf ? 'var(--info-dim)' : 'transparent',
              color:      timeframe === tf ? C.blue : C.muted,
            }}>
              {tf === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
          <button onClick={() => setShowSwing(s => !s)} style={{
            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
            border:    `1px solid ${showSwing ? C.purple : C.border}`,
            background: showSwing ? 'var(--bg-elevated)' : 'transparent',
            color:      showSwing ? C.purple : C.muted,
          }}>
            Why SwingX?
          </button>
        </div>
      </div>

      {/* ── SwingX panel ── */}
      {showSwing && <SwingPanel swing={swing} />}

      {/* ── Zoom controls ── */}
      <div style={{ padding: '7px 14px 4px', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: C.faint, letterSpacing: '0.05em', marginRight: 4 }}>ZOOM</span>
        {ZOOM_PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p.label, p.days)}
            style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
              border:    `1px solid ${activePreset === p.label ? C.blue : C.border}`,
              background: activePreset === p.label ? 'var(--info-dim)' : 'transparent',
              color:      activePreset === p.label ? C.blue : C.muted,
              transition: 'all .12s',
            }}
          >
            {p.label}
          </button>
        ))}
        {isZoomed && activePreset === null && (
          <button onClick={resetZoom} style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${C.amber}`, background: 'var(--warning-dim)', color: C.amber,
          }}>
            ✕ Reset
          </button>
        )}
        <span style={{ fontSize: 9, color: C.faint, marginLeft: 6 }}>or drag on chart to zoom</span>
      </div>

      {/* ── Legend ── */}
      <div style={{ padding: '2px 14px 2px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { color: C.blue,  label: 'MA150' },
          { color: C.amber, label: 'MA50' },
          { color: swingActive ? C.amber : C.muted, label: 'MA20', dash: true },
          { color: 'rgba(167,139,250,0.5)', label: 'Base zone', rect: true },
          { color: 'var(--accent)', label: 'Breakout' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {item.rect
              ? <div style={{ width: 12, height: 10, background: 'rgba(167,139,250,0.25)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 2 }} />
              : <svg width={16} height={4}><line x1={0} y1={2} x2={16} y2={2} stroke={item.color} strokeWidth={2} strokeDasharray={item.dash ? '4 2' : undefined} /></svg>
            }
            <span style={{ fontSize: 9, color: C.faint, letterSpacing: '0.04em' }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* ── Main price chart ── */}
      <div style={{ padding: '4px 0 0', width: '100%', userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            data={visibleRows}
            syncId="sc"
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <CartesianGrid stroke={C.border} strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: C.muted, fontSize: 10 }}
              axisLine={{ stroke: C.border }}
              tickLine={false}
              minTickGap={52}
            />
            <YAxis
              domain={[priceMin, priceMax]}
              tick={{ fill: C.muted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={fmtPx}
            />
            <Tooltip content={<PriceTooltip />} cursor={{ stroke: C.faint, strokeWidth: 1, strokeDasharray: '3 2' }} />

            {/* Base zones */}
            {zones.map((z, i) => (
              <ReferenceArea key={i} x1={z.x1} x2={z.x2} fill="rgba(167,139,250,0.07)" stroke="rgba(167,139,250,0.18)" strokeWidth={1} />
            ))}

            {/* Drag-to-zoom selection overlay */}
            {selX1 && selX2 && (
              <ReferenceArea x1={selX1} x2={selX2} fill="rgba(96,165,250,0.12)" stroke={C.blue} strokeWidth={1} strokeDasharray="3 2" />
            )}

            {/* MA lines */}
            <Line type="monotone" dataKey="ma150" stroke={C.blue}  strokeWidth={1.5} dot={false} strokeOpacity={0.65} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="ma50"  stroke={C.amber} strokeWidth={1.5} dot={false} strokeOpacity={0.7}  isAnimationActive={false} connectNulls />
            <Line
              type="monotone" dataKey="ma20"
              stroke={swingActive ? C.amber : C.muted}
              strokeWidth={swingActive ? 1.5 : 1}
              strokeDasharray={swingActive ? '5 3' : undefined}
              strokeOpacity={swingActive ? 1 : 0.4}
              dot={false} isAnimationActive={false} connectNulls
            />
            {swingActive && <>
              <Line type="monotone" dataKey="ma20upper" stroke={C.amber} strokeWidth={0.5} strokeDasharray="3 3" strokeOpacity={0.4} dot={false} isAnimationActive={false} connectNulls />
              <Line type="monotone" dataKey="ma20lower" stroke={C.amber} strokeWidth={0.5} strokeDasharray="3 3" strokeOpacity={0.4} dot={false} isAnimationActive={false} connectNulls />
            </>}

            {/* Candlesticks rendered as a direct chart child — Recharts v3 */}
            <CandleLayer data={visibleRows} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── RSI sub-chart ── */}
      <div style={{ width: '100%' }}>
        <div style={{ paddingLeft: 66, paddingBottom: 1 }}>
          <span style={{ fontSize: 9, color: C.faint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>RSI (14)</span>
        </div>
        <ResponsiveContainer width="100%" height={76}>
          <ComposedChart data={visibleRows} syncId="sc" margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis domain={[0, 100]} tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} width={64} ticks={[30, 50, 70]} />
            <CartesianGrid stroke={C.border} strokeDasharray="2 3" vertical={false} />
            <ReferenceArea y1={swingActive ? 40 : 30} y2={swingActive ? 65 : 70} fill="rgba(52,211,153,0.07)" />
            <ReferenceLine y={50} stroke={C.faint}  strokeDasharray="2 2" />
            <ReferenceLine y={70} stroke={C.red}    strokeWidth={0.6} strokeOpacity={0.5} />
            <ReferenceLine y={30} stroke={C.green}  strokeWidth={0.6} strokeOpacity={0.5} />
            <Tooltip content={<RsiTooltip />} cursor={{ stroke: C.faint, strokeWidth: 1 }} />
            <Line type="monotone" dataKey="rsi" stroke={C.purple} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Volume sub-chart ── */}
      <div style={{ width: '100%' }}>
        <div style={{ paddingLeft: 66, paddingBottom: 1 }}>
          <span style={{ fontSize: 9, color: C.faint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Volume</span>
        </div>
        <ResponsiveContainer width="100%" height={76}>
          <ComposedChart data={visibleRows} syncId="sc" margin={{ top: 2, right: 8, left: 0, bottom: 2 }}>
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: C.muted, fontSize: 9 }}
              axisLine={{ stroke: C.border }}
              tickLine={false}
              minTickGap={52}
            />
            <YAxis domain={[0, volMax]} tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtVol} />
            <CartesianGrid stroke={C.border} strokeDasharray="2 3" vertical={false} />
            <Bar dataKey="volume" shape={<VolumeBar />} isAnimationActive={false} maxBarSize={14} minPointSize={1} />
            {swingActive && (
              <Line type="monotone" dataKey="spikeThreshold" stroke={C.red} strokeWidth={0.8} strokeDasharray="3 2" strokeOpacity={0.5} dot={false} isAnimationActive={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Disclaimer ── */}
      <div style={{ padding: '5px 14px 8px', borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: 9, color: C.faint, margin: 0, textAlign: 'center' }}>
          Historical price levels shown for informational purposes only. Not indicative of future performance. Not investment advice.
        </p>
      </div>
    </div>
  )
}
