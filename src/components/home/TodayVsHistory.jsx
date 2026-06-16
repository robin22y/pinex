/**
 * TodayVsHistory — Homepage "Today in Market Context" section.
 *
 * Reads today's market_internals (above_ma30w_pct, stage2_count,
 * india_vix), finds past trading days with similar values, and
 * shows the distribution of what happened to Nifty over the
 * following 10 trading days.
 *
 * Neutral phrasing — no "positive outcomes", no "best case".
 * The buckets are the same 5-range scheme PatternHistory uses,
 * so the two surfaces read consistently. CTA links to
 * /lab?template=swingx so a curious reader can browse stocks
 * matching the broader market regime without leaving PineX.
 *
 * Self-gates on render:
 *   loading / error           → null
 *   < MIN_SAMPLE matches      → quiet placeholder
 *
 * No pipeline-side changes. market_internals already carries
 * everything this needs.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { C } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'

const MIN_SAMPLE      = 30
const FORWARD_DAYS    = 10        // trading days to look ahead
const BREADTH_TOL     = 10        // ±  pts on above_ma30w_pct
const VIX_TOL         = 3         // ± on india_vix
const STAGE2_TOL_PCT  = 0.20      // ±20% relative on stage2_count (loose)

const BUCKETS = [
  { key: 'gte_5',    label: '+5% or more',  test: (v) => v >= 5 },
  { key: 'p2_5',     label: '+2% to +5%',   test: (v) => v >= 2 && v < 5 },
  { key: 'p0_2',     label: '0% to +2%',    test: (v) => v >= 0 && v < 2 },
  { key: 'n0_2',     label: '0% to -2%',    test: (v) => v < 0 && v > -2 },
  { key: 'lte_n2',   label: '-2% or worse', test: (v) => v <= -2 },
]

function fmtSignedPct(n, places = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  const abs = Math.abs(v)
  const txt = abs >= 10
    ? Math.round(v).toString()
    : v.toFixed(places).replace(/\.0$/, '')
  return `${sign}${txt}%`
}

function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export default function TodayVsHistory() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Pull market_internals in one shot — small table (~1700 rows
        // × 5 cols). Avoids round-trips when we need the forward 10
        // trading days for each matched row.
        const { data, error } = await supabase
          .from('market_internals')
          .select('date, nifty_close, above_ma30w_pct, india_vix, stage2_count')
          .order('date', { ascending: true })
          .range(0, 5000)
        if (error) throw error
        if (cancelled) return
        const all = data ?? []
        if (all.length < 50) {
          setState({ status: 'thin', sample: all.length })
          return
        }

        // Today's anchor — the most recent row.
        const today = all[all.length - 1]
        const tgtBreadth = Number(today?.above_ma30w_pct)
        const tgtVix     = Number(today?.india_vix)
        const tgtStage2  = Number(today?.stage2_count)
        if (!Number.isFinite(tgtBreadth)) {
          setState({ status: 'idle' })
          return
        }

        // Build (date → row) index + a sorted-by-date array so we
        // can index forward N trading days deterministically.
        const sorted = all // already sorted ascending
        const stage2Tol = Number.isFinite(tgtStage2)
          ? Math.max(50, tgtStage2 * STAGE2_TOL_PCT)
          : null

        // Pre-compute the 10-trading-day forward Nifty % change for
        // every row. Rows without a 10-day forward (last 10 dates)
        // get null and are excluded from the sample.
        const withForward = sorted.map((r, i) => {
          const fwd = sorted[i + FORWARD_DAYS]
          if (!fwd || r.nifty_close == null || fwd.nifty_close == null) return null
          const pct = ((Number(fwd.nifty_close) - Number(r.nifty_close)) / Number(r.nifty_close)) * 100
          return { ...r, forward_10d: pct }
        }).filter(Boolean)

        // Filter to rows whose breadth / vix / stage2 are close to
        // today's. stage2 tolerance is loose (20 %) because the
        // count drifts as the universe grows over time.
        const similar = withForward.filter((r) => {
          if (Math.abs((r.above_ma30w_pct ?? NaN) - tgtBreadth) > BREADTH_TOL) return false
          if (Number.isFinite(tgtVix) && r.india_vix != null) {
            if (Math.abs(r.india_vix - tgtVix) > VIX_TOL) return false
          }
          if (stage2Tol != null && r.stage2_count != null) {
            if (Math.abs(r.stage2_count - tgtStage2) > stage2Tol) return false
          }
          return true
        })

        if (similar.length < MIN_SAMPLE) {
          setState({ status: 'thin', sample: similar.length, today })
          return
        }

        const forwards = similar.map((r) => r.forward_10d)
        const dates = similar.map((r) => r.date).filter(Boolean).sort()
        const earliest = dates[0]
        const latest = dates[dates.length - 1]
        const med = median(forwards)
        const minF = Math.min(...forwards)
        const maxF = Math.max(...forwards)

        const bucketCounts = BUCKETS.map((b) => ({
          ...b,
          count: forwards.filter((v) => b.test(v)).length,
        }))
        const bucketTotal = bucketCounts.reduce((a, b) => a + b.count, 0)
        const bucketRows = bucketCounts.map((b) => ({
          ...b,
          pct: bucketTotal ? Math.round((b.count / bucketTotal) * 1000) / 10 : 0,
        }))

        setState({
          status: 'ready',
          data: {
            today,
            sample_size: similar.length,
            earliest_date: earliest, latest_date: latest,
            median_return_10d: med,
            min_return_10d: minF, max_return_10d: maxF,
            buckets: bucketRows,
          },
        })
      } catch (err) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('TodayVsHistory fetch failed:', err)
        setState({ status: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Years tag — same format as PatternHistory ("2020-2025").
  const yearRange = useMemo(() => {
    if (state.status !== 'ready') return null
    const e = String(state.data.earliest_date || '').slice(0, 4)
    const l = String(state.data.latest_date || '').slice(0, 4)
    if (!e || !l) return null
    return e === l ? e : `${e}-${l}`
  }, [state])

  if (state.status === 'loading' || state.status === 'idle' || state.status === 'error') {
    return null
  }

  if (state.status === 'thin') {
    return (
      <Frame>
        <Heading />
        <p style={{ ...muted, fontSize: 13, margin: '10px 0 0' }}>
          Not enough similar past days in the database yet — only
          {' '}{state.sample ?? '0'} comparable trading days. As the
          window expands this section will fill in.
        </p>
      </Frame>
    )
  }

  const d = state.data
  const t = d.today
  const maxPct = Math.max(...d.buckets.map((b) => b.pct), 1)

  return (
    <Frame>
      <Heading />

      <div style={{ marginTop: 10, marginBottom: 12, fontSize: 13, color: C.textMuted }}>
        Today {fmtDate(t.date)}:{' '}
        <strong style={{ color: C.text }}>
          {Number(t.above_ma30w_pct).toFixed(0)}%
        </strong>{' '}of universe above 30W MA
        {Number.isFinite(Number(t.india_vix)) && (
          <>, India VIX <strong style={{ color: C.text }}>{Number(t.india_vix).toFixed(1)}</strong></>
        )}
      </div>

      <p style={{ ...muted, fontSize: 13, margin: '0 0 14px' }}>
        Sample size: {d.sample_size.toLocaleString('en-IN')} similar trading days
        {yearRange ? ` (${yearRange})` : ''}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
        <SummaryCell label="Median 10-day move" value={fmtSignedPct(d.median_return_10d)} />
        <SummaryCell label="Range"
          value={`${fmtSignedPct(d.min_return_10d, 0)} to ${fmtSignedPct(d.max_return_10d, 0)}`} />
      </div>

      <p style={{ ...muted, color: C.text, fontSize: 13, margin: '0 0 10px',
                  fontWeight: 600, letterSpacing: '0.03em' }}>
        Nifty 10-day forward distribution
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {d.buckets.map((b) => (
          <BucketRow key={b.key} label={b.label} pct={b.pct} count={b.count} maxPct={maxPct} />
        ))}
      </div>

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
        <Link
          to="/lab?template=swingx"
          style={{
            fontSize: 12,
            color: C.amber || '#F59E0B',
            textDecoration: 'none',
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          View stocks in similar condition →
        </Link>
      </div>

      <p style={{ ...muted, fontSize: 11, fontStyle: 'italic',
                  textAlign: 'center', lineHeight: 1.6,
                  margin: '14px auto 0', maxWidth: 360 }}>
        Historical observations only. Past conditions do not guarantee future
        outcomes. Not investment advice.
      </p>
    </Frame>
  )
}

// ── Layout primitives ──────────────────────────────────────────

const muted = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: C.textMuted,
  lineHeight: 1.6,
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function Frame({ children }) {
  return (
    <div style={{
      marginTop: 24,
      padding: '20px 18px',
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
    }}>
      {children}
    </div>
  )
}

function Heading() {
  return (
    <>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700,
                  letterSpacing: '0.06em', color: C.text }}>
        TODAY IN MARKET CONTEXT
      </p>
      <p style={{ ...muted, margin: '4px 0 0', fontSize: 13 }}>
        How the broader market has behaved under similar readings
      </p>
    </>
  )
}

function SummaryCell({ label, value }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: C.surface2 || 'rgba(255,255,255,0.03)',
      borderRadius: 8,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: '0.04em',
                    textTransform: 'uppercase', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: C.text, fontWeight: 600,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {value}
      </div>
    </div>
  )
}

function BucketRow({ label, pct, count, maxPct }) {
  const widthPct = Math.max(0, Math.min(100, (pct / maxPct) * 100))
  const alpha = pct === 0 ? 0.4 : 1
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: alpha }}>
      <div style={{
        flex: '0 0 130px',
        fontSize: 12,
        color: C.text,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative',
                    height: 18, background: 'rgba(255,255,255,0.04)',
                    borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${widthPct}%`,
          height: '100%',
          background: C.amber || 'rgba(245,158,11,0.65)',
          opacity: 0.65,
          transition: 'width 280ms ease',
        }} />
      </div>
      <div style={{
        flex: '0 0 48px',
        textAlign: 'right',
        fontSize: 12,
        color: C.text,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        {pct.toFixed(0)}%
        <span style={{ marginLeft: 4, color: C.textMuted, fontSize: 10 }}>
          ({count})
        </span>
      </div>
    </div>
  )
}
