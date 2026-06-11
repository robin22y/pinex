import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import SectionLabel from '../components/ui/SectionLabel'
import Skeleton from '../components/ui/Skeleton'
import StagePill from '../components/StagePill'
import ProBadge from '../components/ProBadge'
import { C } from '../styles/tokens'
import { getHealthDisplayLabel, normalizeSectorHealthKey, sectorHealthBadgeStatus } from '../lib/sectorHealth'
import { canonicalStageForBadge, stageBadge } from '../lib/stageUi'
import { MEANINGFUL_SECTOR_MIN, isSmallSector } from '../lib/sectorThresholds'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

function pretty(text) {
  return String(text || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
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
  const [loading, setLoading] = useState(true)
  const [sector, setSector] = useState(null)
  const [companies, setCompanies] = useState([])
  const [stageFilter, setStageFilter] = useState('all')

  useEffect(() => {
    if (!sectorName) return
    let active = true
    async function load() {
      setLoading(true)
      if (!hasSupabaseEnv) {
        if (active) setLoading(false)
        return
      }

      try {
        const latestSectorDateRes = await supabase
          .from('sectors')
          .select('last_updated')
          .eq('name', sectorName)
          .order('last_updated', { ascending: false })
          .limit(1)
        const latestSectorDate = latestSectorDateRes.data?.[0]?.last_updated

        const sectorRes = latestSectorDate
          ? await supabase
              .from('sectors')
              .select('*')
              .eq('name', sectorName)
              .eq('last_updated', latestSectorDate)
              .maybeSingle()
          : { data: null }

        const companyRes = await supabase
          .from('companies')
          .select('id,name,symbol,sector')
          .eq('sector', sectorName)
          .limit(1200)

        const companyRows = companyRes.data || []
        const ids = companyRows.map((c) => c.id).filter(Boolean)

        const latestPriceDateRes = await supabase
          .from('price_data')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
        const latestPriceDate = latestPriceDateRes.data?.[0]?.date

        const latestSwingDateRes = await supabase
          .from('swing_conditions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
        const latestSwingDate = latestSwingDateRes.data?.[0]?.date

        const [priceRes, swingRes, changesRes] = await Promise.all([
          latestPriceDate && ids.length
            ? supabase
                .from('price_data')
                .select('company_id,stage,obv_trend')
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
          const s = swingByCompany[c.id] || {}
          return {
            ...c,
            stage: p.stage || null,
            obv_trend: p.obv_trend || null,
            conditions_met: Number(s.conditions_met) || 0,
            condition_stage2: Boolean(s.condition_stage2),
            headline: latestHeadlineByCompany[c.id] || 'No major recent change',
          }
        })

        merged.sort((a, b) => {
          const aStage2 = canonicalStageForBadge(a.stage) === 'Stage 2' ? 1 : 0
          const bStage2 = canonicalStageForBadge(b.stage) === 'Stage 2' ? 1 : 0
          if (aStage2 !== bStage2) return bStage2 - aStage2
          return (b.conditions_met || 0) - (a.conditions_met || 0)
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
    const stage2 = companies.filter((c) => canonicalStageForBadge(c.stage) === 'Stage 2').length
    const obvRising = companies.filter((c) => String(c.obv_trend || '').toLowerCase() === 'rising').length
    const revenueGrowing = companies.filter((c) => {
      const h = String(c.headline || '').toLowerCase()
      return h.includes('revenue') && (h.includes('growth') || h.includes('record') || h.includes('recovery'))
    }).length
    return { stage2, obvRising, revenueGrowing }
  }, [companies])

  const filteredCompanies = useMemo(() => {
    if (stageFilter === 'all') return companies
    if (stageFilter === 'stage2') return companies.filter((c) => canonicalStageForBadge(c.stage) === 'Stage 2')
    if (stageFilter === 'stage1plus') return companies.filter((c) => canonicalStageForBadge(c.stage) === 'Stage 1+')
    if (stageFilter === 'stage1') return companies.filter((c) => canonicalStageForBadge(c.stage) === 'Stage 1')
    return companies.filter((c) =>
      canonicalStageForBadge(c.stage) === 'Stage 3' || canonicalStageForBadge(c.stage) === 'Stage 4',
    )
  }, [companies, stageFilter])

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <Skeleton height={38} width="45%" />
        <Skeleton height={72} />
        <Skeleton height={140} />
        <Skeleton height={300} />
      </div>
    )
  }

  const healthKey = normalizeSectorHealthKey(sector?.health)
  const healthStatus = sectorHealthBadgeStatus(sector?.health)
  const healthLabel = getHealthDisplayLabel(healthKey)

  const total = companies.length || 1
  const breadthPct = Math.round((stats.stage2 / total) * 100)
  const heroAccent =
    breadthPct >= 60 ? { color: C.green, gradient: 'linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.02) 60%)', glow: 'rgba(34,197,94,0.25)' } :
    breadthPct >= 40 ? { color: C.amber, gradient: 'linear-gradient(135deg, rgba(245,159,11,0.18) 0%, rgba(245,159,11,0.02) 60%)', glow: 'rgba(245,159,11,0.22)' } :
                       { color: C.red,   gradient: 'linear-gradient(135deg, rgba(239,68,68,0.16) 0%, rgba(239,68,68,0.02) 60%)', glow: 'rgba(239,68,68,0.22)' }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-10 pt-4">
      <Helmet>
        <title>{`${sector?.display_name || sector?.name || sectorName} Sector — NSE Stocks | PineX`}</title>
        <meta
          name="description"
          content={String(sector?.ai_overview || `Sector analysis for ${sector?.display_name || sector?.name || sectorName}`).slice(0, 160)}
        />
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
        <SectionLabel
          text="Companies"
          action={
            <div className="flex gap-1">
              {[
                ['all', 'All'],
                ['stage2', 'Advancing criteria'],
                ['stage1plus', stageBadge('Stage 1+').label],
                ['stage1', 'Basing criteria'],
                ['stage34', 'Other criteria'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStageFilter(key)}
                  className="rounded-full border px-2 py-1"
                  style={{
                    borderColor: C.border,
                    color: stageFilter === key ? C.text : C.textMuted,
                    background: stageFilter === key ? C.surface2 : 'transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />
        <div className="space-y-2">
          {filteredCompanies.map((c) => (
            <button
              key={c.symbol}
              type="button"
              onClick={() => navigate(`/stock/${c.symbol}`)}
              className="w-full rounded-xl border p-3 text-left"
              style={{ borderColor: C.border, background: C.surface }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.text }}>{c.name} ({c.symbol})</p>
                  <p className="mt-1 line-clamp-1 text-xs" style={{ color: C.textMuted }}>{pretty(c.headline)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StagePill stage={c.stage} />
                  <Badge status={c.conditions_met >= 4 ? 'green' : c.conditions_met >= 2 ? 'amber' : 'red'} text={`${c.conditions_met}/5`} />
                </div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: C.textMuted }}>
          Showing {filteredCompanies.length} of {companies.length} companies
        </p>
        <Link to="/" className="mt-2 inline-block text-sm" style={{ color: C.blue }}>
          ← Back to Home
        </Link>
      </section>
    </div>
  )
}
