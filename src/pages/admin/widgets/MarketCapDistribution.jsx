import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// ── Market Cap Distribution — companies bucketed by market_cap ──────────────
// Source: companies.market_cap (stored as
// rupees by the legacy PR-zip parser). The
// UDiFF format does NOT carry mcap, so until
// a new ingestion path is wired this widget
// may show "Market cap data not populated".

const MCAP_BUCKETS = [
  { label: 'Large Cap', range: '₹20,000 Cr+',     min: 2.0e11, max: Infinity,
    color: 'var(--positive)' },
  { label: 'Mid Cap',   range: '₹5,000–20,000 Cr', min: 5.0e10, max: 2.0e11,
    color: 'var(--info)' },
  { label: 'Small Cap', range: '₹500–5,000 Cr',    min: 5.0e9,  max: 5.0e10,
    color: 'var(--accent)' },
  { label: 'Micro Cap', range: '₹100–500 Cr',      min: 1.0e9,  max: 5.0e9,
    color: 'var(--warning)' },
  { label: 'Nano Cap',  range: 'Below ₹100 Cr',    min: 0,      max: 1.0e9,
    color: 'var(--negative)' },
]

const MarketCapDistribution = () => {
  const [buckets, setBuckets] = useState(null)

  useEffect(() => {
    loadBuckets()
  }, [])

  const loadBuckets = async () => {
    const results = await Promise.all(
      MCAP_BUCKETS.map((b) => {
        let q = supabase
          .from('companies')
          .select('id', { count: 'exact', head: true })
          .gte('market_cap', b.min)
        if (b.max !== Infinity) {
          q = q.lt('market_cap', b.max)
        }
        return q
      }),
    )
    setBuckets(
      MCAP_BUCKETS.map((b, i) => ({
        ...b,
        count: results[i].count || 0,
      })),
    )
  }

  if (!buckets) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        Loading market cap distribution...
      </div>
    )
  }

  const total = buckets.reduce((s, b) => s + b.count, 0)

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
          padding: '0 16px',
        }}
      >
        Market Cap Distribution
      </div>

      <div
        style={{
          margin: '0 16px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '14px',
        }}
      >
        {total === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
            Market cap data not yet populated (companies.market_cap is empty).
            Re-run the PR-zip parser or wire the new mcap source.
          </div>
        ) : (
          buckets.map((b) => {
            const pct = total > 0 ? Math.round((b.count / total) * 100) : 0
            return (
              <div key={b.label} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginBottom: 3,
                  }}
                >
                  <span>
                    <strong style={{ color: 'var(--text-primary)' }}>{b.label}</strong>
                    {'  '}
                    <span style={{ color: 'var(--text-hint)' }}>{b.range}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {b.count} ({pct}%)
                  </span>
                </div>
                <div
                  style={{
                    height: 5,
                    background: 'var(--border)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: b.color,
                      borderRadius: 3,
                      transition: 'width 0.5s',
                    }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default MarketCapDistribution
