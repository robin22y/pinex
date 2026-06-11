// SectorPulse — compact two-column card on Home that nudges users
// toward the sectors view by showing the day's biggest movers in
// breadth (% of sector members above their 30W trend line).
//
// Self-fetching, gracefully degrades when the per-day history
// hasn't accumulated yet (the sectors table was a snapshot until
// scripts/sql/sectors_history_per_day.sql relaxed UNIQUE (name) to
// UNIQUE (name, date)). With zero history rows we still render the
// strongest + weakest current breadth — without arrows. Once 7+ days
// of history exist, week-over-week trend arrows light up
// automatically. Returns null on missing data.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

const MAX_ROWS = 3
const TREND_LOOKBACK = 7  // trading days back for the week-over-week delta

function trendBucket(delta) {
  if (delta == null) return { arrow: '', color: C.textMuted }
  if (delta > 8)  return { arrow: '↑↑', color: C.green }
  if (delta > 3)  return { arrow: '↑',  color: C.green }
  if (delta > -3) return { arrow: '→',  color: C.textMuted }
  if (delta > -8) return { arrow: '↓',  color: C.red }
  return { arrow: '↓↓', color: C.red }
}

function pctColor(pct) {
  if (pct >= 60) return C.green
  if (pct >= 40) return C.amber
  return C.red
}

export default function SectorPulse() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [rising, setRising] = useState([])
  const [falling, setFalling] = useState([])
  const [hasHistory, setHasHistory] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Single fetch — desc by date, big enough window to find both
        // today and the lookback row. ~50 sectors × ≤ 30 days = 1500
        // rows worst case, well under PostgREST's default limit.
        const { data } = await supabase
          .from('sectors')
          .select('name,stage2_pct,date')
          .order('date', { ascending: false })
          .limit(2000)
        const rows = data || []
        if (!rows.length) {
          if (!cancelled) { setLoading(false) }
          return
        }
        // Today's snapshot — every row whose date matches the newest.
        const newestDate = rows[0].date
        const today = rows.filter((r) => r.date === newestDate)

        // History bucket: keep ONE row per (name, date), then for each
        // sector pick the row roughly TREND_LOOKBACK trading days back.
        const bySector = new Map()  // name -> [{date, pct}, …] newest first
        for (const r of rows) {
          if (!bySector.has(r.name)) bySector.set(r.name, [])
          bySector.get(r.name).push({ date: r.date, pct: Number(r.stage2_pct) || 0 })
        }
        let historyFound = false
        const enriched = today.map((r) => {
          const series = bySector.get(r.name) || []
          // series[0] is today; the row at index TREND_LOOKBACK is
          // ~a week back. Fall back to the oldest available if the
          // history is shallower than that.
          const prevIdx = Math.min(series.length - 1, TREND_LOOKBACK)
          const prev = series[prevIdx]
          const prevPct = prev && prev.date !== r.date ? prev.pct : null
          if (prevPct != null) historyFound = true
          const today_pct = Number(r.stage2_pct) || 0
          return {
            name: r.name,
            today: today_pct,
            delta: prevPct != null ? today_pct - prevPct : null,
          }
        })
        const withDelta = enriched.filter((s) => s.delta != null)

        // Rising / falling pick lists. When history is empty, we
        // still show the strongest / weakest by current breadth so
        // the card isn't dead while data accumulates.
        let risingPicks, fallingPicks
        if (withDelta.length > 0) {
          risingPicks = [...withDelta].sort((a, b) => b.delta - a.delta).slice(0, MAX_ROWS)
          fallingPicks = [...withDelta].sort((a, b) => a.delta - b.delta).slice(0, MAX_ROWS)
        } else {
          risingPicks = [...enriched].sort((a, b) => b.today - a.today).slice(0, MAX_ROWS)
          fallingPicks = [...enriched].sort((a, b) => a.today - b.today).slice(0, MAX_ROWS)
        }
        if (cancelled) return
        setRising(risingPicks)
        setFalling(fallingPicks)
        setHasHistory(historyFound)
        setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) return null
  if (rising.length === 0 && falling.length === 0) return null

  const Col = ({ title, items, leftAlign }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: C.textMuted,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {items.map((s) => {
        const t = trendBucket(s.delta)
        return (
          <button
            key={s.name}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/home?tab=sectors`)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: leftAlign ? 'flex-start' : 'space-between',
              gap: 6,
              width: '100%',
              padding: '4px 0',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            <span
              style={{
                color: C.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
              }}
            >
              {s.name}
            </span>
            {t.arrow && (
              <span style={{ color: t.color, fontWeight: 700, flexShrink: 0 }}>
                {t.arrow}
              </span>
            )}
            <span
              style={{
                fontWeight: 700,
                color: pctColor(s.today),
                flexShrink: 0,
                minWidth: 38,
                textAlign: 'right',
              }}
            >
              {s.today.toFixed(0)}%
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate('/home?tab=sectors')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate('/home?tab=sectors')
      }}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
        cursor: 'pointer',
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: C.textMuted,
          marginBottom: 10,
        }}
      >
        Sector pulse
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        <Col
          title={hasHistory ? 'Gaining participation' : 'Highest participation'}
          items={rising}
          leftAlign={false}
        />
        <Col
          title={hasHistory ? 'Losing participation' : 'Lowest participation'}
          items={falling}
          leftAlign={false}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          color: C.amber,
          textAlign: 'right',
          marginTop: 8,
        }}
      >
        Tap to explore all sectors →
      </div>
    </div>
  )
}
