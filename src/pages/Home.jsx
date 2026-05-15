import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context'
import SectorShareModal from '../components/SectorShareCard'
import {
  markHomeBackToSectorsTab,
  clearHomeBackToSectorsTab,
} from '../lib/appNav'

const C = {
  bg: '#0B0E11',
  surface: '#0F1217',
  surface2: '#141820',
  card: '#141820',
  border: '#1E2530',
  text: '#E2E8F0',
  muted: '#64748B',
  textMuted: '#64748B',
  hint: '#475569',
  green: '#00C805',
  red: '#FF3B30',
  blue: '#60A5FA',
  amber: '#FBBF24',
}

const fmt = (n, d=1) => n == null ? '—' : 
  n.toLocaleString('en-IN', {maximumFractionDigits: d})
const fmtPct = (n, d=1) => n == null ? '—' : 
  (n > 0 ? '+' : '') + n.toFixed(d) + '%'
const fmtVol = (n) => {
  if (!n) return '—'
  if (n >= 10000000) return (n/10000000).toFixed(1) + 'Cr'
  if (n >= 100000) return (n/100000).toFixed(1) + 'L'
  if (n >= 1000) return (n/1000).toFixed(0) + 'K'
  return Math.round(n)
}

/** Nifty sector card title → filter on `company.sector` (substring match) */
const NIFTY_SECTOR_NAME_MAP = {
  'Nifty Auto': 'Auto',
  'Nifty Bank': 'Banking',
  'Nifty IT': 'IT Services',
  'Nifty Pharma': 'Pharma',
  'Nifty FMCG': 'FMCG',
  'Nifty Metal': 'Metals & Mining',
  'Nifty Realty': 'Real Estate',
  'Nifty Energy': 'Oil & Gas',
  'Nifty Infra': 'Infrastructure',
  'Nifty Media': 'Media',
  'Nifty PSU Bank': 'Banking',
  'Nifty Financial Services': 'NBFC',
  'Nifty Private Bank': 'Banking',
  'Nifty Healthcare': 'Healthcare',
  'Nifty Consumer Durables': 'Consumer Durables',
  'Nifty Consumer Goods': 'FMCG',
  'Nifty Oil & Gas': 'Oil & Gas',
  'Nifty 50': null,
}

const STAGE_BADGE_TOOLTIPS = {
  'Stage 2': 'Price above rising 30-week MA',
  'Stage 1': 'Price base forming',
  'Stage 3': 'Momentum slowing',
  'Stage 4': 'Price below declining 30-week MA',
}

function mapNiftySectorToFilter(displayOrIndex) {
  const raw = String(displayOrIndex || '').trim()
  if (!raw) return null
  const lower = raw.replace(/\s+/g, ' ').toLowerCase()
  for (const [k, v] of Object.entries(NIFTY_SECTOR_NAME_MAP)) {
    if (k.toLowerCase().replace(/\s+/g, ' ') === lower) return v
  }
  if (/^nifty\s*50$/i.test(raw) || lower === 'nifty 50' || lower.startsWith('nifty 50 ')) return null
  const m = raw.match(/^nifty\s+(.+)$/i)
  if (m) return m[1].trim()
  return raw
}

const StageBadge = ({ stage }) => {
  const cfg = {
    'Stage 2': { bg: 'rgba(0,200,5,.15)', 
                 color: '#00C805', 
                 border: 'rgba(0,200,5,.3)', 
                 label: 'S2' },
    'Stage 1': { bg: 'rgba(96,165,250,.15)', 
                 color: '#60A5FA', 
                 border: 'rgba(96,165,250,.3)', 
                 label: 'S1' },
    'Stage 3': { bg: 'rgba(251,191,36,.15)', 
                 color: '#FBBF24', 
                 border: 'rgba(251,191,36,.3)', 
                 label: 'S3' },
    'Stage 4': { bg: 'rgba(255,59,48,.15)', 
                 color: '#FF3B30', 
                 border: 'rgba(255,59,48,.3)', 
                 label: 'S4' },
  }
  const s = cfg[stage] || { bg: '#1E2530', 
    color: '#64748B', border: '#1E2530', label: '?' }
  const tip = STAGE_BADGE_TOOLTIPS[stage] || ''
  return (
    <span title={tip} style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontSize: 9, fontWeight: 700,
      padding: '1px 5px', borderRadius: 3,
      letterSpacing: '0.05em', flexShrink: 0
    }}>
      {s.label}
    </span>
  )
}

const PulseTag = ({ pulse }) => {
  const cfg = {
    Uptrend: { bg: 'rgba(0,200,5,.1)', 
               color: '#00C805', 
               border: 'rgba(0,200,5,.2)' },
    Watch: { bg: 'rgba(255,59,48,.1)', 
               color: '#FF3B30', 
               border: 'rgba(255,59,48,.2)' },
    Neutral: { bg: 'rgba(100,116,139,.1)', 
               color: '#94A3B8', 
               border: 'rgba(100,116,139,.2)' },
  }
  const s = cfg[pulse] || cfg.Neutral
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontSize: 10, fontWeight: 500,
      padding: '2px 7px', borderRadius: 3,
    }}>
      {pulse || 'Neutral'}
    </span>
  )
}

/** VIX display band (value → color + label). */
function vixBand(vix) {
  const v = Number(vix)
  if (!Number.isFinite(v)) return { color: C.muted, label: '—' }
  if (v < 13) return { color: '#00C805', label: 'calm' }
  if (v < 17) return { color: '#FBBF24', label: 'normal' }
  if (v < 20) return { color: '#F97316', label: 'elevated' }
  return { color: '#FF3B30', label: 'fear' }
}

/** Nifty 1d % color */
function chgColor(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return C.muted
  if (Number(pct) > 0) return '#00C805'
  if (Number(pct) < 0) return '#FF3B30'
  return C.muted
}

/**
 * `history` = newest first (Supabase order desc).
 * Needs at least 2 rows for breadth / index / VIX / 52W / stage2 signals; 3 rows for 3‑session breadth.
 */
function buildMarketSignals(history) {
  const h = [...(history || [])]
  const signals = []

  const month = new Date().getMonth() + 1
  const SEASONAL = {
    3: {
      text: 'March: Quarter-end — institutional rebalancing historically common',
      color: '#60A5FA',
    },
    5: {
      text: 'May: Historically mixed — monitor breadth for direction cues',
      color: '#60A5FA',
    },
    9: {
      text: 'September: FII rebalancing period — breadth often contracts',
      color: '#60A5FA',
    },
    10: {
      text: 'October: Festival season — consumption and retail sectors historically active',
      color: '#60A5FA',
    },
    12: {
      text: 'December: Year-end — profit booking historically common in small caps',
      color: '#60A5FA',
    },
  }

  if (h.length < 2) {
    if (SEASONAL[month]) {
      signals.push({
        type: 'info',
        icon: 'ti-calendar',
        color: SEASONAL[month].color,
        bg: 'rgba(96,165,250,.08)',
        border: 'rgba(96,165,250,.25)',
        text: SEASONAL[month].text,
      })
    }
    return signals
  }

  const latest = h[0] || {}
  const prev = h[1] || {}
  const older = h[2] || {}

  const breadthNow = Number(latest.above_ma150_pct) || 0
  const breadthPrev = Number(prev.above_ma150_pct) || 0
  const breadthChange = breadthNow - breadthPrev

  if (breadthChange < -10 && breadthNow < 40) {
    signals.push({
      type: 'caution',
      icon: 'ti-trending-down',
      color: '#F97316',
      bg: 'rgba(249,115,22,.08)',
      border: 'rgba(249,115,22,.3)',
      text: `Breadth fell sharply — stocks above 30W MA dropped from ${breadthPrev.toFixed(0)}% to ${breadthNow.toFixed(0)}% in recent sessions`,
    })
  }

  const niftyNow = Number(latest.nifty_close) || 0
  const niftyPrev = Number(prev.nifty_close) || 0
  const niftyChange = niftyPrev > 0
    ? ((niftyNow - niftyPrev) / niftyPrev) * 100
    : 0

  if (niftyChange >= -1 && breadthChange < -5) {
    signals.push({
      type: 'caution',
      icon: 'ti-alert-triangle',
      color: '#FBBF24',
      bg: 'rgba(251,191,36,.08)',
      border: 'rgba(251,191,36,.3)',
      text: `Index level masking weakness — only ${breadthNow.toFixed(0)}% of stocks above 30-week MA while index remains elevated`,
    })
  }

  if (h.length >= 3) {
    const breadthOlder = Number(older.above_ma150_pct) || 0
    const breadth3dChange = breadthNow - breadthOlder

    if (breadth3dChange > 5) {
      signals.push({
        type: 'positive',
        icon: 'ti-trending-up',
        color: '#00C805',
        bg: 'rgba(0,200,5,.08)',
        border: 'rgba(0,200,5,.3)',
        text: `Breadth recovering — stocks above 30W MA improved from ${breadthOlder.toFixed(0)}% to ${breadthNow.toFixed(0)}% over 3 sessions`,
      })
    } else if (breadth3dChange < -15) {
      signals.push({
        type: 'caution',
        icon: 'ti-chart-line',
        color: '#FF3B30',
        bg: 'rgba(255,59,48,.08)',
        border: 'rgba(255,59,48,.3)',
        text: `Broad market deteriorating — breadth fell ${Math.abs(breadth3dChange).toFixed(0)} percentage points over 3 sessions`,
      })
    }
  }

  const stage2Now = Number(latest.stage2_pct) || 0
  const stage2Prev = Number(prev.stage2_pct) || 0
  const stage2Change = stage2Now - stage2Prev

  if (stage2Change <= -3) {
    signals.push({
      type: 'caution',
      icon: 'ti-chart-bar',
      color: '#FBBF24',
      bg: 'rgba(251,191,36,.08)',
      border: 'rgba(251,191,36,.3)',
      text: `Uptrend stocks contracting — ${stage2Now.toFixed(0)}% of tracked stocks in uptrend phase, down from ${stage2Prev.toFixed(0)}%`,
    })
  }

  const vix = Number(latest.india_vix) || 0
  const vixPrev = Number(prev.india_vix) || 0
  const vixRising = vix > vixPrev + 1

  if (vix > 20) {
    signals.push({
      type: 'watch',
      icon: 'ti-activity',
      color: '#FF3B30',
      bg: 'rgba(255,59,48,.08)',
      border: 'rgba(255,59,48,.3)',
      text: `India VIX at ${vix.toFixed(1)} — elevated volatility conditions`,
    })
  } else if (vixRising && vix > 17) {
    signals.push({
      type: 'watch',
      icon: 'ti-activity',
      color: '#F97316',
      bg: 'rgba(249,115,22,.08)',
      border: 'rgba(249,115,22,.3)',
      text: `Volatility increasing — VIX rising to ${vix.toFixed(1)}`,
    })
  }

  const highs = Number(latest.new_52w_highs) || 0
  const lows = Number(latest.new_52w_lows) || 0

  if (lows > highs * 2 && lows > 10) {
    signals.push({
      type: 'caution',
      icon: 'ti-arrow-down-circle',
      color: '#FF3B30',
      bg: 'rgba(255,59,48,.08)',
      border: 'rgba(255,59,48,.3)',
      text: `${lows} stocks at 52-week lows vs ${highs} at highs — more stocks breaking down than breaking out`,
    })
  } else if (highs > lows * 3 && highs > 20) {
    signals.push({
      type: 'positive',
      icon: 'ti-arrow-up-circle',
      color: '#00C805',
      bg: 'rgba(0,200,5,.08)',
      border: 'rgba(0,200,5,.3)',
      text: `${highs} stocks at 52-week highs — broad participation in advance`,
    })
  }

  if (SEASONAL[month]) {
    signals.push({
      type: 'info',
      icon: 'ti-calendar',
      color: SEASONAL[month].color,
      bg: 'rgba(96,165,250,.08)',
      border: 'rgba(96,165,250,.25)',
      text: SEASONAL[month].text,
    })
  }

  return signals
}

export default function Home() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { t } = useTranslation()
  const [allStocks, setAllStocks] = useState([])
  const [market, setMarket] = useState(null)
  const [marketSignals, setMarketSignals] = useState([])
  const [marketHistory, setMarketHistory] = useState([])
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortCol, setSortCol] = useState('rs_rating')
  const [sortDir, setSortDir] = useState(-1)
  const [page, setPage] = useState(0)
  const [sectorTf, setSectorTf] = useState('1W')
  const [homeTab, setHomeTab] = useState('stocks')
  const [sectorFilter, setSectorFilter] = useState(null)
  const [sectorRowHover, setSectorRowHover] = useState(null)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)
  const [showSectorShare, setShowSectorShare] = useState(false)
  const [signalsOpen, setSignalsOpen] = useState(false)
  const PER_PAGE = 10

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'sectors') setHomeTab('sectors')
    else if (t === 'stocks') setHomeTab('stocks')
  }, [searchParams])

  const handleSectorClick = (sectorName) => {
    const mapped = mapNiftySectorToFilter(sectorName)
    markHomeBackToSectorsTab(location.pathname)
    setSectorFilter(mapped)
    setActiveFilter('all')
    setSearch('')
    setPage(0)
    setSortCol('rs_rating')
    setSortDir(-1)
    setHomeTab('stocks')
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('tab', 'stocks')
        return p
      },
      { replace: false },
    )
    requestAnimationFrame(() => {
      document.getElementById('stock-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const loadRef = React.useRef(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setFetchError(null)
      try {
        const withTimeout = (promise, ms = 15000) => {
          const timer = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s — Supabase may be unreachable`)), ms)
          )
          return Promise.race([promise, timer])
        }

        const fetchAllStocks = async () => {
          const PAGE = 1000
          let all = []
          let from = 0
          while (true) {
            const { data, error } = await withTimeout(
              supabase.rpc('get_home_stocks').range(from, from + PAGE - 1)
            )
            if (error) {
              if (all.length === 0) {
                // RPC not available — fall back to direct price_data query
                const { data: fallback, error: fbErr } = await withTimeout(
                  supabase
                    .from('price_data')
                    .select('id,company_id,close,stage,rs_vs_nifty,ma30w,ma50,volume,rsi,high_52w,low_52w,obv_slope')
                    .eq('is_latest', true)
                    .limit(2000)
                )
                if (!fbErr && fallback?.length) {
                  const { data: companies } = await withTimeout(
                    supabase.from('companies').select('id,symbol,name,sector,tier').limit(3000)
                  )
                  const cMap = {}
                  for (const c of companies || []) cMap[c.id] = c
                  return fallback.map(p => ({ ...p, ...(cMap[p.company_id] || {}) }))
                }
              }
              break
            }
            if (!data?.length) break
            all = all.concat(data)
            if (data.length < PAGE) break
            from += PAGE
          }
          return all
        }

        const [
          stocks,
          { data: mkt },
          { data: mktHistory },
          { data: sec },
        ] = await Promise.all([
          fetchAllStocks(),
          withTimeout(supabase.from('market_internals')
            .select('*')
            .order('date', { ascending: false })
            .limit(1)),
          withTimeout(supabase.from('market_internals')
            .select(
              'date,nifty_close,new_52w_highs,new_52w_lows,above_ma150_pct,stage2_pct,india_vix,nifty_consecutive_up,nifty_consecutive_down',
            )
            .order('date', { ascending: false })
            .limit(10)),
          withTimeout(supabase.from('nifty_sectors')
            .select('*')
            .order('date', { ascending: false })
            .limit(32)),
        ])

        let mktRow = mkt?.[0] || null
        if (mktRow && (mktRow.india_vix == null || mktRow.india_vix === '')) {
          const { data: vixRow } = await supabase
            .from('market_internals')
            .select('india_vix')
            .not('india_vix', 'is', null)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (vixRow?.india_vix != null) {
            mktRow = { ...mktRow, india_vix: vixRow.india_vix }
          }
        }

        const merged = (stocks || []).map(c => ({
          ...c,
          delivery: c.avg_delivery_30d,
          delivery_trend: c.delivery_trend_30d,
          pledge: c.promoter_pledge_pct || 0,
          obv_slope: parseFloat(c.obv_slope) || 0,
          pct_from_ma: c.close && c.ma30w
            ? ((c.close - c.ma30w) / c.ma30w * 100) : null,
          high_conviction: Boolean(c.high_conviction),
        }))

        const rsVals = merged.filter(r => r.rs_vs_nifty != null)
          .map(r => r.rs_vs_nifty).sort((a,b)=>a-b)
        const withR = merged.map(s => ({
          ...s,
          rs_rating: s.rs_vs_nifty != null && rsVals.length
            ? Math.max(1, Math.round(
                (rsVals.filter(v=>v<=s.rs_vs_nifty).length/rsVals.length)*99))
            : null,
          ai_pulse: s.stage==='Stage 2' && s.obv_slope>0.01 ? 'Uptrend'
            : s.stage==='Stage 4'||s.obv_slope<-0.02 ? 'Watch' : 'Neutral'
        }))

        setAllStocks(withR)
        setMarket(mktRow)
        const hist = mktHistory || []
        setMarketHistory(hist)
        setMarketSignals(buildMarketSignals(hist))
        const latestDate = sec?.[0]?.date
        setSectors((sec||[]).filter(s=>s.date===latestDate))
      } catch(e) {
        console.error('[Home] load error:', e)
        setFetchError(e?.message || String(e))
      }
      finally { setLoading(false) }
    }
    loadRef.current = load
    load()
  }, [])

  const counts = useMemo(() => ({
    above50dma: allStocks.filter(s=>s.close!=null&&s.ma50!=null&&s.close>s.ma50).length,
    stage2: allStocks.filter(s=>s.stage==='Stage 2').length,
    highconviction: allStocks.filter(s => s.high_conviction).length,
    accumulation: allStocks.filter(s=>s.is_accumulation).length,
    distribution: allStocks.filter(s=>s.is_distribution).length,
    breakout30w: allStocks.filter(s=>s.breakout_30wma).length,
    breakdown30w: allStocks.filter(s=>s.breakdown_30wma).length,
    highdelivery: allStocks.filter(s=>s.delivery>55).length,
    clean: allStocks.filter(s=>(!s.pledge||s.pledge===0)&&s.stage==='Stage 2').length,
  }), [allStocks])

  const filtered = useMemo(() => {
    let r = [...allStocks]
    if (sectorFilter) {
      const sf = sectorFilter.toLowerCase()
      r = r.filter((s) => {
        const sec = (s.sector || '').toLowerCase()
        return sec.includes(sf) || sf.includes(sec)
      })
    }
    if (activeFilter==='all') { /* no filter */ }
    else if (activeFilter==='above50dma') r=r.filter(s=>s.close!=null&&s.ma50!=null&&s.close>s.ma50)
    else if (activeFilter==='stage2') r=r.filter(s=>s.stage==='Stage 2')
    else if (activeFilter==='highconviction') r=r.filter(s => s.high_conviction)
    else if (activeFilter==='accumulation') r=r.filter(s=>s.is_accumulation)
    else if (activeFilter==='distribution') r=r.filter(s=>s.is_distribution)
    else if (activeFilter==='breakout30w') r=r.filter(s=>s.breakout_30wma)
    else if (activeFilter==='breakdown30w') r=r.filter(s=>s.breakdown_30wma)
    else if (activeFilter==='highdelivery') r=r.filter(s=>s.delivery>55)
    else if (activeFilter==='clean') r=r.filter(s=>(!s.pledge||s.pledge===0)&&s.stage==='Stage 2')
    if (search) {
      const q=search.toLowerCase()
      r=r.filter(s=>s.symbol?.toLowerCase().includes(q)||
        (s.sector||'').toLowerCase().includes(q)||
        (s.name||'').toLowerCase().includes(q))
    }
    r.sort((a,b)=>{
      const av=a[sortCol]??-999, bv=b[sortCol]??-999
      return sortDir*(bv-av)
    })
    return r
  }, [allStocks, activeFilter, search, sortCol, sortDir, sectorFilter])

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || q.length < 1) return []
    return allStocks
      .filter(s =>
        s.symbol?.toLowerCase().startsWith(q) ||
        s.name?.toLowerCase().includes(q) ||
        s.symbol?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const aStart = a.symbol?.toLowerCase().startsWith(q) ? 0 : 1
        const bStart = b.symbol?.toLowerCase().startsWith(q) ? 0 : 1
        return aStart - bStart
      })
      .slice(0, 7)
  }, [search, allStocks])

  const paginated = filtered.slice(page*PER_PAGE, (page+1)*PER_PAGE)
  const totalPages = Math.ceil(filtered.length/PER_PAGE)

  const handleSort = (col) => {
    if (sortCol===col) setSortDir(d=>d*-1)
    else { setSortCol(col); setSortDir(-1) }
    setPage(0)
  }

  const FILTERS = [
    { id:'all', label: t('screener.filters.all'), count: allStocks.length, color: C.muted },
    { id:'above50dma', label: t('screener.filters.above50dma'), count: counts.above50dma, color: C.blue },
    { id:'stage2', label: t('screener.filters.stage2'), count: counts.stage2, color: C.green },
    {
      id: 'highconviction',
      label: t('screener.filters.highconviction'),
      desc: 'Stage 2 + above MAs + rising delivery',
      count: counts.highconviction,
      color: C.green,
      icon: '🎯',
    },
    { id:'accumulation', label: t('screener.filters.accumulation'), count: counts.accumulation, color: C.green },
    { id:'distribution', label: t('screener.filters.distribution'), count: counts.distribution, color: C.red, desc: 'High volume with declining delivery' },
    { id:'breakout30w', label: t('screener.filters.breakout30w'), count: counts.breakout30w, color: C.green, desc: 'Price above 30-week moving average' },
    { id:'breakdown30w', label: t('screener.filters.breakdown30w'), count: counts.breakdown30w, color: C.red },
    { id:'highdelivery', label: t('screener.filters.highdelivery'), count: counts.highdelivery, color: C.blue },
    { id:'clean', label: t('screener.filters.clean'), count: counts.clean, color: C.amber, desc: 'Zero promoter pledge, uptrend phase' },
  ]

  const sectorKey = sectorTf==='1D'?'change_1d':sectorTf==='1W'?'change_1w':sectorTf==='1M'?'change_1m':'change_3m'
  const sortedSectors = [...sectors].sort((a,b)=>(b[sectorKey]||0)-(a[sectorKey]||0))

  const TH = ({col, label, right}) => (
    <th onClick={()=>handleSort(col)} style={{
      padding:'6px 10px', fontSize:10, color: sortCol===col ? C.text : C.muted,
      textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:400,
      textAlign: right?'right':'left', cursor:'pointer', whiteSpace:'nowrap',
      borderBottom:`1px solid ${C.border}`, userSelect:'none',
      background: C.surface,
    }}>
      {label} {sortCol===col ? (sortDir===-1?'↓':'↑') : '⇅'}
    </th>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{
                  background:C.bg, color:C.text, 
                  fontSize:13, fontFamily:'DM Sans,system-ui,sans-serif',
                }}>

      <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0}}>

        {/* Mobile brand header — hidden on md+ where sidebar shows */}
        <div className="md:hidden" style={{
          display: 'flex', alignItems: 'center',
          padding: '10px 14px 8px',
          borderBottom: '1px solid #1E2530',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(96,165,250,0.15)',
              border: '1px solid rgba(96,165,250,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: '#60A5FA' }}>P</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                Pine<span style={{ color: '#60A5FA' }}>X</span>
              </p>
              <p style={{ margin: 0, fontSize: 9, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Market Intelligence
              </p>
            </div>
          </div>
        </div>

        {/* TOPBAR — single compact scrollable row */}
        {(() => {
          const nc = market?.nifty_close
          const niftyStr = nc != null && nc !== ''
            ? Number(nc).toLocaleString('en-IN', { maximumFractionDigits: 0 })
            : '—'
          const n1d = market?.nifty_change_1d
          const n1dNum = n1d != null && n1d !== '' ? Number(n1d) : null
          const n1dStr = n1dNum != null && Number.isFinite(n1dNum) ? fmtPct(n1dNum) : ''
          const stageLabel = (Number(market?.stage2_pct) || 0) > 40 ? 'Stage 2' : 'Stage 1'
          const consUp = Number(market?.nifty_consecutive_up) || 0
          const consDn = Number(market?.nifty_consecutive_down) || 0
          const vx = market?.india_vix
          const vxNum = vx != null && vx !== '' ? Number(vx) : null
          const vxStr = vxNum != null && Number.isFinite(vxNum) ? vxNum.toFixed(1) : '—'
          const vxMeta = vixBand(vxNum)
          const br = market?.above_ma150_pct
          const brNum = br != null && br !== '' ? Number(br) : null
          const brStr = brNum != null && Number.isFinite(brNum) ? `${brNum.toFixed(1)}%` : '—'
          const brColor = brNum == null || !Number.isFinite(brNum) ? C.muted
            : brNum > 60 ? '#00C805' : brNum >= 40 ? '#FBBF24' : '#FF3B30'
          const hi = market?.new_52w_highs
          const lo = market?.new_52w_lows
          const hiStr = hi != null ? String(hi) : '—'
          const loStr = lo != null ? String(lo) : '—'
          const barW = brNum != null && Number.isFinite(brNum) ? `${Math.min(100, Math.max(0, brNum))}%` : '0%'
          const Divider = () => <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0, alignSelf: 'center' }} />
          return (
            <div style={{
              display: 'flex', flexDirection: 'row', alignItems: 'center',
              height: 44, flexShrink: 0,
              background: C.surface,
              borderBottom: `1px solid ${C.border}`,
              overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none',
            }}>
              {/* NIFTY */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>NIFTY</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: C.text, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{niftyStr}</span>
                {n1dStr ? <span style={{ fontSize: 11, fontWeight: 700, color: chgColor(n1dNum) }}>{n1dStr}</span> : null}
                <StageBadge stage={stageLabel} />
                {consUp > 0 ? <span style={{ fontSize: 10, fontWeight: 700, color: C.green }}>↑{consUp}d</span> : null}
                {consDn > 0 ? <span style={{ fontSize: 10, fontWeight: 700, color: C.red }}>↓{consDn}d</span> : null}
              </div>
              <Divider />
              {/* VIX */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>VIX</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: vxMeta.color, fontVariantNumeric: 'tabular-nums' }}>{vxStr}</span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, border: `1px solid ${vxMeta.color}55`, color: vxMeta.color, background: `${vxMeta.color}14` }}>
                  {vxMeta.label}
                </span>
              </div>
              <Divider />
              {/* BREADTH */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>BREADTH</span>
                <div style={{ width: 36, height: 4, background: C.border, borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ height: '100%', width: barW, background: brColor, borderRadius: 99, transition: 'width .3s ease' }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 12, color: brColor, fontVariantNumeric: 'tabular-nums' }}>{brStr}</span>
              </div>
              <Divider />
              {/* 52W H/L */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 14px', flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>52W</span>
                <span style={{ fontSize: 11, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                  H:<span style={{ color: C.green, fontWeight: 700 }}>{hiStr}</span>
                  {' '}L:<span style={{ color: C.red, fontWeight: 700 }}>{loStr}</span>
                </span>
              </div>
            </div>
          )
        })()}

        {/* Market signals — collapsible single-line preview */}
        {marketSignals.length > 0 && (
          <div style={{ borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0 }}>
            <button
              onClick={() => setSignalsOpen(o => !o)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <i className={`ti ${marketSignals[0].icon} shrink-0`} style={{ fontSize: 13, color: marketSignals[0].color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                {marketSignals[0].text}
              </span>
              {marketSignals.length > 1 && !signalsOpen && (
                <span style={{ fontSize: 10, color: C.textMuted, flexShrink: 0, marginRight: 2 }}>+{marketSignals.length - 1}</span>
              )}
              <i className={`ti ${signalsOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`} style={{ fontSize: 11, color: C.hint, flexShrink: 0 }} />
            </button>
            {signalsOpen && marketSignals.slice(1).map((sig, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 12px 8px' }}>
                <i className={`ti ${sig.icon}`} style={{ fontSize: 13, color: sig.color, flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{sig.text}</span>
              </div>
            ))}
          </div>
        )}

        <div
          className="flex overflow-x-auto border-b"
          style={{
            flexShrink: 0,
            background: C.surface,
            borderColor: C.border,
            scrollbarWidth: 'none',
          }}
        >
          {[
            {id:'stocks', label: t('screener.tabs.stocks')},
            {id:'sectors', label: t('screener.tabs.sectors')},
          ].map(tab=>(
            <button key={tab.id}
              type="button"
              className="whitespace-nowrap"
              onClick={() => {
                setHomeTab(tab.id)
                setSearchParams(
                  (prev) => {
                    const p = new URLSearchParams(prev)
                    p.set('tab', tab.id)
                    return p
                  },
                  { replace: true },
                )
              }}
              style={{
                flex:'none',
                padding:'10px 18px',
                minHeight:40,
                fontSize:13,
                fontWeight:homeTab===tab.id ? 600 : 400,
                color:homeTab===tab.id ? C.text : C.textMuted,
                background:'none',
                border:'none',
                borderBottom:`2px solid ${
                  homeTab===tab.id ? C.green : 'transparent'}`,
                cursor:'pointer',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* SCROLLABLE BODY */}
        <div style={{flex:1, overflowY:'auto', overflowX:'hidden', padding:'12px 16px 96px',
          display:'flex', flexDirection:'column', gap:12}}>

          {homeTab==='stocks' && (
            <>

          {/* SEARCH — pinned at top of content, always visible */}
          <div style={{ position: 'relative' }}>
            <i className="ti ti-search" style={{
              position: 'absolute', left: 13, top: 18,
              fontSize: 16, color: '#60A5FA', pointerEvents: 'none', zIndex: 1,
            }}/>
            <input
              className="w-full min-w-0"
              value={search}
              onChange={e=>{ setSearch(e.target.value); setPage(0) }}
              placeholder={t('screener.searchPlaceholder')}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0B1220',
                border: '1.5px solid rgba(96,165,250,0.35)',
                borderRadius: searchFocused && suggestions.length > 0 ? '10px 10px 0 0' : 10,
                padding: '12px 12px 12px 40px',
                fontSize: 15, color: '#E2E8F0', outline: 'none',
                boxShadow: '0 0 0 0 rgba(96,165,250,0)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onFocus={e => {
                setSearchFocused(true)
                e.target.style.borderColor = 'rgba(96,165,250,0.7)';
                e.target.style.boxShadow = '0 0 0 3px rgba(96,165,250,0.12)';
              }}
              onBlur={e => {
                setTimeout(() => setSearchFocused(false), 150)
                e.target.style.borderColor = 'rgba(96,165,250,0.35)';
                e.target.style.boxShadow = '0 0 0 0 rgba(96,165,250,0)';
              }}
            />
            {/* Suggestion dropdown */}
            {searchFocused && suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                background: '#0B1220',
                border: '1.5px solid rgba(96,165,250,0.5)',
                borderTop: '1px solid rgba(96,165,250,0.15)',
                borderRadius: '0 0 10px 10px',
                overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {suggestions.map((s, idx) => {
                  const stageColor = s.stage === 'Stage 2' ? '#34D399' : s.stage === 'Stage 4' ? '#F87171' : '#94A3B8'
                  return (
                    <button
                      key={s.symbol}
                      type="button"
                      onMouseDown={() => {
                        navigate(`/stock/${s.symbol}`)
                        setSearch('')
                        setSearchFocused(false)
                      }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', background: 'none', border: 'none',
                        borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(96,165,250,0.07)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', minWidth: 80 }}>{s.symbol}</span>
                      <span style={{ fontSize: 12, color: '#64748B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      {s.stage && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: stageColor, background: stageColor + '18', border: `1px solid ${stageColor}30`, padding: '2px 7px', borderRadius: 99, flexShrink: 0 }}>
                          {s.stage}
                        </span>
                      )}
                      <i className="ti ti-arrow-right" style={{ fontSize: 13, color: '#334155', flexShrink: 0 }} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Error banner */}
          {fetchError && !loading && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)',
              borderRadius: 8, padding: '12px 14px',
            }}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 16, color: '#FF3B30', flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#FF3B30', margin: '0 0 2px' }}>{t('screener.loadError')}</p>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 8px', wordBreak: 'break-word' }}>{fetchError}</p>
                <button
                  type="button"
                  onClick={() => { setFetchError(null); loadRef.current?.() }}
                  style={{ fontSize: 12, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  {t('screener.retry')}
                </button>
              </div>
            </div>
          )}

          {/* FILTER CARDS — 2 cols mobile, 4 cols md+ */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {FILTERS.map((f, idx) => {
              const locked = !authLoading && !user && idx >= 3
              return (
                <div key={f.id}
                  onClick={() => {
                    if (locked) { setShowAuthPrompt(true); return }
                    setActiveFilter(f.id); setPage(0); setSortCol('rs_rating'); setSortDir(-1)
                    setTimeout(() => {
                      const el = document.getElementById('stock-table')
                      if (!el) return
                      const top = el.getBoundingClientRect().top + window.scrollY - 8
                      window.scrollTo({ top, behavior: 'smooth' })
                    }, 50)
                  }}
                  style={{
                    minHeight: 72,
                    background: activeFilter===f.id ? C.card : C.surface2,
                    border:`1px solid ${activeFilter===f.id ? f.color : C.border}`,
                    borderRadius:6, padding:'10px 12px',
                    cursor:'pointer', transition:'border-color .15s',
                    opacity: locked ? 0.45 : 1,
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                  {locked && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(11,14,17,0.55)',
                      gap: 4, zIndex: 1,
                    }}>
                      <i className="ti ti-lock" style={{ fontSize: 18, color: '#94A3B8' }} />
                      <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, letterSpacing: '0.04em' }}>Sign in</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    {f.icon ? (
                      <span style={{ fontSize: 14, lineHeight: 1.2, flexShrink: 0 }} aria-hidden>{f.icon}</span>
                    ) : null}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: C.text }}>{f.label}</div>
                      {f.desc ? (
                        <div style={{ fontSize: 9, color: C.hint, marginTop: 3, lineHeight: 1.25 }}>{f.desc}</div>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: f.color, marginTop: 6 }}>
                    {loading ? '...' : f.count}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ENGINE TABLE */}
          <div id="stock-table" style={{background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:8, minHeight:200}}>

            {sectorFilter && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(96,165,250,.08)',
                borderBottom: `1px solid ${C.border}`,
                fontSize: 12,
              }}>
                <i className="ti ti-filter" style={{ color: '#60A5FA', fontSize: 13 }} aria-hidden />
                <span style={{ color: '#60A5FA', fontWeight: 600 }}>Sector: {sectorFilter}</span>
                <span style={{ color: '#475569', fontSize: 11 }}>· {filtered.length} stocks</span>
                <button
                  type="button"
                  onClick={() => {
                    clearHomeBackToSectorsTab()
                    setSectorFilter(null)
                    setPage(0)
                  }}
                  style={{
                    marginLeft: 'auto',
                    background: 'none',
                    border: 'none',
                    color: '#64748B',
                    cursor: 'pointer',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <i className="ti ti-x" style={{ fontSize: 11 }} aria-hidden />
                  Clear
                </button>
              </div>
            )}


            {/* Desktop table */}
            <div className="home-desktop-table">
              <table style={{width:'100%', borderCollapse:'collapse', tableLayout:'fixed'}}>
                <colgroup>
                  <col style={{width:160}}/><col style={{width:100}}/><col style={{width:100}}/>
                  <col style={{width:80}}/><col style={{width:80}}/><col style={{width:90}}/>
                  <col style={{width:80}}/><col style={{width:90}}/><col style={{width:90}}/><col style={{width:90}}/>
                </colgroup>
                <thead>
                  <tr>
                    <TH col="symbol" label={t('screener.table.ticker')}/>
                    <TH col="close" label={t('screener.table.cmp')} right/>
                    <TH col="pct_from_ma" label={t('screener.table.pct30w')} right/>
                    <TH col="rs_rating" label={t('screener.table.rs')} right/>
                    <TH col="volume" label={t('screener.table.volume')} right/>
                    <TH col="delivery" label={t('screener.table.delivery')} right/>
                    <TH col="avg_volume_30d" label={t('screener.table.deliveryVol')} right/>
                    <TH col="price_change_7d" label={t('screener.table.change7d')} right/>
                    <TH col="pledge" label={t('screener.table.pledge')} right/>
                    <TH col="ai_pulse" label={t('screener.table.pulse')} right/>
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array(8).fill(0).map((_,i)=>(
                    <tr key={i}>
                      {Array(10).fill(0).map((_,j)=>(
                        <td key={j} style={{padding:'8px 10px'}}>
                          <div style={{height:12, background:C.border, borderRadius:3,
                            animation:'pulse 1.5s ease infinite', opacity:.5}}/>
                        </td>
                      ))}
                    </tr>
                  )) : paginated.map(s => (
                    <tr key={s.symbol}
                      onClick={()=>navigate('/stock/'+s.symbol)}
                      style={{borderBottom:`1px solid ${C.card}`, cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.card}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'7px 10px'}}>
                        <div style={{display:'flex', alignItems:'center', gap:5}}>
                          <span style={{fontWeight:600, fontSize:12}}>{s.symbol}</span>
                          <StageBadge stage={s.stage}/>
                        </div>
                        <div style={{fontSize:10, color:C.muted, marginTop:1}}>{s.sector}</div>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{fontWeight:600, fontSize:13,
                          color: s.pct_from_ma>5 ? C.green : s.pct_from_ma<-5 ? C.red : C.text}}>
                          ₹{fmt(s.close)}
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{
                          fontSize:12, fontWeight:600, padding:'2px 6px', borderRadius:3,
                          background: s.pct_from_ma>5 ? 'rgba(0,200,5,.1)'
                            : s.pct_from_ma>-3 && s.pct_from_ma<5 ? 'rgba(251,191,36,.1)'
                            : 'rgba(255,59,48,.1)',
                          color: s.pct_from_ma>5 ? C.green
                            : s.pct_from_ma>-3 ? C.amber : C.red
                        }}>
                          {s.pct_from_ma!=null ? fmtPct(s.pct_from_ma) : '—'}
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4}}>
                          <div style={{width:28, height:4, background:C.border, borderRadius:2, overflow:'hidden'}}>
                            <div style={{height:'100%', borderRadius:2,
                              width:(s.rs_rating||0)+'%',
                              background: s.rs_rating>80?C.green:s.rs_rating>60?C.blue:s.rs_rating>40?C.amber:C.red
                            }}/>
                          </div>
                          <span style={{fontSize:12, fontWeight:600, minWidth:22,
                            color: s.rs_rating>80?C.green:s.rs_rating>60?C.blue:s.rs_rating>40?C.amber:C.red}}>
                            {s.rs_rating||'—'}
                          </span>
                        </div>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right', fontSize:12, color:C.muted}}>
                        {fmtVol(s.volume)}
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{fontSize:12, fontWeight: s.delivery>=60?600:400,
                          color: s.delivery>=60?C.green:s.delivery>=40?C.text:C.muted}}>
                          {s.delivery?.toFixed(1)||'—'}%
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right', fontSize:12, color:C.muted}}>
                        {fmtVol(s.avg_volume_30d)}
                        {s.delivery_trend==='rising' && 
                          <span style={{color:C.green, marginLeft:4}}>↑</span>}
                        {s.delivery_trend==='falling' && 
                          <span style={{color:C.red, marginLeft:4}}>↓</span>}
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{fontSize:12, fontWeight:500,
                          color: s.price_change_7d>3?C.green:s.price_change_7d<-3?C.red:C.muted}}>
                          {s.price_change_7d!=null ? fmtPct(s.price_change_7d) : '—'}
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        {s.pledge>0
                          ? <span style={{color:C.red, fontWeight:700, fontSize:12}}>
                              ⚠ {s.pledge.toFixed(1)}%
                            </span>
                          : <span style={{color:C.hint, fontSize:12}}>—</span>
                        }
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <PulseTag pulse={s.ai_pulse}/>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="home-mobile-list">
              {loading ? Array(6).fill(0).map((_,i)=>(
                <div key={i} style={{padding:'12px 14px', borderBottom:`1px solid ${C.border}`}}>
                  <div style={{height:14, background:C.border, borderRadius:3, width:'40%',
                    marginBottom:6, animation:'pulse 1.5s ease infinite'}}/>
                  <div style={{height:10, background:C.border, borderRadius:3, width:'60%',
                    animation:'pulse 1.5s ease infinite'}}/>
                </div>
              )) : paginated.map(s => {
                const pcm = s.pct_from_ma
                const vsMaColor = pcm == null || pcm === ''
                  ? C.textMuted
                  : pcm > 5 ? C.green : pcm > -3 ? C.amber : C.red
                return (
                <div key={s.symbol}
                  onClick={()=>navigate('/stock/'+s.symbol)}
                  className="home-mobile-row flex w-full items-start justify-between gap-2 border-b px-3 py-2"
                  style={{ borderColor: C.border }}
                  onTouchStart={e=>e.currentTarget.style.background=C.card}
                  onTouchEnd={e=>e.currentTarget.style.background='transparent'}>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold" style={{ color: C.text }}>{s.symbol}</span>
                      <StageBadge stage={s.stage} />
                      {s.pledge > 0 ? (
                        <span className="shrink-0 text-[9px] font-bold" style={{ color: C.red }} aria-hidden>⚠</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs" style={{ color: C.textMuted }}>{s.sector}</p>
                    <p className="mt-0.5 text-xs" style={{ color: vsMaColor }}>
                      {s.pct_from_ma != null ? `${fmtPct(s.pct_from_ma)} vs MA` : '—'}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold" style={{ color: C.text }}>₹{fmt(s.close)}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>
                      {s.delivery?.toFixed(1) || '—'}% del
                    </p>
                  </div>
                </div>
                )
              })}
            </div>

            {/* Pagination */}
            {totalPages>1 && (
              <div
                className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 text-xs sm:text-sm"
                style={{
                  padding: '8px 12px',
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                <button
                  type="button"
                  onClick={()=>setPage(p=>Math.max(0,p-1))}
                  disabled={page===0}
                  className="shrink-0"
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 4,
                    padding: '4px 10px',
                    color: page === 0 ? C.hint : C.text,
                    cursor: page === 0 ? 'default' : 'pointer',
                    fontSize: 'inherit',
                  }}
                >
                  ← {t('screener.pagination.prev')}
                </button>
                <span
                  className="min-w-0 flex-1 text-center sm:flex-none"
                  style={{
                    fontSize: 'inherit',
                    color: C.muted,
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                  }}
                >
                  <span className="block sm:inline">{page + 1} / {totalPages}</span>
                  <span className="hidden sm:inline"> · </span>
                  <span className="block sm:inline">{filtered.length} {t('screener.tabs.stocks').toLowerCase()}</span>
                </span>
                <button
                  type="button"
                  onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))}
                  disabled={page>=totalPages-1}
                  className="shrink-0"
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 4,
                    padding: '4px 10px',
                    color: page >= totalPages - 1 ? C.hint : C.text,
                    cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                    fontSize: 'inherit',
                  }}
                >
                  {t('screener.pagination.next')} →
                </button>
              </div>
            )}
          </div>
            </>
          )}

          {homeTab==='sectors' && (
          <div style={{background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:8, overflow:'hidden'}}>
            <div style={{padding:'10px 12px', borderBottom:`1px solid ${C.border}`,
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:12, flexWrap:'wrap'}}>
              <span style={{fontSize:11, fontWeight:600, color:C.muted,
                textTransform:'uppercase', letterSpacing:'0.07em'}}>
                {t('screener.tabs.sectors')}
              </span>
              <div style={{display:'flex', gap:4, flexWrap:'wrap', alignItems:'center'}}>
                {['1D','1W','1M','3M'].map(tf=>(
                  <button key={tf} onClick={()=>setSectorTf(tf)}
                    style={{fontSize:11, padding:'3px 8px', borderRadius:4,
                      border:`1px solid ${C.border}`,
                      background: sectorTf===tf ? C.border : 'transparent',
                      color: sectorTf===tf ? C.text : C.muted,
                      cursor:'pointer'}}>
                    {tf}
                  </button>
                ))}
                <button
                  onClick={() => setShowSectorShare(true)}
                  disabled={sortedSectors.length === 0}
                  style={{
                    fontSize:11, padding:'3px 9px', borderRadius:4,
                    border:'1px solid rgba(56,189,248,0.3)',
                    background:'rgba(56,189,248,0.08)', color:'#38BDF8',
                    cursor:'pointer', display:'flex', alignItems:'center', gap:4,
                    opacity: sortedSectors.length === 0 ? 0.4 : 1,
                  }}
                >
                  <i className="ti ti-share" style={{fontSize:10}} />
                  {t('screener.sectorShare')}
                </button>
              </div>
            </div>
            {sortedSectors.length===0 ? (
              <div style={{padding:16, color:C.hint, fontSize:12, textAlign:'center'}}>
                No sector data available
              </div>
            ) : (
              <div style={{
                display:'grid',
                gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',
                gap:8,
                padding:12,
              }}>
                {sortedSectors.map(sec=>{
                  const chg = sec[sectorKey]
                  const isPos = (chg||0)>=0
                  const rowKey = sec.index_name || sec.display_name || ''
                  const isHover = sectorRowHover === rowKey
                  const sectorTitle = sec.display_name || sec.index_name || ''
                  return (
                    <div
                      key={rowKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSectorClick(sectorTitle)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSectorClick(sectorTitle)
                        }
                      }}
                      onMouseEnter={() => setSectorRowHover(rowKey)}
                      onMouseLeave={() => setSectorRowHover(null)}
                      style={{
                        padding:'10px 12px',
                        border:`1px solid ${isHover ? 'rgba(96,165,250,.35)' : C.border}`,
                        borderRadius:8,
                        background: isHover ? 'rgba(96,165,250,.05)' : C.card,
                        display:'flex', alignItems:'center', gap:10,
                        cursor:'pointer',
                        transition: 'background .12s, border-color .12s',
                      }}
                    >
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:12, color:C.text, fontWeight:500,
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                          {sectorTitle}
                        </div>
                        <div style={{width:'100%', height:4, background:C.border,
                          borderRadius:2, marginTop:6, overflow:'hidden'}}>
                          <div style={{height:'100%', borderRadius:2,
                            background: isPos ? C.green : C.red,
                            width: Math.min(Math.abs(chg||0)*8, 100)+'%'}}/>
                        </div>
                      </div>
                      <i
                        className="ti ti-arrow-right"
                        style={{
                          fontSize: 10,
                          color: '#60A5FA',
                          opacity: isHover ? 1 : 0,
                          transition: 'opacity .12s',
                          flexShrink: 0,
                        }}
                        aria-hidden
                      />
                      <span style={{fontSize:13, fontWeight:700, flexShrink:0, minWidth:56,
                        textAlign:'right', fontFamily:'DM Mono,monospace',
                        color: isPos ? C.green : C.red}}>
                        {chg!=null ? (isPos?'+':'')+chg.toFixed(2)+'%' : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100%{opacity:.4} 50%{opacity:.7}
        }
        input::placeholder{color:#475569}
        input:focus{border-color:#2D3748!important}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1E2530;border-radius:2px}
        .home-topbar::-webkit-scrollbar{display:none}
        @media (min-width: 768px) {
          .topbar-divider-md { display: block !important; }
        }
      `}</style>

      {/* Mobile footer links — hidden on md+ where sidebar shows */}
      <div className="md:hidden" style={{ borderTop: '1px solid #1E2530', padding: '12px 16px', display: 'flex', gap: 20 }}>
        {[['About', '/about'], ['Privacy', '/privacy'], ['Terms', '/terms']].map(([label, path]) => (
          <button key={path} type="button" onClick={() => navigate(path)}
            style={{ background: 'none', border: 'none', color: '#475569', fontSize: 12, cursor: 'pointer', padding: 0 }}>
            {label}
          </button>
        ))}
      </div>

      {/* Sector share modal */}
      {showSectorShare && (
        <SectorShareModal
          sectors={sortedSectors}
          onClose={() => setShowSectorShare(false)}
        />
      )}

      {/* Auth prompt modal */}
      {showAuthPrompt && (
        <div
          onClick={() => setShowAuthPrompt(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: 72,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0F1217', borderRadius: 16,
              border: '1px solid #1E2530',
              padding: '28px 24px 24px',
              width: '100%', maxWidth: 360,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              textAlign: 'center',
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="ti ti-lock" style={{ fontSize: 22, color: '#60A5FA' }} />
            </div>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#E2E8F0' }}>{t('screener.locked')}</p>
            <p style={{ margin: 0, fontSize: 13, color: '#64748B', lineHeight: 1.5 }}>
              {t('screener.lockedDesc')}
            </p>
            <button
              onClick={() => navigate('/login')}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                background: '#60A5FA', color: '#0B0E11', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 4,
              }}
            >Sign in</button>
            <button
              onClick={() => navigate('/register')}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                border: '1px solid #1E2530', background: 'transparent',
                color: '#E2E8F0', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}
            >Create free account</button>
          </div>
        </div>
      )}
    </div>
  )
}
