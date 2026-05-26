import { C } from '../styles/tokens'
import { isStageOnePlus } from '../lib/stageUi'
import InfoHint from './InfoHint'

const ROWS = [
  {
    key: 'is_stage2',
    name: 'Stage 2 active',
    infoId: 'swing_stage2',
    desc: 'Price above 30W trend line with OBV rising',
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
      bg: 'var(--negative-dim)',
      color: 'var(--negative)',
      border: '1px solid var(--negative-dim)',
      text: '0 of 5 conditions',
    }
  }
  if (count <= 2) {
    return {
      bg: 'var(--warning-dim)',
      color: 'var(--warning)',
      border: '1px solid var(--warning-dim)',
      text: `${count} of 5 conditions`,
    }
  }
  if (count <= 4) {
    return {
      bg: 'var(--stage2-bg)',
      color: 'var(--positive)',
      border: '1px solid var(--stage2-border)',
      text: `${count} of 5 conditions`,
    }
  }
  return {
    bg: 'var(--stage2-bg)',
    color: 'var(--positive-soft)',
    border: '1px solid var(--stage2-border)',
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
      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', padding: '20px', marginBottom: '16px' }}
    >
      <h3
        className="m-0 font-bold"
        style={{
          fontSize: '11px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: '16px',
        }}
      >
        {title}
      </h3>
      <p className="m-0 mb-4 text-[11px] italic" style={{ color: 'var(--text-muted)' }}>
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
                background: 'var(--bg-input)',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 8,
                borderColor: 'var(--border)',
                borderLeftWidth: 4,
                borderLeftColor: ok ? 'var(--positive)' : 'var(--text-hint)',
              }}
            >
              <div className="flex gap-2">
                <span className="shrink-0 text-[14px] leading-snug" style={{ color: ok ? 'var(--positive)' : 'var(--text-muted)' }}>
                  {ok ? '✅' : '⬜'}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1 text-[13px] font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                    <span>{row.name}</span>
                    {row.infoId ? <InfoHint id={row.infoId} size={13} /> : null}
                  </p>
                  <p className="text-[12px] leading-snug" style={{ color: 'var(--text-muted)' }}>
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
          {breakout ? <p className="m-0">🚀 New 52-week high today (above key level)</p> : null}
          {enteredStage2 ? <p className="m-0">⭐ Entered Stage 2 this week</p> : null}
        </div>
      ) : null}

      {isStageOnePlus(stage) && Number.isFinite(Number(ma30w)) ? (
        <div
          className="mt-3 space-y-1 rounded-lg border px-3 py-2.5 text-[13px] leading-snug"
          style={{ borderColor: 'rgba(13, 148, 136, 0.45)', background: 'rgba(13, 148, 136, 0.08)', color: '#CCFBF1' }}
        >
          <p className="m-0 font-medium">Price near 30W Trend Line — possible test of the average</p>
          <p className="m-0" style={{ color: 'var(--text-secondary)' }}>
            Watch for confirmed close above ₹{Number(ma30w).toFixed(0)}
          </p>
        </div>
      ) : null}
    </div>
  )
}
