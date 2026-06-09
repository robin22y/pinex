// CriteriaChart — 60-day evolution of the SwingX conditions_met score
// (0-5) for a single stock. Shows the journey, not just today's number.
//
// SCHEMA NOTE — the brief specified
//   .eq('symbol', symbol)  /  .order('trading_date', desc)
// but swing_conditions actually uses company_id + date (NOT symbol +
// trading_date). The query below uses the same companies!inner(symbol)
// embed pattern the rest of the app uses to filter by URL symbol.
//
// TOKEN NOTE — the brief said `C.card`; global tokens export
// `surfaceCard` (no plain `card`). Same intent; using the real export.

import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { C } from '../styles/tokens'
import SectionLabel from './ui/SectionLabel'

// Minimum data points before we render a line at all. Two is enough
// for Recharts to draw a real line segment; below that we render
// nothing (the section label is gated on the same check, so an empty
// chart never leaves an orphaned heading on the page).
const MIN_POINTS = 2

// Per-symbol promise cache. React.StrictMode in dev fires effects
// twice — this dedupes the swing_conditions fetch to one round-trip.
// Also covers back-navigation to a previously-viewed stock within
// the same session. Conditions data only changes daily post-EOD so
// within-session staleness is acceptable; hard-refresh forces re-pull.
const chartCache = new Map()

export default function CriteriaChart({ symbol }) {
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!symbol) { setLoading(false); setChartData([]); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const key = String(symbol).toUpperCase()
      let data
      if (chartCache.has(key)) {
        data = await chartCache.get(key)
      } else {
        const promise = supabase
          .from('swing_conditions')
          .select('date, conditions_met, companies!inner(symbol)')
          .eq('companies.symbol', symbol)
          .order('date', { ascending: false })
          .limit(60)
          .then((r) => (r?.error ? null : (r?.data ?? [])))
          .catch(() => null)
        chartCache.set(key, promise)
        data = await promise
        if (data === null) chartCache.delete(key)
      }
      if (cancelled) return
      // Reverse → oldest-first for the chart; slice ISO date to "MM-DD".
      const points = (data || []).reverse().map((row) => ({
        date: String(row?.date || '').slice(5, 10),
        score: Number(row?.conditions_met) || 0,
      }))
      setChartData(points)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [symbol])

  // No spinner per brief. Return null while loading OR when history
  // is too thin to draw a useful line (< MIN_POINTS). The SectionLabel
  // is rendered INSIDE the component (below) so that returning null
  // also hides the heading — no orphaned title on stocks with thin
  // swing_conditions history.
  if (loading) return null
  if (chartData.length < MIN_POINTS) return null

  return (
    <div style={{ marginTop: 28 }}>
      <SectionLabel text="Conditions score — last 60 days" />
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: '16px 8px 8px 8px', marginTop: 4 }}>
      <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 8, paddingLeft: 8 }}>
        Conditions score — last {chartData.length} trading days
      </p>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: C.textMuted, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fill: C.textMuted, fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            contentStyle={{ background: C.surfaceCard, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: C.textMuted }}
            itemStyle={{ color: C.text }}
            formatter={(value) => [`${value} / 5`, 'Score']}
          />
          <ReferenceLine y={4} stroke={C.green} strokeDasharray="3 3" strokeOpacity={0.4} />
          <ReferenceLine y={2} stroke={C.amber} strokeDasharray="3 3" strokeOpacity={0.4} />
          <Line type="monotone" dataKey="score" stroke={C.blue} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C.blue }} />
        </LineChart>
      </ResponsiveContainer>
      <p style={{ color: C.textMuted, fontSize: 10, paddingLeft: 8, marginTop: 4, fontStyle: 'italic' }}>
        Green line = 4/5 · Amber line = 2/5 · Not investment advice
      </p>
      </div>
    </div>
  )
}
