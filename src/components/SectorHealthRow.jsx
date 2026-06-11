// SectorHealthRow — one-line "[SECTOR] [bar] N% participation · trend"
// chip on the stock detail page. Reads the latest sectors row for the
// stock's sector + the lookback row for the week-over-week delta.
// Tap → /home?tab=sectors (the Sectors view) so the user can see
// where this fits in the broader breadth picture.
//
// Returns null when the stock has no sector tag or no sectors row
// exists for it yet. The trend line is suppressed cleanly when the
// history table has fewer than ~7 days of rows; the percentage + bar
// still render.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

const TREND_LOOKBACK = 7

function pctColor(pct) {
  if (pct >= 60) return C.green
  if (pct >= 40) return C.amber
  return C.red
}

export default function SectorHealthRow({ sector }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!sector) { setData(null); return }
    let cancelled = false
    ;(async () => {
      try {
        // Pull every row for this sector ordered by date desc — newest
        // is "today", row ~7 back is the comparator. Caps at 60 days.
        const { data: rows } = await supabase
          .from('sectors')
          .select('stage2_pct,stage2_count,total_companies,date')
          .eq('name', sector)
          .order('date', { ascending: false })
          .limit(60)
        const arr = rows || []
        if (!arr.length) { if (!cancelled) setData(null); return }
        const today = arr[0]
        const prevIdx = Math.min(arr.length - 1, TREND_LOOKBACK)
        const prev = arr[prevIdx]
        const prevPct = prev && prev.date !== today.date ? Number(prev.stage2_pct) : null
        if (cancelled) return
        setData({
          pct: Number(today.stage2_pct) || 0,
          count: Number(today.stage2_count) || 0,
          total: Number(today.total_companies) || 0,
          prevPct,
        })
      } catch {
        if (!cancelled) setData(null)
      }
    })()
    return () => { cancelled = true }
  }, [sector])

  if (!sector || !data) return null

  const delta = data.prevPct != null ? data.pct - data.prevPct : null
  const trendText =
    delta == null ? null :
    delta > 5 ? { text: `↑ Gaining (was ${data.prevPct.toFixed(0)}%)`, color: C.green } :
    delta < -5 ? { text: `↓ Losing (was ${data.prevPct.toFixed(0)}%)`, color: C.red } :
    { text: '→ Steady', color: C.textMuted }
  const fill = pctColor(data.pct)

  return (
    <button
      type="button"
      onClick={() => navigate('/home?tab=sectors')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: C.surface2,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        cursor: 'pointer',
        marginBottom: 12,
        width: '100%',
        textAlign: 'left',
        color: 'inherit',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: C.textMuted,
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {sector}
      </span>
      <div
        style={{
          width: 80,
          height: 4,
          borderRadius: 2,
          background: C.border,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 2,
            width: `${Math.max(0, Math.min(100, data.pct))}%`,
            background: fill,
          }}
        />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: fill, flexShrink: 0 }}>
        {data.pct.toFixed(0)}%
      </span>
      <span style={{ fontSize: 10, color: C.textFaint, flexShrink: 0 }}>
        participation
      </span>
      {trendText && (
        <span style={{ fontSize: 10, color: trendText.color, marginLeft: 'auto' }}>
          {trendText.text}
        </span>
      )}
    </button>
  )
}
