/**
 * WhatChangedToday — emits TWO visually-distinct sections per the
 * rework spec:
 *
 *   WHAT CHANGED TODAY
 *
 *   + 12 stocks entered Stage 2
 *   + 8 stocks moved to Stage 3
 *   Chemicals leading this week
 *
 *   View these stocks →   (link to /explore)
 *
 *
 *   SECTORS
 *
 *   Active:
 *   Chemicals · Pharma · Infrastructure
 *
 *   Quiet:
 *   Paints · Tourism · Cement
 *
 * Both blocks share the same data fetches (market_internals + the
 * sectors table) so they live in one component file rather than
 * separate units, per the spec's file constraint.
 *
 * Design:
 *   - Left-aligned, sepia-safe via C tokens.
 *   - border 1px solid C.border · border-radius 4 px.
 *   - 16 px padding inside cards, 8 px between related lines,
 *     24 px between unrelated items, 48 px section gap.
 *   - No gradients. No shadows. No animations.
 *   - Section headers — 11 px / 0.10em / uppercase / mono / muted.
 *
 * Self-gates:
 *   loading                        → null (no flash)
 *   no market_internals rows       → null
 *   no sectors rows                → sectors block suppressed,
 *                                     "what changed" still renders
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { C, FONTS } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'

const SECTOR_PICK_COUNT = 3   // top / bottom N sectors by stage2_pct

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

        // Top N sectors by stage2_pct DESC — "active" cohort.
        const activePromise = supabase
          .from('sectors')
          .select('display_name, name, stage2_pct, stage2_count, total_companies')
          .order('stage2_pct', { ascending: false })
          .limit(SECTOR_PICK_COUNT)

        // Bottom N sectors by stage2_pct ASC — "quiet" cohort.
        // Sectors table has no stage3/stage4 column; lowest stage2
        // share is the cleanest proxy with the available data.
        const quietPromise = supabase
          .from('sectors')
          .select('display_name, name, stage2_pct, stage2_count, total_companies')
          .order('stage2_pct', { ascending: true })
          .limit(SECTOR_PICK_COUNT)

        const [miRes, activeRes, quietRes] = await Promise.all([
          miPromise, activePromise, quietPromise,
        ])
        if (cancelled) return
        if (miRes.error) throw miRes.error

        const [today, yesterday] = miRes.data ?? []
        const stage2Delta = (today?.stage2_count != null && yesterday?.stage2_count != null)
          ? Number(today.stage2_count) - Number(yesterday.stage2_count)
          : null
        const stage3Delta = (today?.stage3_count != null && yesterday?.stage3_count != null)
          ? Number(today.stage3_count) - Number(yesterday.stage3_count)
          : null

        const activeSectors = (activeRes?.data ?? [])
          .map(sectorName).filter(Boolean)
        const quietSectors = (quietRes?.data ?? [])
          .map(sectorName).filter(Boolean)
        const leadingSector = activeSectors[0] || null

        setState({
          status: 'ready',
          today,
          stage2Delta,
          stage3Delta,
          activeSectors,
          quietSectors,
          leadingSector,
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

  const s2 = formatDelta(state.stage2Delta, 'Stage 2')
  const s3 = formatDelta(state.stage3Delta, 'Stage 3')
  const leading = state.leadingSector
  // Defensive defaults — React Fast Refresh preserves state shape
  // across HMR, so a stale render of the previous component can
  // hand us state objects missing these arrays. The ?? [] guards
  // crash-proof both .length and the .join() calls below.
  const activeList = state.activeSectors ?? []
  const quietList  = state.quietSectors  ?? []

  const hasChangedLines = s2 || s3 || leading
  const hasSectorLines  = activeList.length > 0 || quietList.length > 0

  return (
    <>
      {/* ── Section 1 — WHAT CHANGED TODAY ──────────────── */}
      <section style={card}>
        <div style={sectionHeader}>WHAT CHANGED TODAY</div>

        {hasChangedLines ? (
          <ul style={lineList}>
            {s2 && (
              <li style={lineItem}>
                <span style={signMark}>+</span>
                <span style={lineText}>{s2.count} stocks {s2.verb} Stage 2</span>
              </li>
            )}
            {s3 && (
              <li style={lineItem}>
                <span style={signMark}>+</span>
                <span style={lineText}>{s3.count} stocks {s3.verb} Stage 3</span>
              </li>
            )}
            {leading && (
              <li style={lineItem}>
                <span style={lineText}>{leading} leading this week</span>
              </li>
            )}
          </ul>
        ) : (
          <p style={quietText}>
            No measurable movement since yesterday.
          </p>
        )}

        <div style={ctaRow}>
          <Link to="/explore" style={ctaLink}>View these stocks →</Link>
        </div>
      </section>

      {/* ── Section 2 — SECTORS (Active / Quiet) ────────── */}
      {hasSectorLines && (
        <section style={cardSpaced}>
          <div style={sectionHeader}>SECTORS</div>

          {activeList.length > 0 && (
            <>
              <div style={groupLabel}>Active</div>
              <div style={groupValue}>
                {activeList.join(' · ')}
              </div>
            </>
          )}

          {quietList.length > 0 && (
            <>
              <div style={{ ...groupLabel, marginTop: 24 }}>Quiet</div>
              <div style={groupValue}>
                {quietList.join(' · ')}
              </div>
            </>
          )}
        </section>
      )}
    </>
  )
}

// ── Helpers ────────────────────────────────────────────

function sectorName(row) {
  if (!row) return null
  return row.display_name || row.name || null
}

function formatDelta(delta, stageLabel) {
  if (delta == null || delta === 0) return null
  const abs = Math.abs(delta)
  if (delta > 0) {
    return {
      count: abs,
      verb: stageLabel === 'Stage 2' ? 'entered' : 'moved to',
    }
  }
  return { count: abs, verb: 'left' }
}

// ── Inline styles — typography-first, left-aligned, flat ─

const card = {
  padding: '16px 16px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  // Section gap to the next block (Sectors / SwingX).
  marginTop: 48,
}

// Same as card, but with a smaller top margin since SECTORS
// follows WHAT CHANGED inside one related cluster.
const cardSpaced = {
  ...card,
  marginTop: 24,
}

const sectionHeader = {
  fontFamily: FONTS.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: C.textMuted,
  marginBottom: 16,
}

const lineList = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const lineItem = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontSize: 14,
  color: C.text,
  lineHeight: 1.5,
}

const signMark = {
  fontFamily: FONTS.mono,
  fontSize: 13,
  fontWeight: 700,
  color: C.textMuted,
  flexShrink: 0,
}

const lineText = { color: C.text }

const quietText = {
  margin: 0,
  fontSize: 13,
  color: C.textMuted,
  fontStyle: 'italic',
}

const ctaRow = { marginTop: 24 }

const ctaLink = {
  display: 'inline-block',
  fontSize: 13,
  color: C.amber,
  fontWeight: 600,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  borderBottom: `1px solid ${C.amber}`,
  paddingBottom: 1,
}

const groupLabel = {
  fontSize: 13,
  color: C.textMuted,
  marginBottom: 8,
}

const groupValue = {
  fontSize: 16,
  color: C.text,
  lineHeight: 1.5,
  letterSpacing: '-0.005em',
}
