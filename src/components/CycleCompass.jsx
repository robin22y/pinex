// CycleCompass — SVG cycle-position dial for the stock detail page.
// Replaces the flat 5-dot criteria row with a richer derived-analytics
// visual: a 4-segment semicircle arc (one segment per Weinstein
// phase), an animated needle pointing at the active phase, the
// days-in-phase count in the hub, and 5 criteria "petals" around the
// hub (filled = criterion met today).
//
// DERIVED DATA ONLY — no raw prices anywhere in this component.
//
// The delivery petal renders permanently empty in practice: the
// backend hardcodes condition_delivery_above_avg=false since delivery
// was dropped from the SwingX score. That is accurate to the score
// (conditions_met counts 5 booleans, so the dial's "n of 5 filled"
// matches the n/5 score shown elsewhere on the page).

import { motion } from 'framer-motion'
import { C } from '../styles/tokens'

// Geometry — viewBox 280×200, hub centred low so the semicircle fills
// the top. All petal / needle / arc maths share these constants.
const CX = 140
const CY = 130
const ARC_R = 92        // arc centreline radius
const ARC_W = 16        // arc stroke width
const NEEDLE_R = 70     // needle tip radius (just inside the arc)
const PETAL_R = 55      // petal-centre distance from hub
const HUB_R = 40

const PHASES = [
  { key: 'basing',    label: 'BASING',    color: '#475569', from: 180, to: 135 },
  { key: 'advancing', label: 'ADVANCING', color: '#22C55E', from: 135, to: 90 },
  { key: 'topping',   label: 'TOPPING',   color: '#F59E0B', from: 90,  to: 45 },
  { key: 'declining', label: 'DECLINING', color: '#EF4444', from: 45,  to: 0 },
]

// Accepts both vocab sets ("Advancing" phase labels and "Stage 2"
// stage strings) so the caller can pass whichever it has.
function normalisePhase(raw) {
  const s = String(raw || '').toLowerCase()
  if (s.includes('advanc') || s.includes('stage 2') || s.includes('stage2')) return 'advancing'
  if (s.includes('bas')    || s.includes('stage 1') || s.includes('stage1')) return 'basing'
  if (s.includes('top')    || s.includes('stage 3') || s.includes('stage3')) return 'topping'
  if (s.includes('declin') || s.includes('stage 4') || s.includes('stage4')) return 'declining'
  return null
}

// Point on a circle around the hub. θ in degrees, standard
// orientation (0° = right, 90° = up). SVG y grows downward, so
// subtract the sine.
function pt(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) }
}

// One 45° arc segment as a stroked path. Left→right across the top is
// clockwise in screen coords → sweep flag 1.
function arcPath(fromDeg, toDeg) {
  const p1 = pt(fromDeg, ARC_R)
  const p2 = pt(toDeg, ARC_R)
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${ARC_R} ${ARC_R} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
}

export default function CycleCompass({
  phase,
  criteriaScore,
  daysInPhase,
  criteria = {},
}) {
  const activeKey = normalisePhase(phase)
  const active = PHASES.find((p) => p.key === activeKey) || null
  const needleAngle = active ? (active.from + active.to) / 2 : 90
  const needleTip = pt(needleAngle, NEEDLE_R)
  // Initial needle position — far left (Basing edge) so the mount
  // animation sweeps visibly to the target segment.
  const initTip = pt(180, NEEDLE_R)

  // Petal order mirrors the backend's 5 score booleans.
  const petals = [
    { key: 'stage2',   met: !!criteria.condition_stage2 },
    { key: 'near50',   met: !!criteria.condition_near_ma50 },
    { key: 'rsi',      met: !!criteria.condition_rsi_healthy },
    { key: 'volume',   met: !!criteria.condition_volume_contracting },
    { key: 'delivery', met: !!criteria.condition_delivery_above_avg },
  ]
  // Evenly spaced around the hub, starting at the top, clockwise.
  const petalPos = petals.map((_, i) => pt(90 - i * 72, PETAL_R))

  const daysText = daysInPhase != null && Number.isFinite(Number(daysInPhase))
    ? String(daysInPhase)
    : '—'

  return (
    <div
      style={{ maxWidth: 280, width: '100%', margin: '0 auto' }}
      aria-label={
        `Cycle position: ${active ? active.label : 'unknown'}` +
        (criteriaScore != null ? `, ${criteriaScore} of 5 criteria met` : '')
      }
    >
      <svg viewBox="0 0 280 200" width="100%" role="img" aria-hidden>
        {/* Phase arc — active segment full opacity, rest dimmed */}
        {PHASES.map((p) => (
          <path
            key={p.key}
            d={arcPath(p.from, p.to)}
            stroke={p.color}
            strokeWidth={ARC_W}
            fill="none"
            strokeLinecap="butt"
            opacity={active && active.key === p.key ? 1 : 0.25}
          />
        ))}

        {/* Needle — animates from the left edge to the active phase */}
        <motion.line
          x1={CX}
          y1={CY}
          stroke="#FFFFFF"
          strokeWidth={2}
          strokeLinecap="round"
          initial={{ x2: initTip.x, y2: initTip.y, opacity: 0.4 }}
          animate={{ x2: needleTip.x, y2: needleTip.y, opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />

        {/* Criteria petals — staggered fade-in */}
        {petals.map((petal, i) => (
          <motion.circle
            key={petal.key}
            cx={petalPos[i].x}
            cy={petalPos[i].y}
            r={10}
            fill={petal.met ? C.green : 'transparent'}
            stroke={petal.met ? 'none' : C.border}
            strokeWidth={petal.met ? 0 : 1.5}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: i * 0.1 }}
          />
        ))}

        {/* Hub — days-in-phase */}
        <circle
          cx={CX}
          cy={CY}
          r={HUB_R}
          fill={C.surface}
          stroke={active ? active.color : C.border}
          strokeWidth={2}
        />
        <text
          x={CX}
          y={CY + 2}
          textAnchor="middle"
          style={{ fontSize: 28, fontWeight: 700, fill: C.text }}
        >
          {daysText}
        </text>
        <text
          x={CX}
          y={CY + 20}
          textAnchor="middle"
          style={{ fontSize: 10, fill: C.textMuted }}
        >
          days
        </text>
      </svg>

      {/* Phase label */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: active ? active.color : C.textMuted,
          marginTop: 2,
        }}
      >
        {active ? active.label : '—'}
      </div>
    </div>
  )
}
