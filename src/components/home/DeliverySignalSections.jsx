import { useMemo, useState } from 'react'

const PREVIEW_LIMIT = 5

const SECTIONS = [
  { id: 'accumulation', title: 'Institutional Base', field: 'is_accumulation', color: '#00C805' },
  { id: 'distribution', title: 'Volume Decline', field: 'is_distribution', color: '#FF3B30' },
  { id: 'breakout_30w', title: 'Above 30W MA', field: 'breakout_30wma', color: '#00C805' },
  { id: 'breakdown_30w', title: 'Below 30W MA', field: 'breakdown_30wma', color: '#FF3B30' },
  { id: 'breakout_50d', title: 'Above 50D MA', field: 'breakout_50dma', color: '#60A5FA' },
  { id: 'breakdown_50d', title: 'Below 50D MA', field: 'breakdown_50dma', color: '#FBBF24' },
]

function formatPct(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${x.toFixed(1)}%`
}

function formatRatio(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${x.toFixed(2)}×`
}

function SignalStockRow({ stock, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(stock.symbol)}
      className="flex w-full items-center gap-2 border-0 bg-transparent px-0 py-1.5 text-left"
      style={{ color: '#E2E8F0', cursor: 'pointer' }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, minWidth: 56 }}>{stock.symbol}</span>
      <span className="tabular-nums" style={{ fontSize: 11, color: '#64748B', marginLeft: 'auto' }}>
        Del {formatPct(stock.delivery_pct_today)}
      </span>
      <span className="tabular-nums" style={{ fontSize: 11, color: '#64748B', minWidth: 52, textAlign: 'right' }}>
        Vol {formatRatio(stock.vol_ratio)}
      </span>
    </button>
  )
}

function SignalSection({ section, stocks, expanded, onToggle, onOpen }) {
  const visible = expanded ? stocks : stocks.slice(0, PREVIEW_LIMIT)
  const hasMore = stocks.length > PREVIEW_LIMIT

  return (
    <section
      style={{
        background: '#0F1217',
        border: '1px solid #1E2530',
        borderRadius: 6,
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (hasMore) onToggle(section.id)
        }}
        className="flex w-full items-center gap-2 border-0 bg-transparent p-0 text-left"
        style={{
          cursor: hasMore ? 'pointer' : 'default',
          color: '#E2E8F0',
        }}
        aria-expanded={hasMore ? expanded : undefined}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: section.color,
            flexShrink: 0,
          }}
          aria-hidden
        />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{section.title}</span>
        <span className="tabular-nums" style={{ fontSize: 11, color: '#64748B', marginLeft: 'auto' }}>
          {stocks.length}
        </span>
      </button>

      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visible.map((stock) => (
          <SignalStockRow key={stock.company_id} stock={stock} onOpen={onOpen} />
        ))}
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={() => onToggle(section.id)}
          className="mt-2 border-0 bg-transparent p-0"
          style={{ fontSize: 11, color: section.color, cursor: 'pointer' }}
        >
          {expanded ? 'Show less' : `View all (${stocks.length})`}
        </button>
      ) : null}
    </section>
  )
}

export default function DeliverySignalSections({ stocks, loading, onOpenStock }) {
  const [expanded, setExpanded] = useState({})

  const sections = useMemo(() => {
    return SECTIONS.map((section) => ({
      ...section,
      stocks: (stocks || [])
        .filter((row) => row?.[section.field] === true)
        .sort((a, b) => (b.rs_rating ?? 0) - (a.rs_rating ?? 0) || a.symbol.localeCompare(b.symbol)),
    })).filter((section) => section.stocks.length > 0)
  }, [stocks])

  const toggleSection = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (loading) {
    return (
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`signal-skel-${i}`}
            style={{
              height: 140,
              borderRadius: 6,
              border: '1px solid #1E2530',
              background: '#141820',
            }}
          />
        ))}
      </div>
    )
  }

  if (!sections.length) return null

  return (
    <div className="mt-4">
      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#64748B',
          marginBottom: 10,
        }}
      >
        Delivery signals
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <SignalSection
            key={section.id}
            section={section}
            stocks={section.stocks}
            expanded={!!expanded[section.id]}
            onToggle={toggleSection}
            onOpen={onOpenStock}
          />
        ))}
      </div>
    </div>
  )
}
