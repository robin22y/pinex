/**
 * TodayVsHistory — Home page hero focus card.
 *
 * Reads one row from daily_market_context and renders it as the
 * top of the home page per the rework spec:
 *
 *   MARKET TODAY · <DATE>
 *
 *   <Large> MIXED        Breadth: 54%
 *   942 advancing · 167 topping
 *   VIX 13.4 — Normal
 *
 *   ──────── separator ────────
 *
 *   Similar to 24 past sessions
 *   <distribution bars — 5 bucket horizontal CSS>
 *
 * Then one observation sentence below the card, derived from the
 * market_phase column:
 *   healthy → "Broad participation — majority of stocks above
 *              long-term average."
 *   mixed   → "Mixed conditions — breadth narrowing while index
 *              holds."
 *   weak    → "Narrow market — fewer stocks participating in
 *              index move."
 *
 * Design constraints:
 *   - Sepia theme preserved via C tokens (no literal hex except
 *     the #60A5FA distribution bar fill carried over from the
 *     previous spec — neutral observation colour).
 *   - Border radius 4 px. No shadows. No gradients. No animations.
 *   - Left-aligned. Typography-first.
 *   - Section gap to next block: 48 px (handled by parent margin).
 *   - Card padding: 16 px.
 *
 * Self-gates:
 *   loading / error / no row     → null (no flash)
 *   similar_days_count < 10      → distribution placeholder
 *                                   ('Building historical context…')
 */
import { useEffect, useState } from 'react'
import { C, FONTS } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'

const MIN_SAMPLE = 10
const BAR_FILL   = '#60A5FA'  // spec-locked neutral observation hue

// distribution_10d shape (from scripts/calc_market_context.py):
//   { strong, positive, flat, negative } — ints summing to 100.
const BUCKETS = [
  { key: 'strong',   label: '+5% or more' },
  { key: 'positive', label: '+1% to +5%' },
  { key: 'flat',     label: 'Flat (−1 to +1)' },
  { key: 'negative', label: 'Below −1%' },
]

const PHASE_OBSERVATIONS = {
  healthy: 'Broad participation — majority of stocks above long-term average.',
  mixed:   'Mixed conditions — breadth narrowing while index holds.',
  weak:    'Narrow market — fewer stocks participating in index move.',
}

// Title-case the phase enum for display.
function phaseTitle(p) {
  if (!p) return '—'
  return String(p).charAt(0).toUpperCase() + String(p).slice(1)
}

function fmtDateHeader(iso) {
  if (!iso) return '—'
  const parts = String(iso).slice(0, 10).split('-')
  if (parts.length !== 3) return iso
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec']
  const m = months[Number(parts[1]) - 1] ?? '—'
  const d = Number(parts[2])
  return `${d} ${m} ${parts[0]}`
}

function fmtNum(n, places = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(places).replace(/\.0$/, '')
}

function fmtInt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-IN')
}

function vixLevelLabel(level) {
  if (!level) return null
  return level.charAt(0).toUpperCase() + level.slice(1)
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

  const sample      = Number(row.similar_days_count ?? 0)
  const dist        = row.distribution_10d || {}
  const phase       = String(row.market_phase || '').toLowerCase()
  const observation = PHASE_OBSERVATIONS[phase] ?? null
  const vixLabel    = vixLevelLabel(row.vix_level)

  return (
    <>
      {/* ── Focus card ───────────────────────────────────── */}
      <section style={card}>
        <div style={topRowLabel}>
          MARKET TODAY · {fmtDateHeader(row.date)}
        </div>

        <div style={titleRow}>
          <div style={primaryNumber}>
            {phaseTitle(phase)}
          </div>
          <div style={secondaryStat}>
            Breadth: <strong style={secondaryStrong}>{fmtNum(row.above_ma30w_pct, 0)}%</strong>
          </div>
        </div>

        <div style={mutedLine}>
          {fmtInt(row.stage2_count)} advancing · {fmtInt(row.stage3_count)} topping
        </div>
        <div style={mutedLine}>
          VIX {fmtNum(row.india_vix, 1)}{vixLabel ? ` — ${vixLabel}` : ''}
        </div>

        <div style={separator} aria-hidden />

        <div style={similarLine}>
          Similar to {fmtInt(row.similar_days_count)} past sessions
        </div>

        {sample < MIN_SAMPLE ? (
          <p style={buildingMsg}>Building historical context…</p>
        ) : (
          <div style={{ marginTop: 8 }}>
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
        )}
      </section>

      {/* ── Observation sentence — sits BELOW the card per spec.
           Reads from the same row's market_phase. Quiet typographic
           line, not a separate panel. */}
      {observation && (
        <p style={observationLine}>{observation}</p>
      )}
    </>
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

// ── Inline styles — flat, left-aligned, sharp corners ─────

const card = {
  padding: '16px 16px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  // Section gap to the observation sentence below.
  marginBottom: 8,
}

const topRowLabel = {
  fontFamily: FONTS.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.10em',
  color: C.textMuted,
  marginBottom: 16,
}

const titleRow = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 8,
}

// Per spec: font-size 32px / weight 700 / "primary number" colour
const primaryNumber = {
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: C.text,
  lineHeight: 1.1,
}

const secondaryStat = {
  fontSize: 13,
  color: C.textMuted,
}

const secondaryStrong = {
  color: C.text,
  fontWeight: 600,
  fontFamily: FONTS.mono,
}

// 8px between related items (advancing line + VIX line).
const mutedLine = {
  fontSize: 13,
  color: C.textMuted,
  lineHeight: 1.5,
  marginTop: 8,
}

const separator = {
  height: 1,
  background: C.border,
  margin: '24px 0 16px',
}

const similarLine = {
  fontSize: 13,
  color: C.textMuted,
  marginBottom: 12,
}

const distHeader = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.10em',
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
  borderRadius: 0,
}

const barValue = {
  textAlign: 'right',
  fontFamily: FONTS.mono,
  fontSize: 12,
  color: C.text,
}

const buildingMsg = {
  marginTop: 8,
  marginBottom: 0,
  padding: '12px 0',
  fontSize: 13,
  color: C.textMuted,
  fontStyle: 'italic',
}

// Observation sentence — sits OUTSIDE the card, left-aligned,
// 24 px space below it before the next section starts.
const observationLine = {
  margin: '8px 0 0',
  padding: '0 4px',
  fontSize: 14,
  color: C.text,
  lineHeight: 1.55,
}
