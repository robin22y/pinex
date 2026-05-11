import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

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
const PULSE_CSS = `@keyframes homePulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 0.7 } }`

const DELIVERY_MINIMAL = 'company_id, avg_delivery_30d, avg_volume_30d, delivery_trend_30d'
const DELIVERY_BASE = `${DELIVERY_MINIMAL}, total_traded_volume_today, vol_ratio`
const DELIVERY_EXT = `${DELIVERY_BASE}, delivery_pct_today, is_accumulation, is_distribution, breakout_30wma, breakdown_30wma, breakout_50dma, breakdown_50dma`

const FILTER_CARDS = [
  {
    id: 'accumulation',
    title: 'Accumulation',
    desc: 'High delivery + High vol + Price flat',
    icon: 'trending-up',
    color: GREEN,
    match: (s) =>
      s.avg_delivery_30d > 60 &&
      s.vol_ratio > 1.5 &&
      s.close != null &&
      s.ma30w != null &&
      Math.abs(s.close - s.ma30w) < 5,
  },
  {
    id: 'distribution',
    title: 'Distribution (Warning)',
    desc: 'Low delivery + High vol + Price flat/fall',
    icon: 'trending-down',
    color: RED,
    match: (s) =>
      s.avg_delivery_30d < 40 &&
      s.vol_ratio > 2 &&
      s.close != null &&
      s.open != null &&
      s.close <= s.open,
  },
  {
    id: 'breakout30w',
    title: '30W Breakout',
    desc: 'Price just crossed above 30W MA',
    icon: 'arrow-up-right',
    color: GREEN,
    match: (s) => {
      if (s.close != null && s.ma30w != null && s.prev_close != null) {
        return s.close > s.ma30w && s.prev_close < s.ma30w
      }
      return s.close != null && s.ma30w != null && s.close > s.ma30w && String(s.stage || '').includes('2')
    },
  },
  {
    id: 'breakdown30w',
    title: '30W Breakdown',
    desc: 'Price just crossed below 30W MA',
    icon: 'arrow-down-right',
    color: RED,
    match: (s) => {
      if (s.close != null && s.ma30w != null && s.prev_close != null) {
        return s.close < s.ma30w && s.prev_close > s.ma30w
      }
      return s.close != null && s.ma30w != null && s.close < s.ma30w && String(s.stage || '').includes('4')
    },
  },
  {
    id: 'momentum50d',
    title: '50D Momentum',
    desc: 'Swing setup above 50D MA',
    icon: 'bolt',
    color: BLUE,
    match: (s) => s.close != null && s.ma50 != null && s.close > s.ma50 && s.rsi > 55,
  },
  {
    id: 'clean',
    title: 'Clean Promoters',
    desc: 'Zero pledge + Stage 2',
    icon: 'shield-check',
    color: AMBER,
    match: (s) => (s.pledge == null || s.pledge === 0) && s.stage === 'Stage 2',
  },
]

const DESKTOP_NAV = [
  { icon: 'home', path: '/', title: 'Home' },
  { icon: 'layout-grid', path: '/heatmap', title: 'Heatmap' },
  { icon: 'bookmark', path: '/dashboard', title: 'Watchlist' },
  { icon: 'briefcase', path: '/portfolio', title: 'Portfolio' },
  { icon: 'bell', path: '/dashboard', title: 'Alerts' },
]

const MOBILE_NAV = [
  { icon: 'home', path: '/', title: 'Home' },
  { icon: 'layout-grid', path: '/heatmap', title: 'Heatmap' },
  { icon: 'bookmark', path: '/dashboard', title: 'Watchlist' },
  { icon: 'user', path: '/profile', title: 'Profile' },
]

function isMissingColumnError(error) {
  const msg = String(error?.message || error || '').toLowerCase()
  return msg.includes('does not exist') || msg.includes('42703') || msg.includes('pgrst204')
}

async function fetchDeliverySignals(signalDate) {
  if (!signalDate) return { data: [], error: null }
  for (const select of [DELIVERY_EXT, DELIVERY_BASE, DELIVERY_MINIMAL]) {
    const res = await supabase.from('delivery_signals').select(select).eq('date', signalDate).limit(600)
    if (!res.error) return res
    if (!isMissingColumnError(res.error)) return res
  }
  return { data: [], error: null }
}

function formatInt(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return Math.round(x).toLocaleString('en-IN')
}

function formatInr(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `₹${x.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function formatPct(n, digits = 1) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${x >= 0 ? '+' : ''}${x.toFixed(digits)}%`
}

function formatRatio(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${x.toFixed(2)}×`
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

function stageBadge(stageRaw) {
  const s = String(stageRaw || '')
  if (s.includes('2')) return { bg: 'rgba(0,200,5,.12)', color: GREEN, border: 'rgba(0,200,5,.25)', short: 'S2' }
  if (s.includes('1')) return { bg: 'rgba(96,165,250,.12)', color: BLUE, border: 'rgba(96,165,250,.25)', short: 'S1' }
  if (s.includes('3')) return { bg: 'rgba(251,191,36,.12)', color: AMBER, border: 'rgba(251,191,36,.25)', short: 'S3' }
  if (s.includes('4')) return { bg: 'rgba(255,59,48,.12)', color: RED, border: 'rgba(255,59,48,.25)', short: 'S4' }
  return { bg: 'rgba(100,116,139,.12)', color: MUTED, border: 'rgba(100,116,139,.25)', short: '—' }
}

function rsBarColor(rs) {
  if (rs >= 80) return GREEN
  if (rs >= 60) return BLUE
  if (rs >= 40) return AMBER
  return RED
}

function computeAiPulse(stage, obvSlope) {
  const obv = obvSlope != null ? Number(obvSlope) : null
  if (stage === 'Stage 2' && obv != null && obv > 0.01) return { key: 'bullish', label: 'Bullish', color: GREEN }
  if (stage === 'Stage 4' || (obv != null && obv < -0.02)) return { key: 'warn', label: 'Warning', color: RED }
  return { key: 'neutral', label: 'Neutral', color: '#94A3B8' }
}

function navActive(pathname, path) {
  if (path === '/') return pathname === '/' || pathname === '/screener'
  if (path === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  if (path === '/profile') return pathname === '/profile' || pathname === '/account'
  return pathname === path || pathname.startsWith(`${path}/`)
}

function SidebarButton({ icon, active, title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
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

function MobileBottomNav({ pathname, navigate }) {
  return (
    <nav
      className="flex md:hidden"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        height: 56,
        background: SURFACE,
        borderTop: `1px solid ${BORDER}`,
        justifyContent: 'space-around',
        alignItems: 'center',
      }}
    >
      {MOBILE_NAV.map((item) => {
        const active = navActive(pathname, item.path)
        return (
          <button
            key={item.path}
            type="button"
            title={item.title}
            onClick={() => navigate(item.path)}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: active ? GREEN : MUTED,
              fontSize: 20,
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <i className={`ti ti-${item.icon}`} />
          </button>
        )
      })}
    </nav>
  )
}

function MobileStockRow({ row, onOpen }) {
  const badge = stageBadge(row.stage)
  const pct = row.pct_from_ma
  const pctColor = pct == null ? MUTED : pct > 5 ? GREEN : pct < -5 ? RED : TEXT
  const del = row.avg_delivery_30d
  const delColor = del == null ? MUTED : del >= 60 ? GREEN : del >= 30 ? TEXT : MUTED

  return (
    <button
      type="button"
      onClick={() => onOpen(row.symbol)}
      className="w-full border-0 bg-transparent text-left"
      style={{ padding: '12px 16px', borderBottom: '1px solid #141820', cursor: 'pointer' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{row.symbol}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{row.sector || '—'}</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{formatInr(row.close)}</div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: badge.bg,
              color: badge.color,
              border: `1px solid ${badge.border}`,
            }}
          >
            {badge.short}
          </span>
          <span className="tabular-nums" style={{ fontSize: 11, color: pctColor }}>
            {pct == null ? '—' : formatPct(pct)}
          </span>
        </div>
        <span className="tabular-nums" style={{ fontSize: 12, color: delColor, fontWeight: del != null && del >= 60 ? 600 : 400 }}>
          {del == null ? '—' : `${del.toFixed(1)}%`}
        </span>
      </div>
    </button>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [internals, setInternals] = useState(null)
  const [nifty50, setNifty50] = useState(null)
  const [nifty500, setNifty500] = useState(null)
  const [syncLabel, setSyncLabel] = useState('—')
  const [dataIssue, setDataIssue] = useState(null)

  const [filterKey, setFilterKey] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [sortKey, setSortKey] = useState('rs')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [filterKey, searchQ, sortKey, sortDir])

  useEffect(() => {
    const load = async () => {
      if (!hasSupabaseEnv) {
        setDataIssue({
          kind: 'config',
          message:
            'Supabase credentials are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.',
        })
        setRows([])
        setLoading(false)
        return
      }

      setLoading(true)
      setDataIssue(null)

      try {
        const latestDateRes = await supabase
          .from('delivery_signals')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()

        const signalDate = latestDateRes.data?.date
        const deliveryRes = await fetchDeliverySignals(signalDate)

        const [companiesRes, pricesRes, shareholdingRes, marketRes, n50Res, n500Res] = await Promise.all([
          supabase
            .from('companies')
            .select('id, symbol, name, sector, industry')
            .or('is_suspended.is.null,is_suspended.eq.false')
            .order('symbol')
            .limit(600),
          supabase
            .from('price_data')
            .select('company_id, close, open, stage, rs_vs_nifty, rsi, ma30w, ma50, volume, obv_slope')
            .eq('is_latest', true)
            .limit(600),
          supabase
            .from('shareholding')
            .select('company_id, promoter_pledge_pct, quarter')
            .order('quarter', { ascending: false })
            .limit(600),
          supabase.from('market_internals').select('*').order('date', { ascending: false }).limit(1),
          supabase
            .from('nifty_sectors')
            .select('*')
            .eq('index_name', 'Nifty 50')
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('nifty_sectors')
            .select('*')
            .eq('index_name', 'Nifty 500')
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        const errors = [companiesRes, pricesRes].filter((r) => r?.error)
        if (errors.length) {
          const msg = errors.map((r) => r.error?.message).filter(Boolean).join(' · ')
          setDataIssue({ kind: 'query', message: msg || 'Could not load market data.' })
          setRows([])
          return
        }

        if (deliveryRes.error) {
          console.warn('[Home] delivery_signals:', deliveryRes.error)
        }
        if (shareholdingRes.error) {
          console.warn('[Home] shareholding:', shareholdingRes.error)
        }

        const companies = companiesRes.data ?? []
        const prices = pricesRes.data ?? []
        const delivery = deliveryRes.error ? [] : deliveryRes.data ?? []
        const shareholding = shareholdingRes.error ? [] : shareholdingRes.data ?? []

        const priceMap = Object.fromEntries(prices.map((p) => [p.company_id, p]))
        const deliveryMap = {}
        delivery.forEach((d) => {
          if (!deliveryMap[d.company_id]) deliveryMap[d.company_id] = d
        })
        const pledgeMap = {}
        shareholding.forEach((s) => {
          if (!pledgeMap[s.company_id]) pledgeMap[s.company_id] = s
        })

        const merged = companies
          .map((c) => {
            const p = priceMap[c.id] || {}
            const d = deliveryMap[c.id] || {}
            const sh = pledgeMap[c.id] || {}
            const close = p.close != null ? Number(p.close) : null
            const ma30w = p.ma30w != null ? Number(p.ma30w) : null
            const todayVol = d.total_traded_volume_today != null ? Number(d.total_traded_volume_today) : null
            const avgVol30 = d.avg_volume_30d != null ? Number(d.avg_volume_30d) : null
            const volRatio =
              d.vol_ratio != null
                ? Number(d.vol_ratio)
                : todayVol != null && avgVol30 > 0
                  ? todayVol / avgVol30
                  : null
            const volOver50d =
              p.volume != null && avgVol30 > 0
                ? Number(p.volume) / avgVol30
                : volRatio

            return {
              company_id: c.id,
              symbol: String(c.symbol || '').toUpperCase(),
              name: c.name,
              sector: c.sector,
              industry: c.industry,
              close,
              open: p.open != null ? Number(p.open) : null,
              prev_close: null,
              stage: p.stage,
              rs_vs_nifty: p.rs_vs_nifty != null ? Number(p.rs_vs_nifty) : null,
              rsi: p.rsi != null ? Number(p.rsi) : null,
              ma30w,
              ma50: p.ma50 != null ? Number(p.ma50) : null,
              obv_slope: p.obv_slope != null ? Number(p.obv_slope) : null,
              avg_delivery_30d: d.avg_delivery_30d != null ? Number(d.avg_delivery_30d) : null,
              vol_ratio: volRatio,
              vol_over_50d: volOver50d,
              pledge: sh.promoter_pledge_pct != null ? Number(sh.promoter_pledge_pct) : 0,
              pct_from_ma: close != null && ma30w ? ((close - ma30w) / ma30w) * 100 : null,
            }
          })
          .filter((r) => r.close != null)

        const rsValues = merged
          .map((r) => r.rs_vs_nifty)
          .filter((v) => Number.isFinite(v))
          .sort((a, b) => a - b)

        const withRatings = merged.map((s) => ({
          ...s,
          rs_rating:
            s.rs_vs_nifty != null && rsValues.length
              ? Math.max(1, Math.round((rsValues.filter((v) => v <= s.rs_vs_nifty).length / rsValues.length) * 99))
              : null,
          ai_pulse: computeAiPulse(s.stage, s.obv_slope),
        }))

        setRows(withRatings)
        setInternals(marketRes.data?.[0] || null)
        setNifty50(n50Res.data || null)
        setNifty500(n500Res.data || null)
        setSyncLabel(formatEodSync(marketRes.data?.[0]?.date))

        if (!withRatings.length) {
          setDataIssue({
            kind: 'empty',
            message: 'No priced stocks returned. Ensure price_data.is_latest rows exist for active companies.',
          })
        }
      } catch (err) {
        setDataIssue({ kind: 'query', message: err?.message || 'Unexpected error loading stocks.' })
        setRows([])
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const cardCounts = useMemo(() => {
    const counts = {}
    FILTER_CARDS.forEach((card) => {
      counts[card.id] = rows.filter((row) => card.match(row)).length
    })
    return counts
  }, [rows])

  const filteredRows = useMemo(() => {
    const card = filterKey === 'all' ? null : FILTER_CARDS.find((c) => c.id === filterKey)
    let list = card ? rows.filter((row) => card.match(row)) : rows

    const q = searchQ.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          String(s.name || '').toLowerCase().includes(q) ||
          String(s.sector || '').toLowerCase().includes(q) ||
          String(s.industry || '').toLowerCase().includes(q),
      )
    }

    const dir = sortDir === 'asc' ? 1 : -1
    const num = (v, missing) => (Number.isFinite(v) ? v : missing)

    list = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'ticker':
          cmp = a.symbol.localeCompare(b.symbol)
          break
        case 'cmp':
          cmp = num(a.close, -Infinity) - num(b.close, -Infinity)
          break
        case 'pct_ma':
          cmp = num(a.pct_from_ma, -Infinity) - num(b.pct_from_ma, -Infinity)
          break
        case 'rs':
          cmp = num(a.rs_rating, -Infinity) - num(b.rs_rating, -Infinity)
          break
        case 'vol50':
          cmp = num(a.vol_over_50d, -Infinity) - num(b.vol_over_50d, -Infinity)
          break
        case 'delivery':
          cmp = num(a.avg_delivery_30d, -Infinity) - num(b.avg_delivery_30d, -Infinity)
          break
        case 'pledge':
          cmp = num(a.pledge, -1) - num(b.pledge, -1)
          break
        case 'pulse': {
          const order = { bullish: 3, neutral: 2, warn: 1 }
          cmp = (order[a.ai_pulse?.key] || 0) - (order[b.ai_pulse?.key] || 0)
          break
        }
        default:
          cmp = 0
      }
      if (cmp !== 0) return cmp * dir
      return a.symbol.localeCompare(b.symbol)
    })

    return list
  }, [rows, filterKey, searchQ, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE))
  const pageClamped = Math.min(page, totalPages)
  const pageRows = useMemo(() => {
    const start = (pageClamped - 1) * ROWS_PER_PAGE
    return filteredRows.slice(start, start + ROWS_PER_PAGE)
  }, [filteredRows, pageClamped])

  const onSort = useCallback(
    (key) => {
      if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortKey(key)
        setSortDir(key === 'ticker' || key === 'pulse' ? 'asc' : 'desc')
      }
    },
    [sortKey],
  )

  const nifty50Val = nifty50?.current_value ?? internals?.nifty_close
  const nifty50Chg = Number.isFinite(Number(nifty50?.change_1d))
    ? Number(nifty50.change_1d)
    : Number.isFinite(Number(internals?.nifty_change_1d))
      ? Number(internals.nifty_change_1d)
      : null
  const nifty500Val = nifty500?.current_value
  const nifty500Chg = Number.isFinite(Number(nifty500?.change_1d)) ? Number(nifty500.change_1d) : null
  const vixNum = Number(internals?.india_vix)
  const vixColor = Number.isFinite(vixNum) ? (vixNum < 15 ? GREEN : vixNum <= 20 ? AMBER : RED) : MUTED
  const breadthPct = internals?.above_ma150_pct != null ? Number(internals.above_ma150_pct) : null
  const stage2pct = internals?.stage2_pct != null ? Number(internals.stage2_pct) : 0
  const regimeGreen = stage2pct > 40

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
      }}
    >
      <style>{PULSE_CSS}</style>

      <aside
        className="hidden md:flex"
        style={{
          width: 52,
          flexShrink: 0,
          background: SURFACE,
          borderRight: `1px solid ${BORDER}`,
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
        {DESKTOP_NAV.map((item) => (
          <SidebarButton
            key={item.title}
            icon={item.icon}
            title={item.title}
            active={navActive(pathname, item.path)}
            onClick={() => navigate(item.path)}
          />
        ))}
        <div style={{ flex: 1 }} />
        <SidebarButton
          icon="settings"
          title="Admin"
          active={pathname.startsWith('/admin')}
          onClick={() => navigate('/admin')}
        />
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <header
          style={{
            height: 40,
            flexShrink: 0,
            background: SURFACE,
            borderBottom: `1px solid ${BORDER}`,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>NIFTY 50</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 600 }}>
                {loading ? '—' : formatInt(nifty50Val)}
              </span>
              <span
                className="tabular-nums"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: nifty50Chg == null ? MUTED : nifty50Chg >= 0 ? GREEN : RED,
                }}
              >
                {nifty50Chg == null ? '—' : `${nifty50Chg >= 0 ? '+' : ''}${nifty50Chg.toFixed(2)}%`}
              </span>
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
              </span>
            </div>
          </div>

          <div style={{ width: 1, height: 20, background: BORDER, flexShrink: 0 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>NIFTY 500</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 600 }}>
                {loading ? '—' : formatInt(nifty500Val)}
              </span>
              <span
                className="tabular-nums"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: nifty500Chg == null ? MUTED : nifty500Chg >= 0 ? GREEN : RED,
                }}
              >
                {nifty500Chg == null ? '—' : `${nifty500Chg >= 0 ? '+' : ''}${nifty500Chg.toFixed(2)}%`}
              </span>
            </div>
          </div>

          <div style={{ width: 1, height: 20, background: BORDER, flexShrink: 0 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>INDIA VIX</span>
            <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: vixColor }}>
              {loading ? '—' : Number.isFinite(vixNum) ? vixNum.toFixed(1) : '—'}
            </span>
          </div>

          <div style={{ width: 1, height: 20, background: BORDER, flexShrink: 0 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: MUTED, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Breadth</span>
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
              {breadthPct == null ? '—' : `${breadthPct.toFixed(1)}%`}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto" style={{ paddingBottom: 70 }}>
          <div
            className="flex snap-x snap-mandatory gap-2 overflow-x-auto md:grid md:grid-cols-3 md:overflow-visible"
            style={{ padding: '12px 16px 0', scrollbarWidth: 'none' }}
          >
            {FILTER_CARDS.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setFilterKey(card.id)}
                className="w-[75vw] flex-shrink-0 snap-start md:w-auto"
                style={{
                  textAlign: 'left',
                  background: SURFACE,
                  border: `1px solid ${filterKey === card.id ? GREEN : BORDER}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  color: TEXT,
                }}
                onMouseEnter={(e) => {
                  if (filterKey !== card.id) e.currentTarget.style.borderColor = '#2D3748'
                }}
                onMouseLeave={(e) => {
                  if (filterKey !== card.id) e.currentTarget.style.borderColor = BORDER
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
                    <div className="tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: card.color, marginTop: 6 }}>
                      {loading ? '…' : cardCounts[card.id] ?? 0}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div
            style={{
              margin: '8px 16px 12px',
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 280,
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
              <div style={{ position: 'relative', width: '100%', maxWidth: 220 }}>
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
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Search ticker, name, sector…"
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
              >
                {dataIssue.message}
              </div>
            ) : null}

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div className="md:hidden">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={`msk-${i}`}
                        style={{
                          height: 72,
                          borderBottom: '1px solid #141820',
                          animation: 'homePulse 1.2s ease-in-out infinite',
                          background: '#141820',
                        }}
                      />
                    ))
                  : pageRows.map((row) => (
                      <MobileStockRow key={row.company_id} row={row} onOpen={(symbol) => navigate(`/stock/${symbol}`)} />
                    ))}
              </div>

              <table className="hidden w-full border-collapse md:table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <th style={{ ...sortHeaderStyle('ticker'), width: 160 }} onClick={() => onSort('ticker')}>
                      Ticker ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('cmp'), width: 90, textAlign: 'right' }} onClick={() => onSort('cmp')}>
                      CMP ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('pct_ma'), width: 90, textAlign: 'right' }} onClick={() => onSort('pct_ma')}>
                      % 30W ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('rs'), width: 70, textAlign: 'right' }} onClick={() => onSort('rs')}>
                      RS ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('vol50'), width: 80, textAlign: 'right' }} onClick={() => onSort('vol50')}>
                      Vol/50D ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('delivery'), width: 80, textAlign: 'right' }} onClick={() => onSort('delivery')}>
                      Delivery ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('pledge'), width: 80, textAlign: 'right' }} onClick={() => onSort('pledge')}>
                      Pledge ⇅
                    </th>
                    <th style={{ ...sortHeaderStyle('pulse'), width: 80, textAlign: 'right' }} onClick={() => onSort('pulse')}>
                      AI Pulse ⇅
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: ROWS_PER_PAGE }).map((_, i) => (
                        <tr key={`sk-${i}`} style={{ height: 32, borderBottom: '1px solid #141820' }}>
                          <td colSpan={8} style={{ padding: '4px 10px' }}>
                            <div
                              style={{
                                height: 14,
                                borderRadius: 4,
                                background: '#1a1f27',
                                animation: 'homePulse 1.2s ease-in-out infinite',
                              }}
                            />
                          </td>
                        </tr>
                      ))
                    : pageRows.map((row) => {
                        const badge = stageBadge(row.stage)
                        const pct = row.pct_from_ma
                        const pctColor = pct == null ? MUTED : pct > 5 ? GREEN : pct < -5 ? RED : TEXT
                        const rs = row.rs_rating
                        const del = row.avg_delivery_30d
                        const pulse = row.ai_pulse

                        return (
                          <tr
                            key={row.company_id}
                            onClick={() => navigate(`/stock/${row.symbol}`)}
                            style={{ height: 32, borderBottom: '1px solid #141820', cursor: 'pointer' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#141820'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent'
                            }}
                          >
                            <td style={{ padding: '4px 10px', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 700 }}>{row.symbol}</span>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    padding: '1px 6px',
                                    borderRadius: 3,
                                    background: badge.bg,
                                    color: badge.color,
                                    border: `1px solid ${badge.border}`,
                                  }}
                                >
                                  {badge.short}
                                </span>
                              </div>
                              <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{row.sector || '—'}</div>
                            </td>
                            <td className="tabular-nums" style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 500 }}>
                              {formatInr(row.close)}
                            </td>
                            <td className="tabular-nums" style={{ padding: '4px 10px', textAlign: 'right', color: pctColor }}>
                              {pct == null ? '—' : formatPct(pct)}
                            </td>
                            <td style={{ padding: '4px 10px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                <span className="tabular-nums" style={{ fontSize: 12, fontWeight: 600, color: rs != null ? rsBarColor(rs) : MUTED }}>
                                  {rs ?? '—'}
                                </span>
                                <div style={{ width: 28, height: 4, background: '#1a1f27', borderRadius: 2, overflow: 'hidden' }}>
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
                            <td className="tabular-nums" style={{ padding: '4px 10px', textAlign: 'right', color: TEXT }}>
                              {formatRatio(row.vol_over_50d)}
                            </td>
                            <td
                              className="tabular-nums"
                              style={{
                                padding: '4px 10px',
                                textAlign: 'right',
                                color: del == null ? MUTED : del >= 60 ? GREEN : del >= 30 ? TEXT : MUTED,
                                fontWeight: del != null && del >= 60 ? 500 : 400,
                              }}
                            >
                              {del == null ? '—' : `${del.toFixed(1)}%`}
                            </td>
                            <td
                              className="tabular-nums"
                              style={{
                                padding: '4px 10px',
                                textAlign: 'right',
                                color: row.pledge > 0 ? RED : MUTED,
                                fontWeight: row.pledge > 0 ? 500 : 400,
                              }}
                            >
                              {row.pledge > 0 ? `${row.pledge.toFixed(1)}%` : '—'}
                            </td>
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
                                  color: pulse.color,
                                }}
                              >
                                {pulse.label}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                </tbody>
              </table>

              {!loading && filteredRows.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', gap: 8 }}>
                  <i className="ti ti-database-off" style={{ fontSize: 24, color: MUTED }} />
                  <div style={{ color: MUTED, fontSize: 13 }}>No stocks match this filter</div>
                </div>
              ) : null}
            </div>

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
                }}
              >
                <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
              </button>
              <span style={{ fontSize: 11, color: MUTED }}>
                Page {loading ? '—' : pageClamped} of {loading ? '—' : totalPages}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>{filteredRows.length} stocks</span>
            </div>
          </div>
        </div>
      </div>

      <MobileBottomNav pathname={pathname} navigate={navigate} />
    </div>
  )
}
