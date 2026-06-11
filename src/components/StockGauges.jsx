// StockGauges — four derived-analytics gauge rows for the stock
// detail page: 52-week range position, distance from the 30W trend
// line, RSI momentum category, and relative strength vs Nifty.
//
// DERIVED DATA ONLY — every value is a percentage, category label, or
// directional indicator. No raw prices, no raw RSI number, no raw
// volume. rangePosition is computed upstream from 52W high/low/close
// and arrives here as a 0-100 number; the rupee values never reach
// this component.
//
// Rows render-or-omit on missing inputs; the whole component returns
// null when nothing is renderable.
//
// (The brief listed a deliveryAboveAvg prop — deliberately not taken:
// none of the four gauges uses it, and the backend hardcodes the
// underlying condition false since delivery left the SwingX score.)

import { C } from '../styles/tokens'

// RSI category → filled-dot count for the momentum row.
const RSI_DOTS = {
  Healthy: 4,
  Extended: 5,
  Neutral: 3,
  Oversold: 1,
  Overbought: 5,
}

const RSI_DOT_COLOR = {
  Healthy: C.green,
  Neutral: C.green,
  Extended: C.amber,
  Overbought: C.amber,
  Oversold: C.red,
}

function LabelRow({ name, value, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 11, color: C.textMuted }}>{name}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: valueColor || C.text }}>{value}</span>
    </div>
  )
}

// Plain left-anchored bar (52W range).
function Bar({ widthPct, color }) {
  return (
    <div
      style={{
        height: 6,
        borderRadius: 3,
        background: C.border,
        overflow: 'hidden',
        marginTop: 4,
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 3,
          width: `${Math.max(0, Math.min(100, widthPct))}%`,
          background: color,
          transition: 'width 0.6s ease',
        }}
      />
    </div>
  )
}

// Centre-anchored bar (trend distance, RS vs Nifty). Positive →
// green fill grows rightward from the centre marker; negative → red
// fill grows leftward. ±50 maps to a full half-bar; beyond that the
// fill caps (the label still carries the exact number).
function CenterBar({ value }) {
  const positive = value >= 0
  const w = Math.min(50, Math.abs(value)) // % of total width, capped at half
  return (
    <div
      style={{
        position: 'relative',
        height: 6,
        borderRadius: 3,
        background: C.border,
        overflow: 'hidden',
        marginTop: 4,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          height: '100%',
          borderRadius: 3,
          background: positive ? C.green : C.red,
          left: positive ? '50%' : `${50 - w}%`,
          width: `${w}%`,
          transition: 'width 0.6s ease, left 0.6s ease',
        }}
      />
      {/* centre marker */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          width: 1,
          height: '100%',
          background: C.textMuted,
        }}
      />
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
  const hasRsi = rsiCategory && RSI_DOTS[rsiCategory] != null
  const hasRs = Number.isFinite(Number(rsVsNifty))
  if (!hasRange && !hasTrend && !hasRsi && !hasRs) return null

  const range = hasRange ? Math.max(0, Math.min(100, Number(rangePosition))) : null
  const trend = hasTrend ? Number(pctFromMa) : null
  const rs = hasRs ? Number(rsVsNifty) : null

  const rangeLabel =
    range == null ? '' :
    range > 75 ? 'Near upper range' :
    range >= 50 ? 'Upper half' :
    range >= 25 ? 'Lower half' : 'Near lower range'
  const rangeColor =
    range == null ? C.border :
    range > 60 ? C.green :
    range >= 40 ? C.amber : C.red

  const dots = hasRsi ? RSI_DOTS[rsiCategory] : 3
  const dotColor = hasRsi ? (RSI_DOT_COLOR[rsiCategory] || C.green) : C.green

  return (
    <div>
      {/* GAUGE 1 — 52-week range position */}
      {hasRange && (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <LabelRow name="52-Week Range" value={`${range.toFixed(0)}% — ${rangeLabel}`} />
          <Bar widthPct={range} color={rangeColor} />
        </div>
      )}

      {/* GAUGE 2 — distance from the 30W trend line */}
      {hasTrend && (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <LabelRow
            name="Distance from Trend Line"
            value={`${trend > 0 ? '+' : ''}${trend.toFixed(1)}%`}
            valueColor={trend >= 0 ? C.green : C.red}
          />
          <CenterBar value={trend} />
          <div
            style={{
              fontSize: 10,
              marginTop: 4,
              color: trend >= 0 ? C.green : C.red,
            }}
          >
            {trend >= 0 ? 'Above long-term trend ↑' : 'Below long-term trend ↓'}
          </div>
        </div>
      )}

      {/* GAUGE 3 — momentum (RSI category as dots, never the raw number) */}
      {hasRsi && (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <LabelRow name="Momentum" value={rsiCategory} />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: i < dots ? dotColor : 'transparent',
                  border: i < dots ? 'none' : `1px solid ${C.border}`,
                  display: 'inline-block',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* GAUGE 4 — relative strength vs Nifty 50 */}
      {hasRs && (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <LabelRow
            name="vs Nifty 50"
            value={`${rs > 0 ? '+' : ''}${rs.toFixed(1)}%`}
            valueColor={rs >= 0 ? C.green : C.red}
          />
          <CenterBar value={rs} />
          <div
            style={{
              fontSize: 10,
              marginTop: 4,
              color: rs > 5 ? C.green : rs < -5 ? C.red : C.textMuted,
            }}
          >
            {rs > 5 ? '↑ Outperforming Nifty' : rs < -5 ? '↓ Underperforming Nifty' : '→ Tracking Nifty'}
          </div>
        </div>
      )}
    </div>
  )
}
