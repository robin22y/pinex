/**
 * TodayVsHistory — homepage "Today in Market Context" section.
 *
 * Reads ONE pre-computed row from public.daily_market_context.
 * The nightly pipeline (scripts/calc_market_context.py) does the
 * historical matching + bucketing; the frontend just renders.
 *
 *   SELECT * FROM daily_market_context
 *   ORDER BY date DESC LIMIT 1
 *
 * Visual spec (verbatim — do not stylise):
 *   - Flat design. No gradients. No shadows. No animations.
 *   - Typography-first. PineX colour tokens via the C object,
 *     EXCEPT the distribution bar fill which is the spec hex
 *     #60A5FA for every bucket — these are neutral observations,
 *     never coloured by direction.
 *   - Distribution bars are pure CSS (`width: <pct>%`) — no
 *     chart library, no animation.
 *
 * Self-gates render:
 *   loading / error                 → null (no flash)
 *   similar_days_count < MIN_SAMPLE → "Building historical context..."
 *                                      placeholder, no empty bars
 */
import { useEffect, useState } from 'react'
import { C, FONTS } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'

const MIN_SAMPLE = 10
const BAR_FILL   = '#60A5FA'   // spec-mandated blue, NOT a token

// distribution_10d schema (set in scripts/calc_market_context.py):
//   { strong: %, positive: %, flat: %, negative: % }
// Render order mirrors the spec — best to worst, top to bottom.
const BUCKETS = [
  { key: 'strong',   label: '+5% or more' },
  { key: 'positive', label: '+1% to +5%' },
  { key: 'flat',     label: 'Flat (−1% to +1%)' },
  { key: 'negative', label: 'Below −1%' },
]

function fmtDateHeader(iso) {
  if (!iso) return '—'
  // Build a UTC date so the displayed day matches the stored
  // calendar date regardless of viewer time zone.
  const parts = String(iso).slice(0, 10).split('-')
  if (parts.length !== 3) return iso
  const months = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC']
  const m = months[Number(parts[1]) - 1] ?? '—'
  const d = Number(parts[2])
  const y = parts[0]
  return `${m} ${d}, ${y}`
}

function fmtNum(n, places = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(places).replace(/\.0$/, '')
}

export default function TodayVsHistory() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('daily_market_context')
          .select('*')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) throw error
        if (cancelled) return
        setState({ status: 'ready', row: data })
      } catch (err) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('TodayVsHistory fetch failed:', err)
        setState({ status: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state.status === 'loading' || state.status === 'error') return null
  const row = state.row
  if (!row) return null

  const sample = Number(row.similar_days_count ?? 0)
  const dist   = row.distribution_10d || {}

  return (
    <section style={frame}>
      <header style={headerWrap}>
        <div style={dateHeader}>
          TODAY · {fmtDateHeader(row.date)}
        </div>
        <div style={subhead}>
          Market context vs historical observations
        </div>
      </header>

      {/* ── Snapshot stats — typography-first, no cards ──────── */}
      <dl style={statsList}>
        <StatRow label="Above 30W MA"
                 value={`${fmtNum(row.above_ma30w_pct, 1)}%`} />
        <StatRow label="Stage 2 stocks"
                 value={fmtNum(row.stage2_count, 0)} />
        <StatRow label="Stage 3 stocks"
                 value={fmtNum(row.stage3_count, 0)} />
        <StatRow label="India VIX"
                 value={`${fmtNum(row.india_vix, 1)} · ${row.vix_level || '—'}`} />
        <StatRow label="Similar past days"
                 value={fmtNum(row.similar_days_count, 0)} />
      </dl>

      {sample < MIN_SAMPLE ? (
        <p style={buildingMsg}>
          Building historical context…
        </p>
      ) : (
        <DistributionBars dist={dist} />
      )}

      <p style={disclaimer}>
        Historical observations only. Past conditions do not
        guarantee future outcomes.
      </p>
    </section>
  )
}

function DistributionBars({ dist }) {
  return (
    <div style={distWrap}>
      <div style={distHeader}>
        Nifty 10-day forward distribution
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {BUCKETS.map((b) => {
          const pct = Number(dist?.[b.key] ?? 0)
          return <BucketBar key={b.key} label={b.label} pct={pct} />
        })}
      </div>
    </div>
  )
}

function BucketBar({ label, pct }) {
  const width = Math.max(0, Math.min(100, pct))
  return (
    <div style={barRow}>
      <div style={barLabel}>{label}</div>
      <div style={barTrack}>
        <div style={{
          width: `${width}%`,
          height: '100%',
          background: BAR_FILL,
        }} />
      </div>
      <div style={barValue}>{pct}%</div>
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div style={statRow}>
      <dt style={statKey}>{label}</dt>
      <dd style={statVal}>{value}</dd>
    </div>
  )
}

// ── Inline styles — flat, no borders rounded, no shadows ─────

const frame = {
  marginTop: 24,
  padding: '20px 18px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  // intentionally NOT rounded — flat design per spec
  borderRadius: 0,
}

const headerWrap = { marginBottom: 16 }

const dateHeader = {
  fontFamily: FONTS.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.10em',
  color: C.textMuted,
}

const subhead = {
  marginTop: 4,
  fontSize: 18,
  fontWeight: 700,
  color: C.text,
  letterSpacing: '-0.01em',
}

const statsList = {
  margin: '0 0 20px',
  padding: 0,
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 0,
}

const statRow = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: `1px solid ${C.border}`,
}

const statKey = {
  margin: 0,
  fontSize: 13,
  color: C.textMuted,
}

const statVal = {
  margin: 0,
  fontFamily: FONTS.mono,
  fontSize: 13,
  fontWeight: 600,
  color: C.text,
}

const distWrap = { marginBottom: 16 }

const distHeader = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: C.textMuted,
  marginBottom: 10,
}

const barRow = {
  display: 'grid',
  gridTemplateColumns: '130px 1fr 44px',
  alignItems: 'center',
  gap: 12,
}

const barLabel = {
  fontFamily: FONTS.mono,
  fontSize: 12,
  color: C.text,
}

const barTrack = {
  height: 8,
  background: C.surface2,
}

const barValue = {
  textAlign: 'right',
  fontFamily: FONTS.mono,
  fontSize: 12,
  color: C.text,
}

const buildingMsg = {
  marginTop: 8,
  marginBottom: 8,
  padding: '12px 0',
  textAlign: 'center',
  fontSize: 13,
  color: C.textMuted,
  fontStyle: 'italic',
}

const disclaimer = {
  marginTop: 14,
  marginBottom: 0,
  fontSize: 11,
  color: C.textFaint,
  textAlign: 'center',
  fontStyle: 'italic',
  lineHeight: 1.5,
}
