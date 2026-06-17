/**
 * /explore — Discover page with four auto-running condition tabs.
 *
 *   [ Stage 2 ] [ High Volume ] [ New Entries ] [ Stage 3 Watch ]
 *
 * Each tab is its own price_data SELECT (latest snapshot per
 * company via is_latest = true) joined to companies for name +
 * sector. Switching tabs refires the fetch — no Run button, no
 * apply step. The result row design is preserved from the
 * earlier single-condition version of this page.
 *
 *   Tab 1 — Stage 2:
 *     stage = 'Stage 2' AND rs_vs_nifty > 0 AND vol_ratio > 1.2
 *     ORDER BY rs_vs_nifty DESC                   (existing default)
 *
 *   Tab 2 — High Volume:
 *     stage = 'Stage 2' AND vol_ratio > 2.0
 *     ORDER BY vol_ratio DESC
 *
 *   Tab 3 — New Entries:
 *     stage = 'Stage 2' AND stage2_new_this_week = true
 *     ORDER BY rs_vs_nifty DESC
 *
 *   Tab 4 — Stage 3 Watch:
 *     stage = 'Stage 3'
 *     ORDER BY rs_vs_nifty ASC
 *
 * All tabs cap at 60 rows. Counts shown as 'X stocks in this
 * condition' per the spec. No 'X results' / 'X matches' wording.
 */
import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { C } from '../styles/tokens'
import { supabase } from '../lib/supabase'

const PAGE_LIMIT = 60

// One config object per tab. queryFn receives the base price_data
// SelectBuilder (is_latest already applied) and returns the final
// builder with its filters / sort / limit attached. Keeping the
// rule next to the description and label makes adding a tab a
// single-line edit later.
const TABS = [
  {
    key: 'stage2',
    label: 'Stage 2',
    description: 'Stocks currently in the Stage 2 advancing phase with positive relative strength and above-average volume',
    queryFn: (base) => base
      .eq('stage', 'Stage 2')
      .gt('rs_vs_nifty', 0)
      .gt('vol_ratio', 1.2)
      .order('rs_vs_nifty', { ascending: false })
      .limit(PAGE_LIMIT),
  },
  {
    key: 'high_volume',
    label: 'High Volume',
    description: 'Stocks with volume more than 2x their 30-day average',
    queryFn: (base) => base
      .eq('stage', 'Stage 2')
      .gt('vol_ratio', 2.0)
      .order('vol_ratio', { ascending: false })
      .limit(PAGE_LIMIT),
  },
  {
    key: 'new_entries',
    label: 'New Entries',
    description: 'Stocks that entered Stage 2 in the last 5 trading days',
    queryFn: (base) => base
      .eq('stage', 'Stage 2')
      .eq('stage2_new_this_week', true)
      .order('rs_vs_nifty', { ascending: false })
      .limit(PAGE_LIMIT),
  },
  {
    key: 'stage3_watch',
    label: 'Stage 3 Watch',
    description: 'Stocks showing topping conditions',
    queryFn: (base) => base
      .eq('stage', 'Stage 3')
      .order('rs_vs_nifty', { ascending: true })
      .limit(PAGE_LIMIT),
  },
]

function fmtPct(n, { plus = false, places = 1 } = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  const abs = Math.abs(v)
  const txt = abs >= 10 ? Math.round(v).toString()
    : v.toFixed(places).replace(/\.0$/, '')
  return `${plus ? sign : ''}${txt}%`
}

function fmtNum(n, places = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(places).replace(/\.00$/, '')
}

export default function Explore() {
  const [activeKey, setActiveKey] = useState(TABS[0].key)
  const [state, setState] = useState({ status: 'loading' })

  const activeTab = useMemo(
    () => TABS.find((t) => t.key === activeKey) ?? TABS[0],
    [activeKey],
  )

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      try {
        // is_latest is the per-company 'latest snapshot' flag the
        // pipeline maintains. Joining companies!inner pulls the
        // display name + sector denormalised onto each row so
        // we don't need a second round-trip.
        // price_data has no `symbol` column — it lives on
        // companies. Pull it via the !inner embed alongside
        // name + sector so each row carries its full display
        // identity without a second round-trip.
        const base = supabase
          .from('price_data')
          .select(`
            stage,
            weinstein_substage,
            rs_vs_nifty,
            vol_ratio,
            close,
            ma30w,
            stage2_new_this_week,
            company_id,
            companies!inner ( symbol, name, sector )
          `)
          .eq('is_latest', true)
        const { data, error } = await activeTab.queryFn(base)
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
  }, [activeTab])

  const rowCount = state.status === 'ready' ? (state.rows?.length ?? 0) : null

  return (
    <>
      <Helmet>
        <title>Discover · PineX</title>
      </Helmet>

      <div style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: '24px 16px 64px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* ── Page header ───────────────────────────────────── */}
        <header style={{ marginBottom: 16 }}>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: C.text,
            letterSpacing: '-0.02em', margin: '0 0 6px',
          }}>
            Stocks in this condition
          </h1>
        </header>

        {/* ── Tab strip ─────────────────────────────────────── */}
        <TabStrip
          tabs={TABS}
          activeKey={activeKey}
          onChange={setActiveKey}
        />

        {/* ── Description chip + count ──────────────────────── */}
        <div style={{
          marginTop: 12,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={chip}>
            {activeTab.description}
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
            {rowCount} stocks in this condition
            {rowCount === PAGE_LIMIT ? ` (capped at top ${PAGE_LIMIT})` : ''}
          </p>
        )}

        {/* ── Body — loading / error / list ────────────────── */}
        <div style={{ marginTop: 14 }}>
          {state.status === 'loading' && <LoadingSkeleton />}
          {state.status === 'error'   && <ErrorPanel message={state.message} />}
          {state.status === 'ready' && rowCount === 0 && <EmptyPanel />}
          {state.status === 'ready' && rowCount > 0 && (
            <ResultsTable rows={state.rows} />
          )}
        </div>
      </div>
    </>
  )
}

// ── TabStrip ──────────────────────────────────────────────
// Spec-locked styling: active text #E2E8F0 with a 2 px #FBBF24
// underline; inactive text #64748B. 13 px, no uppercase, no font
// weight inflation on the active state — the underline carries
// the affordance.
function TabStrip({ tabs, activeKey, onChange }) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: `1px solid ${C.border}`,
        overflowX: 'auto',
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            style={{
              padding: '10px 14px',
              fontSize: 13,
              color: active ? '#E2E8F0' : '#64748B',
              background: 'transparent',
              border: 'none',
              borderBottom: active
                ? '2px solid #FBBF24'
                : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              marginBottom: -1,  // align the active underline with the strip baseline
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────

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
        {rows.map((row, i) => {
          const company = Array.isArray(row.companies) ? row.companies[0] : row.companies
          return <ResultRow key={company?.symbol || row.company_id || i} row={row} />
        })}
      </div>
    </div>
  )
}

function ResultRow({ row }) {
  // The companies join lands as either an object or an array of
  // one depending on PostgREST's interpretation of the relation.
  // Coerce both shapes here once. Symbol now lives on the joined
  // companies row, not on price_data — both name/sector and
  // symbol come from the same coerced object.
  const company = Array.isArray(row.companies) ? row.companies[0] : row.companies
  const symbol = company?.symbol || '—'
  const name   = company?.name || '—'
  const sector = company?.sector || '—'
  return (
    <Link
      to={`/stock/${encodeURIComponent(symbol)}`}
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
          {symbol}
        </div>
        <div style={{
          fontSize: 11, color: C.textMuted, marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {name}
        </div>
      </div>
      <div style={{
        fontSize: 12, color: C.textMuted, alignSelf: 'center',
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {sector}
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
      No stocks currently match this condition.
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

// ── Styles ────────────────────────────────────────────────

const chip = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 12px',
  fontSize: 12,
  color: C.textMuted,
  background: C.surface2 || 'rgba(255,255,255,0.03)',
  border: `1px solid ${C.border}`,
  borderRadius: 99,
  lineHeight: 1.4,
}
