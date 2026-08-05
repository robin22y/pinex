/**
 * Home — the "Today" tab.
 *
 * Rebuilt to five blocks and nothing else:
 *   1. header        "PineX · <data date>"
 *   2. stage counts  2x2 grid, largest text on the page, each tile links
 *                    to the screener pre-filtered to that stage
 *   3. sector table  top 8 by % advancing, plain rows
 *   4. search        one full-width input
 *   5. research + links  two plain ResearchTools lines, then a link row
 *
 * WHAT CAME OFF, AND WHERE IT WENT
 *   points/rewards, "Private Research Engine", "Today's Movement",
 *   "What This Means", the market-health card, the "Research Tools" card
 *   chrome and the chip row are no longer mounted here. Nothing was
 *   deleted — every component still exists and every route still
 *   resolves. Market health lives on /pulse and Company Studies on
 *   /learn/companies, both linked from block 5.
 *
 * DATA — reuses the queries /pulse already runs, per spec. No new maths.
 *   market_internals   stage1_count..stage4_count + date   (Pulse.jsx:204)
 *   sectors            name, stage2_pct, total_companies   (SectorPulse.jsx:52)
 *
 * ?tab=sectors
 *   The DesktopSidebar "Sectors" entry points at /home?tab=sectors, and
 *   block 3 needs an "All sectors" destination. One switch serves both:
 *   with the param the sector table renders in full instead of the top
 *   8. No new route, and the existing sidebar link keeps working.
 *
 * SwingX
 *   Retired as a brand. This page carried the ONLY `level="swingx"`
 *   AcademyGate in the codebase; with it gone the academy tier had no
 *   consumer, so the tier itself was retired too. The academy is two
 *   tiers now — screener and advanced. Modules 4 and 7 are progression,
 *   not gates.
 */
import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { C } from '../styles/tokens'
import ResearchTools from '../components/home/ResearchTools'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * '2026-07-31' -> '31 Jul 2026'.
 *
 * Parsed by hand rather than via `new Date(iso)`: that constructor reads
 * a bare date string as UTC midnight, so any viewer west of Greenwich
 * sees the previous day. The session date is a calendar fact from NSE,
 * not an instant.
 */
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10))
  if (!m) return ''
  const [, y, mo, d] = m
  const name = MONTHS[Number(mo) - 1]
  return name ? `${Number(d)} ${name} ${y}` : ''
}

/** Stage tiles in the order the brief specifies. `stage` is the value
 *  the screener's filter reads. */
const STAGES = [
  { key: 'stage1_count', label: 'Basing',    stage: 'Stage 1' },
  { key: 'stage2_count', label: 'Advancing', stage: 'Stage 2' },
  { key: 'stage3_count', label: 'Topping',   stage: 'Stage 3' },
  { key: 'stage4_count', label: 'Declining', stage: 'Stage 4' },
]

const TOP_SECTORS = 8

export default function Home() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const allSectors = params.get('tab') === 'sectors'

  const [internals, setInternals] = useState(null)
  const [sectors, setSectors] = useState([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Both reads in parallel — neither depends on the other, and a
        // waterfall here would be two round trips for one paint.
        const [mi, sec] = await Promise.all([
          supabase
            .from('market_internals')
            .select('date, stage1_count, stage2_count, stage3_count, stage4_count, total_stocks')
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('sectors')
            .select('name, stage2_pct, total_companies, date')
            .order('date', { ascending: false })
            .limit(400),
        ])
        if (cancelled) return
        setInternals(mi?.data ?? null)

        // `sectors` holds one row per sector per date. Keep only the
        // newest date present, so a half-written day cannot mix two
        // dates into one table.
        const rows = Array.isArray(sec?.data) ? sec.data : []
        const newest = rows.reduce((a, r) => (r.date > a ? r.date : a), '')
        setSectors(rows.filter((r) => r.date === newest && r.name))
      } catch {
        if (!cancelled) { setInternals(null); setSectors([]) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const ranked = useMemo(() => {
    const withPct = sectors
      .map((s) => ({ name: s.name, pct: Number(s.stage2_pct) }))
      .filter((s) => Number.isFinite(s.pct))
      .sort((a, b) => b.pct - a.pct)
    return allSectors ? withPct : withPct.slice(0, TOP_SECTORS)
  }, [sectors, allSectors])

  function onSearch(e) {
    e.preventDefault()
    const q = query.trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  const dataDate = formatDate(internals?.date)

  return (
    <>
      <Helmet>
        <title>PineX — NSE stage counts and sector participation</title>
      </Helmet>

      <div className="home-page" style={S.page}>
        {/* ── 1. HEADER ────────────────────────────────────────────── */}
        <h1 style={S.header}>
          PineX
          {dataDate && <span style={S.headerDate}> · {dataDate}</span>}
        </h1>

        {/* ── 2. STAGE COUNTS ──────────────────────────────────────── */}
        <div className="home-stages" style={S.grid}>
          {STAGES.map((s) => (
            <Link
              key={s.key}
              to={`/screener?stage=${encodeURIComponent(s.stage)}`}
              style={S.tile}
            >
              <span style={S.tileLabel}>{s.label}</span>
              <span style={S.tileCount}>{internals?.[s.key] ?? '—'}</span>
            </Link>
          ))}
        </div>

        {/* Two columns at ≥1024px: sectors left, the input surfaces
            right. Below that it is one stacked column and the class is
            inert. Blocks 3-5 keep their source order either way. */}
        <div className="home-cols">
        <div>
        {/* ── 3. SECTOR TABLE ────────────────────────────────────────
            Each row opens /sector/:name, which lists that sector's
            stocks (SectorDetail.jsx:466 filters companies on
            `sector`). encodeURIComponent because sector names carry
            spaces and '&' — "Oil Gas & Consumable Fuels" would
            otherwise split the path. Same link shape SectorBreadth
            and SectorGroupedView already use. */}
        <div style={S.tableHead}>
          <span>Sector</span>
          <span style={S.pctCol}>% Advancing</span>
        </div>
        {ranked.map((s) => (
          <Link
            key={s.name}
            to={`/sector/${encodeURIComponent(s.name)}`}
            style={S.row}
          >
            <span style={S.sectorName}>{s.name}</span>
            <span style={S.pctCol}>{Math.round(s.pct)}%</span>
          </Link>
        ))}
        {!allSectors && sectors.length > TOP_SECTORS && (
          <Link to="/home?tab=sectors" style={S.moreLink}>All sectors →</Link>
        )}

        </div>

        <div>
        {/* ── 4. SEARCH ────────────────────────────────────────────── */}
        <form onSubmit={onSearch} style={S.searchWrap}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stock"
            aria-label="Search stock"
            style={S.search}
          />
        </form>

        {/* ── 5. RESEARCH LINES + LINK ROW ─────────────────────────── */}
        {/* ResearchTools stays mounted with its behaviour intact; the
            card chrome and heading are stripped inside the component. */}
        <ResearchTools />

        <nav style={S.links} aria-label="Other sections">
          <Link to="/learn/companies" style={S.link}>Company Studies</Link>
          <span style={S.dot} aria-hidden="true">·</span>
          <Link to="/pulse" style={S.link}>Market Health</Link>
          <span style={S.dot} aria-hidden="true">·</span>
          <Link to="/learn" style={S.link}>Academy</Link>
        </nav>
        </div>
        </div>
      </div>
    </>
  )
}

// ── styles ──────────────────────────────────────────────────────────
// Inline objects, matching the rest of the codebase — this project does
// not use CSS modules. Grouped here so the JSX above reads as structure.
// The app body font is DM Sans (index.css). The homepage opts out:
// system stack for words, ui-monospace for every number on the page.
// Scoped to S.page so no other route inherits the override.
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace'

const S = {
  // No maxWidth / width here — .home-page owns both. <main> is
  // display:flex, so a block child with only `margin: 0 auto` shrinks to
  // its content instead of filling: at 1280px this page rendered as a
  // 332px column, narrower than it is on a phone. width:100% in the
  // class is the fix; the media query then widens the cap for desktop.
  page: { margin: '0 auto', padding: '14px 16px 8px', fontFamily: SANS },

  header: {
    fontSize: 15, fontWeight: 600, color: C.text, textAlign: 'left',
    margin: '0 0 14px', letterSpacing: '-0.01em',
  },
  // The date is a number, so it takes the mono face.
  headerDate: { fontFamily: MONO, fontWeight: 400, color: C.textMuted },

  // Column count lives in .home-stages: 2 up on mobile, 4 across on
  // desktop. auto-fit was wrong here — at a 1040px container a 140px
  // floor yields seven columns, not four.
  grid: {
    display: 'grid',
    // 1px gap over a border-coloured backdrop draws the grid rules —
    // separation by hairline, not by shadow or radius.
    gap: 1, background: C.border, border: `1px solid ${C.border}`,
    marginBottom: 20,
  },
  tile: {
    display: 'flex', flexDirection: 'column', gap: 3,
    padding: '12px 12px', background: C.surface,
    textDecoration: 'none', color: C.text,
  },
  tileLabel: {
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: C.textMuted,
  },
  // The largest text on the page, per spec.
  tileCount: {
    fontFamily: MONO, fontSize: 34, lineHeight: 1.05, fontWeight: 700,
    letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
  },

  tableHead: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: C.textMuted, paddingBottom: 8,
    borderBottom: `1px solid ${C.border}`,
  },
  // A row is a link now, so it needs the anchor resets — without
  // textDecoration the whole table renders underlined.
  row: {
    display: 'flex', justifyContent: 'space-between', gap: 12,
    padding: '7px 0', borderBottom: `1px solid ${C.border}`,
    fontSize: 14, color: C.text, textDecoration: 'none',
  },
  // Long sector names truncate rather than push the percentage past the
  // right edge — the 390px failure mode the audit was chasing.
  sectorName: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pctCol: {
    fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
    flexShrink: 0, color: C.text,
  },
  moreLink: {
    display: 'inline-block', marginTop: 10, fontSize: 13,
    color: C.accent, textDecoration: 'none',
  },

  searchWrap: { margin: '20px 0 16px' },
  search: {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    fontSize: 15, fontFamily: SANS,
    color: C.text, background: C.surface,
    border: `1px solid ${C.border}`, borderRadius: 2,
  },

  links: {
    display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline',
    padding: '4px 0 8px', fontSize: 13,
  },
  link: { color: C.accent, textDecoration: 'none' },
  dot: { color: C.textFaint },
}
