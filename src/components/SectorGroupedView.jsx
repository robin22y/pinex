// SectorGroupedView — mobile-first horizontal-scroll layout for
// the sectors landing experience. Three "participation zones"
// (Strong / Mixed / Weak), each rendered as:
//   header row → optional sort tabs → horizontal scroll of sector cards
// Small sectors (< MEANINGFUL_SECTOR_MIN) are pulled out and shown in
// a collapsible row at the bottom — a 1/1 = 100% sector doesn't
// belong next to a 22/30 = 73% sector.
//
// The whole layout fits in ~1.5 screens, never an endless vertical scroll.
//
// Consumes:
//   sectors: [{ name, pct, count, total, delta }]   (delta optional)
//   todayDate: ISO date string (or null)
// Self-fetching when no sectors prop is passed (used by SectorDetail/All).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { C } from '../styles/tokens'
import { MEANINGFUL_SECTOR_MIN, isSmallSector } from '../lib/sectorThresholds'

const TREND_LOOKBACK = 7

const ZONES = [
  {
    key: 'strong',
    emoji: '🟢',
    title: 'Strong Participation',
    range: '>60%',
    subtext: 'Most stocks above trend line',
    color: C.green,
    test: (pct) => pct >= 60,
  },
  {
    key: 'mixed',
    emoji: '🟡',
    title: 'Mixed Participation',
    range: '40–60%',
    subtext: 'Breadth building or declining',
    color: C.amber,
    test: (pct) => pct >= 40 && pct < 60,
  },
  {
    key: 'weak',
    emoji: '🔴',
    title: 'Low Participation',
    range: '<40%',
    subtext: 'Most stocks below trend line',
    color: C.red,
    test: (pct) => pct < 40,
  },
]

function pctColor(pct) {
  if (pct >= 60) return C.green
  if (pct >= 40) return C.amber
  return C.red
}

function trendArrow(delta) {
  if (delta == null) return null
  if (delta > 3) return { glyph: '↑', color: C.green }
  if (delta < -3) return { glyph: '↓', color: C.red }
  return { glyph: '→', color: C.textMuted }
}

function Card({ sector, onClick }) {
  const fill = pctColor(sector.pct)
  const arrow = trendArrow(sector.delta)
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 140,
        flexShrink: 0,
        background: C.surface,
        borderRadius: 12,
        padding: 12,
        cursor: 'pointer',
        border: `1px solid ${C.border}`,
        color: 'inherit',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: C.text,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 30,
          lineHeight: 1.25,
        }}
      >
        {sector.name}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: fill, marginTop: 6, lineHeight: 1 }}>
        {sector.pct.toFixed(0)}%
      </div>
      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: C.border,
          margin: '8px 0 6px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 2,
            width: `${Math.max(0, Math.min(100, sector.pct))}%`,
            background: fill,
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 10,
          color: C.textMuted,
        }}
      >
        <span>{sector.count}/{sector.total}</span>
        {arrow && (
          <span style={{ color: arrow.color, fontWeight: 700 }}>{arrow.glyph}</span>
        )}
      </div>
    </button>
  )
}

function ZoneRow({ zone, sectors, onCardClick }) {
  const [sort, setSort] = useState('pct')

  const sorted = useMemo(() => {
    const arr = [...sectors]
    if (sort === 'trend') {
      arr.sort((a, b) => (b.delta ?? -9999) - (a.delta ?? -9999))
    } else {
      arr.sort((a, b) => b.pct - a.pct)
    }
    return arr
  }, [sectors, sort])

  if (sectors.length === 0) return null

  const tabBtn = (id, label) => {
    const on = sort === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => setSort(id)}
        style={{
          background: on ? C.surface2 : 'transparent',
          border: `1px solid ${on ? C.border : 'transparent'}`,
          borderRadius: 999,
          padding: '3px 10px',
          fontSize: 10,
          color: on ? C.text : C.textMuted,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: zone.color }}>
          {zone.emoji} {zone.title}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: zone.color, whiteSpace: 'nowrap' }}>
          {sectors.length} {sectors.length === 1 ? 'sector' : 'sectors'} · {zone.range}
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
        {zone.subtext}
      </div>

      {/* Sort tabs */}
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {tabBtn('pct', '% High → Low')}
        {tabBtn('trend', 'Most Improving')}
      </div>

      {/* Horizontal scroll row */}
      <div
        className="sgv-scroll"
        style={{
          display: 'flex',
          overflowX: 'auto',
          paddingBottom: 8,
          marginTop: 10,
          gap: 8,
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          position: 'relative',
        }}
      >
        {sorted.map((s) => (
          <Card key={s.name} sector={s} onClick={() => onCardClick(s)} />
        ))}
        {/* Ghost fade hint — sticks to the right edge so the user
            sees the gradient even after scrolling, signalling there's
            more content. position:sticky inside overflow-x:auto pins
            it to the visible viewport's right edge. */}
        <div
          aria-hidden
          style={{
            position: 'sticky',
            right: 0,
            flexShrink: 0,
            width: 40,
            background: `linear-gradient(to right, rgba(0,0,0,0) 0%, ${C.base} 100%)`,
            pointerEvents: 'none',
            marginLeft: -40,
          }}
        />
      </div>
    </div>
  )
}

export default function SectorGroupedView({ sectors: sectorsProp, todayDate: todayDateProp } = {}) {
  const navigate = useNavigate()
  const selfFetch = !sectorsProp
  const [loading, setLoading] = useState(selfFetch)
  const [fetched, setFetched] = useState([])
  const [fetchedDate, setFetchedDate] = useState(null)
  const [smallOpen, setSmallOpen] = useState(false)

  useEffect(() => {
    if (!selfFetch) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('sectors')
          .select('name,stage2_pct,stage2_count,total_companies,date')
          .order('date', { ascending: false })
          .limit(2000)
        const rows = data || []
        if (!rows.length) { if (!cancelled) setLoading(false); return }
        const newest = rows[0].date
        const today = rows.filter((r) => r.date === newest)
        const bySector = new Map()
        for (const r of rows) {
          if (!bySector.has(r.name)) bySector.set(r.name, [])
          bySector.get(r.name).push({ date: r.date, pct: Number(r.stage2_pct) || 0 })
        }
        const enriched = today.map((r) => {
          const total = Number(r.total_companies) || 0
          const stage2 = Number(r.stage2_count) || 0
          // Defensive — DB stage2_pct should already be stage2/total*100
          // but fall back to the explicit calc if it's null or stale.
          const dbPct = Number(r.stage2_pct)
          const pct = Number.isFinite(dbPct) && dbPct !== 0
            ? dbPct
            : total > 0 ? (stage2 / total) * 100 : 0
          const series = bySector.get(r.name) || []
          const prevIdx = Math.min(series.length - 1, TREND_LOOKBACK)
          const prev = series[prevIdx]
          const prevPct = prev && prev.date !== r.date ? prev.pct : null
          return {
            name: r.name,
            pct,
            count: stage2,
            total,
            delta: prevPct != null ? pct - prevPct : null,
          }
        })
        if (cancelled) return
        setFetched(enriched)
        setFetchedDate(newest)
        setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selfFetch])

  const sectors = sectorsProp ?? fetched
  const todayDate = todayDateProp ?? fetchedDate

  const totalStocks = useMemo(
    () => sectors.reduce((s, x) => s + (x.total || 0), 0),
    [sectors],
  )

  const meaningful = useMemo(
    () => sectors.filter((s) => !isSmallSector(s.total)),
    [sectors],
  )
  const small = useMemo(
    () => sectors
      .filter((s) => isSmallSector(s.total))
      .sort((a, b) => b.pct - a.pct),
    [sectors],
  )

  const zoneSectors = useMemo(
    () => ZONES.map((z) => ({ zone: z, list: meaningful.filter((s) => z.test(s.pct)) })),
    [meaningful],
  )

  if (loading) return null
  if (!sectors.length) return null

  return (
    <div style={{ width: '100%' }}>
      {/* hide-scrollbar without inflating global CSS */}
      <style>{`.sgv-scroll::-webkit-scrollbar { display: none }`}</style>

      {/* Top summary */}
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16 }}>
        {sectors.length} {sectors.length === 1 ? 'sector' : 'sectors'} · {totalStocks} {totalStocks === 1 ? 'stock' : 'stocks'}{todayDate ? ` · ${todayDate}` : ''}
      </div>

      {zoneSectors.map(({ zone, list }) => (
        <ZoneRow
          key={zone.key}
          zone={zone}
          sectors={list}
          onCardClick={(s) => navigate(`/sector/${encodeURIComponent(s.name)}`)}
        />
      ))}

      {/* Small sectors collapsible */}
      {small.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setSmallOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'transparent',
              border: 'none',
              color: C.textMuted,
              fontSize: 11,
              cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            <span style={{ fontSize: 10, display: 'inline-block', transform: smallOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
              ▶
            </span>
            Small Sectors ({small.length})
          </button>
          {smallOpen && (
            <div style={{ marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {small.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => navigate(`/sector/${encodeURIComponent(s.name)}`)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto',
                    gap: 12,
                    alignItems: 'center',
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
                    color: C.textMuted,
                    fontSize: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </span>
                  <span
                    style={{
                      background: C.surface2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 4,
                      padding: '1px 6px',
                      fontSize: 10,
                      color: C.textFaint,
                    }}
                  >
                    {s.total} {s.total === 1 ? 'stock' : 'stocks'}
                  </span>
                  <span style={{ fontSize: 12, color: C.textFaint, minWidth: 36, textAlign: 'right' }}>
                    {s.pct.toFixed(0)}%
                  </span>
                </button>
              ))}
              <div style={{ padding: '6px 12px', fontSize: 10, color: C.textFaint, background: C.surface2 }}>
                Sectors with fewer than {MEANINGFUL_SECTOR_MIN} stocks may not reflect meaningful trends.
              </div>
            </div>
          )}
        </div>
      )}

      {/* SEBI footer */}
      <div style={{ fontSize: 10, color: C.textFaint, textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
        Breadth shows % of sector members trading above their 30-week trend line.
        <br />
        EOD data only · Not investment advice
      </div>
    </div>
  )
}
