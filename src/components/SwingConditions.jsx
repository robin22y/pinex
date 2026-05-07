import { C } from '../styles/tokens'

const ROWS = [
  {
    key: 'is_stage2',
    name: 'Stage 2 active',
    desc: 'Price trending above 30W MA, OBV rising',
  },
  {
    key: 'is_delivery_above_avg',
    name: 'Delivery above average',
    desc: 'More than normal delivery today',
  },
  {
    key: 'is_near_ma20',
    name: 'Near 20-day MA',
    desc: 'Within 3% of common support level',
  },
  {
    key: 'is_rsi_healthy',
    name: 'RSI 40-65',
    desc: 'Momentum healthy, not overheated',
  },
  {
    key: 'is_volume_contracting',
    name: 'Volume contracting on pullback',
    desc: 'Selling pressure reducing',
  },
]

function has(conditions, key) {
  return Boolean(conditions?.[key])
}

function countColor(count) {
  if (count >= 4) return C.green
  if (count >= 2) return C.amber
  return C.red
}

export default function SwingConditions({ conditions = {} }) {
  const count = ROWS.filter((row) => has(conditions, row.key)).length
  const breakout = Boolean(conditions?.is_52w_breakout || conditions?.breakout_52w)
  const enteredStage2 = Boolean(conditions?.entered_stage2_this_week || conditions?.stage2_entered_this_week)

  return (
    <div className="rounded-xl border p-4" style={{ background: C.surface, borderColor: C.border }}>
      <h3 className="text-base font-semibold" style={{ color: C.text }}>
        Swing Trader Conditions
      </h3>
      <p className="mt-1 text-xs italic" style={{ color: C.textMuted }}>
        Conditions swing traders commonly look for.
        <br />
        Not a trade recommendation.
      </p>

      <div className="mt-3 space-y-2">
        {ROWS.map((row) => {
          const ok = has(conditions, row.key)
          return (
            <div key={row.key} className="rounded-lg border p-2" style={{ borderColor: C.border, background: C.surface2 }}>
              <p className="text-sm font-medium" style={{ color: C.text }}>
                <span className="mr-2">{ok ? '✅' : '⬜'}</span>
                {row.name}
              </p>
              <p className="ml-6 text-xs" style={{ color: C.textMuted }}>
                {row.desc}
              </p>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-sm font-semibold" style={{ color: countColor(count) }}>
        {count} of 5 conditions present
      </p>

      {breakout || enteredStage2 ? (
        <div className="mt-2 space-y-1 text-sm" style={{ color: C.text }}>
          {breakout ? <p>🚀 52-week high breakout today</p> : null}
          {enteredStage2 ? <p>⭐ Entered Stage 2 this week</p> : null}
        </div>
      ) : null}
    </div>
  )
}
