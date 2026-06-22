/**
 * PatternHistory — Historical Conditions section on /stock/:symbol.
 *
 * Reads pattern_snapshots directly via supabase (the edge-function
 * aggregate response was outcome-shaped — positive %, best, worst —
 * which is the language the rework spec asked us to remove). The
 * client-side query mirrors the pattern-match matcher: same range
 * filters, same substage null-tolerance.
 *
 * What this section now shows:
 *   - Sample size + observation window
 *   - Median forward 30-day return
 *   - Range (min → max forward 30-day return)
 *   - 5-bucket horizontal distribution of the forward 30-day returns
 *   - Top 4 most-similar historical instances (still by similarity)
 *   - Static disclaimer
 *
 * What was removed in the rework:
 *   - "Positive: X%" outcome-language row
 *   - "Best case / Worst case" labels (replaced by neutral "Range")
 *   - "What happened in similar conditions" event-flag block
 *     (Advanced further / 52W high / Dropped below 30W MA / Stage
 *     upgraded — all outcome language)
 *
 * Self-gates render:
 *   - while loading                → null (no flash)
 *   - error / fetch failed          → null
 *   - sample_size < 30              → quiet placeholder
 */
import { useEffect, useMemo, useState } from 'react'
import { C } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'
import useProGate from '../../hooks/useProGate'

// ── Match tolerances. Mirror pattern-match/index.ts so the
//    client-side query returns the same row set as the edge function.
const RS_TOL      = 10
const VOL_TOL     = 0.5
const BREADTH_TOL = 10
const EXCLUDE_DAYS = 90
const TOP_N_INSTANCES = 4
const MIN_SAMPLE  = 30

// ── 5-bucket layout for forward_30d returns. Spec is exact.
//    Width 12 inside the row + flexShrink:0 keeps the bar aligned.
const BUCKETS = [
  { key: 'gte_20',   label: '+20% or more',  test: (v) => v >= 20 },
  { key: 'p10_20',   label: '+10% to +20%',  test: (v) => v >= 10 && v < 20 },
  { key: 'p0_10',    label: '0% to +10%',    test: (v) => v >= 0  && v < 10 },
  { key: 'n0_10',    label: '0% to -10%',    test: (v) => v < 0   && v > -10 },
  { key: 'lte_n10',  label: '-10% or worse', test: (v) => v <= -10 },
]

function fmtMonthYear(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function fmtYearRange(earliest, latest) {
  if (!earliest || !latest) return null
  const ey = String(earliest).slice(0, 4)
  const ly = String(latest).slice(0, 4)
  return ey === ly ? ey : `${ey}-${ly}`
}

function fmtSignedPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  const abs = Math.abs(v)
  const txt = abs >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '')
  return `${sign}${txt}%`
}

function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function axisScore(value, target, tol) {
  if (value == null || tol <= 0) return 0
  const diff = Math.abs(Number(value) - Number(target))
  if (diff >= tol) return 0
  return 1 - diff / tol
}

function similarityScore(row, rs, vol, breadth) {
  const parts = [
    axisScore(row.rs_vs_nifty,     rs,      RS_TOL),
    axisScore(row.vol_ratio,       vol,     VOL_TOL),
    axisScore(row.above_ma30w_pct, breadth, BREADTH_TOL),
  ]
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100)
}

export default function PatternHistory({
  symbol,
  stage,
  substage,
  rsScore,
  volRatio,
  aboveMa30wPct,
}) {
  // ProGateModal teaser — Historical Conditions is the 1,500-pt Pro
  // feature per feature_unlock_costs. Fires once per session for Free
  // users who land on any stock page; the modal is dismissible and
  // the section underneath continues to render.
  const proGateModal = useProGate('historical_conditions', 'Historical Conditions')
  const [state, setState] = useState({ status: 'loading' })

  const queryKey = useMemo(() => JSON.stringify({
    symbol: symbol || '', stage: stage || '', substage: substage || '',
    rs: Number(rsScore), vol: Number(volRatio), breadth: Number(aboveMa30wPct),
  }), [symbol, stage, substage, rsScore, volRatio, aboveMa30wPct])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    if (
      !stage ||
      !Number.isFinite(Number(rsScore)) ||
      !Number.isFinite(Number(volRatio))
    ) {
      setState({ status: 'idle' })
      return () => { cancelled = true }
    }

    ;(async () => {
      try {
        // above_ma30w_pct is a daily market-wide value. Fall back to
        // the latest market_internals row when the parent didn't pass.
        let breadthValue = Number(aboveMa30wPct)
        if (!Number.isFinite(breadthValue)) {
          const { data: miRow } = await supabase
            .from('market_internals')
            .select('above_ma30w_pct')
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()
          breadthValue = Number(miRow?.above_ma30w_pct)
        }
        if (!Number.isFinite(breadthValue)) {
          if (!cancelled) setState({ status: 'idle' })
          return
        }

        const rsN = Number(rsScore), volN = Number(volRatio)
        const cutoff = new Date(Date.now() - EXCLUDE_DAYS * 86_400_000)
          .toISOString().slice(0, 10)

        // Mirror the edge-function matcher in supabase-js. Substage
        // filter is null-tolerant on the snapshot side — same logic as
        // pattern-match/index.ts. Page through to be safe; the result
        // set is typically tens to low hundreds of rows.
        const rows = []
        let start = 0
        const PAGE = 1000
        while (true) {
          let q = supabase.from('pattern_snapshots')
            .select(
              'company_id, date, rs_vs_nifty, vol_ratio, above_ma30w_pct, ' +
              'forward_7d, forward_30d, forward_60d, forward_90d'
            )
            .eq('stage', stage)
            .lt('date', cutoff)
            .gte('rs_vs_nifty',     rsN     - RS_TOL)
            .lte('rs_vs_nifty',     rsN     + RS_TOL)
            .gte('vol_ratio',       volN    - VOL_TOL)
            .lte('vol_ratio',       volN    + VOL_TOL)
            .gte('above_ma30w_pct', breadthValue - BREADTH_TOL)
            .lte('above_ma30w_pct', breadthValue + BREADTH_TOL)
          if (substage) q = q.or(`substage.is.null,substage.eq.${substage}`)
          const { data, error } = await q.range(start, start + PAGE - 1)
          if (error) throw error
          const batch = data ?? []
          rows.push(...batch)
          if (batch.length < PAGE) break
          start += PAGE
        }

        if (cancelled) return

        if (rows.length < MIN_SAMPLE) {
          setState({ status: 'thin', sample: rows.length })
          return
        }

        // Aggregate locally — bucket the 30-day forwards.
        const f30 = rows.map((r) => r.forward_30d).filter((v) => v != null && Number.isFinite(v))
        const dates = rows.map((r) => r.date).filter(Boolean).sort()
        const earliest = dates[0]
        const latest = dates[dates.length - 1]
        const med = median(f30)
        const minF = f30.length ? Math.min(...f30) : null
        const maxF = f30.length ? Math.max(...f30) : null

        const bucketCounts = BUCKETS.map((b) => ({
          ...b,
          count: f30.filter((v) => b.test(v)).length,
        }))
        const bucketTotal = bucketCounts.reduce((a, b) => a + b.count, 0)
        const bucketRows = bucketCounts.map((b) => ({
          ...b,
          pct: bucketTotal ? Math.round((b.count / bucketTotal) * 1000) / 10 : 0,
        }))

        // Top-N most-similar instances. Look up symbols in one batch.
        const scored = rows.map((r) => ({
          ...r, similarity_score: similarityScore(r, rsN, volN, breadthValue),
        }))
        scored.sort((a, b) => {
          if (b.similarity_score !== a.similarity_score) {
            return b.similarity_score - a.similarity_score
          }
          return (b.forward_30d ?? -Infinity) - (a.forward_30d ?? -Infinity)
        })
        const top = scored.slice(0, TOP_N_INSTANCES)
        const cids = [...new Set(top.map((r) => r.company_id).filter(Boolean))]
        const symbolByCid = new Map()
        if (cids.length) {
          const { data: comps } = await supabase
            .from('companies').select('id, symbol').in('id', cids)
          for (const c of comps ?? []) {
            if (c?.id && c?.symbol) symbolByCid.set(c.id, c.symbol)
          }
        }
        const instances = top.map((r) => ({
          symbol:     symbolByCid.get(r.company_id) ?? '—',
          date:       r.date,
          score:      r.similarity_score,
          forward_30d: r.forward_30d,
        }))

        if (cancelled) return
        setState({
          status: 'ready',
          data: {
            sample_size: rows.length,
            earliest_date: earliest, latest_date: latest,
            median_return_30d: med,
            min_return_30d: minF, max_return_30d: maxF,
            buckets: bucketRows,
            instances,
          },
        })
      } catch (err) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('PatternHistory fetch failed:', err)
        setState({ status: 'error' })
      }
    })()

    return () => { cancelled = true }
  }, [queryKey, stage, substage, rsScore, volRatio, aboveMa30wPct])

  if (state.status === 'loading' || state.status === 'idle' || state.status === 'error') {
    return null
  }

  if (state.status === 'thin') {
    // sample === 0 means the pattern_snapshots query returned no
    // rows at all for this stock's stage/RS/vol/breadth band — most
    // commonly because the daily snapshot backfill hasn't populated
    // yet (or the table is otherwise empty). Showing the empty-state
    // on EVERY stock in that case is worse than showing nothing, so
    // we render null and the section quietly disappears. The
    // partial-fill copy still surfaces when 1 ≤ sample < MIN_SAMPLE,
    // which is the legitimate "data is accumulating" case.
    if (!state.sample) return null
    return (
      <Section>
        <Header />
        <p style={{ ...muted, fontSize: 13, margin: '10px 0 0' }}>
          Fewer than {MIN_SAMPLE} similar historical occurrences in the
          database (found {state.sample}). Not enough to show a stable
          outcome distribution. As more daily snapshots accumulate this
          section will populate with the distribution of 30-day outcomes
          plus the closest past occurrences of matching market
          conditions.
        </p>
      </Section>
    )
  }

  const d = state.data
  const yearRange = fmtYearRange(d.earliest_date, d.latest_date)
  const sampleLine = yearRange
    ? `Sample size: ${d.sample_size.toLocaleString('en-IN')} instances (${yearRange})`
    : `Sample size: ${d.sample_size.toLocaleString('en-IN')} instances`

  // Largest bucket sets the bar scale. Avoids the chart appearing
  // empty when the dominant bucket is only 40 % — bar fills the row.
  const maxPct = Math.max(...d.buckets.map((b) => b.pct), 1)

  return (
    <Section>
      {proGateModal}
      <Header />
      <p style={{ ...muted, margin: '8px 0 14px', fontSize: 13 }}>
        {sampleLine}
      </p>

      {/* Sample, median, range — neutral summary. Labels use
          "outcome" rather than "return" per the compliance doc's
          approved vocabulary (Median outcome / Best outcome /
          Worst outcome). */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
        <SummaryCell label="Median outcome" value={fmtSignedPct(d.median_return_30d)} />
        <SummaryCell
          label="Outcome range"
          value={`${fmtSignedPct(d.min_return_30d)} to ${fmtSignedPct(d.max_return_30d)}`}
        />
      </div>

      <p style={{ ...muted, color: C.text, fontSize: 13, margin: '0 0 10px',
                  fontWeight: 600, letterSpacing: '0.03em' }}>
        30-day outcome distribution
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {d.buckets.map((b) => (
          <BucketRow key={b.key} label={b.label} pct={b.pct} count={b.count} maxPct={maxPct} />
        ))}
      </div>

      {d.instances.length > 0 && (
        <>
          <Divider />
          <p style={{ ...muted, color: C.text, fontSize: 13,
                      margin: '18px 0 10px', fontWeight: 600, letterSpacing: '0.04em' }}>
            PAST OCCURRENCES
          </p>
          <pre style={tableStyle}>
{d.instances.map((inst) => {
  const sym = String(inst.symbol || '—').padEnd(11)
  const dt  = fmtMonthYear(inst.date).padEnd(9)
  const sc  = `Score ${inst.score ?? '—'}%`.padEnd(11)
  const fwd = fmtSignedPct(inst.forward_30d)
  return `${sym} ${dt} ${sc} ${fwd} (30d)\n`
}).join('')}
          </pre>
        </>
      )}

      <Divider />

      <p style={{ ...muted, fontSize: 11, fontStyle: 'italic',
                  textAlign: 'center', lineHeight: 1.6,
                  margin: '14px auto 0', maxWidth: 380 }}>
        Based on historical observations of similar market conditions.
        Outcomes varied significantly. Historical observations do not
        indicate future performance. Not investment advice.
      </p>
    </Section>
  )
}

// ── Layout primitives ──────────────────────────────────────────

const muted = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: C.textMuted,
  lineHeight: 1.6,
}

const tableStyle = {
  margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace',
  fontSize: 12.5,
  lineHeight: 1.7,
  color: C.text,
  whiteSpace: 'pre',
  overflowX: 'auto',
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
  // Horizontal bar — width relative to the largest bucket so the
  // dominant range fills its row, others scale proportionally.
  const widthPct = Math.max(0, Math.min(100, (pct / maxPct) * 100))
  const muted2 = pct === 0 ? 0.4 : 1
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: muted2 }}>
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

function Section({ children }) {
  return (
    <div
      style={{
        marginTop: 32,
        padding: '20px 18px',
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
      }}
    >
      {children}
    </div>
  )
}

function Header() {
  return (
    <>
      <p style={{
        margin: 0,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: C.text,
      }}>
        HISTORICAL CONDITIONS
      </p>
      <p style={{ ...muted, margin: '4px 0 0', fontSize: 13 }}>
        Similar historical occurrences in the PineX database
      </p>
    </>
  )
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{
        marginTop: 16,
        marginBottom: 0,
        borderTop: `1px solid ${C.border}`,
      }}
    />
  )
}
