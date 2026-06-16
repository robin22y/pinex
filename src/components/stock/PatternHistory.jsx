/**
 * PatternHistory — Historical Conditions section on /stock/:symbol.
 *
 * Calls the Supabase Edge Function `pattern-match` with the current
 * stock conditions and renders the aggregated forward-outcome table
 * + top-similar-instances list + disclaimer.
 *
 * Layout is intentionally rigid — the user requirement is "Display
 * exactly like this — no deviation". The numbers come from the
 * matcher; tweaking them is the only thing that should change here.
 *
 * Self-gates render:
 *   - while loading           → null  (no flash of empty layout)
 *   - error fetching          → null
 *   - sample_size < 30        → "Insufficient historical data" line
 *                               (avoids reading-too-much into noise)
 *
 * No raw rupee numbers are shown; only percentages. Safe under the
 * StockDetail page's "NO raw price numbers" rule.
 */
import { useEffect, useMemo, useState } from 'react'
import { C } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'

const FUNCTION_NAME = 'pattern-match'

// Vite env override — same pattern used by IQjetDesk for local dev.
function functionsBaseUrl() {
  const override = import.meta.env.VITE_FUNCTIONS_BASE_URL
  if (override) return String(override).replace(/\/+$/, '')
  const url = import.meta.env.VITE_SUPABASE_URL
  return url ? `${String(url).replace(/\/+$/, '')}/functions/v1` : ''
}

function fmtPct(n, { plus = false } = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  // Drop trailing .0 on whole numbers so "61%" reads cleaner than "61.0%".
  const abs = Math.abs(v)
  const txt = abs >= 10
    ? Math.round(v).toString()
    : v.toFixed(1).replace(/\.0$/, '')
  return `${plus ? sign : ''}${txt}%`
}

function fmtSignedPct(n) {
  return fmtPct(n, { plus: true })
}

function fmtMonthYear(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function fmtYearRange(earliest, latest) {
  if (!earliest || !latest) return null
  const ey = String(earliest).slice(0, 4)
  const ly = String(latest).slice(0, 4)
  return ey === ly ? ey : `${ey}-${ly}`
}

// Pick which forward window to show in the "Top similar instances"
// rows. The spec puts a different horizon next to each instance:
// → +23% (30d), → +41% (60d), → +18% (30d), → +67% (90d).
// We pick the largest-magnitude positive forward for each row (or
// the least-negative if all are losses) so the listed number is the
// most striking outcome — same idea behind the spec's selection.
function bestForwardForInstance(inst) {
  const opts = [
    ['7d',  inst.forward_7d],
    ['30d', inst.forward_30d],
    ['60d', inst.forward_60d],
    ['90d', inst.forward_90d],
  ].filter(([, v]) => v != null && Number.isFinite(Number(v)))
  if (opts.length === 0) return { horizon: '30d', value: null }
  // Sort by absolute magnitude descending → most-extreme outcome
  // first. Tie-broken by sign (positive wins).
  opts.sort((a, b) => {
    const av = Math.abs(Number(a[1]))
    const bv = Math.abs(Number(b[1]))
    if (bv !== av) return bv - av
    return Number(b[1]) - Number(a[1])
  })
  return { horizon: opts[0][0], value: Number(opts[0][1]) }
}

export default function PatternHistory({
  symbol,
  stage,
  substage,
  rsScore,
  volRatio,
  aboveMa30wPct,   // optional — fetched from market_internals when omitted
}) {
  const [state, setState] = useState({ status: 'loading' })

  // Stable key so we don't refire when irrelevant parent props change.
  const queryKey = useMemo(() => {
    return JSON.stringify({
      symbol: symbol || '',
      stage:  stage  || '',
      substage: substage || '',
      rs:  Number(rsScore),
      vol: Number(volRatio),
      breadth: Number(aboveMa30wPct),
    })
  }, [symbol, stage, substage, rsScore, volRatio, aboveMa30wPct])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    // Don't fire without the inputs the matcher needs.
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
        // above_ma30w_pct is a daily market-wide value, not per-stock.
        // Resolve it here (one tiny SELECT) so the parent page
        // doesn't have to add a separate fetch path. The latest
        // market_internals row is always cheap.
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
          // Without breadth the matcher can't deliver a meaningful
          // result. Render nothing rather than a misleading sample.
          if (cancelled) return
          setState({ status: 'idle' })
          return
        }

        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY
        const base = functionsBaseUrl()
        if (!base) throw new Error('functions base url not configured')
        const res = await fetch(`${base}/${FUNCTION_NAME}`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey':         import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            stage,
            substage: substage || null,
            rs_score:    Number(rsScore),
            vol_ratio:   Number(volRatio),
            above_ma30w_pct: breadthValue,
          }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`pattern-match ${res.status}: ${text.slice(0, 200)}`)
        }
        const data = await res.json()
        if (cancelled) return
        setState({ status: 'ready', data })
      } catch (err) {
        if (cancelled) return
        // Log for debugging but render nothing — the section is
        // additive content, not load-bearing. A 500 here shouldn't
        // pollute the page with a red banner.
        // eslint-disable-next-line no-console
        console.warn('PatternHistory fetch failed:', err)
        setState({ status: 'error' })
      }
    })()

    return () => { cancelled = true }
  }, [queryKey, stage, substage, rsScore, volRatio, aboveMa30wPct])

  if (state.status !== 'ready') return null
  const data = state.data
  if (!data || (data.sample_size ?? 0) < 30) {
    // Too few matches to be informative. Render a quiet placeholder.
    return (
      <Section>
        <Header />
        <p style={{ ...muted, fontSize: 13, margin: '10px 0 0' }}>
          Not enough historically similar setups in the database yet
          to draw a stable distribution. As more snapshots accumulate
          this section will fill in.
        </p>
      </Section>
    )
  }

  const yearRange = fmtYearRange(data.earliest_date, data.latest_date)
  const sampleLine = yearRange
    ? `Sample size: ${data.sample_size.toLocaleString('en-IN')} instances (${yearRange})`
    : `Sample size: ${data.sample_size.toLocaleString('en-IN')} instances`

  const headers = data.table?.headers ?? ['7 days', '30 days', '60 days']
  const positive   = data.table?.positive   ?? [null, null, null]
  const medianRet  = data.table?.median_return ?? [null, null, null]
  const bestCase   = data.table?.best_case  ?? [null, null, null]
  const worstCase  = data.table?.worst_case ?? [null, null, null]

  return (
    <Section>
      <Header />
      <p style={{ ...muted, margin: '8px 0 18px', fontSize: 13 }}>
        {sampleLine}
      </p>

      {/* Forward-outcome distribution table.
          Hand-aligned monospace so the columns line up identically
          on every device — flex / grid alignment was drifting on
          narrow viewports. */}
      <pre style={tableStyle}>
{tableRow('',              headers[0],  headers[1],  headers[2])}
{tableRow('Positive:',     fmtPct(positive[0]),  fmtPct(positive[1]),  fmtPct(positive[2]))}
{tableRow('Median return:', fmtSignedPct(medianRet[0]), fmtSignedPct(medianRet[1]), fmtSignedPct(medianRet[2]))}
{tableRow('Best case:',     fmtSignedPct(bestCase[0]),  fmtSignedPct(bestCase[1]),  fmtSignedPct(bestCase[2]))}
{tableRow('Worst case:',    fmtSignedPct(worstCase[0]), fmtSignedPct(worstCase[1]), fmtSignedPct(worstCase[2]))}
      </pre>

      <p style={{ ...muted, margin: '18px 0 8px', fontSize: 13, color: C.text }}>
        What happened in similar conditions:
      </p>
      <pre style={tableStyle}>
{eventRow('✓', 'Advanced further:',     fmtPct(positive[1]))}
{eventRow('✓', 'Hit new 52W high:',     fmtPct(data.pct_hit_52w_high))}
{eventRow('✗', 'Dropped below 30W MA:', fmtPct(data.pct_dropped_below_ma))}
{eventRow('↑', 'Stage upgraded:',       fmtPct(data.pct_stage_upgraded))}
      </pre>

      <Divider />

      <p style={{
        ...muted, color: C.text, fontSize: 13,
        margin: '18px 0 10px', fontWeight: 600, letterSpacing: '0.04em',
      }}>
        TOP SIMILAR HISTORICAL INSTANCES
      </p>
      <pre style={tableStyle}>
{(data.similar_instances ?? []).map((inst, idx) => {
  const bf = bestForwardForInstance(inst)
  const fwd = bf.value == null ? '—' : fmtSignedPct(bf.value)
  const sym = String(inst.symbol || '—').padEnd(11)
  const dt  = fmtMonthYear(inst.date).padEnd(9)
  const sc  = `Score ${inst.similarity_score ?? '—'}%`.padEnd(11)
  return `${sym} ${dt} ${sc} →${fwd} (${bf.horizon})\n`
}).join('')}
      </pre>

      <Divider />

      <p style={{
        ...muted, fontSize: 11, fontStyle: 'italic',
        textAlign: 'center', lineHeight: 1.6,
        margin: '14px auto 0', maxWidth: 360,
      }}>
        This analysis is based on historical observations only.
        Past conditions do not guarantee future outcomes.
        Not investment advice.
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

function tableRow(label, c1, c2, c3) {
  // Column widths chosen to match the spec layout while staying
  // narrow enough for mobile. "Median return:" is the widest label
  // at 14 chars + colon — pad to 16.
  const L = String(label).padEnd(16)
  const C1 = String(c1).padStart(8)
  const C2 = String(c2).padStart(9)
  const C3 = String(c3).padStart(9)
  return `${L}${C1}  ${C2}  ${C3}\n`
}

function eventRow(glyph, label, pct) {
  // Glyph + label left, percentage right-aligned at column 30.
  const left = `${glyph} ${label}`
  const right = String(pct).padStart(Math.max(30 - left.length, 4))
  return `${left}${right}\n`
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
        Similar setups in PineX database
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
