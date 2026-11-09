/**
 * charts.jsx — plain inline SVG small multiples. No chart library.
 *
 * Deterministic output (fixed viewBox, coordinates rounded to 0.1) so the
 * Node prerender and the browser preview produce identical markup.
 * Colours come from study.css classes, never inline fills.
 */
import { toNum } from './format.js'

const r1 = (n) => Math.round(n * 10) / 10

/**
 * Bar small multiple. points: [{ label, value }], oldest first.
 * Missing values leave an empty slot. Negative values hang below zero.
 */
export function MiniBars({ points, ariaLabel, formatValue }) {
  const W = 200
  const H = 96
  const top = 14
  const bottom = 78
  const values = points.map((p) => toNum(p.value))
  const known = values.filter((v) => v !== null)
  if (!known.length) return null
  const max = Math.max(0, ...known)
  const min = Math.min(0, ...known)
  const span = max - min || 1
  const y = (v) => top + ((max - v) / span) * (bottom - top)
  const zero = y(0)
  const slot = W / points.length
  const bw = Math.min(28, slot * 0.6)
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop()

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
      {values.map((v, i) => {
        if (v === null) return null
        const x = r1(i * slot + (slot - bw) / 2)
        const yv = y(v)
        const yTop = r1(Math.min(yv, zero))
        const h = r1(Math.max(0.5, Math.abs(zero - yv)))
        return <rect key={i} className={v < 0 ? 'st-bar-neg' : 'st-bar'} x={x} y={yTop} width={r1(bw)} height={h} />
      })}
      <line className="st-axis" x1="0" x2={W} y1={r1(zero)} y2={r1(zero)} />
      {lastIdx !== undefined && (
        <text
          className="st-svg-value"
          x={r1(lastIdx * slot + slot / 2)}
          y={r1(Math.max(9, Math.min(y(values[lastIdx]), zero) - 3))}
          textAnchor="middle"
        >
          {formatValue(values[lastIdx])}
        </text>
      )}
      <text className="st-svg-label" x={r1(slot / 2)} y={H - 4} textAnchor="middle">{points[0].label}</text>
      {points.length > 1 && (
        <text className="st-svg-label" x={r1(W - slot / 2)} y={H - 4} textAnchor="middle">
          {points[points.length - 1].label}
        </text>
      )}
    </svg>
  )
}

/** Line small multiple (used for ratios such as margins). */
export function MiniLine({ points, ariaLabel, formatValue }) {
  const W = 200
  const H = 96
  const top = 14
  const bottom = 78
  const values = points.map((p) => toNum(p.value))
  const known = values.filter((v) => v !== null)
  if (!known.length) return null
  let max = Math.max(...known)
  let min = Math.min(...known)
  if (max === min) {
    max += 1
    min -= 1
  }
  const pad = (max - min) * 0.1
  max += pad
  min -= pad
  const slot = W / points.length
  const x = (i) => r1(i * slot + slot / 2)
  const y = (v) => r1(top + ((max - v) / (max - min)) * (bottom - top))

  // Break the line at missing values.
  const segments = []
  let cur = []
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur)
      cur = []
    } else cur.push(`${x(i)},${y(v)}`)
  })
  if (cur.length) segments.push(cur)
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop()

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
      <line className="st-axis" x1="0" x2={W} y1={bottom} y2={bottom} />
      {segments.map((s, i) =>
        s.length > 1 ? <polyline key={i} className="st-line" points={s.join(' ')} /> : null,
      )}
      {values.map((v, i) => (v === null ? null : <circle key={i} className="st-dot" cx={x(i)} cy={y(v)} r="2" />))}
      {lastIdx !== undefined && (
        <text className="st-svg-value" x={x(lastIdx)} y={Math.max(9, y(values[lastIdx]) - 5)} textAnchor="middle">
          {formatValue(values[lastIdx])}
        </text>
      )}
      <text className="st-svg-label" x={x(0)} y={H - 4} textAnchor="middle">{points[0].label}</text>
      {points.length > 1 && (
        <text className="st-svg-label" x={x(points.length - 1)} y={H - 4} textAnchor="middle">
          {points[points.length - 1].label}
        </text>
      )}
    </svg>
  )
}

/** Tiny sparkline for table rows. Returns null with fewer than 2 values. */
export function Sparkline({ values, ariaLabel }) {
  const W = 60
  const H = 18
  const nums = values.map(toNum)
  const known = nums.filter((v) => v !== null)
  if (known.length < 2) return null
  let max = Math.max(...known)
  let min = Math.min(...known)
  if (max === min) {
    max += 1
    min -= 1
  }
  const step = nums.length > 1 ? (W - 4) / (nums.length - 1) : 0
  const pts = nums
    .map((v, i) => (v === null ? null : `${r1(2 + i * step)},${r1(2 + ((max - v) / (max - min)) * (H - 4))}`))
    .filter(Boolean)
  return (
    <svg className="st-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      <polyline className="st-line" points={pts.join(' ')} />
    </svg>
  )
}
