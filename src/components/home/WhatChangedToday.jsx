/**
 * WhatChangedToday — "you missed this" landing card.
 *
 * Three insight rows, each with a plain-English headline (line 1)
 * and a one-line "what it means" tail (line 2). Followed by a
 * 'WHAT THIS MEANS' block that translates market_internals.market_phase
 * into a single sentence, and a 'Come back tomorrow' nudge at the
 * very bottom.
 *
 * HEADER
 *   When the previous-session snapshot (sessionStorage written by
 *   AuthContext on hydrate, see context/AuthContext.jsx) shows
 *   last_active_at > 24 h ago, we read 'YOU MISSED THIS'. When the
 *   user has been around today, we read "TODAY'S MOVEMENT". The
 *   snapshot is the same one WYWA uses.
 *
 * INSIGHTS
 *   1. Top stage-2 sector — "X woke up · Money is rotating in"
 *   2. Stage-2 entries since yesterday
 *      — "N stocks crossed into early uptrend · New trend forming"
 *   3. Either a breadth-warning row (when above_ma30w_pct dropped
 *      by > 2 pp) or stage-3 progression — picks one, never both.
 *      The breadth row is prefixed ⚠ in amber per the sentiment
 *      indicator rule.
 *
 * WHAT THIS MEANS
 *   One sentence keyed on market_internals.market_phase
 *   (healthy / mixed / weak). Falls back to 'mixed' copy when the
 *   value is unknown so the section never reads blank.
 *
 * COMES BACK TOMORROW
 *   Tiny muted italic line at the foot — "Tomorrow: See if Stage 2
 *   expands or fails.".
 *
 * Self-gates: null on loading / fetch error / no market_internals
 * rows. No flash; no empty card.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const AWAY_THRESHOLD_MS = 24 * 60 * 60 * 1000
const SECTOR_PICK_COUNT = 1            // only the top sector now
const BREADTH_WARN_DROP = 2            // pp drop that triggers ⚠

const MEANING = {
  healthy: 'Broad participation confirmed. Majority of stocks in uptrend.',
  mixed:   'Market holding but participation narrowing. Stay selective.',
  weak:    'Fewer stocks carrying the index. Conditions tightening.',
}

function pickSectorName(row) {
  if (!row) return null
  return row.display_name || row.name || null
}

function wasAwayFromSnapshot() {
  if (typeof window === 'undefined') return false
  try {
    const snap = sessionStorage.getItem('pinex_prev_last_active_at')
    if (!snap) return false
    const then = new Date(snap).getTime()
    if (!Number.isFinite(then)) return false
    return Date.now() - then > AWAY_THRESHOLD_MS
  } catch {
    return false
  }
}

export default function WhatChangedToday() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Two latest market_internals rows for day-over-day deltas.
        // Added above_ma30w_pct (for the breadth warning sentiment
        // gate) and market_phase (for the WHAT THIS MEANS copy) —
        // both are columns the row already carries; no new table,
        // no new schema, same one-shot SELECT as before.
        const miPromise = supabase
          .from('market_internals')
          .select('date, stage2_count, stage3_count, above_ma30w_pct, market_phase')
          .order('date', { ascending: false })
          .limit(2)

        // Single top sector by stage2_pct DESC for the wake-up line.
        const leadPromise = supabase
          .from('sectors')
          .select('display_name, name, stage2_pct')
          .order('stage2_pct', { ascending: false })
          .limit(SECTOR_PICK_COUNT)

        // SwingX active-positions count for the bottom chip. Counts
        // rows in swingx_entries with is_active=true. `count: 'exact'`
        // + `head: true` returns the count without any payload so the
        // query is one number, not 2k rows. Error is non-fatal — chip
        // hides cleanly when count is null.
        const swingxActivePromise = supabase
          .from('swingx_entries')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)

        const [miRes, leadRes, swingxRes] = await Promise.all([
          miPromise, leadPromise, swingxActivePromise,
        ])
        if (cancelled) return
        if (miRes.error) throw miRes.error

        const [today, yesterday] = miRes.data ?? []
        if (!today) { setState({ status: 'empty' }); return }

        const stage2Delta = (today.stage2_count != null && yesterday?.stage2_count != null)
          ? Number(today.stage2_count) - Number(yesterday.stage2_count)
          : null
        const stage3Delta = (today.stage3_count != null && yesterday?.stage3_count != null)
          ? Number(today.stage3_count) - Number(yesterday.stage3_count)
          : null
        const breadthChange = (today.above_ma30w_pct != null && yesterday?.above_ma30w_pct != null)
          ? Number(today.above_ma30w_pct) - Number(yesterday.above_ma30w_pct)
          : null
        const leadingSector = pickSectorName((leadRes?.data ?? [])[0])
        const phaseKey = String(today.market_phase || '').toLowerCase()
        // PostgREST count probes return `{ data: null, count: N }`.
        // Coerce a missing count to null so the renderer hides the
        // chip rather than showing "0 active" when the probe failed.
        const swingxActive = Number.isFinite(Number(swingxRes?.count))
          ? Number(swingxRes.count)
          : null

        setState({
          status: 'ready',
          stage2Delta,
          stage3Delta,
          breadthChange,
          leadingSector,
          phaseKey,
          swingxActive,
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

  const headerLabel = wasAwayFromSnapshot() ? 'YOU MISSED THIS' : "TODAY'S MOVEMENT"

  // ── Build the 3 insight rows in priority order ─────────────
  // Each row is { primary, secondary, warn } — primary is the
  // headline line, secondary is the '→ what it means' tail, warn
  // adds the ⚠ prefix in amber.
  const rows = []

  if (state.leadingSector) {
    rows.push({
      primary: `${state.leadingSector} woke up.`,
      secondary: '→ Money is rotating in',
      warn: false,
    })
  }

  if (state.stage2Delta != null && state.stage2Delta > 0) {
    rows.push({
      primary: `${state.stage2Delta} stocks crossed into early uptrend.`,
      secondary: '→ New trend formation starting',
      warn: false,
    })
  }

  // Slot 3 — breadth warning OR stage-3 progression. The breadth
  // warning wins when the day-over-day drop exceeds the threshold;
  // a tightening market is the more important signal than a few
  // stocks rolling into stage 3 on the same day.
  const breadthWarn = state.breadthChange != null && state.breadthChange < -BREADTH_WARN_DROP
  if (breadthWarn) {
    rows.push({
      primary: 'Fewer stocks joining the move.',
      secondary: '→ Conditions tightening',
      warn: true,
    })
  } else if (state.stage3Delta != null && state.stage3Delta > 0) {
    rows.push({
      primary: `${state.stage3Delta} more are picking up speed quietly.`,
      secondary: '→ Building momentum',
      warn: false,
    })
  }

  // If nothing fired (rare — fully flat day, no sector lead,
  // no breadth drop), hide the whole component rather than
  // render an empty card.
  if (rows.length === 0) return null

  const meaning = MEANING[state.phaseKey] || MEANING.mixed
  const shown = rows.slice(0, 3)

  return (
    <section
      style={{
        // Theme-aware colours. Earlier revision hardcoded dark
        // hexes (#0F1217 bg, #1E2530 border) which bled into the
        // sepia surface as a black panel on light-theme users.
        // CSS vars carry whichever palette is active.
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 20,
        marginTop: 24,
      }}
    >
      {/* Header */}
      <div
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 14,
        }}
      >
        {headerLabel}
      </div>

      {/* Insight rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {shown.map((r, i) => (
          <div key={i}>
            <div
              style={{
                fontSize: 14,
                color: 'var(--text-primary)',
                lineHeight: 1.5,
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
              }}
            >
              {r.warn && (
                <span style={{ color: 'var(--accent, #FBBF24)', flexShrink: 0 }}>⚠</span>
              )}
              <span>{r.primary}</span>
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-muted)',
                marginLeft: 16,
                marginTop: 2,
                lineHeight: 1.5,
              }}
            >
              {r.secondary}
            </div>
          </div>
        ))}
      </div>

      {/* SwingX active-positions stat chip — research tool, count only.
         Self-hides when the count probe failed (state.swingxActive is
         null) so we never read "0 active" on a probe error. Link goes
         to /lab where the user can see the actual list — names live
         there, not here. Same 13px chip font as the insight tails. */}
      {state.swingxActive != null && (
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: 'var(--text-primary, #E2E8F0)' }}>
            ⚡ SwingX —{' '}
            <span style={{ color: '#FBBF24', fontWeight: 600 }}>
              {state.swingxActive.toLocaleString('en-IN')}
            </span>{' '}
            active condition{state.swingxActive === 1 ? '' : 's'}
          </div>
          <Link
            to="/lab"
            style={{
              color: 'var(--text-muted)',
              marginLeft: 16,
              textDecoration: 'none',
            }}
          >
            View stocks →
          </Link>
        </div>
      )}

      {/* Separator */}
      <div style={{ height: 1, background: 'var(--border)', margin: '18px 0 14px' }} />

      {/* WHAT THIS MEANS */}
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 8,
          fontWeight: 600,
        }}
      >
        What this means
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55, opacity: 0.92 }}>
        {meaning}
      </div>

      {/* Come back tomorrow */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-hint, var(--text-muted))',
          fontStyle: 'italic',
          marginTop: 14,
          lineHeight: 1.5,
        }}
      >
        Tomorrow: See if Stage 2 expands or fails.
      </div>
    </section>
  )
}
