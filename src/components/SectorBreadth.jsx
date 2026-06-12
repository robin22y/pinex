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
import { MEANINGFUL_SECTOR_MIN, isSmallSector } from '../lib/sectorThresholds'
import { useIsMobile } from '../lib/useIsMobile'
import SectorGroupedView from './SectorGroupedView'

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

// ColumnPanel — tinted container per zone. Keeps the column header
// pinned at top, then a scrollable cards stack underneath. maxHeight
// caps the Weak column at ~640 px so a 26-sector dump doesn't drag
// the page; users can scroll inside if needed.
function ColumnPanel({ zoneKey, label, range, color, count, items, renderItem, emptyLabel, zone, ColumnHeader }) {
  return (
    <div
      style={{
        background: zone[zoneKey].panel,
        border: `1px solid ${zone[zoneKey].border}`,
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        // Cap height so the long Weak column doesn't dominate the
        // page. Internal scroll preserves the at-a-glance grid.
        maxHeight: 640,
      }}
    >
      <ColumnHeader
        zoneKey={zoneKey}
        label={label}
        range={range}
        color={color}
        count={items.length}
      />
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ padding: 18, fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
            {emptyLabel || '—'}
          </div>
        ) : (
          items.map((s, i) => renderItem(s, i))
        )}
      </div>
    </div>
  )
}

export default function SectorBreadth() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [todayDate, setTodayDate] = useState(null)
  const [sectors, setSectors] = useState([])
  const [smallOpen, setSmallOpen] = useState(false)

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

  // Mobile: horizontal-scroll grouped layout. Desktop keeps the
  // existing 3-column Strong/Mixed/Weak cards which read fine on a
  // wide viewport. We still render the amber "View as Heatmap"
  // CTA on mobile so the heatmap remains one tap away.
  if (isMobile) {
    return (
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginBottom: 10,
          }}
        >
          <button
            type="button"
            onClick={() => navigate('/heatmap')}
            style={{
              padding: '5px 12px',
              background: 'rgba(245,159,11,0.10)',
              border: `1px solid ${C.amber}55`,
              borderRadius: 8,
              color: C.amber,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            🗺 View as Heatmap
          </button>
        </div>
        <SectorGroupedView sectors={sectors} todayDate={todayDate} />
      </div>
    )
  }

  // Small sectors (< MEANINGFUL_SECTOR_MIN stocks) get pulled out of
  // the main Strong/Mixed/Weak buckets — a 1/1 = 100% sector
  // shouldn't sit in "Strong" next to genuine 22/30 = 73% sectors.
  const meaningful = sectors.filter((s) => !isSmallSector(s.total))
  const small = sectors
    .filter((s) => isSmallSector(s.total))
    .sort((a, b) => b.pct - a.pct)
  const strong = meaningful
    .filter((s) => s.pct >= 60)
    .sort((a, b) => b.pct - a.pct)
  const mixed = meaningful
    .filter((s) => s.pct >= 40 && s.pct < 60)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
  const weak = meaningful
    .filter((s) => s.pct < 40)
    .sort((a, b) => a.pct - b.pct)

  // Per-zone tint for the column panel + the card hover accent.
  // Triple-low alpha — these tints read as zones not alerts.
  const ZONE = {
    strong: { panel: 'rgba(34,197,94,0.04)',  border: 'rgba(34,197,94,0.16)',  hover: 'rgba(34,197,94,0.08)',  emoji: '🟢' },
    mixed:  { panel: 'rgba(245,159,11,0.04)', border: 'rgba(245,159,11,0.16)', hover: 'rgba(245,159,11,0.08)', emoji: '🟡' },
    weak:   { panel: 'rgba(239,68,68,0.04)',  border: 'rgba(239,68,68,0.16)',  hover: 'rgba(239,68,68,0.08)',  emoji: '🔴' },
  }

  // Compact card — no per-card chrome (the column panel is the container).
  // Subtle divider between rows. Bigger % on the right, mini trend hint
  // shrunk to a single arrow chip so the eye doesn't bounce between
  // labels. .sb-card:hover lifts background — reads as touch affordance.
  const Card = (s, zoneKey, isFirst) => {
    const t = trendBucket(s.delta)
    const fill = fillColor(s.pct)
    return (
      <button
        type="button"
        onClick={() => navigate(`/sector/${encodeURIComponent(s.name)}`)}
        key={s.name}
        className="sb-card"
        data-zone={zoneKey}
        style={{
          background: 'transparent',
          border: 'none',
          borderTop: isFirst ? 'none' : '1px solid rgba(255,255,255,0.04)',
          padding: '12px 14px',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          width: '100%',
          display: 'block',
          transition: 'background 0.15s',
        }}
      >
        {/* Row 1 — sector name + % */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 10,
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: C.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
              letterSpacing: '-0.005em',
            }}
          >
            {s.name}
          </span>
          <span
            style={{
              fontWeight: 700,
              color: fill,
              fontSize: 15,
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
              letterSpacing: '-0.02em',
            }}
          >
            {s.pct.toFixed(0)}%
          </span>
        </div>
        {/* Row 2 — bar */}
        <div
          style={{
            height: 5,
            borderRadius: 3,
            background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden',
            marginBottom: 6,
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 3,
              width: `${Math.max(0, Math.min(100, s.pct))}%`,
              background: fill,
              transition: 'width 0.3s ease-out',
            }}
          />
        </div>
        {/* Row 3 — count + trend chip */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
          }}
        >
          <span style={{ color: C.textFaint, fontVariantNumeric: 'tabular-nums' }}>
            {s.count}/{s.total} above trend
          </span>
          {t.arrow && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: t.color,
                background: t.color === C.green ? 'rgba(34,197,94,0.10)'
                          : t.color === C.red ? 'rgba(239,68,68,0.10)'
                          : 'rgba(255,255,255,0.04)',
                padding: '1px 6px',
                borderRadius: 4,
                flexShrink: 0,
                letterSpacing: '0.02em',
              }}
            >
              {t.arrow} {t.label}
            </span>
          )}
        </div>
      </button>
    )
  }

  // Pillared column header: emoji + label + count badge. The emoji
  // gives instant visual signal even before the user reads "Strong".
  const ColumnHeader = ({ label, range, color, count, zoneKey }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '14px 14px 12px',
        borderBottom: `1px solid ${ZONE[zoneKey].border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>{ZONE[zoneKey].emoji}</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color,
            letterSpacing: '0.02em',
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 10, color: C.textFaint, fontWeight: 500 }}>{range}</span>
      </div>
      <span
        style={{
          background: ZONE[zoneKey].hover,
          color,
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 999,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </span>
    </div>
  )

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Summary bar + "View as Heatmap" CTA — the heatmap is the
          unsung hero of the sectors layer; an amber button at the
          top is the most reliable way to surface it. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 11, color: C.textMuted }}>
          {sectors.length} sectors tracked · Updated {todayDate} · EOD data
        </span>
        <button
          type="button"
          onClick={() => navigate('/heatmap')}
          style={{
            padding: '5px 12px',
            background: 'rgba(245,159,11,0.10)',
            border: `1px solid ${C.amber}55`,
            borderRadius: 8,
            color: C.amber,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          🗺 View as Heatmap
        </button>
      </div>

      {/* Hover state for cards — uses the zone tint so the lift
          reads consistent with the panel it's inside. Single style
          tag, scoped to .sb-card. */}
      <style>{`
        .sb-card:hover { background: rgba(255,255,255,0.025); }
        .sb-card[data-zone="strong"]:hover { background: rgba(34,197,94,0.06); }
        .sb-card[data-zone="mixed"]:hover  { background: rgba(245,159,11,0.06); }
        .sb-card[data-zone="weak"]:hover   { background: rgba(239,68,68,0.06); }
      `}</style>

      {/* Three column panels — each is a tinted card with its own
          chrome. CSS grid gives stable 3-up layout on desktop and
          flex-wraps to 1-up on phones below ~720 px. The container
          tint shifts the eye between zones without screaming. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        <ColumnPanel zoneKey="strong" range="≥ 60%" label="Strong" color={C.green} items={strong}
          renderItem={(s, i) => Card(s, 'strong', i === 0)}
          emptyLabel="No sectors with strong breadth today" zone={ZONE} ColumnHeader={ColumnHeader} />
        <ColumnPanel zoneKey="mixed" range="40 – 60%" label="Mixed" color={C.amber} items={mixed}
          renderItem={(s, i) => Card(s, 'mixed', i === 0)}
          emptyLabel="No sectors in the mixed band" zone={ZONE} ColumnHeader={ColumnHeader} />
        <ColumnPanel zoneKey="weak" range="< 40%" label="Weak" color={C.red} items={weak}
          renderItem={(s, i) => Card(s, 'weak', i === 0)}
          emptyLabel="No sectors with weak breadth today" zone={ZONE} ColumnHeader={ColumnHeader} />
      </div>

      {/* Small Sectors — collapsible. These have < 5 stocks each so
          one outlier swings the percentage, hence excluded from the
          main breadth grouping but still surfaced here. */}
      {small.length > 0 && (
        <div style={{ marginTop: 16 }}>
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
