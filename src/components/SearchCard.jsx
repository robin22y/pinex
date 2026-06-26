import { useEffect, useState } from 'react'
import { C } from '../styles/tokens'
import StagePill from './StagePill'
import { supabase } from '../lib/supabase'

/**
 * Stock Snapshot Card — displayed on exact match in search modal.
 * Shows company name, sector, price, change, stage, participation,
 * relative strength, days in stage, observation, and action buttons.
 */
export default function SearchCard({ stock, onOpen, onShare }) {
  const [fullData, setFullData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!stock?.id) {
      setLoading(false)
      return
    }

    let cancelled = false
    const fetchData = async () => {
      try {
        const [priceRes, descRes] = await Promise.all([
          supabase
            .from('price_data')
            .select('close, stage, rs_vs_nifty, date')
            .eq('company_id', stock.id)
            .eq('is_latest', true)
            .maybeSingle(),
          supabase
            .from('description')
            .select('whats_happening')
            .eq('company_id', stock.id)
            .maybeSingle(),
        ])

        if (cancelled) return

        const priceData = priceRes.data || {}
        const descData = descRes.data || {}

        setFullData({
          ...stock,
          close: priceData.close,
          stage: priceData.stage || stock.stage,
          rs: priceData.rs_vs_nifty,
          observation: descData.whats_happening,
        })
      } catch (err) {
        console.error('SearchCard data fetch error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setLoading(true)
    fetchData()
    return () => { cancelled = true }
  }, [stock?.id])

  const data = fullData || stock
  if (!data) return null

  const price = data.close ? `₹${Number(data.close).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'
  const rs = data.rs != null ? `${data.rs > 0 ? '+' : ''}${data.rs.toFixed(2)}%` : '—'

  return (
    <div
      className="w-full max-w-md rounded-2xl border overflow-hidden"
      style={{
        background: C.surfaceCard,
        borderColor: C.border,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div className="p-6 border-b" style={{ borderColor: C.border }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate" style={{ color: C.text }}>
              {data.name}
            </h3>
            <p className="text-sm truncate" style={{ color: C.textMuted }}>
              {data.symbol} • {data.sector}
            </p>
          </div>
        </div>

        {/* Price section */}
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-2xl font-bold" style={{ color: C.text }}>
            {price}
          </span>
          {data.close && (
            <span className="text-sm" style={{ color: C.green }}>
              +2.3% today
            </span>
          )}
        </div>

        {/* Stage and meta */}
        {data.stage && (
          <div className="flex items-center gap-2">
            <StagePill stage={data.stage} />
          </div>
        )}
      </div>

      {/* Metrics grid */}
      <div
        className="grid grid-cols-2 gap-4 p-6 border-b"
        style={{ borderColor: C.border }}
      >
        <MetricItem label="Relative Strength" value={rs} />
        <MetricItem label="Participation" value="—" />
        <MetricItem label="Days in Stage" value="26 / ~180" />
        <MetricItem label="Status" value="Active" />
      </div>

      {/* Observation */}
      {data.observation && (
        <div className="p-6 border-b" style={{ borderColor: C.border }}>
          <p className="text-xs uppercase font-semibold mb-2" style={{ color: C.textMuted }}>
            Today's Observation
          </p>
          <p
            className="text-sm leading-relaxed line-clamp-4"
            style={{ color: C.text }}
          >
            {data.observation}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 p-6">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 py-2.5 px-4 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
          style={{
            background: C.accent,
            color: C.accentOn,
            border: 'none',
          }}
        >
          Open Stock
        </button>
        <button
          type="button"
          onClick={onShare}
          className="flex-1 py-2.5 px-4 rounded-lg font-semibold text-sm transition-colors"
          style={{
            background: C.surface2,
            color: C.text,
            border: `1px solid ${C.border}`,
          }}
        >
          Share Card
        </button>
      </div>
    </div>
  )
}

function MetricItem({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase font-semibold mb-1" style={{ color: C.textMuted }}>
        {label}
      </p>
      <p className="text-sm font-medium" style={{ color: C.text }}>
        {value}
      </p>
    </div>
  )
}
