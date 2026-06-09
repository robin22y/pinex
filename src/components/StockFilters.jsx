import { useMemo, useState } from 'react'

// ── StockFilters ────────────────────────────────────────────────────────────
// Mobile-first bottom-sheet that lets the user combine objective, EOD-data
// filters and run a screen. This is the "everything is a filter" surface:
// PineX never suggests stocks — the user picks the mathematical conditions and
// sees which stocks currently match. Filters AND across groups; OR within a
// group. Market cap + industry are intentionally absent until those columns
// are added to mv_home_stocks (see scripts/sql).
//
// Fields used all come from mv_home_stocks: sector, close, ma30w,
// breakout_30wma, breakdown_30wma, vol_ratio, rs_vs_nifty, avg_delivery_30d,
// rsi, promoter_pledge_pct.

const GROUPS = [
  {
    key: 'ma',
    title: '30W Trend Line action',
    multi: true,
    options: [
      { id: 'above', label: 'Above 30W', test: (s) => s.close != null && s.ma30w != null && s.close > s.ma30w },
      { id: 'below', label: 'Below 30W', test: (s) => s.close != null && s.ma30w != null && s.close < s.ma30w },
      // Labels reworded for the final perception audit: "Breakout" /
      // "Breakdown" read as actionable trading signals. Neutral phrasing
      // ("Crossed above" / "Crossed below" with a "trend line"
      // disambiguator) keeps the same filter behaviour but reads as a
      // data classification, not a recommendation. Filter ids stay
      // intact so URL-encoded state in the wild still resolves.
      { id: 'breakout', label: 'Crossed above 30W', test: (s) => !!s.breakout_30wma },
      { id: 'breakdown', label: 'Crossed below 30W', test: (s) => !!s.breakdown_30wma },
    ],
  },
  {
    key: 'vol',
    title: 'Volume vs 30D average',
    multi: false,
    options: [
      { id: 'v1', label: '≥ 1×', test: (s) => (s.vol_ratio || 0) >= 1 },
      { id: 'v15', label: '≥ 1.5×', test: (s) => (s.vol_ratio || 0) >= 1.5 },
      { id: 'v2', label: '≥ 2×', test: (s) => (s.vol_ratio || 0) >= 2 },
    ],
  },
  {
    key: 'rs',
    title: 'RS vs Nifty',
    multi: false,
    options: [
      { id: 'rs0', label: 'Positive', test: (s) => (s.rs_vs_nifty || 0) > 0 },
      { id: 'rs10', label: '> 10%', test: (s) => (s.rs_vs_nifty || 0) > 10 },
      { id: 'rs25', label: '> 25%', test: (s) => (s.rs_vs_nifty || 0) > 25 },
    ],
  },
  {
    key: 'del',
    title: 'Delivery %',
    multi: false,
    options: [
      { id: 'd50', label: '≥ 50%', test: (s) => (s.avg_delivery_30d || 0) >= 50 },
      { id: 'd65', label: '≥ 65%', test: (s) => (s.avg_delivery_30d || 0) >= 65 },
    ],
  },
  {
    key: 'rsi',
    title: 'RSI',
    multi: false,
    options: [
      { id: 'rsiRange', label: '40–65', test: (s) => s.rsi != null && s.rsi >= 40 && s.rsi <= 65 },
      { id: 'rsiHigh', label: '> 65', test: (s) => (s.rsi || 0) > 65 },
      { id: 'rsiLow', label: '< 40', test: (s) => s.rsi != null && s.rsi < 40 },
    ],
  },
  {
    key: 'pledge',
    title: 'Promoter pledge',
    multi: false,
    options: [
      { id: 'pz', label: 'Zero', test: (s) => !s.promoter_pledge_pct },
      { id: 'p10', label: '< 10%', test: (s) => (s.promoter_pledge_pct || 0) < 10 },
    ],
  },
]

function matchStock(s, sel) {
  if (sel.sectors?.length && !sel.sectors.includes(s.sector)) return false
  for (const g of GROUPS) {
    const ids = sel[g.key] || []
    if (!ids.length) continue
    const opts = g.options.filter((o) => ids.includes(o.id))
    if (!opts.some((o) => o.test(s))) return false
  }
  return true
}

function buildLabel(sel) {
  const parts = []
  if (sel.sectors?.length) parts.push(sel.sectors.length === 1 ? sel.sectors[0] : `${sel.sectors.length} sectors`)
  for (const g of GROUPS) {
    const ids = sel[g.key] || []
    if (!ids.length) continue
    const labels = g.options.filter((o) => ids.includes(o.id)).map((o) => o.label)
    parts.push(`${g.title.split(' ')[0]} ${labels.join('/')}`)
  }
  return parts.length ? `Filtered scan · ${parts.join(' · ')}` : 'All NSE stocks'
}

const chip = (active) => ({
  padding: '6px 12px',
  borderRadius: 16,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
  background: active ? 'var(--accent-dim)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-secondary)',
})

export default function StockFilters({ open, onClose, allStocks = [], onApply }) {
  const [sel, setSel] = useState({})

  const sectors = useMemo(() => {
    const set = new Set()
    for (const s of allStocks) if (s.sector) set.add(s.sector)
    return [...set].sort()
  }, [allStocks])

  const matched = useMemo(() => allStocks.filter((s) => matchStock(s, sel)), [allStocks, sel])
  const activeCount = useMemo(
    () => (sel.sectors?.length ? 1 : 0) + GROUPS.filter((g) => (sel[g.key] || []).length).length,
    [sel],
  )

  if (!open) return null

  const toggle = (key, id, multi) => {
    setSel((prev) => {
      const cur = prev[key] || []
      let next
      if (multi) next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      else next = cur.includes(id) ? [] : [id]
      return { ...prev, [key]: next }
    })
  }
  const toggleSector = (name) => {
    setSel((prev) => {
      const cur = prev.sectors || []
      return { ...prev, sectors: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] }
    })
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Filters</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '8px 16px 16px', flex: 1 }}>
          {/* Sector */}
          <div style={{ margin: '12px 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sector</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sectors.map((name) => (
              <button key={name} onClick={() => toggleSector(name)} style={chip((sel.sectors || []).includes(name))}>{name}</button>
            ))}
          </div>

          {/* Other groups */}
          {GROUPS.map((g) => (
            <div key={g.key}>
              <div style={{ margin: '16px 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {g.title}{g.multi ? <span style={{ color: 'var(--text-hint)', fontWeight: 400 }}> · pick any</span> : null}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.options.map((o) => (
                  <button key={o.id} onClick={() => toggle(g.key, o.id, g.multi)} style={chip((sel[g.key] || []).includes(o.id))}>{o.label}</button>
                ))}
              </div>
            </div>
          ))}

          <p style={{ fontSize: 10, color: 'var(--text-hint)', fontStyle: 'italic', margin: '18px 0 0', lineHeight: 1.5 }}>
            Objective EOD-data filters. Results are stocks matching the conditions you picked — not recommendations. Market cap &amp; industry filters coming once added to the data feed.
          </p>
        </div>

        {/* Sticky footer */}
        <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0, paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => setSel({})}
            style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Reset
          </button>
          <button
            onClick={() => onApply?.(matched, buildLabel(sel))}
            style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Show {matched.length} stock{matched.length === 1 ? '' : 's'}{activeCount ? ` · ${activeCount} filter${activeCount === 1 ? '' : 's'}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
