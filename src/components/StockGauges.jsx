// StockGauges — terminal-style metric strip on the stock detail page.
// Four single-line rows: 52-Week Range, Distance from 30W MA,
// Volume Persistence, 30W RS vs Nifty 50.
//
// Prop contract (DO NOT BREAK — consumed by StockDetail.jsx):
//   pctFromMa      — number, % distance from 30W MA (signed)
//   rangePosition  — 0..100, % through the 52-week range
//   rsVsNifty      — number, % relative strength vs Nifty (signed)
//   rsiCategory    — 'Overbought'|'Extended'|'Healthy'|'Neutral'|'Oversold'
//                    (re-purposed in the new design as a 1–5 persistence
//                    bucket; raw RSI is never rendered)
//
// Render-or-omit: each row gates on a finite number / known category.
// Component returns null when nothing is renderable.

import { C } from '../styles/tokens'

// Category → block count (1..5). Order encodes "how persistent": single
// short-window readings (Oversold) at the bottom, sustained readings
// (Overbought) at the top.
const BLOCK_MAP = {
  Overbought: 5,
  Extended:   4,
  Healthy:    3,
  Neutral:    2,
  Oversold:   1,
}

const BLOCK_COLOR_MAP = {
  Overbought: C.red,
  Extended:   C.amber,
  Healthy:    C.green,
  Neutral:    C.textMuted,
  Oversold:   C.red,
}

// 0..100 position rendered as a 2px vertical tick on a 1px track.
function TickBar({ position, color }) {
  return (
    <div style={{
      position: 'relative',
      height: 12,
      display: 'flex',
      alignItems: 'center',
    }}>
      <div style={{
        position: 'absolute',
        left: 0, right: 0,
        height: 1,
        background: C.border,
      }} />
      <div style={{
        position: 'absolute',
        left: `${Math.min(Math.max(position, 0), 100)}%`,
        transform: 'translateX(-50%)',
        width: 2,
        height: 10,
        background: color,
        borderRadius: 0,
      }} />
    </div>
  )
}

// Zero-centred bar. Positive value → green fill grows rightward from
// the centre marker; negative → red fill grows leftward. Magnitudes
// beyond maxAbs clamp to the edge (the right-column number still
// carries the precise value).
function ZeroBar({ value, maxAbs = 50 }) {
  const clamped = Math.min(Math.max(value, -maxAbs), maxAbs)
  const pct = (clamped / maxAbs) * 50
  const isPositive = clamped >= 0
  const color = isPositive ? C.green : C.red
  return (
    <div style={{
      position: 'relative',
      height: 12,
      display: 'flex',
      alignItems: 'center',
    }}>
      <div style={{
        position: 'absolute',
        left: 0, right: 0,
        height: 1,
        background: C.border,
      }} />
      <div style={{
        position: 'absolute',
        left: '50%',
        width: 1,
        height: 8,
        background: C.textFaint,
      }} />
      <div style={{
        position: 'absolute',
        left: isPositive ? '50%' : `${50 + pct}%`,
        width: `${Math.abs(pct)}%`,
        height: 1,
        background: color,
      }} />
      <div style={{
        position: 'absolute',
        left: `${50 + pct}%`,
        transform: 'translateX(-50%)',
        width: 2,
        height: 10,
        background: color,
        borderRadius: 0,
      }} />
    </div>
  )
}

// Block meter — five 8×10 cells. Filled count comes from BLOCK_MAP,
// fill colour from BLOCK_COLOR_MAP. Sharp corners (radius 0).
function BlockMeter({ category }) {
  const count = BLOCK_MAP[category] ?? 0
  const color = BLOCK_COLOR_MAP[category] ?? C.textMuted
  return (
    <div style={{
      display: 'flex',
      gap: 2,
      alignItems: 'center',
    }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{
          width: 8,
          height: 10,
          background: i <= count ? color : C.border,
          borderRadius: 0,
        }} />
      ))}
    </div>
  )
}

// Three-column grid: label · bar · value. The bar slot owns the centre
// column at 1fr so the track always fills the available width between
// the fixed-width label and value columns.
function MetricRow({ label, bar, value, valueColor, isFirst }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr 72px',
      alignItems: 'center',
      gap: 12,
      padding: '10px 0',
      borderTop: isFirst ? 'none' : `1px solid ${C.border}`,
    }}>
      <span style={{
        fontSize: 12,
        color: C.textMuted,
        letterSpacing: '0.02em',
      }}>
        {label}
      </span>
      {bar}
      <span className="num" style={{
        fontSize: 13,
        fontWeight: 500,
        color: valueColor ?? C.text,
        textAlign: 'right',
      }}>
        {value}
      </span>
    </div>
  )
}

export default function StockGauges({
  pctFromMa,
  rangePosition,
  rsVsNifty,
  rsiCategory,
}) {
  const hasRange = Number.isFinite(Number(rangePosition))
  const hasTrend = Number.isFinite(Number(pctFromMa))
  const hasRsi   = rsiCategory != null && BLOCK_MAP[rsiCategory] != null
  const hasRs    = Number.isFinite(Number(rsVsNifty))
  if (!hasRange && !hasTrend && !hasRsi && !hasRs) return null

  const range = hasRange ? Math.max(0, Math.min(100, Number(rangePosition))) : null
  const trend = hasTrend ? Number(pctFromMa) : null
  const rs    = hasRs    ? Number(rsVsNifty) : null

  // Build the list of rows actually rendered so the first-row
  // no-top-border rule applies to whichever row lands first after
  // gating (not necessarily 52-Week Range).
  const rows = []
  if (hasRange) {
    rows.push({
      key: 'range',
      label: '52-Week Range',
      bar: <TickBar position={range} color={C.textMuted} />,
      value: `${range.toFixed(0)}%`,
      valueColor: C.textMuted,
    })
  }
  if (hasTrend) {
    rows.push({
      key: 'trend',
      label: 'Distance from 30W MA',
      bar: <ZeroBar value={trend} />,
      value: `${trend > 0 ? '+' : ''}${trend.toFixed(1)}%`,
      valueColor: trend >= 0 ? C.green : C.red,
    })
  }
  if (hasRsi) {
    rows.push({
      key: 'persistence',
      label: 'Volume Persistence',
      bar: <BlockMeter category={rsiCategory} />,
      value: `${BLOCK_MAP[rsiCategory] ?? 0} / 5`,
      valueColor: BLOCK_COLOR_MAP[rsiCategory] ?? C.textMuted,
    })
  }
  if (hasRs) {
    rows.push({
      key: 'rs',
      label: '30W RS vs Nifty 50',
      bar: <ZeroBar value={rs} />,
      value: `${rs > 0 ? '+' : ''}${rs.toFixed(1)}%`,
      valueColor: rs >= 0 ? C.green : C.red,
    })
  }

  return (
    <div style={{
      padding: 0,
      borderBottom: `1px solid ${C.border}`,
    }}>
      {rows.map((r, i) => (
        <MetricRow
          key={r.key}
          label={r.label}
          bar={r.bar}
          value={r.value}
          valueColor={r.valueColor}
          isFirst={i === 0}
        />
      ))}
    </div>
  )
}
