import { C } from '../styles/tokens'
import { isStageOnePlus } from '../lib/stageUi'
import InfoHint from './InfoHint'

const ROWS = [
  {
    key: 'is_stage2',
    name: 'Stage 2 active',
    infoId: 'swing_stage2',
    desc: 'Price above 30W MA with OBV rising',
  },
  {
    key: 'is_delivery_above_avg',
    name: 'Delivery above average',
    infoId: 'swing_delivery',
    desc: 'More than normal delivery versus recent sessions',
  },
  {
    key: 'is_near_ma20',
    name: 'Near 20-day MA',
    infoId: 'swing_near_ma20',
    desc: 'Close to the 20-day moving average band',
  },
  {
    key: 'is_rsi_healthy',
    name: 'RSI 40-65',
    infoId: 'swing_rsi',
    desc: 'Momentum healthy — not overheated',
  },
  {
    key: 'is_volume_contracting',
    name: 'Volume contracting on pullback',
    infoId: 'swing_volume',
    desc: 'Selling pressure easing on declines',
  },
]

function has(conditions, key) {
  return Boolean(conditions?.[key])
}

function countPillStyle(count) {
  if (count === 0) {
    return {
      bg: 'rgba(239,68,68,0.12)',
      color: '#EF4444',
      border: '1px solid rgba(239,68,68,0.45)',
      text: '0 of 5 conditions',
    }
  }
  if (count <= 2) {
    return {
      bg: 'rgba(245,158,11,0.12)',
      color: '#F59E0B',
      border: '1px solid rgba(245,158,11,0.45)',
      text: `${count} of 5 conditions`,
    }
  }
  if (count <= 4) {
    return {
      bg: 'rgba(34,197,94,0.12)',
      color: '#22C55E',
      border: '1px solid rgba(34,197,94,0.45)',
      text: `${count} of 5 conditions`,
    }
  }
  return {
    bg: 'rgba(74,222,128,0.18)',
    color: '#4ADE80',
    border: '1px solid #22C55E',
    text: '5 of 5 — All conditions met',
  }
}

export default function SwingConditions({ conditions = {}, title = 'Swing conditions', stage = null, ma30w = null }) {
  const count = ROWS.filter((row) => has(conditions, row.key)).length
  const breakout = Boolean(conditions?.is_52w_breakout || conditions?.breakout_52w)
  const enteredStage2 = Boolean(conditions?.entered_stage2_this_week || conditions?.stage2_entered_this_week)
  const pill = countPillStyle(count)

  return (
    <div
      className="rounded-[12px] border"
      style={{ background: '#0D1525', borderColor: '#1E293B', padding: '20px', marginBottom: '16px' }}
    >
      <h3
        className="m-0 font-bold"
        style={{
          fontSize: '11px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: '#64748B',
          marginBottom: '16px',
        }}
      >
        {title}
      </h3>
      <p className="m-0 mb-4 text-[11px] italic" style={{ color: '#64748B' }}>
        Common swing checks · Not a trade recommendation.
      </p>

      <div>
        {ROWS.map((row) => {
          const ok = has(conditions, row.key)
          return (
            <div
              key={row.key}
              className="border border-solid"
              style={{
                background: '#0D1525',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 8,
                borderColor: '#1E293B',
                borderLeftWidth: 4,
                borderLeftColor: ok ? '#22C55E' : '#475569',
              }}
            >
              <div className="flex gap-2">
                <span className="shrink-0 text-[14px] leading-snug" style={{ color: ok ? '#22C55E' : '#64748B' }}>
                  {ok ? '✅' : '⬜'}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1 text-[13px] font-medium leading-snug" style={{ color: '#F1F5F9' }}>
                    <span>{row.name}</span>
                    {row.infoId ? <InfoHint id={row.infoId} size={13} /> : null}
                  </p>
                  <p className="text-[12px] leading-snug" style={{ color: '#64748B' }}>
                    {row.desc}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div
        className="mt-2 inline-flex rounded-full px-3 py-1.5 text-[12px] font-bold"
        style={{ background: pill.bg, color: pill.color, border: pill.border }}
      >
        {pill.text}
      </div>

      {breakout || enteredStage2 ? (
        <div className="mt-3 space-y-1 text-sm" style={{ color: C.text }}>
          {breakout ? <p className="m-0">🚀 52-week high breakout today</p> : null}
          {enteredStage2 ? <p className="m-0">⭐ Entered Stage 2 this week</p> : null}
        </div>
      ) : null}

      {isStageOnePlus(stage) && Number.isFinite(Number(ma30w)) ? (
        <div
          className="mt-3 space-y-1 rounded-lg border px-3 py-2.5 text-[13px] leading-snug"
          style={{ borderColor: 'rgba(13, 148, 136, 0.45)', background: 'rgba(13, 148, 136, 0.08)', color: '#CCFBF1' }}
        >
          <p className="m-0 font-medium">Price near 30W MA — potential breakout zone</p>
          <p className="m-0" style={{ color: '#94A3B8' }}>
            Watch for confirmed close above ₹{Number(ma30w).toFixed(0)}
          </p>
        </div>
      ) : null}
    </div>
  )
}
