import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import InfoHint from '../components/InfoHint'

/* ═══ Design tokens — Bloomberg / Koyfin terminal ═══ */
const BG = '#0B0E11'
const SURFACE = '#0F1217'
const BORDER = '#1E2530'
const TEXT = '#E2E8F0'
const MUTED = '#64748B'
const GREEN = '#00C805'
const RED = '#FF3B30'
const BLUE = '#60A5FA'
const AMBER = '#FBBF24'

const ROWS_PER_PAGE = 15

const PULSEKeyframes = `@keyframes homeTerminalPulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 0.7 } }`

function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280))
  useEffect(() => {
    const onR = () => setW(window.innerWidth)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  return w
}

function formatIN(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function formatIntComma(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Math.round(Number(n)).toLocaleString('en-IN')
}

function formatEodSync(dateStr) {
  if (!dateStr) return '—'
  const raw = String(dateStr).slice(0, 10)
  const d = new Date(`${raw}T12:00:00`)
  if (Number.isNaN(d.getTime())) return raw
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const t = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
  return `${day}, ${t} IST`
}

function formatVol(n) {
  const v = Number(n)
  if (!v || !Number.isFinite(v)) return '—'
  if (v >= 10000000) return `${(v / 10000000).toFixed(1)} Cr`
  if (v >= 100000) return `${(v / 100000).toFixed(1)}L`
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`
  return String(Math.round(v))
}

/** Filter/search only; Home table applies column sort separately. */
function applyStockFilters(stocks, filter, search) {
  let result = [...stocks]

  const qRaw = typeof search === 'string' ? search.trim() : ''

  // Search applies across the entire engine universe, not only the active tab preset.
  if (qRaw) {
    const q = qRaw.toLowerCase()
    return result.filter(
      (s) =>
        (s.symbol && s.symbol.toLowerCase().includes(q)) ||
        (s.sector || '').toLowerCase().includes(q) ||
        (s.industry || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q),
    )
  }

  if (filter === 'breakout') {
    result = result.filter((s) => s.stage === 'Stage 2')
  } else if (filter === 'delivery') {
    result = result.filter((s) => s.delivery != null && s.delivery > 55)
  } else if (filter === 'clean') {
    result = result.filter((s) => (!s.pledge || s.pledge === 0) && s.rs_rating > 50)
  }

  return result
}

/** Filter + RS sort (standalone helper matching product spec; table sorts via headers). */
// eslint-disable-next-line no-unused-vars -- kept for parity with documented `applyFilter` API
function applyFilter(stocks, filter, search) {
  const result = applyStockFilters(stocks, filter, search)
  return result.sort((a, b) => (b.rs_rating || 0) - (a.rs_rating || 0))
}

function stageBadgeMeta(stageRaw) {
  const s = String(stageRaw || '')
  if (s.includes('2')) {
    return { bg: 'rgba(0,200,5,.12)', color: GREEN, border: 'rgba(0,200,5,.25)', short: 'S2' }
  }
  if (s.includes('1')) {
    return { bg: 'rgba(96,165,250,.12)', color: BLUE, border: 'rgba(96,165,250,.25)', short: 'S1' }
  }
  if (s.includes('3')) {
    return { bg: 'rgba(251,191,36,.12)', color: AMBER, border: 'rgba(251,191,36,.25)', short: 'S3' }
  }
  if (s.includes('4')) {
    return { bg: 'rgba(255,59,48,.12)', color: RED, border: 'rgba(255,59,48,.25)', short: 'S4' }
  }
  return { bg: 'rgba(100,116,139,.12)', color: MUTED, border: 'rgba(100,116,139,.25)', short: '—' }
}

function rsBarColor(rs) {
  if (rs >= 80) return GREEN
  if (rs >= 60) return BLUE
  if (rs >= 40) return AMBER
  return RED
}

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const vw = useViewportWidth()
  const isMobile = vw < 768
  const isTablet = vw >= 768 && vw <= 1200
  /** Vol/50D removed; desktop adds DEL VOL between Del % and pledge */
  const tableColCount = isMobile ? 4 : isTablet ? 7 : 8

  const [loading, setLoading] = useState(true)
  const [internals, setInternals] = useState(null)
  const [nifty50Row, setNifty50Row] = useState(null)
  const [nifty500Row, setNifty500Row] = useState(null)
  const [tableRows, setTableRows] = useState([])
  const [syncLabel, setSyncLabel] = useState('—')

  const [cardCounts, setCardCounts] = useState({ breakout: null, delivery: null, clean: null })

  const [filterKey, setFilterKey] = useState('breakout')
  const [searchQ, setSearchQ] = useState('')
  const [sortKey, setSortKey] = useState('rs')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  /** Set when Supabase env is missing or engine queries fail (e.g. RLS — Netlify build env). */
  const [dataIssue, setDataIssue] = useState(null)

  const activeNav = location.pathname

  useEffect(() => {
    queueMicrotask(() => {
      if (filterKey === 'breakout') {
        setSortKey('rs')
        setSortDir('desc')
      } else if (filterKey === 'delivery') {
        setSortKey('delivery')
        setSortDir('desc')
      } else {
        setSortKey('rs')
        setSortDir('desc')
      }
      setPage(1)
    })
  }, [filterKey])

  useEffect(() => {
    const fetchAll = async () => {
      if (!hasSupabaseEnv) {
        setDataIssue({
          kind: 'config',
          message:
            'Supabase credentials are missing from this deployment. In Netlify: Site settings → Environment variables → expose for Builds: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, or SUPABASE_URL + SUPABASE_ANON_KEY, then Clear cache and deploy.',
        })
        setTableRows([])
        setLoading(false)
        return
      }
      setDataIssue(null)
      setLoading(true)
      try {
        const latestDateRes = await supabase.from('delivery_signals').select('date').order('date', { ascending: false }).limit(1).maybeSingle()

        if (latestDateRes.error) {
          console.warn('[Home] delivery_signals latest date:', latestDateRes.error)
        }

        const latestDate = latestDateRes.data

        const [
          companiesRes,
          pricesRes,
          deliveryRes,
          shareholdingRes,
          marketRes,
          n50Res,
          n500Res,
        ] = await Promise.all([
          supabase
            .from('companies')
            .select('id, symbol, name, sector, industry')
            .eq('is_suspended', false)
            .order('symbol')
            .limit(600),

          supabase
            .from('price_data')
            .select('company_id, close, stage, rs_vs_nifty, rsi, ma30w, ma30w_slope, obv_slope, breakout_52w, high_52w, low_52w, volume')
            .eq('is_latest', true)
            .limit(600),

          latestDate?.date != null
            ? supabase
                .from('delivery_signals')
                .select('company_id, avg_delivery_30d, delivery_trend_30d, avg_volume_30d, price_change_30d')
                .eq('date', latestDate.date)
                .limit(600)
            : Promise.resolve({ data: [], error: null }),

          supabase.from('shareholding').select('company_id, promoter_pledge_pct').order('quarter', { ascending: false }).limit(600),

          supabase.from('market_internals').select('*').order('date', { ascending: false }).limit(1),

          supabase.from('nifty_sectors').select('*').eq('index_name', 'Nifty 50').order('date', { ascending: false }).limit(1).maybeSingle(),

          supabase.from('nifty_sectors').select('*').eq('index_name', 'Nifty 500').order('date', { ascending: false }).limit(1).maybeSingle(),
        ])

        const queryErrors = [companiesRes, pricesRes, deliveryRes, shareholdingRes].filter((r) => r?.error)
        if (queryErrors.length > 0) {
          const lines = queryErrors.map((r) => r.error?.message || String(r.error)).filter(Boolean)
          const msg =
            lines.length > 0
              ? lines.join(' · ')
              : 'Could not load market data — check Supabase RLS policies for anonymous read access to companies / price_data / delivery_signals.'
          console.error('[Home] Supabase:', queryErrors.map((r) => r.error))
          setDataIssue({ kind: 'query', message: msg })
          setTableRows([])
          return
        }

        const companies = companiesRes?.data ?? []
        const prices = pricesRes?.data ?? []
        const delivery = deliveryRes?.data ?? []
        const shareholding = shareholdingRes?.data ?? []
        const marketRows = marketRes?.data ?? []

        console.log('companies:', companies?.length)
        console.log('prices:', prices?.length)
        console.log('delivery:', delivery?.length)

        const priceMap = {}
        prices?.forEach((p) => {
          priceMap[p.company_id] = p
        })

        const deliveryMap = {}
        delivery?.forEach((d) => {
          if (!deliveryMap[d.company_id]) {
            deliveryMap[d.company_id] = d
          }
        })

        const pledgeMap = {}
        shareholding?.forEach((s) => {
          if (!pledgeMap[s.company_id]) {
            pledgeMap[s.company_id] = s
          }
        })

        const merged = (companies || [])
          .map((c) => {
            const p = priceMap[c.id] || {}
            const d = deliveryMap[c.id] || {}
            const sh = pledgeMap[c.id] || {}
            const obv = p.obv_slope != null ? Number(p.obv_slope) : null
            let aiLabel = 'Neutral'
            if (p.stage === 'Stage 2' && obv != null && obv > 0.01) aiLabel = 'Bullish'
            else if (p.stage === 'Stage 4' || (obv != null && obv < -0.02)) aiLabel = 'Warning'

            return {
              ...c,
              company_id: c.id,
              symbol: String(c.symbol || '').toUpperCase(),
              industry: String(c.industry || '').trim(),
              close: p.close,
              stage: p.stage,
              rs_vs_nifty: p.rs_vs_nifty,
              rsi: p.rsi,
              ma30w: p.ma30w,
              ma30w_slope: p.ma30w_slope,
              obv_slope: p.obv_slope,
              breakout_52w: p.breakout_52w,
              high_52w: p.high_52w,
              low_52w: p.low_52w,
              volume: p.volume,
              delivery: d.avg_delivery_30d != null ? Number(d.avg_delivery_30d) : null,
              delivery_trend: d.delivery_trend_30d,
              pledge: sh.promoter_pledge_pct ?? 0,
              pct_from_ma: p.close && p.ma30w ? ((p.close - p.ma30w) / p.ma30w) * 100 : null,
              ai_pulse:
                aiLabel === 'Bullish'
                  ? { key: 'bullish', label: 'Bullish' }
                  : aiLabel === 'Warning'
                    ? { key: 'warn', label: 'Warning' }
                    : { key: 'neutral', label: 'Neutral' },
              avg_delivery_30d: d.avg_delivery_30d != null ? Number(d.avg_delivery_30d) : null,
              avg_volume_30d: d.avg_volume_30d != null ? Number(d.avg_volume_30d) : null,
              delivery_trend_30d: d.delivery_trend_30d ?? '',
              pct_ma: p.close && p.ma30w ? ((p.close - p.ma30w) / p.ma30w) * 100 : null,
            }
          })
          .filter((c) => c.close != null)

        console.log('merged:', merged.length)

        const rsValues = merged
          .filter((r) => r.rs_vs_nifty != null)
          .map((r) => r.rs_vs_nifty)
          .sort((a, b) => a - b)

        const withRatings = merged.map((s) => ({
          ...s,
          rs_rating:
            s.rs_vs_nifty != null && rsValues.length
              ? Math.max(
                  1,
                  Math.round((rsValues.filter((v) => v <= s.rs_vs_nifty).length / rsValues.length) * 99),
                )
              : null,
        }))

        setTableRows(withRatings)
        if (withRatings.length === 0) {
          setDataIssue({
            kind: 'empty',
            message:
              'No priced stocks returned (companies × latest price_data). Ensure EOD jobs populate price_data.is_latest rows and IDs match companies.id.',
          })
        } else {
          setDataIssue(null)
        }

        const marketData = marketRows
        setInternals(marketData?.[0] || null)
        setNifty50Row(n50Res.data || null)
        setNifty500Row(n500Res.data || null)
        setSyncLabel(formatEodSync(marketData?.[0]?.date))

        setCardCounts({
          breakout: withRatings.filter((s) => s.stage === 'Stage 2').length,
          delivery: withRatings.filter((s) => s.delivery != null && s.delivery > 55).length,
          clean: withRatings.filter((s) => (!s.pledge || s.pledge === 0) && s.rs_rating > 50).length,
        })
      } catch (err) {
        console.error('fetchAll error:', err)
        setDataIssue({
          kind: 'query',
          message: err?.message ?? 'Unexpected error loading stocks — see browser console.',
        })
        setTableRows([])
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  const sortedFiltered = useMemo(() => {
    let r = applyStockFilters(tableRows, filterKey, searchQ)

    const dirMul = sortDir === 'asc' ? 1 : -1
    const cmpNum = (a, b, getter) => {
      const na = getter(a)
      const nb = getter(b)
      const fa = Number.isFinite(na) ? na : sortDir === 'desc' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
      const fb = Number.isFinite(nb) ? nb : sortDir === 'desc' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
      if (fa !== fb) return (fa - fb) * dirMul
      return a.symbol.localeCompare(b.symbol)
    }
    const cmpStr = (a, b, getter) => getter(a).localeCompare(getter(b)) * dirMul

    r.sort((a, b) => {
      switch (sortKey) {
        case 'ticker':
          return cmpStr(a, b, (x) => x.symbol)
        case 'cmp':
          return cmpNum(a, b, (x) => Number(x.close))
        case 'pct_ma':
          return cmpNum(a, b, (x) => x.pct_ma)
        case 'rs':
          return cmpNum(a, b, (x) => x.rs_rating)
        case 'delivery':
          return cmpNum(a, b, (x) => Number(x.avg_delivery_30d))
        case 'del_vol':
          return cmpNum(a, b, (x) => Number(x.avg_volume_30d))
        case 'pledge':
          return cmpNum(a, b, (x) => (x.pledge == null ? -1 : x.pledge))
        case 'pulse': {
          const order = { bullish: 3, neutral: 2, warn: 1 }
          const va = order[a.ai_pulse?.key] ?? 0
          const vb = order[b.ai_pulse?.key] ?? 0
          if (va !== vb) return (va - vb) * dirMul
          return a.symbol.localeCompare(b.symbol)
        }
        default:
          return 0
      }
    })

    return r
  }, [tableRows, searchQ, filterKey, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / ROWS_PER_PAGE))
  const pageClamped = Math.min(page, totalPages)
  const pageRows = useMemo(() => {
    const p0 = Math.max(0, (pageClamped - 1) * ROWS_PER_PAGE)
    return sortedFiltered.slice(p0, p0 + ROWS_PER_PAGE)
  }, [sortedFiltered, pageClamped])

  const onSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'ticker' || key === 'pulse' ? 'asc' : 'desc')
    }
  }, [sortKey])

  const niftyChg = useMemo(() => {
    const d = internals
    if (!d) return null
    const keys = ['nifty_change_pct', 'nifty_1d_change_pct', 'nifty_daily_change_pct', 'nifty_change_1d']
    for (const k of keys) {
      const v = d[k]
      if (v != null && Number.isFinite(Number(v))) return Number(v)
    }
    return null
  }, [internals])

  const nifty50Val = nifty50Row?.current_value ?? internals?.nifty_close
  const nifty50Chg = Number.isFinite(Number(nifty50Row?.change_1d)) ? Number(nifty50Row.change_1d) : niftyChg

  const nifty500Val = nifty500Row?.current_value
  const nifty500Chg = Number.isFinite(Number(nifty500Row?.change_1d)) ? Number(nifty500Row.change_1d) : null

  const vix = internals?.india_vix
  const vixNum = Number(vix)
  const vixColor = Number.isFinite(vixNum) ? (vixNum < 15 ? GREEN : vixNum <= 20 ? AMBER : RED) : MUTED

  const breadthPct = internals?.above_ma150_pct != null ? Number(internals.above_ma150_pct) : null
  const stage2pct = internals?.stage2_pct != null ? Number(internals.stage2_pct) : 0
  const regimeGreen = stage2pct > 40

  const divider = (
    <div style={{ width: 1, height: 20, background: BORDER, flexShrink: 0 }} aria-hidden />
  )

  const topbarItem = (label, valueNode, subNode, extra = null) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {valueNode}
        {subNode}
        {extra}
      </div>
    </div>
  )

  const headerBtn = (icon, path, title) => {
    const active = path === '/' ? activeNav === '/' : activeNav === path || activeNav.startsWith(`${path}/`)
    return (
      <button
        type="button"
        title={title}
        onClick={() => navigate(path)}
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: active ? '#1E2530' : 'transparent',
          color: active ? TEXT : MUTED,
        }}
      >
        <i className={`ti ti-${icon}`} style={{ fontSize: 18 }} />
      </button>
    )
  }

  const sortHeaderStyle = (key) => ({
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: sortKey === key ? TEXT : MUTED,
    fontWeight: 400,
    padding: '6px 10px',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  })

  return (
    <div
      style={{
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: BG,
        fontFamily: '"DM Sans", system-ui, sans-serif',
        fontSize: 13,
        color: TEXT,
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      <style>{`${PULSEKeyframes}`}</style>

      {/* Sidebar */}
      {!isMobile ? (
        <aside
          style={{
            width: 52,
            flexShrink: 0,
            background: SURFACE,
            borderRight: `1px solid ${BORDER}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 8,
            paddingBottom: 8,
            gap: 6,
          }}
        >
          <button
            type="button"
            title="PineX"
            onClick={() => navigate('/')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              color: GREEN,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <i className="ti ti-wave-sine" style={{ fontSize: 18 }} />
          </button>
          {headerBtn('home', '/', 'Home')}
          {headerBtn('layout-grid', '/heatmap', 'Heatmap')}
          {headerBtn('bookmark', '/dashboard', 'Watchlist')}
          {headerBtn('briefcase', '/dashboard', 'Portfolio')}
          <button
            type="button"
            title="Alerts"
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              color: MUTED,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <i className="ti ti-bell" style={{ fontSize: 18 }} />
          </button>
          <div style={{ flex: 1 }} />
          {headerBtn('settings', '/admin', 'Admin')}
        </aside>
      ) : null}

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Market regime topbar */}
        <header
          style={{
            height: 40,
            flexShrink: 0,
            background: SURFACE,
            borderBottom: `1px solid ${BORDER}`,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '0 16px',
          }}
        >
          {loading
            ? topbarItem(
                'NIFTY 50',
                <span style={{ fontSize: 14, fontWeight: 600 }}>—</span>,
                <span style={{ fontSize: 12, color: MUTED }}>—</span>,
              )
            : topbarItem(
                'NIFTY 50',
                <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 600 }}>
                  {formatIntComma(nifty50Val)}
                </span>,
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      nifty50Chg != null && Number.isFinite(nifty50Chg)
                        ? nifty50Chg >= 0
                          ? GREEN
                          : RED
                        : MUTED,
                  }}
                >
                  {nifty50Chg != null && Number.isFinite(nifty50Chg)
                    ? `${nifty50Chg >= 0 ? '+' : ''}${nifty50Chg.toFixed(2)}%`
                    : '—'}
                </span>,
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: regimeGreen ? 'rgba(0,200,5,.12)' : 'rgba(96,165,250,.12)',
                    color: regimeGreen ? GREEN : BLUE,
                    border: `1px solid ${regimeGreen ? 'rgba(0,200,5,.25)' : 'rgba(96,165,250,.25)'}`,
                  }}
                >
                  {regimeGreen ? 'STAGE 2' : 'STAGE 1'}
                </span>,
              )}
          {divider}
          {loading
            ? topbarItem('NIFTY 500', <span style={{ fontWeight: 600 }}>—</span>, <span style={{ color: MUTED }}>—</span>)
            : topbarItem(
                'NIFTY 500',
                <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 600 }}>
                  {nifty500Val != null ? formatIntComma(nifty500Val) : internals?.above_ma150_pct != null ? `${Number(internals.above_ma150_pct).toFixed(1)}%` : '—'}
                </span>,
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      nifty500Chg != null && Number.isFinite(nifty500Chg)
                        ? nifty500Chg >= 0
                          ? GREEN
                          : RED
                        : MUTED,
                  }}
                >
                  {nifty500Chg != null && Number.isFinite(nifty500Chg)
                    ? `${nifty500Chg >= 0 ? '+' : ''}${nifty500Chg.toFixed(2)}%`
                    : ''}
                </span>,
              )}
          {divider}
          {loading
            ? topbarItem(
                <span className="flex items-center gap-1" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
                  INDIA VIX
                  <InfoHint id="india_vix" size={11} />
                </span>,
                <span>—</span>,
                null,
              )
            : topbarItem(
                <span className="flex items-center gap-1" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
                  INDIA VIX
                  <InfoHint id="india_vix" size={11} />
                </span>,
                <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: vixColor }}>
                  {Number.isFinite(vixNum) ? vixNum.toFixed(1) : '—'}
                </span>,
                <span style={{ fontSize: 11, color: MUTED }}>{internals?.vix_level != null ? String(internals.vix_level) : ''}</span>,
              )}
          {divider}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span
              className="flex items-center gap-1"
              style={{ fontSize: 10, color: MUTED, letterSpacing: '0.05em', textTransform: 'uppercase' }}
            >
              Breadth above 30W MA
              <InfoHint id="market_breadth" size={11} />
            </span>
            <div
              style={{
                width: 120,
                height: 6,
                background: BG,
                borderRadius: 2,
                overflow: 'hidden',
                border: `1px solid ${BORDER}`,
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, breadthPct != null && Number.isFinite(breadthPct) ? breadthPct : 0)}%`,
                  height: '100%',
                  background: GREEN,
                }}
              />
            </div>
            <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 600 }}>
              {breadthPct != null && Number.isFinite(breadthPct) ? `${breadthPct.toFixed(1)}%` : '—'}
            </span>
            {!loading && internals?.new_52w_highs != null ? (
              <span className="flex items-center gap-1 tabular-nums" style={{ fontSize: 11, color: TEXT }}>
                <span style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>52W H</span>
                <InfoHint id="new_52w_highs" size={11} />
                <span style={{ fontWeight: 600 }}>{internals.new_52w_highs}</span>
              </span>
            ) : null}
            {!loading && internals?.new_52w_lows != null ? (
              <span className="flex items-center gap-1 tabular-nums" style={{ fontSize: 11, color: TEXT }}>
                <span style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>52W L</span>
                <InfoHint id="new_52w_lows" size={11} />
                <span style={{ fontWeight: 600 }}>{internals.new_52w_lows}</span>
              </span>
            ) : null}
            {!loading && internals?.market_health_score != null && Number.isFinite(Number(internals.market_health_score)) ? (
              <span className="flex items-center gap-1 tabular-nums" style={{ fontSize: 11, color: TEXT }}>
                <span style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Health</span>
                <InfoHint id="health_score" size={11} />
                <span style={{ fontWeight: 600 }}>{Number(internals.market_health_score).toFixed(0)}</span>
              </span>
            ) : null}
            {!loading && internals?.divergence_active ? (
              <span className="flex items-center gap-1" style={{ fontSize: 10, fontWeight: 700, color: RED, textTransform: 'uppercase' }}>
                Div
                <InfoHint id="divergence" size={11} />
              </span>
            ) : null}
          </div>
          <span style={{ fontSize: 11, color: MUTED }}>
            Updated{' '}
            {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
          </span>
        </header>

        {/* Scroll body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Quick-scan cards */}
          <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8 }}>
            {[
              {
                k: 'breakout',
                icon: 'trending-up',
                color: GREEN,
                title: 'Stage 2 breakouts',
                desc: 'Price > 30W MA with volume spike',
                count: cardCounts.breakout,
                countColor: GREEN,
              },
              {
                k: 'delivery',
                icon: 'package',
                color: BLUE,
                title: 'High delivery pullbacks',
                desc: 'Delivery avg >55%',
                count: cardCounts.delivery,
                countColor: BLUE,
              },
              {
                k: 'clean',
                icon: 'shield-check',
                color: AMBER,
                title: 'Clean promoters',
                desc: 'Zero pledge + rising institutional',
                count: cardCounts.clean,
                countColor: AMBER,
              },
            ].map((card) => (
              <button
                key={card.k}
                type="button"
                onClick={() => setFilterKey(card.k)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  background: SURFACE,
                  border: `1px solid ${filterKey === card.k ? GREEN : BORDER}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  color: TEXT,
                }}
                onMouseEnter={(e) => {
                  if (filterKey !== card.k) e.currentTarget.style.borderColor = '#2D3748'
                }}
                onMouseLeave={(e) => {
                  if (filterKey !== card.k) e.currentTarget.style.borderColor = BORDER
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: `${card.color}22`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: card.color,
                      flexShrink: 0,
                    }}
                  >
                    <i className={`ti ti-${card.icon}`} style={{ fontSize: 16 }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{card.title}</div>
                    <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.35 }}>{card.desc}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: card.countColor, marginTop: 6 }}>
                      {loading ? '…' : card.count != null ? card.count : '—'}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Engine table */}
          <div
            style={{
              flex: 1,
              margin: '8px 16px 12px',
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              minHeight: 280,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: 36,
                flexShrink: 0,
                borderBottom: `1px solid ${BORDER}`,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                gap: 8,
              }}
            >
              <div style={{ position: 'relative', width: 220 }}>
                <i
                  className="ti ti-search"
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 14,
                    color: MUTED,
                    pointerEvents: 'none',
                  }}
                />
                <input
                  value={searchQ}
                  onChange={(e) => {
                    setSearchQ(e.target.value)
                    setPage(1)
                  }}
                  placeholder="Search all stocks (ticker, name, sector)…"
                  style={{
                    width: '100%',
                    background: BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 4,
                    padding: '4px 8px 4px 28px',
                    fontSize: 12,
                    color: TEXT,
                    outline: 'none',
                  }}
                />
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>EOD sync: {syncLabel}</span>
            </div>

            {!loading && dataIssue ? (
              <div
                style={{
                  flexShrink: 0,
                  padding: '8px 12px',
                  borderBottom: `1px solid ${BORDER}`,
                  background: dataIssue.kind === 'config' ? 'rgba(251,191,36,.12)' : 'rgba(239,68,68,.08)',
                  color: dataIssue.kind === 'config' ? AMBER : '#FCA5A5',
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
                role="status"
              >
                {dataIssue.message}
              </div>
            ) : null}

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <th style={{ ...sortHeaderStyle('ticker'), width: isMobile ? 140 : 160 }} onClick={() => onSort('ticker')}>
                      Ticker ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('cmp'), width: 90, textAlign: 'right' }} onClick={() => onSort('cmp')}>
                      CMP ⇅
                    </th>
                    <th
                      style={{ ...sortHeaderStyle('pct_ma'), width: isMobile ? 76 : 90, textAlign: 'right' }}
                      onClick={() => onSort('pct_ma')}
                    >
                      <span className="inline-flex w-full items-center justify-end gap-0.5">
                        <span>%30W ⇅</span>
                        <InfoHint id="ma30w" size={11} />
                      </span>
                    </th>
                    <th style={{ ...sortHeaderStyle('rs'), width: 70, textAlign: 'right' }} onClick={() => onSort('rs')}>
                      <span className="inline-flex w-full items-center justify-end gap-0.5">
                        <span>RS ⇅</span>
                        <InfoHint id="rs_rating" size={11} />
                      </span>
                    </th>
                    {!isMobile ? (
                      <th
                        style={{ ...sortHeaderStyle('delivery'), width: 80, textAlign: 'right' }}
                        onClick={() => onSort('delivery')}
                      >
                        <span className="inline-flex w-full items-center justify-end gap-0.5">
                          <span>Del % ⇅</span>
                          <InfoHint id="delivery_pct" size={11} />
                        </span>
                      </th>
                    ) : null}
                    {!isMobile ? (
                      <th
                        style={{ ...sortHeaderStyle('del_vol'), width: 90, textAlign: 'right' }}
                        onClick={() => onSort('del_vol')}
                      >
                        <span className="inline-flex w-full items-center justify-end gap-0.5">
                          <span className="whitespace-normal text-right leading-tight">DEL VOL (30D AVG) ⇅</span>
                          <InfoHint id="delivery_volume" size={11} />
                        </span>
                      </th>
                    ) : null}
                    {!isMobile && !isTablet ? (
                      <th
                        style={{ ...sortHeaderStyle('pledge'), width: 80, textAlign: 'right' }}
                        onClick={() => onSort('pledge')}
                      >
                        <span className="inline-flex w-full items-center justify-end gap-0.5">
                          <span>Pledge ⇅</span>
                          <InfoHint id="promoter_pledge" size={11} />
                        </span>
                      </th>
                    ) : null}
                    {!isMobile ? (
                      <th style={{ ...sortHeaderStyle('pulse'), width: 80, textAlign: 'right' }} onClick={() => onSort('pulse')}>
                        <span className="inline-flex w-full items-center justify-end gap-0.5">
                          <span>AI pulse ⇅</span>
                          <InfoHint
                            title="AI Pulse"
                            body="Rule-based signal from stage, OBV trend, and delivery pattern. Bullish = Stage 2 with rising OBV. Warning = Stage 4 or falling OBV. Neutral = mixed signals."
                            size={11}
                          />
                        </span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: ROWS_PER_PAGE }).map((_, i) => (
                        <tr key={`sk-${i}`} style={{ height: 32, borderBottom: `1px solid #141820` }}>
                          <td colSpan={tableColCount} style={{ padding: '4px 10px' }}>
                            <div
                              style={{
                                height: 14,
                                borderRadius: 4,
                                background: '#1a1f27',
                                animation: 'homeTerminalPulse 1.2s ease-in-out infinite',
                              }}
                            />
                          </td>
                        </tr>
                      ))
                    : pageRows.map((row) => {
                        const sb = stageBadgeMeta(row.stage)
                        const pct = row.pct_ma
                        let pctColor = MUTED
                        if (pct != null && Number.isFinite(pct)) {
                          if (pct >= -3 && pct <= 5) pctColor = MUTED
                          else if (pct > 5) pctColor = GREEN
                          else pctColor = RED
                        }
                        const rs = row.rs_rating
                        const del = row.avg_delivery_30d
                        const pulse = row.ai_pulse ?? { key: 'neutral', label: 'Neutral' }
                        const delTrend = String(row.delivery_trend_30d ?? '')
                          .toLowerCase()
                          .trim()
                        const volFormatted = formatVol(row.avg_volume_30d)
                        const volNumColor = volFormatted === '—' ? MUTED : delTrend === 'rising' ? GREEN : TEXT
                        let delVolArrow = '\u2192'
                        let delVolArrowColor = MUTED
                        if (delTrend === 'rising') {
                          delVolArrow = '\u2191'
                          delVolArrowColor = GREEN
                        } else if (delTrend === 'falling') {
                          delVolArrow = '\u2193'
                          delVolArrowColor = RED
                        }

                        const pctDisp =
                          pct != null && Number.isFinite(pct)
                            ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
                            : '—'

                        return (
                          <tr
                            key={row.company_id}
                            role="button"
                            onClick={() => navigate(`/stock/${row.symbol}`)}
                            style={{
                              height: 32,
                              borderBottom: '1px solid #141820',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#141820'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent'
                            }}
                          >
                            <td style={{ padding: '4px 10px', width: 160, verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 12, fontWeight: 700 }}>{row.symbol}</span>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    padding: '1px 6px',
                                    borderRadius: 3,
                                    background: sb.bg,
                                    color: sb.color,
                                    border: `1px solid ${sb.border}`,
                                  }}
                                >
                                  {sb.short}
                                </span>
                              </div>
                              <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{row.sector}</div>
                            </td>
                            <td
                              className="tabular-nums"
                              style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 500, fontSize: 13 }}
                            >
                              ₹{formatIN(row.close)}
                            </td>
                            <td
                              className="tabular-nums"
                              style={{ padding: '4px 10px', textAlign: 'right', fontSize: isMobile ? 11 : 12, color: pctColor }}
                            >
                              {pctDisp}
                            </td>
                            <td style={{ padding: '4px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                <span
                                  className="tabular-nums"
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: rs != null ? rsBarColor(rs) : MUTED,
                                  }}
                                >
                                  {rs ?? '—'}
                                </span>
                                <div
                                  style={{
                                    width: 28,
                                    height: 4,
                                    background: '#1a1f27',
                                    borderRadius: 2,
                                    overflow: 'hidden',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${rs != null ? (rs / 99) * 100 : 0}%`,
                                      height: '100%',
                                      background: rs != null ? rsBarColor(rs) : MUTED,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                            {!isMobile ? (
                              <td
                                className="tabular-nums"
                                style={{
                                  padding: '4px 10px',
                                  textAlign: 'right',
                                  fontSize: 12,
                                  color:
                                    del == null
                                      ? MUTED
                                      : del >= 60
                                        ? GREEN
                                        : del >= 30
                                          ? TEXT
                                          : MUTED,
                                  fontWeight: del != null && del >= 60 ? 500 : 400,
                                }}
                              >
                                {del != null && Number.isFinite(del) ? `${del.toFixed(1)}%` : '—'}
                              </td>
                            ) : null}
                            {!isMobile ? (
                              <td
                                className="tabular-nums"
                                style={{
                                  padding: '4px 10px',
                                  textAlign: 'right',
                                  fontSize: 12,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {volFormatted === '—' ? (
                                  <span style={{ color: MUTED }}>—</span>
                                ) : (
                                  <>
                                    <span style={{ color: volNumColor }}>{volFormatted}</span>{' '}
                                    <span style={{ color: delVolArrowColor }}>{delVolArrow}</span>
                                  </>
                                )}
                              </td>
                            ) : null}
                            {!isMobile && !isTablet ? (
                              <td
                                className="tabular-nums"
                                style={{
                                  padding: '4px 10px',
                                  textAlign: 'right',
                                  fontSize: 12,
                                  color:
                                    row.pledge != null && row.pledge > 0 ? RED : MUTED,
                                  fontWeight: row.pledge != null && row.pledge > 0 ? 500 : 400,
                                }}
                              >
                                {row.pledge != null && row.pledge > 0 ? `${row.pledge.toFixed(1)}%` : '—'}
                              </td>
                            ) : null}
                            {!isMobile ? (
                              <td style={{ padding: '4px 10px', textAlign: 'right' }}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 500,
                                    padding: '1px 7px',
                                    borderRadius: 3,
                                    background:
                                      pulse.key === 'bullish'
                                        ? 'rgba(0,200,5,.1)'
                                        : pulse.key === 'warn'
                                          ? 'rgba(255,59,48,.1)'
                                          : 'rgba(100,116,139,.1)',
                                    color: pulse.key === 'bullish' ? GREEN : pulse.key === 'warn' ? RED : '#94A3B8',
                                  }}
                                >
                                  {pulse.label}
                                </span>
                              </td>
                            ) : null}
                          </tr>
                        )
                      })}
                </tbody>
              </table>

              {!loading && sortedFiltered.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '48px 16px',
                    gap: 8,
                  }}
                >
                  <i className="ti ti-database-off" style={{ fontSize: 24, color: MUTED }} />
                  <div style={{ color: MUTED, fontSize: 13 }}>No stocks match this filter</div>
                  <div style={{ color: MUTED, fontSize: 12 }}>Try adjusting your criteria</div>
                </div>
              ) : null}
            </div>

            {/* Pagination */}
            <div
              style={{
                height: 32,
                flexShrink: 0,
                borderTop: `1px solid ${BORDER}`,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                gap: 6,
              }}
            >
              <button
                type="button"
                disabled={pageClamped <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  width: 24,
                  height: 24,
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 3,
                  color: TEXT,
                  cursor: pageClamped <= 1 || loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                <i className="ti ti-chevron-left" style={{ fontSize: 14 }} />
              </button>
              <button
                type="button"
                disabled={pageClamped >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  width: 24,
                  height: 24,
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 3,
                  color: TEXT,
                  cursor: pageClamped >= totalPages || loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
              </button>
              <span style={{ fontSize: 11, color: MUTED }}>
                Page {loading ? '—' : pageClamped} of {loading ? '—' : totalPages}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>{sortedFiltered.length} stocks</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
