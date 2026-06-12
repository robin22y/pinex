import { useState } from 'react'
import { C } from '../styles/tokens'
import { isStageOnePlus } from '../lib/stageUi'
import InfoHint from './InfoHint'

// ── Cycle Analysis Criteria ─────────────────────────────────────────────────
// Presentation-only view of the pre-calculated swing_conditions row. Every
// label is framed as a factual, mathematical criterion (no opinions, no
// forward-looking language). The underlying data KEYS are unchanged — only the
// human-readable name/description shown to the user.
const ROWS = [
  {
    key: 'is_stage2',
    name: 'Price in advancing trend',
    infoId: 'swing_stage2',
    desc: 'Price above rising 30W trend line with OBV rising',
  },
  {
    key: 'is_delivery_above_avg',
    name: 'Delivery above 30D average',
    infoId: 'swing_delivery',
    desc: 'Delivery volume above 30-day average — factual data',
  },
  {
    key: 'is_near_ma20',
    name: 'Near 50-day MA',
    infoId: 'swing_near_ma20',
    desc: 'Within 3% of 50-day MA support level',
  },
  {
    key: 'is_rsi_healthy',
    name: 'RSI in reference range',
    infoId: 'swing_rsi',
    desc: 'RSI between 40-65 — mathematical indicator value',
  },
  {
    key: 'is_volume_contracting',
    name: 'Volume pattern: contracting',
    infoId: 'swing_volume',
    desc: 'Recent volume below 30-day average — factual data',
  },
]

function has(conditions, key) {
  return Boolean(conditions?.[key])
}

export default function SwingConditions({
  conditions = {},
  title = 'Cycle Analysis Criteria',
  stage = null,
  ma30w = null,
}) {
  const [showInfo, setShowInfo] = useState(false)
  const count = ROWS.filter((row) => has(conditions, row.key)).length
  const breakout = Boolean(conditions?.is_52w_breakout || conditions?.breakout_52w)
  const enteredStage2 = Boolean(
    conditions?.entered_stage2_this_week || conditions?.stage2_entered_this_week,
  )

  return (
    <div
      className="rounded-[12px] border"
      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', padding: '20px', marginBottom: '16px' }}
    >
      {/* Title + info button */}
      <div className="mb-4 flex items-center gap-2">
        <h3
          className="m-0 font-bold"
          style={{ fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-muted)' }}
        >
          {title}
        </h3>
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-label="About these criteria"
          aria-expanded={showInfo}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: showInfo ? 'var(--bg-surface)' : 'transparent',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontStyle: 'italic',
            fontWeight: 700,
            lineHeight: 1,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          i
        </button>
      </div>

      {/* Info panel — opens on tap */}
      {showInfo ? (
        <div
          className="mb-4 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
        >
          <p className="m-0 mb-2">
            These criteria are mathematical calculations based on end-of-day price, volume, and
            relative strength data.
          </p>
          <p className="m-0 mb-2">A higher score means more criteria are currently met.</p>
          <p className="m-0 mb-2">What the score means for your own analysis is your decision.</p>
          <p className="m-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            ℹ️ Data only · Not advice · Not SEBI registered
          </p>
        </div>
      ) : null}

      {/* Criteria rows */}
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
                {/* ✓ green when met · ✗ muted grey when not (never red) */}
                <span
                  className="shrink-0 text-[15px] font-bold leading-snug"
                  style={{ color: ok ? 'var(--positive)' : 'var(--text-hint)' }}
                >
                  {ok ? '✓' : '✗'}
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

      {/* Prominent score — [N]/5 large, "criteria met" muted below */}
      <div className="mt-3 flex items-baseline gap-2">
        <span
          style={{
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {count}/5
        </span>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          criteria met
        </span>
      </div>

      {/* "Changed today" badge — only renders when the pipeline's
          day-over-day diff produced a non-empty reason. Empty string
          (the default for unchanged days) is falsy and hides the badge
          entirely. Reason text is built deterministically server-side
          from a fixed labels dict — not user input, not AI-generated,
          safe to render straight into JSX. */}
      {conditions?.criteria_change_reason ? (
        <p
          style={{
            color: '#FBBF24',
            fontSize: '12px',
            marginTop: '8px',
            padding: '6px 8px',
            background: 'rgba(251,191,36,0.08)',
            borderRadius: '6px',
            border: '1px solid rgba(251,191,36,0.2)',
          }}
        >
          Changed today: {conditions.criteria_change_reason}
        </p>
      ) : null}

      {/* Special flags — factual, data-only framing */}
      {breakout || enteredStage2 ? (
        <div className="mt-3 space-y-1 text-[13px]" style={{ color: C.text }}>
          {breakout ? (
            <p className="m-0">
              📊 52-week high proximity: within 1% of 52W high{' '}
              <span style={{ color: 'var(--text-muted)' }}>ℹ️ Data only</span>
            </p>
          ) : null}
          {enteredStage2 ? (
            <p className="m-0">
              📊 Trend criteria change: advancing criteria newly met this week{' '}
              <span style={{ color: 'var(--text-muted)' }}>ℹ️ Data only</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 30W trend line reference (data field unchanged; wording kept factual) */}
      {isStageOnePlus(stage) && Number.isFinite(Number(ma30w)) ? (
        <div
          className="mt-3 space-y-1 rounded-lg border px-3 py-2.5 text-[13px] leading-snug"
          style={{ borderColor: 'rgba(13, 148, 136, 0.45)', background: 'rgba(13, 148, 136, 0.08)', color: '#CCFBF1' }}
        >
          <p className="m-0 font-medium">Price near 30W Trend Line</p>
          <p className="m-0" style={{ color: 'var(--text-secondary)' }}>
            30W Trend Line reference: ₹{Number(ma30w).toFixed(0)}
          </p>
        </div>
      ) : null}

      {/* Footer disclaimer */}
      <p className="m-0 mt-4 text-[11px] italic leading-snug" style={{ color: 'var(--text-muted)' }}>
        Cycle analysis criteria are mathematical calculations from EOD data only. Not investment
        advice. Not a recommendation. PineX is not SEBI registered.
      </p>
    </div>
  )
}
