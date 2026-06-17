/**
 * /explore — Auto-running default condition.
 *
 * Per the PineX rework spec, /explore is a results page, not a
 * picker. On page load the default condition runs immediately:
 *
 *   Stage 2  AND  rs_vs_nifty > 0  AND  vol_ratio > 1.2
 *
 * Matching stocks render in a single scrollable list, sorted by
 * relative strength descending. There is NO primary "Run Scan"
 * CTA — the screen is the page. A small "Modify condition →"
 * link sends curious users to Lab where they can pick a
 * different template or further narrow the criteria.
 *
 * Copy is neutral throughout: "Stocks in this condition",
 * "Stocks matching this condition" — no outcome language.
 *
 * No new data layer. The query reads mv_home_stocks (the same
 * materialised view Home and Lab already use) and renders a
 * derivative list — UI / UX change only, no pipeline impact.
 */
import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { C } from '../styles/tokens'
import { supabase } from '../lib/supabase'

// Default condition. Tracked as a single object so a future
// "select a saved condition" feature can swap it without
// restructuring the page.
const DEFAULT_CONDITION = {
  label: 'Stage 2 · RS positive · Volume above 1.2× average',
  stage: 'Stage 2',
  minRs: 0,
  minVolRatio: 1.2,
  description:
    'Stocks currently in the Stage 2 advancing phase with relative ' +
    'strength versus Nifty above zero and recent volume at least 1.2× ' +
    'their 30-day average.',
}

const PAGE_LIMIT = 60   // upper bound on the rendered list

function fmtPct(n, { plus = false, places = 1 } = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  const abs = Math.abs(v)
  const txt = abs >= 10
    ? Math.round(v).toString()
    : v.toFixed(places).replace(/\.0$/, '')
  return `${plus ? sign : ''}${txt}%`
}

function fmtNum(n, places = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(places).replace(/\.00$/, '')
}

export default function Explore() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('mv_home_stocks')
          .select('symbol, name, sector, stage, rs_vs_nifty, vol_ratio, ma30w, close')
          .eq('stage', DEFAULT_CONDITION.stage)
          .gt('rs_vs_nifty', DEFAULT_CONDITION.minRs)
          .gt('vol_ratio',   DEFAULT_CONDITION.minVolRatio)
          .order('rs_vs_nifty', { ascending: false })
          .limit(PAGE_LIMIT)
        if (error) throw error
        if (cancelled) return
        setState({ status: 'ready', rows: data ?? [] })
      } catch (err) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('Explore fetch failed:', err)
        setState({ status: 'error', message: err?.message || 'fetch failed' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const rowCount = state.status === 'ready' ? (state.rows?.length ?? 0) : null

  return (
    <>
      <Helmet>
        <title>Explore · PineX</title>
      </Helmet>

      <div style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: '24px 16px 64px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* ── Page header — neutral framing, no scan button.
             Per the spec the page IS the screen; the header just
             describes which condition is currently active. */}
        <header style={{ marginBottom: 20 }}>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: C.text,
            letterSpacing: '-0.02em', margin: '0 0 6px',
          }}>
            Stocks in this condition
          </h1>
          <p style={{
            margin: 0,
            fontSize: 13, color: C.textMuted, lineHeight: 1.55,
          }}>
            {DEFAULT_CONDITION.description}
          </p>

          {/* Condition chip + Modify link — chip is the active filter,
              the link is the secondary surface. */}
          <div style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '5px 10px',
              fontSize: 11, fontWeight: 700,
              letterSpacing: '0.04em',
              color: C.amber || '#F59E0B',
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.30)',
              borderRadius: 99,
            }}>
              Condition active
            </span>
            <span style={{
              fontSize: 12, color: C.textMuted,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              {DEFAULT_CONDITION.label}
            </span>
            <Link
              to="/lab?template=swingx"
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: C.textMuted,
                textDecoration: 'underline',
                textDecorationStyle: 'dotted',
              }}
            >
              Modify condition →
            </Link>
          </div>

          {state.status === 'ready' && (
            <p style={{
              margin: '14px 0 0',
              fontSize: 12, color: C.textHint || C.textMuted,
              letterSpacing: '0.02em',
            }}>
              {rowCount} stocks matching this condition
              {rowCount === PAGE_LIMIT ? ' (capped at top ' + PAGE_LIMIT + ')' : ''}
            </p>
          )}
        </header>

        {/* ── Body — loading / error / list ───────────────────── */}
        {state.status === 'loading' && <LoadingSkeleton />}

        {state.status === 'error' && (
          <ErrorPanel message={state.message} />
        )}

        {state.status === 'ready' && rowCount === 0 && (
          <EmptyPanel />
        )}

        {state.status === 'ready' && rowCount > 0 && (
          <ResultsTable rows={state.rows} />
        )}
      </div>
    </>
  )
}

// ── Subcomponents ───────────────────────────────────────────

function ResultsTable({ rows }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr 70px 70px',
        gap: 8,
        padding: '10px 14px',
        background: C.surface2 || 'rgba(255,255,255,0.03)',
        borderBottom: `1px solid ${C.border}`,
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: C.textMuted,
        fontWeight: 700,
      }}>
        <div>Symbol / Name</div>
        <div>Sector</div>
        <div style={{ textAlign: 'right' }}>RS</div>
        <div style={{ textAlign: 'right' }}>Vol×</div>
      </div>

      <div>
        {rows.map((row) => (
          <ResultRow key={row.symbol} row={row} />
        ))}
      </div>
    </div>
  )
}

function ResultRow({ row }) {
  return (
    <Link
      to={`/stock/${encodeURIComponent(row.symbol)}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr 70px 70px',
        gap: 8,
        padding: '12px 14px',
        textDecoration: 'none',
        color: 'inherit',
        borderTop: `1px solid ${C.border}`,
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.025)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: C.text,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
          {row.symbol}
        </div>
        <div style={{
          fontSize: 11, color: C.textMuted, marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {row.name || '—'}
        </div>
      </div>
      <div style={{
        fontSize: 12, color: C.textMuted, alignSelf: 'center',
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {row.sector || '—'}
      </div>
      <div style={{
        fontSize: 12, color: C.text, fontWeight: 600,
        textAlign: 'right', alignSelf: 'center',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        {fmtPct(row.rs_vs_nifty, { plus: true })}
      </div>
      <div style={{
        fontSize: 12, color: C.text, fontWeight: 600,
        textAlign: 'right', alignSelf: 'center',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        {fmtNum(row.vol_ratio)}×
      </div>
    </Link>
  )
}

function LoadingSkeleton() {
  // Six placeholder rows so the layout doesn't pop after the fetch.
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          padding: '14px 14px',
          borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
        }}>
          <div style={{
            height: 12, width: '24%',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 4, marginBottom: 6,
          }} />
          <div style={{
            height: 9, width: '52%',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 4,
          }} />
        </div>
      ))}
    </div>
  )
}

function EmptyPanel() {
  return (
    <div style={{
      padding: '24px 18px',
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      textAlign: 'center',
      color: C.textMuted,
      fontSize: 13,
      lineHeight: 1.55,
    }}>
      No stocks currently match this condition. Try modifying it
      via the link above.
    </div>
  )
}

function ErrorPanel({ message }) {
  return (
    <div style={{
      padding: '20px 18px',
      background: 'rgba(255,59,48,0.06)',
      border: '1px solid rgba(255,59,48,0.28)',
      borderRadius: 12,
      color: C.textMuted,
      fontSize: 13,
      lineHeight: 1.55,
    }}>
      <div style={{ color: C.text, fontWeight: 600, marginBottom: 4 }}>
        Failed to load
      </div>
      <div>{message || 'Try refreshing the page.'}</div>
    </div>
  )
}
