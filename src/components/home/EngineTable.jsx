import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { normalizeStageKey } from '../../lib/stageUi'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { HOME } from '../../styles/homeSkin'

const BORDER = HOME.cardBorder
const CARD = HOME.card
const MUTED = HOME.muted
const TEXT = '#F1F5F9'
const BLUE = '#38BDF8'

const NEG_NEWS_RE =
  /\b(crash|crashes|plunge|plunges|fraud|probe|investigation|scam|default|bankrupt|losses|loss widen|downgrade|bearish|sell.?rating|weak outlook|warning|penalty|ban|fraudulent|scandal)\b/i

/** Calendar date in Asia/Kolkata (listing date for “news today”). */
function todayYmdIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isoDatePart(iso) {
  if (iso == null) return ''
  const s = String(iso).trim()
  return s.length >= 10 ? s.slice(0, 10) : s
}

/** Mid-rank percentile in [0,100], then map to 1–99 RS score. */
function rsRating99(allRs, x) {
  if (!Number.isFinite(x)) return null
  const vals = allRs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const n = vals.length
  if (n === 0) return null
  if (n === 1) return 50
  let below = 0
  let equal = 0
  for (let i = 0; i < n; i++) {
    if (vals[i] < x) below += 1
    else if (vals[i] === x) equal += 1
  }
  const pct = (below + 0.5 * equal) / n
  const score = Math.round(1 + pct * 98)
  return Math.max(1, Math.min(99, score))
}

function parseObvRising(obvTrend, obvSlope) {
  const t = String(obvTrend || '').toLowerCase()
  if (t.includes('rising')) return true
  const s = Number(obvSlope)
  return Number.isFinite(s) && s > 0.01
}

/**
 * News today + negative keywords → Warning
 * Stage 2 + OBV rising → Bullish
 * Else → Neutral
 */
function computeAiPulse({ stage, obvTrend, obvSlope, newsTitle, newsDatePart }) {
  const today = todayYmdIST()
  if (newsTitle && newsDatePart === today && NEG_NEWS_RE.test(String(newsTitle))) {
    return { label: 'Warning', color: '#F87171' }
  }
  const st = normalizeStageKey(stage)
  if (st === 'stage2' && parseObvRising(obvTrend, obvSlope)) {
    return { label: 'Bullish', color: '#34D399' }
  }
  return { label: 'Neutral', color: '#94A3B8' }
}

function firstNewsPerSymbol(rows) {
  const map = {}
  for (const r of rows || []) {
    const sym = String(r.symbol || '').toUpperCase()
    if (!sym || map[sym]) continue
    map[sym] = {
      title: r.title || '',
      datePart: isoDatePart(r.published_at || r.fetched_date),
    }
  }
  return map
}

/** Latest quarter row per company from shareholding dump. */
function latestPledgeByCompany(rows) {
  const by = new Map()
  for (const r of rows || []) {
    const id = r.company_id
    if (!id) continue
    const q = String(r.quarter || r.quarter_name || '')
    const prev = by.get(id)
    if (!prev) {
      by.set(id, r)
      continue
    }
    const pq = String(prev.quarter || prev.quarter_name || '')
    if (q.localeCompare(pq) > 0) by.set(id, r)
  }
  const out = {}
  for (const [id, row] of by) {
    const v = row.promoter_pledge_pct
    out[id] = v != null && Number.isFinite(Number(v)) ? Number(v) : null
  }
  return out
}

async function fetchDeliveryLatestMap(supabaseClient, companyIds) {
  const dateRes = await supabaseClient.from('delivery_signals').select('date').order('date', { ascending: false }).limit(1)
  const d0 = dateRes.data?.[0]?.date
  if (!d0 || !companyIds.length) return { date: d0 || null, byCompany: {} }
  const BY = 400
  const byCompany = {}
  for (let i = 0; i < companyIds.length; i += BY) {
    const chunk = companyIds.slice(i, i + BY)
    const res = await supabaseClient
      .from('delivery_signals')
      .select('company_id,avg_delivery_30d,delivery_trend_30d')
      .eq('date', d0)
      .in('company_id', chunk)
    for (const r of res.data || []) {
      byCompany[r.company_id] = {
        avg_delivery_30d: r.avg_delivery_30d != null ? Number(r.avg_delivery_30d) : null,
        delivery_trend_30d: r.delivery_trend_30d != null ? String(r.delivery_trend_30d) : '',
      }
    }
  }
  return { date: d0, byCompany }
}

async function fetchShareholdingPledges(supabaseClient, companyIds) {
  if (!companyIds.length) return {}
  const BY = 150
  const all = []
  for (let i = 0; i < companyIds.length; i += BY) {
    const chunk = companyIds.slice(i, i + BY)
    const res = await supabaseClient
      .from('shareholding')
      .select('company_id,quarter,quarter_name,promoter_pledge_pct')
      .in('company_id', chunk)
    all.push(...(res.data || []))
  }
  return latestPledgeByCompany(all)
}

async function fetchVolumeOver50dAvg(supabaseClient, companyIds, endDateStr) {
  const out = {}
  if (!companyIds.length || !endDateStr) return out
  const end = endDateStr.slice(0, 10)
  const start = new Date(end.includes('T') ? end : `${end}T12:00:00`)
  start.setDate(start.getDate() - 140)
  const startStr = start.toISOString().slice(0, 10)

  const CHUNK = 45
  for (let c = 0; c < companyIds.length; c += CHUNK) {
    const chunk = companyIds.slice(c, c + CHUNK)
    const grouped = new Map()
    let offset = 0
    const PAGE = 2000
    for (;;) {
      const { data, error } = await supabaseClient
        .from('price_data')
        .select('company_id,volume,date')
        .in('company_id', chunk)
        .gte('date', startStr)
        .lte('date', end)
        .range(offset, offset + PAGE - 1)

      if (error) break
      const batch = data || []
      for (const row of batch) {
        const id = row.company_id
        if (!grouped.has(id)) grouped.set(id, [])
        grouped.get(id).push({ d: row.date, v: Number(row.volume) })
      }
      offset += PAGE
      if (batch.length < PAGE) break
    }

    for (const id of chunk) {
      const rows = grouped.get(id)
      if (!rows?.length) {
        out[id] = null
        continue
      }
      const sorted = [...rows].sort((a, b) => String(b.d).localeCompare(String(a.d)))
      const vols = sorted
        .slice(0, 50)
        .map((x) => x.v)
        .filter((v) => Number.isFinite(v) && v >= 0)
      if (vols.length < 2) {
        out[id] = null
        continue
      }
      const last = vols[0]
      const avg = vols.reduce((a, b) => a + b, 0) / vols.length
      out[id] = avg > 0 ? last / avg : null
    }
  }
  return out
}

function EngineTableSkeleton() {
  return (
    <div className="w-full space-y-3 p-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={`et-sk-${i}`} className="h-10 w-full animate-pulse rounded-md bg-slate-800/50" />
      ))}
    </div>
  )
}

export default function EngineTable() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [breadthPct, setBreadthPct] = useState(null)
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!hasSupabaseEnv) {
      queueMicrotask(() => setLoading(false))
      return
    }
    let alive = true
    queueMicrotask(() => setLoading(true))

    ;(async () => {
      try {
        const [
          internalsRes,
          companiesRes,
          priceRes,
          newsRes,
        ] = await Promise.all([
          supabase.from('market_internals').select('above_ma150_pct,date').order('date', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('companies').select('id,symbol,name,sector').limit(8000),
          supabase
            .from('price_data')
            .select(
              'company_id,close,stage,rs_vs_nifty,rsi,ma30w,obv_slope,obv_trend,breakout_52w,volume,date',
            )
            .eq('is_latest', true)
            .limit(8000),
          supabase.from('stock_news').select('symbol,title,published_at,fetched_date').order('published_at', { ascending: false }).limit(6000),
        ])

        if (!alive) return

        const companies = companiesRes.data || []
        const companyById = Object.fromEntries(companies.map((c) => [c.id, c]))
        const priceRows = priceRes.data || []
        const companyIds = priceRows.map((r) => r.company_id).filter(Boolean)

        const sampleEnd = priceRows[0]?.date || new Date().toISOString().slice(0, 10)

        const [deliveryPack, pledgeByCompany, volRatio, newsMapPacked] = await Promise.all([
          fetchDeliveryLatestMap(supabase, companyIds),
          fetchShareholdingPledges(supabase, companyIds),
          fetchVolumeOver50dAvg(supabase, companyIds, String(sampleEnd)),
          Promise.resolve(firstNewsPerSymbol(newsRes.data || [])),
        ])

        const allRs = priceRows.map((p) => Number(p.rs_vs_nifty)).filter(Number.isFinite)

        const merged = []
        for (const p of priceRows) {
          const c = companyById[p.company_id]
          if (!c?.symbol) continue
          const sym = String(c.symbol).toUpperCase()
          const rs = Number(p.rs_vs_nifty)
          const rsScore = rsRating99(allRs, rs)
          const d = deliveryPack.byCompany[p.company_id]
          const volR = volRatio[p.company_id]
          const news = newsMapPacked[sym]
          const pulse = computeAiPulse({
            stage: p.stage,
            obvTrend: p.obv_trend,
            obvSlope: p.obv_slope,
            newsTitle: news?.title,
            newsDatePart: news?.datePart,
          })

          merged.push({
            company_id: p.company_id,
            symbol: sym,
            name: c.name || sym,
            sector: (c.sector && String(c.sector).trim()) || '—',
            close: p.close,
            stage: p.stage,
            rsRaw: Number.isFinite(rs) ? rs : null,
            rsScore,
            rsi: p.rsi != null ? Number(p.rsi) : null,
            ma30w: p.ma30w != null ? Number(p.ma30w) : null,
            obvSlope: p.obv_slope != null ? Number(p.obv_slope) : null,
            breakout52w: Boolean(p.breakout_52w),
            avg_delivery_30d: d?.avg_delivery_30d ?? null,
            delivery_trend_30d: d?.delivery_trend_30d ?? '—',
            pledge: pledgeByCompany[p.company_id] ?? null,
            vol50d: volR,
            aiPulse: pulse,
          })
        }

        merged.sort((a, b) => (b.rsScore ?? -1) - (a.rsScore ?? -1))

        if (!alive) return
        setBreadthPct(
          internalsRes.data?.above_ma150_pct != null ? Number(internalsRes.data.above_ma150_pct) : null,
        )
        setRows(merged)
      } catch {
        if (!alive) return
        setBreadthPct(null)
        setRows([])
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  const subtitle = useMemo(() => {
    if (breadthPct == null || !Number.isFinite(breadthPct)) return 'Breadth —'
    return `Breadth above MA150: ${breadthPct.toFixed(1)}%`
  }, [breadthPct])

  if (!hasSupabaseEnv) return null
  if (loading) return <EngineTableSkeleton />

  return (
    <div style={{ marginBottom: 36 }}>
      <style>{`@keyframes homeSk { 0%,100%{opacity:.45} 50%{opacity:.95} }`}</style>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: MUTED }}>
          ENGINE
        </div>
        <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 6 }}>{subtitle}</div>
      </div>

      <div className="hidden w-full overflow-auto rounded-md border border-slate-800 bg-[#0F1217] md:block md:h-[calc(100vh-320px)]">
        <table className="relative w-full min-w-[960px] border-collapse text-left text-xs whitespace-nowrap">
          <thead className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950 shadow-md">
            <tr style={{ textAlign: 'left', color: MUTED }}>
              <th className="px-3 py-2 font-semibold">Symbol</th>
              <th className="px-3 py-2 font-semibold">Sector</th>
              <th className="px-3 py-2 font-semibold tabular-nums">RS (1–99)</th>
              <th className="px-3 py-2 font-semibold">AI pulse</th>
              <th className="px-3 py-2 font-semibold tabular-nums">Vol / 50D</th>
              <th className="px-3 py-2 font-semibold tabular-nums">Del % 30d</th>
              <th className="px-3 py-2 font-semibold">Del trend</th>
              <th className="px-3 py-2 font-semibold tabular-nums">Pledge %</th>
              <th className="px-3 py-2 font-semibold">Stage</th>
              <th className="px-3 py-2 font-semibold tabular-nums">RSI</th>
              <th className="px-3 py-2 font-semibold tabular-nums">MA30W</th>
              <th className="px-3 py-2 font-semibold">52W</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.company_id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/stock/${r.symbol}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/stock/${r.symbol}`)
                }}
                style={{
                  borderBottom: `1px solid ${BORDER}`,
                  cursor: 'pointer',
                  color: TEXT,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(56,189,248,0.06)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-bold" style={{ color: BLUE }}>
                  {r.symbol}
                </td>
                <td className="max-w-[160px] truncate whitespace-nowrap px-3 py-1.5">{r.sector}</td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{r.rsScore != null ? r.rsScore : '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold" style={{ color: r.aiPulse.color }}>
                  {r.aiPulse.label}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {r.vol50d != null && Number.isFinite(r.vol50d) ? `${r.vol50d.toFixed(2)}×` : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {r.avg_delivery_30d != null && Number.isFinite(r.avg_delivery_30d) ? `${r.avg_delivery_30d.toFixed(1)}%` : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5" style={{ color: MUTED }}>
                  {r.delivery_trend_30d}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {r.pledge != null && Number.isFinite(r.pledge) ? `${r.pledge.toFixed(2)}%` : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.stage || '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {r.rsi != null && Number.isFinite(r.rsi) ? r.rsi.toFixed(0) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {r.ma30w != null && Number.isFinite(r.ma30w) ? r.ma30w.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.breakout52w ? '⚡' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>No engine data yet.</div>
        ) : null}
      </div>
    </div>
  )
}
