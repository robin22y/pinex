// SectorBreadth — three-column "Strong / Mixed / Weak" grouping of
// the sectors table by current % of members above the 30W trend
// line. Rendered ABOVE the existing Nifty Sector Performance table
// inside the Home page Sectors tab (homeTab==='sectors').
//
// Week-over-week trend arrows light up automatically once the
// sectors table accumulates ≥ 7 days of history — see
// scripts/sql/sectors_history_per_day.sql for the migration that
// flipped the table from snapshot to per-day. Until then, cards
// render with the current breadth + bar + count and no arrow,
// which is the right behaviour: useful from day one, richer over
// time.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

const TREND_LOOKBACK = 7

function trendBucket(delta) {
  if (delta == null) return { arrow: '', color: C.textMuted, label: '' }
  if (delta > 8)  return { arrow: '↑↑', color: C.green,    label: 'gaining' }
  if (delta > 3)  return { arrow: '↑',  color: C.green,    label: 'gaining' }
  if (delta > -3) return { arrow: '→',  color: C.textMuted, label: 'steady' }
  if (delta > -8) return { arrow: '↓',  color: C.red,      label: 'losing' }
  return { arrow: '↓↓', color: C.red, label: 'losing' }
}

function fillColor(pct) {
  if (pct >= 60) return C.green
  if (pct >= 40) return C.amber
  return C.red
}

export default function SectorBreadth() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [todayDate, setTodayDate] = useState(null)
  const [sectors, setSectors] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('sectors')
          .select('name,stage2_pct,stage2_count,total_companies,health,date')
          .order('date', { ascending: false })
          .limit(2000)
        const rows = data || []
        if (!rows.length) {
          if (!cancelled) { setLoading(false) }
          return
        }
        const newest = rows[0].date
        const today = rows.filter((r) => r.date === newest)

        const bySector = new Map()
        for (const r of rows) {
          if (!bySector.has(r.name)) bySector.set(r.name, [])
          bySector.get(r.name).push({ date: r.date, pct: Number(r.stage2_pct) || 0 })
        }
        const enriched = today.map((r) => {
          const series = bySector.get(r.name) || []
          const prevIdx = Math.min(series.length - 1, TREND_LOOKBACK)
          const prev = series[prevIdx]
          const prevPct = prev && prev.date !== r.date ? prev.pct : null
          const today_pct = Number(r.stage2_pct) || 0
          return {
            name: r.name,
            pct: today_pct,
            count: Number(r.stage2_count) || 0,
            total: Number(r.total_companies) || 0,
            delta: prevPct != null ? today_pct - prevPct : null,
          }
        })
        if (cancelled) return
        setTodayDate(newest)
        setSectors(enriched)
        setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) return null
  if (!sectors.length) return null

  const strong = sectors
    .filter((s) => s.pct >= 60)
    .sort((a, b) => b.pct - a.pct)
  const mixed = sectors
    .filter((s) => s.pct >= 40 && s.pct < 60)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
  const weak = sectors
    .filter((s) => s.pct < 40)
    .sort((a, b) => a.pct - b.pct)

  const Card = (s) => {
    const t = trendBucket(s.delta)
    const fill = fillColor(s.pct)
    return (
      <button
        type="button"
        onClick={() => navigate(`/sector/${encodeURIComponent(s.name)}`)}
        key={s.name}
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: '10px 12px',
          marginBottom: 6,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          width: '100%',
          display: 'block',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: C.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {s.name}
          </span>
          {t.arrow && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: t.color,
                flexShrink: 0,
              }}
            >
              {t.arrow} {t.label}
            </span>
          )}
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: C.border,
            overflow: 'hidden',
            marginBottom: 6,
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 2,
              width: `${Math.max(0, Math.min(100, s.pct))}%`,
              background: fill,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
          }}
        >
          <span style={{ fontWeight: 700, color: fill, fontSize: 12 }}>
            {s.pct.toFixed(0)}%
          </span>
          <span style={{ color: C.textMuted, fontSize: 10 }}>
            {s.count}/{s.total} above trend
          </span>
        </div>
      </button>
    )
  }

  const ColumnHeader = ({ label, color, count }) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color,
        marginBottom: 8,
      }}
    >
      {label} <span style={{ color: C.textMuted, fontWeight: 500 }}>· {count}</span>
    </div>
  )

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Summary bar */}
      <div
        style={{
          fontSize: 11,
          color: C.textMuted,
          textAlign: 'center',
          marginBottom: 10,
        }}
      >
        {sectors.length} sectors tracked · Updated {todayDate} · EOD data
      </div>

      {/* Three columns — flex-wrap so phone < 640 px stacks. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <ColumnHeader label="Strong (≥ 60%)" color={C.green} count={strong.length} />
          {strong.length === 0 && <div style={{ fontSize: 11, color: C.textFaint }}>—</div>}
          {strong.map(Card)}
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <ColumnHeader label="Mixed (40–60%)" color={C.amber} count={mixed.length} />
          {mixed.length === 0 && <div style={{ fontSize: 11, color: C.textFaint }}>—</div>}
          {mixed.map(Card)}
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <ColumnHeader label="Weak (< 40%)" color={C.red} count={weak.length} />
          {weak.length === 0 && <div style={{ fontSize: 11, color: C.textFaint }}>—</div>}
          {weak.map(Card)}
        </div>
      </div>

      {/* Methodology + SEBI footer */}
      <div
        style={{
          fontSize: 10,
          color: C.textFaint,
          textAlign: 'center',
          marginTop: 12,
          lineHeight: 1.5,
        }}
      >
        Breadth shows % of sector members trading above their 30-week trend line.
        <br />
        EOD data only · Not investment advice
      </div>
    </div>
  )
}
