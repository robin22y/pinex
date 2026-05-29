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

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-10 pt-4">
      <Helmet>
        <title>{`${sector?.display_name || sector?.name || sectorName} Sector — NSE Stocks | PineX`}</title>
        <meta
          name="description"
          content={String(sector?.ai_overview || `Sector analysis for ${sector?.display_name || sector?.name || sectorName}`).slice(0, 160)}
        />
      </Helmet>
      <section>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold" style={{ color: C.text }}>{sector?.display_name || sector?.name || sectorName}</h1>
          <Badge status={healthStatus} text={healthLabel} size="md" />
        </div>
        <p className="mt-2 text-sm leading-6" style={{ color: C.text }}>
          {sector?.ai_overview || 'Sector overview will appear when AI summary is generated.'}
        </p>
        {policyTags.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {policyTags.map((tag) => (
              <span key={tag} className="rounded-full border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted }}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <div className="mb-2 flex items-center">
          <SectionLabel text="Sector health detail" />
          <ProBadge />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Card><p style={{ color: C.textMuted }} className="text-xs">Advancing criteria</p><p style={{ color: C.text }} className="text-2xl font-bold">{stats.stage2} stocks</p></Card>
          <Card><p style={{ color: C.textMuted }} className="text-xs">OBV Rising</p><p style={{ color: C.text }} className="text-2xl font-bold">{stats.obvRising} companies</p></Card>
          <Card><p style={{ color: C.textMuted }} className="text-xs">Revenue Growing</p><p style={{ color: C.text }} className="text-2xl font-bold">{stats.revenueGrowing} companies</p></Card>
        </div>
      </section>

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
