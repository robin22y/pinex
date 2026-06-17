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

// ── Sepia-safe palette ────────────────────────────────────
// Spec-locked literal hex values per the contrast brief. The
// 'on-sepia' tokens read clearly against the ~#F5F0E8 sepia
// background; they're literal hex rather than C tokens because
// the spec is explicit — never #64748B (slate) on sepia.
const SEPIA = {
  ink:        '#2D1B00', // dark brown — primary contrast
  midBrown:   '#6B5744', // medium brown — secondary text
  darkAmber:  '#92400E', // CTA + active mobile nav
  hairline:   '#D4C5A9', // border / divider
  cream:      '#F5F0E8', // background tone (active button fill text)
}

export default function Explore() {
  const [activeKey, setActiveKey] = useState(TABS[0].key)
  const [state, setState] = useState({ status: 'loading' })
  // Sort column + direction — default RS DESC (highest first) per
  // the spec. The whole filteredRows array gets a final client-side
  // sort so toggling direction doesn't re-fire the Supabase query.
  const [sortKey, setSortKey] = useState('rs')
  const [sortDir, setSortDir] = useState('desc')

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

        {/* ── Description text + modify link ─────────────────
             Description was overflowing the right edge on mobile
             (long single-line span with margin-left:auto on the
             link). Now: description gets its own block with
             padding + word-wrap; the 'Modify condition' link
             drops below on narrow viewports rather than getting
             pushed off-screen. */}
        <div style={{
          marginTop: 12,
          padding: '0 16px',
          maxWidth: '100%',
        }}>
          <p style={{
            margin: 0,
            fontSize: 13,
            color: SEPIA.midBrown,
            lineHeight: 1.55,
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            maxWidth: '100%',
          }}>
            {activeTab.description}
          </p>
          <Link
            to="/lab?template=swingx"
            style={{
              display: 'inline-block',
              marginTop: 8,
              fontSize: 12,
              color: SEPIA.darkAmber,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
              fontWeight: 600,
            }}
          >
            Modify condition →
          </Link>
        </div>

        {state.status === 'ready' && (
          <p style={{
            margin: '14px 0 0',
            padding: '0 16px',
            fontSize: 12, color: SEPIA.midBrown,
            letterSpacing: '0.02em',
          }}>
            {rowCount} stocks in this condition
            {rowCount === PAGE_LIMIT ? ` (capped at top ${PAGE_LIMIT})` : ''}
          </p>
        )}

        {/* ── Sort toggles — RS up / RS down · Vol up / Vol down
             Spec: inline buttons, no dropdown. Each pair lives
             behind a single column key; clicking ↑ sets asc,
             ↓ sets desc, and the row re-sorts in place. */}
        <div style={{
          marginTop: 10,
          padding: '0 16px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}>
          <SortGroup label="RS"  col="rs"  sortKey={sortKey} sortDir={sortDir}
            onPick={(d) => { setSortKey('rs');  setSortDir(d) }} />
          <span style={{ color: SEPIA.hairline, padding: '0 4px' }}>|</span>
          <SortGroup label="Vol" col="vol" sortKey={sortKey} sortDir={sortDir}
            onPick={(d) => { setSortKey('vol'); setSortDir(d) }} />
        </div>

        {/* ── Body — loading / error / list ────────────────── */}
        <div style={{ marginTop: 14 }}>
          {state.status === 'loading' && <LoadingSkeleton />}
          {state.status === 'error'   && <ErrorPanel message={state.message} />}
          {state.status === 'ready' && rowCount === 0 && <EmptyPanel />}
          {state.status === 'ready' && rowCount > 0 && (
            <ResultsTable rows={sortRows(state.rows, sortKey, sortDir)} />
          )}
        </div>
      </div>
    </>
  )
}

// ── TabStrip ──────────────────────────────────────────────
// Spec-locked sepia palette. Tab text reads clearly on the
// #F5F0E8 page tone:
//   active   #2D1B00 (dark brown)  with 2 px #92400E underline
//   inactive #6B5744 (medium brown)
// 13 px, no uppercase, weight 600 on the active label so the
// dark-brown ink doesn't blur with the inactive tone at small
// sizes.
function TabStrip({ tabs, activeKey, onChange }) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: `1px solid ${SEPIA.hairline}`,
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
              fontWeight: active ? 700 : 600,
              color: active ? SEPIA.ink : SEPIA.midBrown,
              background: 'transparent',
              border: 'none',
              borderBottom: active
                ? `2px solid ${SEPIA.darkAmber}`
                : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// ── SortGroup ─────────────────────────────────────────────
// Two-button toggle per column — '↑' = asc, '↓' = desc. The
// currently-selected (column, direction) gets the dark-brown
// fill; the other three buttons sit in transparent outlines.
function SortGroup({ label, col, sortKey, sortDir, onPick }) {
  const isAsc  = sortKey === col && sortDir === 'asc'
  const isDesc = sortKey === col && sortDir === 'desc'
  return (
    <>
      <SortBtn active={isAsc}  onClick={() => onPick('asc')}>
        {label} ↑
      </SortBtn>
      <SortBtn active={isDesc} onClick={() => onPick('desc')}>
        {label} ↓
      </SortBtn>
    </>
  )
}

function SortBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 10px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        background: active ? SEPIA.ink : 'transparent',
        color: active ? SEPIA.cream : SEPIA.midBrown,
        border: active ? `1px solid ${SEPIA.ink}` : `1px solid ${SEPIA.hairline}`,
        borderRadius: 4,
        lineHeight: 1.2,
      }}
    >
      {children}
    </button>
  )
}

// ── sortRows — applied to the fetched rows on the client so
// toggling direction doesn't re-fire the Supabase query.
function sortRows(rows, key, dir) {
  if (!Array.isArray(rows) || rows.length === 0) return rows
  const getter = key === 'vol'
    ? (r) => Number(r.vol_ratio)
    : (r) => Number(r.rs_vs_nifty)
  const sorted = [...rows].sort((a, b) => {
    const av = getter(a), bv = getter(b)
    const an = av == null || Number.isNaN(av)
    const bn = bv == null || Number.isNaN(bv)
    if (an && bn) return 0
    if (an) return 1
    if (bn) return -1
    return dir === 'asc' ? av - bv : bv - av
  })
  return sorted
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
        // Sepia-safe contrast — dark brown reads against the
        // page-tone backdrop, where the old C.textMuted was
        // resolving to a slate grey that disappeared.
        color: SEPIA.ink,
        fontWeight: 600,
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
