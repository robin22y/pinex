// GuruScoreWidget — full-score home page entry point. Receives the
// computed score from useGuruScore (loading + scoreResult). Entire
// card is a <button> — tapping anywhere navigates to /my-calls
// where the shareable certificate + share button live.

import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'
import Icon from './ui/Icon'

function gainText(n) {
  if (n == null) return null
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

export default function GuruScoreWidget({ scoreResult, loading }) {
  const navigate = useNavigate()

  if (loading) {
    return (
      <div
        className="rounded-2xl border px-4 py-3 animate-pulse"
        style={{ borderColor: C.border, background: C.surface, height: 72 }}
      />
    )
  }

  if (!scoreResult || !scoreResult.stats) return null

  const { score, title, emoji, stats } = scoreResult

  const medalColor =
    score >= 85 ? '#F59E0B'
    : score >= 70 ? '#38BDF8'
    : score >= 55 ? '#22C55E'
    : '#A78BFA'

  const avgText = gainText(stats.avgGainPct)

  return (
    <button
      type="button"
      onClick={() => navigate('/my-calls')}
      className="w-full text-left"
    >
      <div
        className="rounded-2xl border px-4 py-4 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${C.base} 0%, ${C.base} 100%)`,
          borderColor: `${medalColor}55`,
        }}
      >
        {/* Glow spot */}
        <div style={{
          position: 'absolute',
          top: -20, right: -20,
          width: 120, height: 120,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${medalColor}18 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        {/* Top accent line */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 2,
          borderRadius: '99px 99px 0 0',
          background: `linear-gradient(90deg, ${medalColor}, #38BDF8, #A78BFA)`,
        }} />

        <div className="flex items-center justify-between">
          {/* Left: score + title */}
          <div className="flex items-center gap-3">
            <div
              className="flex flex-col items-center justify-center rounded-xl"
              style={{
                width: 52, height: 52,
                background: `${medalColor}18`,
                border: `1px solid ${medalColor}44`,
                flexShrink: 0,
              }}
            >
              <Icon name={emoji} size={20} style={{ color: medalColor, display: 'inline-flex' }} aria-hidden />
              <span style={{ fontSize: 11, fontWeight: 800, color: medalColor, lineHeight: 1 }}>
                {score}
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: medalColor }}>
                Guru Score
              </p>
              <p className="text-base font-bold" style={{ color: C.text }}>
                {title}
              </p>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                {stats.totalCalls} tracked
                {avgText ? ` · avg ${avgText}` : ''}
                {stats.advancingNow > 0 ? ` · ${stats.advancingNow} advancing` : ''}
              </p>
            </div>
          </div>

          {/* Right: arrow + share hint */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
            <span style={{ color: medalColor, fontSize: 18 }}>›</span>
            <span className="text-xs" style={{ color: C.textMuted }}>Share →</span>
          </div>
        </div>
      </div>
    </button>
  )
}
