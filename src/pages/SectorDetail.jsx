import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import SectionLabel from '../components/ui/SectionLabel'
import Skeleton from '../components/ui/Skeleton'
import ProBadge from '../components/ProBadge'
import { C } from '../styles/tokens'
import { getHealthDisplayLabel, normalizeSectorHealthKey, sectorHealthBadgeStatus } from '../lib/sectorHealth'
import { canonicalStageForBadge, stageBadge } from '../lib/stageUi'
import { MEANINGFUL_SECTOR_MIN, isSmallSector } from '../lib/sectorThresholds'
import { useIsMobile } from '../lib/useIsMobile'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import SectorGroupedView from '../components/SectorGroupedView'
import HeatMap from '../components/HeatMap'

function pretty(text) {
  return String(text || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Stock-row helpers — kept in module scope so they don't re-create
// on every render.
const STAGE_LABEL = {
  'Stage 1': 'Basing',
  'Stage 1+': 'Emerging',
  'Stage 2': 'Advancing',
  'Stage 3': 'Topping',
  'Stage 4': 'Declining',
}

const STAGE_ACCENT = {
  'Stage 1': C.amber,
  'Stage 1+': C.green,
  'Stage 2': C.green,
  'Stage 3': '#F97316',
  'Stage 4': C.red,
}

function scorePillStyle(score) {
  // null === no swing-condition row → "–/5" grey pill. Distinguishes
  // "we don't know" from "we measured 0 conditions met".
  if (score == null) {
    return { bg: C.surface2, border: C.border, color: C.textMuted, text: '–/5' }
  }
  const n = Number(score)
  if (n === 5) return { bg: 'rgba(0,200,5,0.15)', border: 'rgba(0,200,5,0.4)',  color: C.green,    text: '5/5' }
  if (n === 4) return { bg: 'rgba(0,200,5,0.1)',  border: 'rgba(0,200,5,0.25)', color: C.green,    text: '4/5' }
  if (n === 3) return { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.3)', color: C.amber, text: '3/5' }
  if (n === 2) return { bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.2)', color: C.red,    text: '2/5' }
  return { bg: C.surface2, border: C.border, color: C.textMuted, text: `${n}/5` }
}

function truncName(s, n = 22) {
  if (!s) return ''
  const str = String(s)
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

function isMeaningfulHeadline(h) {
  const t = String(h || '').trim().toLowerCase()
  if (!t) return false
  // The pipeline writes "No major recent change" as a placeholder
  // when the company has no quarterly_changes row yet. Showing it
  // on every silent stock is pure noise — silence is better.
  return t !== 'no major recent change'
}

function toPolicyTags(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  return []
}

function StatCard({ icon, label, value, total, color, helper }) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        background: C.surface,
        padding: '14px 16px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: color,
          borderRadius: '3px 0 0 3px',
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <p style={{ color: C.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
          {label}
        </p>
        <span style={{ fontSize: 16, opacity: 0.8 }}>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 13, color: C.textMuted }}>/ {total}</span>
      </div>
      <p style={{ color: C.textFaint, fontSize: 11, marginTop: 6, marginBottom: 0 }}>{helper}</p>
    </div>
  )
}

function StageDistribution({ counts, total }) {
  const t = total || 1
  const segments = [
    { key: 'stage1', label: stageBadge('Stage 1').label, color: stageBadge('Stage 1').color, value: counts.stage1 || 0 },
    { key: 'stage1p', label: stageBadge('Stage 1+').label, color: stageBadge('Stage 1+').color, value: counts.stage1Plus || 0 },
    { key: 'stage2', label: stageBadge('Stage 2').label, color: stageBadge('Stage 2').color, value: counts.stage2 || 0 },
    { key: 'stage3', label: stageBadge('Stage 3').label, color: stageBadge('Stage 3').color, value: counts.stage3 || 0 },
    { key: 'stage4', label: stageBadge('Stage 4').label, color: stageBadge('Stage 4').color, value: counts.stage4 || 0 },
  ]
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full" style={{ background: C.surface2 }}>
        {segments.map((seg) => (
          <div key={seg.key} style={{ width: `${(seg.value / t) * 100}%`, background: seg.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: C.textMuted }}>
        {segments.map((seg) => (
          <span key={seg.key}>
            {seg.label}: {seg.value}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function SectorDetail() {
  const { name } = useParams()
  const navigate = useNavigate()
  const sectorName = decodeURIComponent(String(name || '')).trim()
  const isMobile = useIsMobile()
  const isAllSectors = sectorName.toLowerCase() === 'all'
  const [loading, setLoading] = useState(true)
  const [sector, setSector] = useState(null)
  const [companies, setCompanies] = useState([])
  const [stageFilter, setStageFilter] = useState('all')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!sectorName) return
    // /sector/All renders the multi-sector overview component(s)
    // directly — no per-sector fetch needed.
    if (sectorName.toLowerCase() === 'all') {
      setLoading(false)
      return
    }
    let active = true
    async function load() {
      setLoading(true)
      if (!hasSupabaseEnv) {
        if (active) setLoading(false)
        return
      }

      try {
        // ⚠ Use `date` not `last_updated` — the per-day history
        // migration (sectors_history_per_day.sql) makes `date` the
        // canonical row key. `last_updated` is NULL on the new rows
        // so filtering by it returns nothing and the page silently
        // falls back to its placeholder { name } with no breadth data.
        const latestSectorDateRes = await supabase
          .from('sectors')
          .select('date')
          .eq('name', sectorName)
          .not('date', 'is', null)
          .order('date', { ascending: false })
          .limit(1)
        const latestSectorDate = latestSectorDateRes.data?.[0]?.date

        const sectorRes = latestSectorDate
          ? await supabase
              .from('sectors')
              .select('*')
              .eq('name', sectorName)
              .eq('date', latestSectorDate)
              .maybeSingle()
          : { data: null }

        const companyRes = await supabase
          .from('companies')
          .select('id,name,symbol,sector')
          .eq('sector', sectorName)
          .limit(1200)

        const companyRows = companyRes.data || []
        const ids = companyRows.map((c) => c.id).filter(Boolean)

        // ⚠ Important: pick the most recent date where `stage` is
        // actually populated, NOT just the latest row. The pipeline
        // can write a price_data row before the stage step has run,
        // and using that date silently zeros every per-stock stage —
        // which then shows up as "0% of 14 stocks meet advancing
        // criteria" on a sector the breadth aggregate (sectors row)
        // correctly classifies as 93% strong.
        const latestPriceDateRes = await supabase
          .from('price_data')
          .select('date')
          .not('stage', 'is', null)
          .order('date', { ascending: false })
          .limit(1)
        const latestPriceDate = latestPriceDateRes.data?.[0]?.date

        const latestSwingDateRes = await supabase
          .from('swing_conditions')
          .select('date')
          .not('conditions_met', 'is', null)
          .order('date', { ascending: false })
          .limit(1)
        const latestSwingDate = latestSwingDateRes.data?.[0]?.date

        const [priceRes, swingRes, changesRes] = await Promise.all([
          latestPriceDate && ids.length
            ? supabase
                .from('price_data')
                // ⚠ obv_trend column does NOT exist on price_data.
                // The schema stores raw `obv` + numeric `obv_slope`;
                // an earlier select for `obv_trend` errored, blanking
                // BOTH stage and obv for every stock. We derive the
                // categorical trend from obv_slope on the JS side.
                .select('company_id,stage,obv_slope')
                .eq('date', latestPriceDate)
                .in('company_id', ids)
            : Promise.resolve({ data: [] }),
          latestSwingDate && ids.length
            ? supabase
                .from('swing_conditions')
                .select('company_id,conditions_met,condition_stage2,date')
                .eq('date', latestSwingDate)
                .in('company_id', ids)
            : Promise.resolve({ data: [] }),
          ids.length
            ? supabase
                .from('quarterly_changes')
                .select('company_id,headline_change,ai_summary,created_at')
                .in('company_id', ids)
                .order('created_at', { ascending: false })
                .limit(5000)
            : Promise.resolve({ data: [] }),
        ])

        const priceByCompany = Object.fromEntries((priceRes.data || []).map((p) => [p.company_id, p]))
        const swingByCompany = Object.fromEntries((swingRes.data || []).map((s) => [s.company_id, s]))
        const latestHeadlineByCompany = {}
        for (const row of changesRes.data || []) {
          if (!row?.company_id || latestHeadlineByCompany[row.company_id]) continue
          latestHeadlineByCompany[row.company_id] = row.headline_change || row.ai_summary
        }

        const merged = companyRows.map((c) => {
          const p = priceByCompany[c.id] || {}
          const s = swingByCompany[c.id] || null
          // conditions_met is intentionally `null` when no swing row
          // exists — distinguishes "no data" from "measured 0/5".
          // The row UI renders "–/5" for null, real numbers otherwise.
          const score = s && s.conditions_met != null ? Number(s.conditions_met) : null
          // Derive categorical OBV trend from the raw slope. Matches
          // how the rest of the codebase reads "rising/falling" — the
          // actual `obv_trend` column doesn't exist in price_data.
          const slope = Number(p.obv_slope)
          const obvTrend = !Number.isFinite(slope)
            ? null
            : slope > 0 ? 'rising' : slope < 0 ? 'falling' : 'flat'
          return {
            ...c,
            stage: p.stage || null,
            obv_trend: obvTrend,
            conditions_met: score,
            condition_stage2: Boolean(s?.condition_stage2),
            headline: latestHeadlineByCompany[c.id] || 'No major recent change',
          }
        })

        merged.sort((a, b) => {
          const aStage2 = canonicalStageForBadge(a.stage) === 'Stage 2' ? 1 : 0
          const bStage2 = canonicalStageForBadge(b.stage) === 'Stage 2' ? 1 : 0
          if (aStage2 !== bStage2) return bStage2 - aStage2
          return (b.conditions_met ?? -1) - (a.conditions_met ?? -1)
        })

        if (!active) return
        setSector(sectorRes.data || { name: sectorName, display_name: sectorName })
        setCompanies(merged)
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [sectorName])

  const policyTags = toPolicyTags(sector?.policy_tags)
  const stageCounts = useMemo(() => {
    const out = { stage1Plus: 0, stage1: 0, stage2: 0, stage3: 0, stage4: 0 }
    for (const c of companies) {
      const canon = canonicalStageForBadge(c.stage)
      switch (canon) {
        case 'Stage 1':
          out.stage1 += 1
          break
        case 'Stage 1+':
          out.stage1Plus += 1
          break
        case 'Stage 2':
          out.stage2 += 1
          break
        case 'Stage 3':
          out.stage3 += 1
          break
        case 'Stage 4':
          out.stage4 += 1
          break
        default:
          break
      }
    }
    return out
  }, [companies])

  const stats = useMemo(() => {
    // Local row-level stage count — accurate when price_data on the
    // chosen date has stage populated for these companies.
    const localStage2 = companies.filter((c) => canonicalStageForBadge(c.stage) === 'Stage 2').length
    // Pipeline aggregate from the sectors table — canonical, computed
    // against the day stage was actually run. Prefer this when the
    // local count comes back empty (price/stage pipeline lag) and the
    // aggregate has a real number.
    const aggStage2 = Number(sector?.stage2_count)
    const stage2 = localStage2 > 0
      ? localStage2
      : Number.isFinite(aggStage2) && aggStage2 > 0 ? aggStage2 : 0
    const obvRising = companies.filter((c) => String(c.obv_trend || '').toLowerCase() === 'rising').length
    const revenueGrowing = companies.filter((c) => {
      const h = String(c.headline || '').toLowerCase()
      return h.includes('revenue') && (h.includes('growth') || h.includes('record') || h.includes('recovery'))
    }).length
    return { stage2, obvRising, revenueGrowing }
  }, [companies, sector])

  // Filter definitions kept together so the pill list, the counts,
  // and the active filter share a single source of truth.
  const filterDefs = useMemo(() => ([
    { key: 'all',        label: 'All',                 match: () => true },
    { key: 'advancing',  label: 'Advancing',           match: (c) => ['Stage 2', 'Stage 1+'].includes(canonicalStageForBadge(c.stage)) },
    { key: 'basing',     label: 'Basing',              match: (c) => canonicalStageForBadge(c.stage) === 'Stage 1' },
    { key: 'topdec',     label: 'Topping/Declining',   match: (c) => ['Stage 3', 'Stage 4'].includes(canonicalStageForBadge(c.stage)) },
  ]), [])

  const filterCounts = useMemo(() => {
    const counts = {}
    for (const f of filterDefs) counts[f.key] = companies.filter(f.match).length
    return counts
  }, [companies, filterDefs])

  const filteredCompanies = useMemo(() => {
    const f = filterDefs.find((x) => x.key === stageFilter) || filterDefs[0]
    return companies.filter(f.match)
  }, [companies, filterDefs, stageFilter])

  const VISIBLE_LIMIT = 30
  const visibleCompanies = useMemo(() => (
    showAll || filteredCompanies.length <= VISIBLE_LIMIT
      ? filteredCompanies
      : filteredCompanies.slice(0, VISIBLE_LIMIT)
  ), [filteredCompanies, showAll])

  // Switching filter resets the "show all" toggle — feels natural,
  // also avoids the user re-clicking "show all 60" after switching
  // from 90→30 to filtered 12.
  useEffect(() => { setShowAll(false) }, [stageFilter])

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <Skeleton height={38} width="45%" />
        <Skeleton height={72} />
        <Skeleton height={140} />
        {/* Card-shaped row skeletons — match the new row dimensions
            so the page doesn't shift on load. Left accent strip
            kept dim so it reads as part of the skeleton. */}
        <div>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                position: 'relative',
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 8,
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: C.surface2 }} />
              <Skeleton height={14} width="55%" />
              <div style={{ height: 8 }} />
              <Skeleton height={10} width="35%" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // /sector/All — multi-sector landing. Mobile: grouped horizontal
  // scroll layout. Desktop: existing heatmap. The bottom-nav
  // "Sectors" tab routes here, so this is the canonical entry point
  // for "show me every sector at once".
  if (isAllSectors) {
    return (
      <div className="mx-auto max-w-6xl space-y-5 px-4 pb-10 pt-4">
        <Helmet>
          <title>All Sectors — NSE Stocks | PineX</title>
          <meta name="description" content="Sector breadth overview across all NSE sectors — PineX." />
        </Helmet>
        <section>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h1 className="text-2xl font-bold" style={{ color: C.text, margin: 0 }}>All Sectors</h1>
            <button
              type="button"
              onClick={() => navigate('/heatmap')}
              style={{
                padding: '6px 14px',
                background: 'rgba(245,159,11,0.10)',
                border: `1px solid ${C.amber}55`,
                borderRadius: 8,
                color: C.amber,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🗺 View as Heatmap
            </button>
          </div>
        </section>
        {isMobile ? (
          <SectorGroupedView />
        ) : (
          <HeatMap navigate={navigate} />
        )}
      </div>
    )
  }

  const healthKey = normalizeSectorHealthKey(sector?.health)
  const healthStatus = sectorHealthBadgeStatus(sector?.health)
  const healthLabel = getHealthDisplayLabel(healthKey)

  // Prefer the canonical pipeline aggregate when available — same
  // reason as stats: the local company list can be wider than the
  // sector aggregate's coverage, and using sector.total_companies
  // keeps the hero % consistent with /sector/All and the heatmap.
  const aggTotal = Number(sector?.total_companies)
  const aggPct = Number(sector?.stage2_pct)
  const total = (Number.isFinite(aggTotal) && aggTotal > 0)
    ? aggTotal
    : (companies.length || 1)
  const breadthPct = (Number.isFinite(aggPct) && aggPct > 0)
    ? Math.round(aggPct)
    : Math.round((stats.stage2 / total) * 100)
  const heroAccent =
    breadthPct >= 60 ? { color: C.green, gradient: 'linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.02) 60%)', glow: 'rgba(34,197,94,0.25)' } :
    breadthPct >= 40 ? { color: C.amber, gradient: 'linear-gradient(135deg, rgba(245,159,11,0.18) 0%, rgba(245,159,11,0.02) 60%)', glow: 'rgba(245,159,11,0.22)' } :
                       { color: C.red,   gradient: 'linear-gradient(135deg, rgba(239,68,68,0.16) 0%, rgba(239,68,68,0.02) 60%)', glow: 'rgba(239,68,68,0.22)' }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-10 pt-4">
      <Helmet>
        {(() => {
          const label = sector?.display_name || sector?.name || sectorName
          const overview = String(
            sector?.ai_overview
              || 'Stage classification, delivery data and swing conditions — updated daily.'
          )
          const title = `${label} Stocks — Cycle Analysis · PineX`
          const desc = `${label} sector cycle analysis. ${stats?.stage2 || 0} stocks in Stage 2. ${overview}`.slice(0, 280)
          const ogTitle = `${label} — PineX Cycle Analysis`
          const ogDesc = String(overview || `${label} sector analysis updated daily.`).slice(0, 155)
          const url = `https://pinex.in/sector/${encodeURIComponent(sectorName)}`
          return (
            <>
              <title>{title}</title>
              <meta name="description" content={desc} />
              <meta property="og:title" content={ogTitle} />
              <meta property="og:description" content={ogDesc} />
              <meta property="og:url" content={url} />
              <meta property="og:image" content="/og-image.png" />
              <link rel="canonical" href={url} />
            </>
          )
        })()}
      </Helmet>

      {/* Small-sector warning banner. Surfaced first because if the
          sector only has 1–4 stocks in coverage, every breadth /
          stage stat below is statistically meaningless and the user
          needs to know that before they read the numbers. */}
      {isSmallSector(companies.length) && (
        <div
          role="note"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: 12,
            fontSize: 12,
            color: C.textMuted,
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>⚠️</span>
          <span>
            This sector has only <strong style={{ color: C.text }}>{companies.length} stock{companies.length === 1 ? '' : 's'}</strong> in PineX. Breadth data may not reflect a broader trend.
          </span>
        </div>
      )}

      {/* Hero card: gradient tinted by breadth, big number, breadth bar */}
      <section
        style={{
          borderRadius: 16,
          border: `1px solid ${C.border}`,
          background: heroAccent.gradient,
          padding: '20px 22px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -40,
            right: -40,
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: heroAccent.glow,
            filter: 'blur(60px)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative' }}>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold" style={{ color: C.text, margin: 0 }}>
              {sector?.display_name || sector?.name || sectorName}
            </h1>
            <Badge status={healthStatus} text={healthLabel} size="md" />
          </div>

          {/* Breadth headline */}
          <div className="mt-4 flex flex-wrap items-baseline gap-2">
            <span style={{ fontSize: 44, fontWeight: 800, color: heroAccent.color, lineHeight: 1 }}>
              {breadthPct}%
            </span>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              of {companies.length} {companies.length === 1 ? 'stock' : 'stocks'} meet advancing criteria
            </span>
          </div>
          {/* Breadth bar */}
          <div
            style={{
              marginTop: 10,
              height: 6,
              borderRadius: 3,
              background: C.surface2,
              overflow: 'hidden',
              maxWidth: 420,
            }}
          >
            <div style={{ width: `${breadthPct}%`, height: '100%', background: heroAccent.color, borderRadius: 3 }} />
          </div>

          <p className="mt-4 text-sm leading-6" style={{ color: C.text, maxWidth: 720 }}>
            {sector?.ai_overview || 'Sector overview will appear when AI summary is generated.'}
          </p>

          {policyTags.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {policyTags.map((tag) => (
                <span key={tag} className="rounded-full border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted, background: C.surface }}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* Stat cards: icon + colored number + helper line */}
      <section>
        <div className="mb-2 flex items-center">
          <SectionLabel text="Sector health detail" />
          <ProBadge />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            icon="📈"
            label="Advancing criteria"
            value={stats.stage2}
            total={companies.length}
            color={C.green}
            helper={companies.length ? `${Math.round((stats.stage2 / total) * 100)}% of sector` : '—'}
          />
          <StatCard
            icon="📊"
            label="OBV rising"
            value={stats.obvRising}
            total={companies.length}
            color={C.blue}
            helper={companies.length ? `${Math.round((stats.obvRising / total) * 100)}% accumulating` : '—'}
          />
          <StatCard
            icon="🌱"
            label="Revenue growing"
            value={stats.revenueGrowing}
            total={companies.length}
            color={C.amber}
            helper="Latest disclosure"
          />
        </div>
      </section>

      {/* Stage mix — better legend with colored swatches */}
      <section>
        <SectionLabel text="Stage mix" />
        <Card>
          <StageDistribution counts={stageCounts} total={companies.length} />
        </Card>
      </section>

      <section>
        <SectionLabel text="Companies" />

        {/* Filter pills — PineX phase language with live counts. The
            amber border on the active pill matches the brand accent
            we use elsewhere for "you've picked this". */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {filterDefs.map((f) => {
            const active = stageFilter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStageFilter(f.key)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: `1px solid ${active ? C.amber : C.border}`,
                  background: active ? C.surface2 : 'transparent',
                  color: active ? C.text : C.textMuted,
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.label} ({filterCounts[f.key] || 0})
              </button>
            )
          })}
        </div>

        {/* Sort hint — small enough to not compete with the pills,
            tells the user what determines the row order without
            requiring a tooltip. */}
        <div style={{ fontSize: 10, color: C.textFaint, textAlign: 'right', marginBottom: 4 }}>
          Sorted by cycle strength
        </div>

        {visibleCompanies.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', padding: '32px 0' }}>
            No stocks in this phase today
          </div>
        ) : (
          <div>
            {visibleCompanies.map((c) => {
              const canonStage = canonicalStageForBadge(c.stage)
              const accent = STAGE_ACCENT[canonStage] || C.border
              const stageLabel = STAGE_LABEL[canonStage] || null
              const pill = scorePillStyle(c.conditions_met)
              const showHeadline = isMeaningfulHeadline(c.headline)
              return (
                <button
                  key={c.symbol}
                  type="button"
                  onClick={() => navigate(`/stock/${c.symbol}`)}
                  className="sd-row"
                  style={{
                    position: 'relative',
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: '12px 14px 12px 18px',
                    marginBottom: 8,
                    cursor: 'pointer',
                    color: 'inherit',
                    transition: 'border-color 0.15s',
                    overflow: 'hidden',
                  }}
                >
                  {/* Left accent bar — instant visual stage signal */}
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 4,
                      background: accent,
                      borderRadius: '4px 0 0 4px',
                    }}
                  />

                  {/* Row 1 — name + score pill */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                        {truncName(c.name, 22)}
                      </span>
                      <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 6 }}>
                        ({c.symbol})
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        background: pill.bg,
                        border: `1px solid ${pill.border}`,
                        color: pill.color,
                        padding: '3px 10px',
                        borderRadius: 999,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {pill.text}
                    </span>
                  </div>

                  {/* Row 2 — stage label + headline (only if meaningful) */}
                  {(stageLabel || showHeadline) && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6, minWidth: 0 }}>
                      {stageLabel ? (
                        <span
                          style={{
                            fontSize: 10,
                            background: C.surface2,
                            border: `1px solid ${C.border}`,
                            color: accent,
                            padding: '1px 6px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          {stageLabel}
                        </span>
                      ) : <span />}
                      {showHeadline && (
                        <span
                          className="line-clamp-1"
                          style={{ fontSize: 11, color: C.textMuted, textAlign: 'right', minWidth: 0, flex: 1 }}
                          title={pretty(c.headline)}
                        >
                          {pretty(c.headline)}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}

            {/* Show-all toggle — keeps initial render fast for fat
                sectors like Banking (200+ stocks). 30 visible rows
                is well below the point where the page starts to
                feel sluggish on mid-range Androids. */}
            {!showAll && filteredCompanies.length > VISIBLE_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '10px 12px',
                  background: 'transparent',
                  border: `1px dashed ${C.border}`,
                  borderRadius: 10,
                  color: C.textMuted,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Show all {filteredCompanies.length} stocks
              </button>
            )}
          </div>
        )}

        <p className="mt-2 text-xs" style={{ color: C.textMuted }}>
          Showing {visibleCompanies.length} of {filteredCompanies.length}
          {stageFilter !== 'all' ? ` filtered (${companies.length} total)` : ' companies'}
        </p>
        <Link to="/" className="mt-2 inline-block text-sm" style={{ color: C.blue }}>
          ← Back to Home
        </Link>
      </section>

      {/* Hover state for stock rows — desktop-only nicety. Kept here
          as a single small style block instead of inflating styles/tokens. */}
      <style>{`
        .sd-row:hover { border-color: rgba(255,255,255,0.15) !important; }
      `}</style>
    </div>
  )
}
