import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DeliveryPanel from '../components/DeliveryPanel'
import StockShareModal from '../components/StockShareCard'
import { supabase, hasSupabaseEnv } from '../lib/supabaseClient'
import { consumeHomeNavigateFromStock } from '../lib/appNav'
import { useAuth } from '../context'
import { CONFIG } from '../config'

const VIEWED_KEY = 'pinex_viewed_stocks'
const FREE_LIMIT = 3

const C = {
  bg: '#05070A', surface: '#0B0F18', card: '#111620',
  border: '#1E2530', borderHover: '#2e3f5a',
  text: '#E2E8F0', muted: '#64748B', textMuted: '#64748B', faint: '#3D4F63',
  green: '#34D399', greenDim: 'rgba(52,211,153,0.12)',
  red: '#F87171', redDim: 'rgba(248,113,113,0.12)',
  blue: '#60A5FA', blueDim: 'rgba(96,165,250,0.12)',
  amber: '#FBBF24', amberDim: 'rgba(251,191,36,0.12)',
  purple: '#A78BFA',
}

const QUARTER_MONTH_INDEX = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
  jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11,
}

function quarterLabelTime(row) {
  const raw = row?.quarter ?? row?.quarter_name ?? ''
  if (!raw) return 0
  const parsed = Date.parse(String(raw))
  if (!Number.isNaN(parsed)) return parsed
  const fy = String(raw).trim().match(/^FY(\d{4})$/i)
  if (fy) { const y = Number(fy[1]); if (Number.isFinite(y)) return new Date(y, 2, 31).getTime() }
  const match = String(raw).trim().match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (match) {
    const month = QUARTER_MONTH_INDEX[match[1].slice(0,3).toLowerCase()]
    const year = Number(match[2])
    if (month != null && Number.isFinite(year)) return new Date(year, month, 1).getTime()
  }
  return 0
}

function isFiscalYearRow(row) {
  return /^FY\d{4}$/i.test(String(row?.quarter ?? '').trim())
}

const fmt = (n, d=2) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: d })
const fmtPct = (n, d=1) => n == null ? '—' : (n > 0 ? '+' : '') + Number(n).toFixed(d) + '%'
const fmtCr = (n) => {
  if (!n) return '—'
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(1) + ' Cr'
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L'
  if (n >= 1000) return '₹' + (n / 1000).toFixed(0) + 'K'
  return '₹' + n.toFixed(0)
}
const fmtShares = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (v >= 10000000) return (v / 10000000).toFixed(2) + ' Cr'
  if (v >= 100000) return (v / 100000).toFixed(2) + ' L'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K'
  return Math.round(v).toLocaleString('en-IN')
}
const fmtDeliveryDate = (d) => {
  if (!d) return '—'
  const dt = new Date(`${String(d).slice(0,10)}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
const timeAgo = (d) => {
  if (!d) return ''
  const diff = Date.now() - new Date(d)
  const h = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (h < 1) return Math.floor(diff / 60000) + 'm ago'
  if (h < 24) return h + 'h ago'
  if (days < 7) return days + 'd ago'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function sectorKeyword(sector) {
  const s = (sector || '').toLowerCase()
  if (s.includes('information tech') || s.includes('software') || s === 'it') return 'IT'
  if (s.includes('pharma') || s.includes('health')) return 'Pharma'
  if (s.includes('bank')) return 'Bank'
  if (s.includes('financial') || s.includes('finance')) return 'Financial'
  if (s.includes('auto')) return 'Auto'
  if (s.includes('fmcg') || s.includes('consumer goods')) return 'FMCG'
  if (s.includes('metal') || s.includes('mining')) return 'Metal'
  if (s.includes('energy') || s.includes('power') || s.includes('oil')) return 'Energy'
  if (s.includes('real estate') || s.includes('realty')) return 'Realty'
  if (s.includes('media') || s.includes('telecom')) return 'Media'
  if (s.includes('infra')) return 'Infra'
  return sector?.split(' ')[0] || ''
}

// ── Shared UI primitives ──────────────────────────────────────────

const STAGE_STYLE = {
  'Stage 2': { bg: C.greenDim, c: C.green, b: 'rgba(52,211,153,0.3)' },
  'Stage 1': { bg: C.blueDim,  c: C.blue,  b: 'rgba(96,165,250,0.3)' },
  'Stage 3': { bg: C.amberDim, c: C.amber, b: 'rgba(251,191,36,0.3)' },
  'Stage 4': { bg: C.redDim,   c: C.red,   b: 'rgba(248,113,113,0.3)' },
}

const STAGE_TOOLTIPS = {
  'Stage 2': 'Price above rising 30-week MA',
  'Stage 1': 'Price base forming',
  'Stage 3': 'Momentum slowing',
  'Stage 4': 'Price below declining 30-week MA',
}

function StagePill({ stage }) {
  const s = STAGE_STYLE[stage] || { bg: C.card, c: C.muted, b: C.border }
  const tip = STAGE_TOOLTIPS[stage] || ''
  return (
    <span title={tip} style={{ background: s.bg, color: s.c, border: `1px solid ${s.b}`, fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {stage || 'Unclassified'}
    </span>
  )
}

/** Larger stage badge for Technicals tab */
function LargeStageBadge({ stage }) {
  const s = STAGE_STYLE[stage] || { bg: C.card, c: C.muted, b: C.border }
  const tip = STAGE_TOOLTIPS[stage] || ''
  return (
    <span
      title={tip}
      style={{
        display: 'inline-block',
        background: s.bg,
        color: s.c,
        border: `1px solid ${s.b}`,
        fontSize: 15,
        fontWeight: 800,
        padding: '10px 18px',
        borderRadius: 12,
        letterSpacing: '0.04em',
      }}
    >
      {stage || 'Unclassified'}
    </span>
  )
}

/** ₹… en-IN; null → em dash */
function fmtInrCell(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return '₹' + n.toLocaleString('en-IN')
}

function Card({ children, style }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

function SectionLabel({ title, sub }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>{title}</p>
      {sub && <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>{sub}</p>}
    </div>
  )
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}` }}>
      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: color || C.text, margin: '0 0 3px' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>{sub}</p>}
    </div>
  )
}

// Ring chart for delivery % (SVG arc)
function DeliveryRing({ pct, label, size = 80 }) {
  const r = (size / 2) - 7
  const circ = 2 * Math.PI * r
  const val = pct != null && Number.isFinite(Number(pct)) ? Math.min(100, Math.max(0, Number(pct))) : null
  const offset = val != null ? circ * (1 - val / 100) : circ
  const color = val == null ? C.faint : val > 55 ? C.green : val < 35 ? C.red : C.amber

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.card} strokeWidth={6} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={val != null ? offset : circ}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={{ textAlign: 'center', marginTop: -size * 0.68, marginBottom: size * 0.68 - 8 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color, margin: 0, lineHeight: 1 }}>
          {val != null ? val.toFixed(0) + '%' : '—'}
        </p>
      </div>
      <p style={{ fontSize: 10, color: C.muted, textAlign: 'center', margin: 0, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</p>
    </div>
  )
}

function DeliveryBar({ label, value, suffix = '%', threshold = 50 }) {
  const val = value != null && Number.isFinite(Number(value)) ? Number(value) : null
  const pct = val != null ? Math.min(100, Math.abs(val)) : 0
  const color = val == null ? C.faint : val > threshold ? C.green : val < threshold * 0.6 ? C.red : C.amber

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <p style={{ fontSize: 11, color: C.muted, width: 100, flexShrink: 0, margin: 0 }}>{label}</p>
      <div style={{ flex: 1, height: 4, background: C.card, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 99, transition: 'width 0.5s ease' }} />
      </div>
      <p style={{ fontSize: 12, fontWeight: 700, color, width: 44, textAlign: 'right', flexShrink: 0, margin: 0 }}>
        {val != null ? val.toFixed(1) + suffix : '—'}
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────

export default function StockDetail() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const { user, isPaid } = useAuth()
  const tabRef = useRef(null)
  const [company, setCompany] = useState(null)
  const [price, setPrice] = useState(null)
  const [shareholding, setShareholding] = useState([])
  const [financials, setFinancials] = useState([])
  const [news, setNews] = useState([])
  const [delivery, setDelivery] = useState(null)
  const [latestDeliveryDay, setLatestDeliveryDay] = useState(null)
  const [quarterlyChanges, setQuarterlyChanges] = useState(null)
  const [gated, setGated] = useState(false)
  const [isWatched, setIsWatched] = useState(false)
  const [watchlistId, setWatchlistId] = useState(null)
  const [watchMessage, setWatchMessage] = useState('')
  const [showShareModal, setShowShareModal] = useState(false)
  const [sectorPerf, setSectorPerf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const sym = symbol?.toUpperCase()

  // Gate non-signed-in users after FREE_LIMIT unique stock views
  useEffect(() => {
    if (!sym || user) return
    try {
      const viewed = JSON.parse(localStorage.getItem(VIEWED_KEY) || '[]')
      if (viewed.includes(sym)) return
      if (viewed.length >= FREE_LIMIT) { setGated(true); return }
      localStorage.setItem(VIEWED_KEY, JSON.stringify([...viewed, sym]))
    } catch { /* ignore storage errors */ }
  }, [sym, user])

  useEffect(() => {
    if (!sym) return
    const load = async () => {
      setLoading(true)
      const { data: co } = await supabase.from('companies').select('*').eq('symbol', sym).single()
      if (!co) { setLoading(false); return }
      setCompany(co)
      const [
        { data: pd }, { data: sh }, { data: fin },
        { data: nws }, { data: del }, { data: latestDay },
        { data: qc },
      ] = await Promise.all([
        supabase.from('price_data').select('*').eq('company_id', co.id).eq('is_latest', true).maybeSingle(),
        supabase.from('shareholding').select('*').eq('company_id', co.id).order('quarter', { ascending: false }).limit(6),
        supabase.from('financials').select('*').eq('company_id', co.id).order('quarter', { ascending: false }).limit(8),
        supabase.from('stock_news').select('*').eq('company_id', co.id).order('published_at', { ascending: false }).limit(10),
        supabase.from('delivery_signals').select('*').eq('company_id', co.id).order('date', { ascending: false }).maybeSingle(),
        supabase.from('delivery_data').select('date,delivery_pct,delivery_volume,total_volume,vs_30d_avg,ai_insight')
          .eq('company_id', co.id).order('date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('quarterly_changes').select('*').eq('company_id', co.id)
          .order('quarter', { ascending: false }).limit(1).maybeSingle(),
      ])
      setPrice(pd ?? null); setShareholding(sh || []); setFinancials(fin || [])
      setNews(nws || []); setDelivery(del ?? null); setLatestDeliveryDay(latestDay)
      setQuarterlyChanges(qc ?? null)
      setLoading(false)
      /* best-effort sector perf from nifty_sectors */
      if (co.sector) {
        const kw = sectorKeyword(co.sector)
        if (kw) {
          supabase.from('nifty_sectors').select('change_1w').ilike('display_name', `%${kw}%`)
            .order('date', { ascending: false }).limit(1).maybeSingle()
            .then(({ data: sec }) => { setSectorPerf(sec?.change_1w ?? null) })
        }
      }
    }
    load()
  }, [sym])

  useEffect(() => {
    if (!user?.id || !company?.id || !hasSupabaseEnv) return
    supabase
      .from('watchlists')
      .select('id')
      .eq('user_id', user.id)
      .eq('company_id', company.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('Watchlist membership check:', error)
          setIsWatched(false)
          setWatchlistId(null)
          return
        }
        setIsWatched(Boolean(data))
        setWatchlistId(data?.id ?? null)
      })
  }, [user?.id, company?.id])

  const shareholdingByQuarter = useMemo(
    () => [...shareholding].sort((a, b) => quarterLabelTime(b) - quarterLabelTime(a)),
    [shareholding],
  )
  const financialsByQuarter = useMemo(
    () => [...financials].sort((a, b) => quarterLabelTime(b) - quarterLabelTime(a)),
    [financials],
  )
  const quarterlyFinancials = useMemo(
    () => financialsByQuarter.filter((row) => !isFiscalYearRow(row)),
    [financialsByQuarter],
  )

  const pct_from_ma = useMemo(() => {
    const c = price?.close
    const m = price?.ma30w
    if (c == null || m == null || Number(m) === 0) return null
    return ((Number(c) - Number(m)) / Number(m)) * 100
  }, [price?.close, price?.ma30w])
  /** ma30w_slope is numeric in DB; coerce so .toFixed is safe if PostgREST sends a string. */
  const ma30wSlopeNum = useMemo(() => {
    const v = price?.ma30w_slope
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }, [price?.ma30w_slope])

  const pctFrom52wHigh = useMemo(() => {
    const close = price?.close
    const hi = price?.high_52w
    if (close == null || hi == null || hi === '') return null
    const c = Number(close)
    const h = Number(hi)
    if (!Number.isFinite(c) || !Number.isFinite(h) || h === 0) return null
    return ((c - h) / h) * 100
  }, [price?.close, price?.high_52w])

  /** RS vs Nifty can be 0 or negative — only treat null/undefined as missing. */
  const rsVsNifty = useMemo(() => {
    const v = price?.rs_vs_nifty
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }, [price?.rs_vs_nifty])

  const latest_sh = shareholdingByQuarter[0] || {}
  const prev_sh   = shareholdingByQuarter[1] || {}
  const latest_fin = quarterlyFinancials[0] || {}
  const ttm_rev = quarterlyFinancials.slice(0,4).reduce((s,r) => s + (r.revenue || 0), 0)
  const ttm_pat = quarterlyFinancials.slice(0,4).reduce((s,r) => s + (r.pat || 0), 0)
  const sessionDate   = latestDeliveryDay?.date || delivery?.date
  const sessionPct    = latestDeliveryDay?.delivery_pct ?? delivery?.delivery_pct_today
  const sessionDelVol = latestDeliveryDay?.delivery_volume
  const sessionTotalVol = latestDeliveryDay?.total_volume
  const sessionVs30d  = latestDeliveryDay?.vs_30d_avg

  const TABS = ['Overview', 'Ownership', 'Technicals', 'Delivery', 'Financials']

  const normalizedSymbol = sym

  async function handleWatchlistToggle() {
    if (!user?.id) {
      setWatchMessage('Please sign in to use watchlist.')
      return
    }
    try {
      if (isWatched) {
        const q = supabase.from('watchlists').delete().eq('user_id', user.id)
        const { error } = watchlistId
          ? await q.eq('id', watchlistId)
          : await q.eq('company_id', company?.id)
        if (error) throw error
        setIsWatched(false)
        setWatchlistId(null)
        setWatchMessage('')
      } else {
        const limit = CONFIG.limits.watchlistStocks
        const countRes = await supabase
          .from('watchlists')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
        if (!isPaid && (countRes.count || 0) >= limit) {
          setWatchMessage(`Watchlist limit reached (${limit} stocks).`)
          return
        }
        const today = new Date().toISOString().split('T')[0]
        const row = {
          user_id: user.id,
          company_id: company?.id || null,
          reference_price: price?.close ?? null,
          reference_date: today,
        }

        const { data: existing, error: exErr } = await supabase
          .from('watchlists')
          .select('id')
          .eq('user_id', user.id)
          .eq('company_id', company?.id)
          .maybeSingle()
        if (exErr) throw exErr

        let data
        if (existing?.id != null) {
          const { data: upd, error: upErr } = await supabase
            .from('watchlists')
            .update({
              reference_price: row.reference_price,
              reference_date: row.reference_date,
            })
            .eq('id', existing.id)
            .eq('user_id', user.id)
            .select('id')
            .single()
          if (upErr) throw upErr
          data = upd
        } else {
          const { data: ins, error: inErr } = await supabase
            .from('watchlists')
            .insert(row)
            .select('id')
            .single()
          if (inErr) throw inErr
          data = ins
        }

        setIsWatched(true)
        setWatchlistId(data?.id ?? null)
        setWatchMessage('')
      }
    } catch (err) {
      setWatchMessage('Could not update watchlist.')
      console.error('Watchlist error:', err)
    }
  }

  function handleTabChange(tab) {
    setActiveTab(tab)
    setTimeout(() => { tabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 50)
  }

  if (gated) return (
    <div style={{
      background: C.bg, minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center', gap: 16,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
      }}>
        <i className="ti ti-lock" style={{ fontSize: 26, color: C.blue }} />
      </div>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>Free limit reached</p>
      <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 280, lineHeight: 1.5 }}>
        You've viewed {FREE_LIMIT} stocks as a guest. Sign in to access unlimited stock details.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 260 }}>
        <button onClick={() => navigate('/login')} style={{
          padding: '12px 0', borderRadius: 10, border: 'none',
          background: C.blue, color: '#0B0E11', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>Sign in</button>
        <button onClick={() => navigate('/register')} style={{
          padding: '12px 0', borderRadius: 10, border: `1px solid ${C.border}`,
          background: 'transparent', color: C.text, fontSize: 15, fontWeight: 600, cursor: 'pointer',
        }}>Create free account</button>
        <button onClick={() => navigate(-1)} style={{
          background: 'none', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', marginTop: 4,
        }}>← Go back</button>
      </div>
    </div>
  )

  if (loading) return (
    <div style={{ background: C.bg, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 14 }}>
      Loading {sym}…
    </div>
  )
  if (!company) return (
    <div style={{ background: C.bg, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 14, gap: 12 }}>
      <span>Stock not found: {sym}</span>
      <button onClick={() => navigate('/')} style={{ color: C.blue, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>← Back to Home</button>
    </div>
  )

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontSize: 13, width: '100%', maxWidth: '100%' }}>

      {/* ── STICKY HEADER ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: C.bg, borderBottom: `1px solid ${C.border}`, width: '100%' }}>

        {/* Nav row */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px', height: 44, gap: 6, maxWidth: '100%', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => {
              if (!consumeHomeNavigateFromStock(navigate)) navigate(-1)
            }}
            style={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, borderRadius: 6 }}
          >
            <i className="ti ti-arrow-left" style={{ fontSize: 18 }} />
          </button>

          {/* Stock identity */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>{sym}</span>
              <StagePill stage={price?.stage} />
            </div>
            <p style={{ fontSize: 10, color: C.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {company.name} · {company.sector}
            </p>
          </div>

          {/* Price */}
          <div style={{ textAlign: 'right', flexShrink: 1, minWidth: 52, marginRight: 2 }}>
            <p style={{ fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono,monospace', margin: 0, color: pct_from_ma > 5 ? C.green : pct_from_ma < -5 ? C.red : C.text, whiteSpace: 'nowrap' }}>
              {fmt(price?.close)}
            </p>
            {pct_from_ma != null && (
              <p style={{ fontSize: 9, margin: 0, color: pct_from_ma > 0 ? C.green : pct_from_ma < 0 ? C.red : C.muted, whiteSpace: 'nowrap' }}>
                {pct_from_ma > 0 ? '+' : ''}{pct_from_ma.toFixed(1)}% vs MA
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2" style={{ borderBottom: `1px solid ${C.border}` }}>
          {/* Share Card button */}
          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 6,
              background: 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(99,102,241,0.15))',
              border: '1px solid rgba(56,189,248,0.3)',
              color: '#38BDF8', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(14,165,233,0.25), rgba(99,102,241,0.25))' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(99,102,241,0.15))' }}
          >
            <i className="ti ti-share-2" style={{ fontSize: 13 }} />
            Share
          </button>

          <button
            type="button"
            onClick={() => void handleWatchlistToggle()}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 10px', borderRadius: 6,
              borderColor: isWatched ? 'rgba(0,200,5,0.4)' : C.border,
              border: `1px solid ${isWatched ? 'rgba(0,200,5,0.4)' : C.border}`,
              background: isWatched ? 'rgba(0,200,5,0.08)' : 'transparent',
              color: isWatched ? C.green : C.textMuted,
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <i className={`ti ${isWatched ? 'ti-bookmark-filled' : 'ti-bookmark'}`} style={{ fontSize: 14 }} />
            {isWatched ? 'Watching' : 'Watchlist'}
          </button>
        </div>
        {watchMessage ? (
          <p className="px-3 pb-2 text-xs" style={{ color: C.amber, margin: 0 }}>
            {watchMessage}
          </p>
        ) : null}

        {/* Signal badges */}
        <div style={{ padding: '0 10px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[
            { show: true, color: price?.stage === 'Stage 2' ? C.green : price?.stage === 'Stage 4' ? C.red : C.blue, label: price?.stage || 'Unclassified' },
            { show: delivery?.avg_delivery_30d != null, color: delivery?.avg_delivery_30d > 55 ? C.green : C.muted, label: `Del ${delivery?.avg_delivery_30d?.toFixed(1) || '—'}% 30D` },
            { show: latest_sh.promoter_pledge_pct != null, color: latest_sh.promoter_pledge_pct > 0 ? C.red : C.green, label: latest_sh.promoter_pledge_pct > 0 ? `⚠ Pledge ${latest_sh.promoter_pledge_pct?.toFixed(1)}%` : '✓ No Pledge' },
            { show: rsVsNifty != null, color: rsVsNifty > 0 ? C.green : rsVsNifty < 0 ? C.red : C.muted, label: `RS ${fmtPct(rsVsNifty)}` },
          ].filter(b => b.show).map((b, i) => (
            <span key={i} style={{ background: b.color + '18', color: b.color, border: `1px solid ${b.color}33`, fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20 }}>
              {b.label}
            </span>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderTop: `1px solid ${C.border}`, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map(tab => {
            const key = tab.toLowerCase()
            const active = activeTab === key
            return (
              <button key={tab} onClick={() => handleTabChange(key)}
                style={{ flex: 'none', padding: '8px 14px', fontSize: 11, fontWeight: active ? 700 : 400, color: active ? C.text : C.muted, background: 'none', border: 'none', borderBottom: `2px solid ${active ? C.blue : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color .15s, border-color .15s' }}>
                {tab}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div ref={tabRef} style={{ maxWidth: 800, margin: '0 auto', padding: '12px 10px 80px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ═══ OVERVIEW ═══ */}
        {activeTab === 'overview' && (<>

          {/* AI Description */}
          {company.description && (
            <Card>
              <SectionLabel title="PineX Intelligence" />
              <div style={{ padding: '14px 16px' }}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {company.description.split(/\.\s+/).filter(s => s.length > 40).slice(0, 4).map((point, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>
                      <span style={{ color: C.green, flexShrink: 0, marginTop: 2 }}>›</span>
                      {point.trim() + '.'}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {/* Analyst Consensus */}
          {(()=>{
            const sb = company.analyst_strong_buy || 0, b = company.analyst_buy || 0
            const h = company.analyst_hold || 0, s = company.analyst_sell || 0
            const total = sb + b + h + s
            if (!total) return null
            const segs = [
              { label: 'Strong Buy', count: sb, color: C.green },
              { label: 'Buy',        count: b,  color: '#86EFAC' },
              { label: 'Hold',       count: h,  color: C.amber },
              { label: 'Sell',       count: s,  color: C.red },
            ]
            const buyPct = (sb + b) / total * 100
            return (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
                  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>
                    Analyst Consensus · {total} analysts
                  </p>
                  <span style={{ fontSize: 11, fontWeight: 700, color: buyPct > 70 ? C.green : buyPct > 50 ? '#86EFAC' : C.amber, padding: '2px 9px', borderRadius: 20, background: buyPct > 70 ? C.greenDim : C.amberDim }}>
                    {buyPct > 70 ? 'Strong Buy' : buyPct > 50 ? 'Buy' : 'Mixed'}
                  </span>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1, marginBottom: 12 }}>
                    {segs.map(sg => (
                      <div key={sg.label} style={{ flex: sg.count / total, background: sg.color, minWidth: sg.count ? 2 : 0 }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {segs.map(sg => (
                      <div key={sg.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: sg.color }} />
                        <span style={{ fontSize: 11, color: C.muted }}>{sg.label}:</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: sg.color }}>{sg.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )
          })()}

          {/* Latest quarter change summary (quarterly_changes · latest by quarter) */}
          {(quarterlyChanges?.headline_change || quarterlyChanges?.ai_summary) && (
            <Card>
              <SectionLabel title="What changed" sub={quarterlyChanges?.quarter ? String(quarterlyChanges.quarter) : undefined} />
              <div style={{ padding: '14px 16px' }}>
                {quarterlyChanges.headline_change && (
                  <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: '0 0 8px', lineHeight: 1.45 }}>{quarterlyChanges.headline_change}</p>
                )}
                {quarterlyChanges.ai_summary && (
                  <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.55 }}>{quarterlyChanges.ai_summary}</p>
                )}
              </div>
            </Card>
          )}

          {/* News */}
          <Card>
            <SectionLabel title="Recent News" />
            <div style={{ padding: '4px 0' }}>
              {news.length === 0 ? (
                <p style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: '20px 0', margin: 0 }}>No recent news available.</p>
              ) : news.map((item, i) => (
                <div key={i}
                  onClick={() => { const url = item.url?.startsWith('http') ? item.url : 'https://www.livemint.com' + (item.url || ''); window.open(url, '_blank') }}
                  style={{ display: 'flex', gap: 12, padding: '11px 16px', cursor: 'pointer', borderBottom: i < news.length - 1 ? `1px solid ${C.border}` : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = C.card}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {item.image_url && (
                    <img src={item.image_url} alt="" style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                      onError={e => e.target.style.display = 'none'} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 10, color: C.faint, margin: '0 0 3px' }}>{timeAgo(item.published_at)}{item.source && ` · ${item.source}`}</p>
                    <p style={{ fontSize: 13, fontWeight: 500, color: C.text, lineHeight: 1.4, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.title}</p>
                    {item.summary && <p style={{ fontSize: 11, color: C.muted, margin: '3px 0 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{item.summary}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>)}

        {/* ═══ OWNERSHIP ═══ */}
        {activeTab === 'ownership' && (<>

          {/* Shareholding snapshot */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>Shareholding Pattern</p>
              {latest_sh.quarter && <span style={{ fontSize: 11, color: C.faint }}>{latest_sh.quarter}</span>}
            </div>
            <div style={{ padding: '14px 16px' }}>
              <div className="grid-2-to-4" style={{ marginBottom: 14 }}>
                {[
                  { label: 'Promoter', val: latest_sh.promoter_pct, prev: prev_sh.promoter_pct, color: C.purple },
                  { label: 'FII',      val: latest_sh.fii_pct,      prev: prev_sh.fii_pct,      color: C.blue },
                  { label: 'DII',      val: latest_sh.dii_pct,      prev: prev_sh.dii_pct,      color: C.green },
                  { label: 'Public',   val: latest_sh.public_pct,   prev: prev_sh.public_pct,   color: C.muted },
                ].map(sh => {
                  const chg = sh.val != null && sh.prev != null ? (sh.val - sh.prev) : null
                  return (
                    <div key={sh.label} style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}` }}>
                      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{sh.label}</p>
                      <p style={{ fontSize: 18, fontWeight: 700, color: sh.color, margin: '0 0 3px' }}>{sh.val?.toFixed(1) || '—'}%</p>
                      {chg != null && (
                        <p style={{ fontSize: 10, margin: '0 0 6px', color: chg > 0 ? C.green : chg < 0 ? C.red : C.faint }}>
                          {chg > 0 ? '↑ +' : '↓ '}{Math.abs(chg).toFixed(2)}% QoQ
                        </p>
                      )}
                      <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: sh.color, borderRadius: 2, width: Math.min(sh.val || 0, 100) + '%' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              {latest_sh.promoter_pledge_pct > 0 && (
                <div style={{ background: C.redDim, border: `1px solid rgba(248,113,113,0.25)`, borderRadius: 8, padding: '10px 14px' }}>
                  <span style={{ color: C.red, fontSize: 13, fontWeight: 600 }}>⚠ Promoter pledge: {latest_sh.promoter_pledge_pct?.toFixed(1)}%</span>
                  <span style={{ color: '#94A3B8', fontSize: 11, marginLeft: 8 }}>Risk of forced selling</span>
                </div>
              )}
            </div>
          </Card>

          {/* Quarterly history */}
          {shareholdingByQuarter.length > 1 && (
            <Card>
              <SectionLabel title="Quarterly Trend" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                  <thead>
                    <tr style={{ background: C.card }}>
                      {['Quarter', 'Promoter', 'FII', 'DII', 'Public', 'Pledge'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', fontSize: 9, color: C.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Quarter' ? 'left' : 'right', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shareholdingByQuarter.map((r, i) => {
                      const prev = shareholdingByQuarter[i + 1]
                      const chgP = prev ? (r.promoter_pct || 0) - (prev.promoter_pct || 0) : null
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '6px 8px', fontSize: 11, color: C.muted, fontWeight: 500 }}>{r.quarter}</td>
                          <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right' }}>
                            <span style={{ color: C.text, fontWeight: 500 }}>{r.promoter_pct?.toFixed(2) || '—'}%</span>
                            {chgP != null && <span style={{ fontSize: 10, marginLeft: 5, color: chgP > 0 ? C.green : chgP < 0 ? C.red : C.faint }}>{chgP > 0 ? '↑' : chgP < 0 ? '↓' : '→'}</span>}
                          </td>
                          {[r.fii_pct, r.dii_pct, r.public_pct].map((v, j) => (
                            <td key={j} style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', color: C.text }}>{v?.toFixed(2) || '—'}%</td>
                          ))}
                          <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', color: r.promoter_pledge_pct > 0 ? C.red : C.faint, fontWeight: r.promoter_pledge_pct > 0 ? 600 : 400 }}>
                            {r.promoter_pledge_pct?.toFixed(1) || '—'}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>)}

        {/* ═══ TECHNICALS ═══ */}
        {activeTab === 'technicals' && (() => {
          const priceData = price
          const rs = priceData?.rs_vs_nifty
          const rsNum = rs != null && rs !== '' ? Number(rs) : null
          const rsValid = rsNum != null && Number.isFinite(rsNum)
          const obvSlopeTech = parseFloat(String(priceData?.obv_slope ?? '')) || 0
          const rsiTech = priceData?.rsi
          const rsiForColor = rsiTech != null && rsiTech !== '' ? Number(rsiTech) : null
          const rsiFmt = rsiForColor != null && Number.isFinite(rsiForColor) ? rsiForColor.toFixed(1) : '—'
          const rsiColor = rsiForColor == null || !Number.isFinite(rsiForColor)
            ? C.muted
            : rsiForColor > 70 ? '#FF3B30'
              : rsiForColor < 30 ? '#00C805'
                : '#E2E8F0'
          const rsValueStr = rsValid ? (rsNum > 0 ? '+' : '') + rsNum.toFixed(1) + '%' : '—'
          const rsColor = !rsValid ? C.muted : rsNum > 0 ? '#00C805' : '#FF3B30'
          const rsSub = !rsValid ? '' : rsNum > 0 ? 'Outperforming Nifty' : 'Underperforming Nifty'
          const obvLabel = obvSlopeTech > 0.02 ? '↑ Rising' : obvSlopeTech < -0.02 ? '↓ Falling' : '→ Flat'
          const obvColor = obvSlopeTech > 0.02 ? '#00C805' : obvSlopeTech < -0.02 ? '#FF3B30' : '#64748B'
          const ma30 = fmtInrCell(priceData?.ma30w)
          const ma50 = fmtInrCell(priceData?.ma50)
          const ma150 = fmtInrCell(priceData?.ma150)
          const slopeStr = ma30wSlopeNum != null ? ma30wSlopeNum.toFixed(2) + '%' : '—'
          const hi52Str = fmtInrCell(priceData?.high_52w)
          const lo52Str = fmtInrCell(priceData?.low_52w)
          const pct52Str = pctFrom52wHigh != null && Number.isFinite(pctFrom52wHigh)
            ? (pctFrom52wHigh > 0 ? '+' : '') + pctFrom52wHigh.toFixed(1) + '%'
            : '—'

          if (!priceData) {
            return (
              <Card>
                <SectionLabel title="Technicals" sub="price_data · is_latest" />
                <p style={{ padding: '20px 16px', margin: 0, color: C.muted, fontSize: 13 }}>
                  No latest price row for this symbol yet. Data will appear after the next price sync.
                </p>
              </Card>
            )
          }

          return (<>
            <Card>
              <SectionLabel title="Technicals" sub="price_data · is_latest" />
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                  <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>RS vs Nifty (1Y)</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: rsColor, margin: '0 0 4px' }}>{rsValueStr}</p>
                    <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>{rsSub}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>OBV Trend</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: obvColor, margin: 0 }}>{obvLabel}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>RSI</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: rsiColor, margin: 0 }}>{rsiFmt}</p>
                  </div>
                </div>

                <div>
                  <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>Stage</p>
                  <LargeStageBadge stage={priceData?.stage} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                  {[
                    { label: '30W MA', value: ma30 },
                    { label: '50D MA', value: ma50 },
                    { label: '150D MA', value: ma150 },
                    { label: '30W Slope', value: slopeStr },
                  ].map((row) => (
                    <div key={row.label} style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: `1px solid ${C.border}` }}>
                      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{row.label}</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{row.value}</p>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>52W High</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{hi52Str}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>52W Low</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{lo52Str}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>% from 52W High</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: pctFrom52wHigh != null ? C.text : C.muted, margin: 0 }}>{pct52Str}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Current close</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{fmt(priceData?.close)}</p>
                  </div>
                </div>
              </div>
            </Card>
          </>)
        })()}

        {/* ═══ DELIVERY ═══ */}
        {activeTab === 'delivery' && (<>

          {/* Delivery % */}
          {(delivery || sessionDate) && (
            <Card>
              <SectionLabel title="Delivery %" sub={sessionDate ? fmtDeliveryDate(sessionDate) : undefined} />
              <div style={{ padding: '20px 16px' }}>
                {/* Ring indicators row */}
                <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                  <DeliveryRing pct={sessionPct ?? delivery?.avg_delivery_30d} label={sessionPct != null ? 'Latest' : '30D Avg'} size={84} />
                  <DeliveryRing pct={delivery?.avg_delivery_7d} label="7D Avg" size={72} />
                  <DeliveryRing pct={delivery?.avg_delivery_30d} label="30D Avg" size={72} />
                  <DeliveryRing pct={delivery?.avg_delivery_60d} label="60D Avg" size={72} />
                </div>

                {/* Volume stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                  {[
                    { label: 'Del. Volume', value: fmtShares(sessionDelVol), color: C.text },
                    { label: 'Total Volume', value: fmtShares(sessionTotalVol), color: C.muted },
                    { label: 'vs 30D Avg', value: sessionVs30d != null ? Number(sessionVs30d).toFixed(2) + 'x' : '—', color: sessionVs30d > 1.2 ? C.green : sessionVs30d < 0.8 ? C.red : C.muted },
                  ].map(item => (
                    <div key={item.label} style={{ background: C.card, borderRadius: 10, padding: '11px 13px', border: `1px solid ${C.border}` }}>
                      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 5px' }}>{item.label}</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: item.color, margin: 0 }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Period comparison bars */}
          {delivery && (
            <Card>
              <SectionLabel title="Delivery Trends" />
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  <DeliveryBar label="7D Avg Del%" value={delivery.avg_delivery_7d} />
                  <DeliveryBar label="30D Avg Del%" value={delivery.avg_delivery_30d} />
                  <DeliveryBar label="60D Avg Del%" value={delivery.avg_delivery_60d} />
                  <DeliveryBar label="90D Avg Del%" value={delivery.avg_delivery_90d} />
                  <DeliveryBar label="Vol Ratio" value={delivery.vol_ratio} suffix="x" threshold={1.5} />
                </div>

                {/* Volume row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {[
                    { label: '7D Avg Volume', val: fmtCr(delivery.avg_volume_7d) },
                    { label: '30D Avg Volume', val: fmtCr(delivery.avg_volume_30d) },
                  ].map(d => (
                    <div key={d.label} style={{ background: C.card, borderRadius: 10, padding: '11px 13px', border: `1px solid ${C.border}` }}>
                      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 5px' }}>{d.label}</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{d.val}</p>
                    </div>
                  ))}
                </div>

                {/* Signal badges */}
                {(() => {
                  const sigs = [
                    { show: delivery.is_accumulation,  label: 'Institutional Base', color: C.green, dim: C.greenDim },
                    { show: delivery.is_distribution,   label: 'Volume Decline',    color: C.red,   dim: C.redDim },
                    { show: delivery.breakout_30wma,    label: 'Above 30W MA', color: C.green, dim: C.greenDim },
                    { show: delivery.breakdown_30wma,   label: 'Below 30W MA',color: C.red,   dim: C.redDim },
                    { show: delivery.breakout_50dma,    label: 'Above 50D MA', color: C.blue,  dim: C.blueDim },
                    { show: delivery.breakdown_50dma,   label: 'Below 50D MA',color: C.amber, dim: C.amberDim },
                  ].filter(s => s.show)

                  return sigs.length > 0 ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {sigs.map((s, i) => (
                        <span key={i} style={{ background: s.dim, color: s.color, border: `1px solid ${s.color}44`, fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20 }}>
                          {s.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>No active signals</p>
                  )
                })()}
              </div>
            </Card>
          )}

          {/* Detailed panel */}
          <Card>
            <SectionLabel title="Detailed Delivery Data" />
            <div style={{ padding: '14px 16px', maxWidth: '100%', overflowX: 'auto' }}>
              <DeliveryPanel companyId={company.id} symbol={sym} latestStage={price?.stage} embedded hideExplain />
            </div>
          </Card>
        </>)}

        {/* ═══ FINANCIALS ═══ */}
        {activeTab === 'financials' && (<>

          {/* TTM summary */}
          <Card>
            <SectionLabel title="Trailing 12 Months (TTM)" />
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              <MetricCard label="Revenue TTM" value={fmtCr(ttm_rev)} sub="Last 4 quarters" />
              <MetricCard label="PAT TTM" value={fmtCr(ttm_pat)} sub="Net profit TTM" color={ttm_pat > 0 ? C.green : C.red} />
              {latest_fin?.margin != null && <MetricCard label="Oper. Margin" value={latest_fin.margin?.toFixed(1) + '%'} color={latest_fin.margin > 20 ? C.green : latest_fin.margin > 10 ? C.text : C.red} />}
              {latest_fin?.revenue_growth_yoy != null && <MetricCard label="Rev Growth YoY" value={fmtPct(latest_fin.revenue_growth_yoy)} color={latest_fin.revenue_growth_yoy > 0 ? C.green : C.red} />}
              {latest_fin?.pat_growth_yoy != null && <MetricCard label="PAT Growth YoY" value={fmtPct(latest_fin.pat_growth_yoy)} color={latest_fin.pat_growth_yoy > 0 ? C.green : C.red} />}
              {latest_fin?.eps != null && <MetricCard label="EPS (Latest Q)" value={'₹' + latest_fin.eps?.toFixed(2)} />}
            </div>
          </Card>

          {/* Quarterly table */}
          {financialsByQuarter.length > 0 && (
            <Card>
              <SectionLabel title="Quarterly Results" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                  <thead>
                    <tr style={{ background: C.card }}>
                      {['Quarter', 'Revenue', 'PAT', 'Margin', 'Rev YoY', 'PAT YoY'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', fontSize: 9, color: C.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Quarter' ? 'left' : 'right', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {financialsByQuarter.map((r, i) => (
                      <tr key={r.quarter ?? i} style={{ borderBottom: `1px solid ${C.border}` }}
                        onMouseEnter={e => e.currentTarget.style.background = C.card}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '6px 8px', fontSize: 11, color: C.muted, fontWeight: 500 }}>{r.quarter}</td>
                        <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', color: C.text }}>{fmtCr(r.revenue)}</td>
                        <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', fontWeight: 600, color: r.pat > 0 ? C.green : C.red }}>{fmtCr(r.pat)}</td>
                        <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', color: r.margin > 20 ? C.green : r.margin > 10 ? C.text : C.red }}>{r.margin?.toFixed(1) || '—'}%</td>
                        <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', fontWeight: 500, color: r.revenue_growth_yoy > 0 ? C.green : r.revenue_growth_yoy < 0 ? C.red : C.muted }}>{r.revenue_growth_yoy != null ? fmtPct(r.revenue_growth_yoy) : '—'}</td>
                        <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', fontWeight: 500, color: r.pat_growth_yoy > 0 ? C.green : r.pat_growth_yoy < 0 ? C.red : C.muted }}>{r.pat_growth_yoy != null ? fmtPct(r.pat_growth_yoy) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {financials.length === 0 && (
            <p style={{ textAlign: 'center', color: C.muted, fontSize: 13, padding: '32px 0' }}>No financial data available yet.</p>
          )}
        </>)}

      </div>

      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #1E2530',
          fontSize: 11,
          color: '#475569',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        Data is for informational and educational purposes only. Not investment advice. Past performance does not guarantee future results. Please consult a SEBI-registered investment advisor before making any investment decisions.
      </div>

      {/* Share modal */}
      {showShareModal && (
        <StockShareModal
          symbol={sym}
          company={company}
          price={price}
          delivery={delivery}
          shareholding={shareholding}
          pctFromMa={pct_from_ma}
          rsVsNifty={rsVsNifty}
          sectorPerf={sectorPerf}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  )
}
