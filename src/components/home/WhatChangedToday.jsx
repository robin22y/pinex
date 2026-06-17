/**
 * WhatChangedToday — homepage "What changed today" section.
 *
 * Three small typographic stat lines plus a CTA that routes to
 * /explore. No charts, no cards, no animations. Pure flat
 * design per the spec — PineX colour tokens via C, no gradients.
 *
 * Data:
 *   - market_internals, last 2 rows → stage2_count + stage3_count
 *     deltas (today minus yesterday). The user asked for "stocks
 *     entered Stage 2 today" — the cleanest proxy without a
 *     dedicated transitions table is the net change in the count.
 *     When deltas are positive we report "X stocks entered"; when
 *     negative we report "X stocks left" so the headline still
 *     conveys movement direction without outcome language.
 *   - sectors, ordered by stage2_pct DESC → leading sector this week.
 *
 * Self-gates render:
 *   loading                            → null
 *   no market_internals rows           → null
 *   missing both stage delta lines     → renders the sector line
 *                                        only (still useful)
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { C, FONTS } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'

export default function WhatChangedToday() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Two latest market_internals rows for the day-over-day
        // delta. Small SELECT, one round-trip.
        const miPromise = supabase
          .from('market_internals')
          .select('date, stage2_count, stage3_count')
          .order('date', { ascending: false })
          .limit(2)

        // Leading sector — highest stage2_pct from the sectors table.
        const secPromise = supabase
          .from('sectors')
          .select('display_name, name, stage2_pct, stage2_count, total_companies, date')
          .order('stage2_pct', { ascending: false })
          .limit(1)
          .maybeSingle()

        const [miRes, secRes] = await Promise.all([miPromise, secPromise])
        if (cancelled) return
        if (miRes.error) throw miRes.error
        // sectors.error is non-fatal; the sector line is optional

        const [today, yesterday] = miRes.data ?? []
        const sector = secRes?.data ?? null

        const stage2Delta = (today?.stage2_count != null && yesterday?.stage2_count != null)
          ? Number(today.stage2_count) - Number(yesterday.stage2_count)
          : null
        const stage3Delta = (today?.stage3_count != null && yesterday?.stage3_count != null)
          ? Number(today.stage3_count) - Number(yesterday.stage3_count)
          : null

        setState({
          status: 'ready',
          today,
          stage2Delta,
          stage3Delta,
          sector,
        })
      } catch (err) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('WhatChangedToday fetch failed:', err)
        setState({ status: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state.status !== 'ready') return null
  if (!state.today) return null

  const stage2 = formatDelta(state.stage2Delta, 'Stage 2')
  const stage3 = formatDelta(state.stage3Delta, 'Stage 3')
  const sector = state.sector
  const sectorName =
    sector?.display_name || sector?.name || null

  return (
    <section style={frame}>
      <header style={headerWrap}>
        <div style={titleStyle}>WHAT CHANGED TODAY</div>
        <div style={subtitle}>Day-over-day movement across the universe</div>
      </header>

      <div style={lineList}>
        {stage2 && (
          <Line text={`${stage2.count} ${stage2.verb} Stage 2 today`} />
        )}
        {stage3 && (
          <Line text={`${stage3.count} ${stage3.verb} Stage 3 today`} />
        )}
        {sectorName && (
          <Line text={`${sectorName} leading this week`} />
        )}
        {!stage2 && !stage3 && !sectorName && (
          <Line text="No measurable movement since yesterday." muted />
        )}
      </div>

      <div style={ctaRow}>
        <Link to="/explore" style={ctaLink}>
          View stocks in these conditions →
        </Link>
      </div>
    </section>
  )
}

function Line({ text, muted = false }) {
  return (
    <p style={{
      ...linePara,
      color: muted ? C.textMuted : C.text,
      fontStyle: muted ? 'italic' : 'normal',
    }}>
      {text}
    </p>
  )
}

// Pretty-print a delta as { count, verb }. Suppress zeros so the
// list doesn't read as filler ("0 stocks entered Stage 2 today" is
// noise). Negatives invert the verb so the headline still carries
// direction without an "outcome" claim.
function formatDelta(delta, stageLabel) {
  if (delta == null || delta === 0) return null
  const abs = Math.abs(delta)
  if (delta > 0) return { count: abs, verb: `stocks entered`, stageLabel }
  return { count: abs, verb: `stocks left`, stageLabel }
}

// ── Inline styles — flat, no rounded corners, no shadows ─────

const frame = {
  marginTop: 16,
  padding: '20px 18px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 0,
}

const headerWrap = { marginBottom: 14 }

const titleStyle = {
  fontFamily: FONTS.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.10em',
  color: C.textMuted,
}

const subtitle = {
  marginTop: 4,
  fontSize: 18,
  fontWeight: 700,
  color: C.text,
  letterSpacing: '-0.01em',
}

const lineList = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
}

const linePara = {
  margin: 0,
  padding: '10px 0',
  borderTop: `1px solid ${C.border}`,
  fontSize: 14,
  lineHeight: 1.5,
}

const ctaRow = { marginTop: 16 }

const ctaLink = {
  fontSize: 12,
  color: C.amber,
  fontWeight: 600,
  letterSpacing: '0.02em',
  textDecoration: 'none',
  borderBottom: `1px solid ${C.amber}`,
  paddingBottom: 1,
}
