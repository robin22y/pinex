import { useState, useEffect, useRef, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate, useParams } from 'react-router-dom'
import DeliveryPanel from '../components/DeliveryPanel'
import StockShareModal from '../components/StockShareCard'
import StockChart from '../components/StockChart'
import { supabase } from '../lib/supabaseClient'
import { consumeHomeNavigateFromStock } from '../lib/appNav'
import { useAuth } from '../context'
import { insertWatchlistRow, selectWatchMembership } from '../lib/watchlistTable'

const C = {
  bg: '#05070A', surface: '#0B0F18', card: '#111620',
  border: '#1E2530', borderHover: '#2e3f5a',
  text: '#E2E8F0', muted: '#64748B', faint: '#3D4F63',
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
const formatPeriod = (q) => {
  if (!q) return '—'
  if (q.startsWith('FY')) return 'FY ' + q.replace('FY', '').trim()
  return q
}
const growthColor = (val) => {
  if (val == null) return '#64748B'
  if (val > 15) return '#00C805'
  if (val > 0) return '#86EFAC'
  if (val > -10) return '#FCA5A5'
  return '#FF3B30'
}
const marginColor = (val) => {
  if (val == null) return '#64748B'
  if (val > 20) return '#00C805'
  if (val > 10) return '#86EFAC'
  if (val > 0) return '#E2E8F0'
  return '#FF3B30'
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

// ── Shared UI primitives ──────────────────────────────────────────

const STAGE_STYLE = {
  'Stage 2': { bg: C.greenDim, c: C.green, b: 'rgba(52,211,153,0.3)' },
  'Stage 1': { bg: C.blueDim,  c: C.blue,  b: 'rgba(96,165,250,0.3)' },
  'Stage 3': { bg: C.amberDim, c: C.amber, b: 'rgba(251,191,36,0.3)' },
  'Stage 4': { bg: C.redDim,   c: C.red,   b: 'rgba(248,113,113,0.3)' },
}

const SUBSTAGE_STYLE = {
  '2A+': { bg: 'rgba(0,200,5,.15)',    c: '#00C805', b: 'rgba(0,200,5,.3)',         label: 'S2 A+' },
  '2A-': { bg: 'rgba(134,239,172,.1)', c: '#86EFAC', b: 'rgba(134,239,172,.25)',    label: 'S2 A-' },
  '2B+': { bg: 'rgba(251,191,36,.15)', c: '#FBBF24', b: 'rgba(251,191,36,.3)',      label: 'S2 B+' },
  '2B-': { bg: 'rgba(249,115,22,.15)', c: '#F97316', b: 'rgba(249,115,22,.3)',      label: 'S2 B-' },
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
function LargeStageBadge({ stage, substage }) {
  const sub = substage && SUBSTAGE_STYLE[substage]
  const s = sub || STAGE_STYLE[stage] || { bg: C.card, c: C.muted, b: C.border }
  const label = sub ? sub.label : (stage || 'Unclassified')
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
      {label}
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
  const tabRef = useRef(null)
  const { user } = useAuth()
  const [company, setCompany] = useState(null)
  const [price, setPrice] = useState(null)
  const [shareholding, setShareholding] = useState([])
  const [financials, setFinancials] = useState([])
  const [news, setNews] = useState([])
  const [delivery, setDelivery] = useState(null)
  const [latestDeliveryDay, setLatestDeliveryDay] = useState(null)
  const [quarterlyChanges, setQuarterlyChanges] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [swingConditions, setSwingConditions] = useState(null)
  const [showShare, setShowShare] = useState(false)
  const [watching, setWatching] = useState(false)
  const [watchlistRowId, setWatchlistRowId] = useState(null)
  const [watchLoading, setWatchLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [deliveryTab, setDeliveryTab] = useState('1D')
  const [sectorHealth, setSectorHealth] = useState(null)
  const sym = symbol?.toUpperCase()

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
        { data: qc }, { data: hist }, { data: swing },
        { data: secRows },
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
        supabase.from('price_data')
          .select('date,open,high,low,close,volume,ma20,ma50,ma150,rsi')
          .eq('company_id', co.id)
          .order('date', { ascending: false })
          .limit(252),
        supabase.from('swing_conditions')
          .select('*')
          .eq('symbol', sym)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('nifty_sectors')
          .select('index_name, change_1m')
          .order('date', { ascending: false })
          .limit(30),
      ])
      setPrice(pd ?? null); setShareholding(sh || []); setFinancials(fin || [])
      setNews(nws || []); setDelivery(del ?? null); setLatestDeliveryDay(latestDay)
      setQuarterlyChanges(qc ?? null)
      setPriceHistory(hist || [])
      setSwingConditions(swing ?? null)
      if (secRows?.length && co.sector) {
        const sectorLower = co.sector.toLowerCase()
        const match = secRows.find(r => {
          const idx = (r.index_name || '').toLowerCase()
          return idx.includes(sectorLower) || sectorLower.includes(idx.replace(/^nifty\s*/, ''))
        })
        const c1m = match?.change_1m
        if (c1m != null) {
          setSectorHealth(c1m > 5 ? 'Strong' : c1m > 0 ? 'Good' : c1m > -5 ? 'Neutral' : 'Weak')
        }
      }
      setLoading(false)
    }
    load()
  }, [sym])

  // Check watchlist membership whenever user or company changes
  useEffect(() => {
    if (!user?.id || !company?.id) {
      setWatching(false)
      setWatchlistRowId(null)
      return
    }
    selectWatchMembership(user.id, company.id).then(({ data }) => {
      setWatching(!!data)
      setWatchlistRowId(data?.id ?? null)
    })
  }, [user?.id, company?.id])

  const handleWatchToggle = async () => {
    if (!user) return
    if (watchLoading) return
    setWatchLoading(true)
    try {
      if (watching && watchlistRowId) {
        await supabase.from('watchlists').delete().eq('id', watchlistRowId)
        setWatching(false)
        setWatchlistRowId(null)
      } else {
        const { error } = await insertWatchlistRow({
          user_id: user.id,
          company_id: company.id,
          added_at: new Date().toISOString(),
          price_at_add: price?.close ?? null,
        })
        if (!error) {
          const { data } = await selectWatchMembership(user.id, company.id)
          setWatching(true)
          setWatchlistRowId(data?.id ?? null)
        }
      }
    } finally {
      setWatchLoading(false)
    }
  }

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

  const isAnnual = useMemo(
    () => financials?.length > 0 && financials.every(f => f.quarter?.startsWith('FY')),
    [financials],
  )

  const sortedFinancials = useMemo(
    () => [...(financials || [])].sort((a, b) => {
      if (isAnnual) return b.quarter.localeCompare(a.quarter)
      return 0
    }),
    [financials, isAnnual],
  )

  const withGrowth = useMemo(
    () => sortedFinancials.map((row, idx, arr) => {
      if (!isAnnual) return row
      const prev = arr[idx + 1]
      const revYoY = prev?.revenue && row.revenue
        ? ((row.revenue - prev.revenue) / Math.abs(prev.revenue) * 100)
        : null
      const patYoY = prev?.pat && row.pat
        ? ((row.pat - prev.pat) / Math.abs(prev.pat) * 100)
        : null
      return {
        ...row,
        revenue_growth_yoy: revYoY != null ? parseFloat(revYoY.toFixed(1)) : null,
        pat_growth_yoy: patYoY != null ? parseFloat(patYoY.toFixed(1)) : null,
        revenue_growth_qoq: null,
        pat_growth_qoq: null,
      }
    }),
    [sortedFinancials, isAnnual],
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

  function handleTabChange(tab) {
    setActiveTab(tab)
    setTimeout(() => { tabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 50)
  }

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

  const priceData = price

  return (
    <>
      <Helmet>
        <title>
          {company?.symbol} — {company?.name} |{' '}
          {priceData?.weinstein_substage || priceData?.stage} | PineX
        </title>
        <meta
          name="description"
          content={
            company?.description
              ? `${company.description.slice(0, 150)}...`
              : `${company?.name} (${company?.symbol}) ${priceData?.stage} stage. RS vs Nifty: ${
                  priceData?.rs_vs_nifty != null
                    ? (priceData.rs_vs_nifty >= 0 ? '+' : '') + priceData.rs_vs_nifty.toFixed(1)
                    : '—'
                }%. Free analysis on PineX.`
          }
        />
      </Helmet>
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontSize: 13, width: '100%', maxWidth: '100%' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── STICKY HEADER ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: C.bg, borderBottom: `1px solid ${C.border}` }}>

        {/* Nav row */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 52, gap: 8, maxWidth: '100%' }}>
          <button
            type="button"
            onClick={() => {
              if (!consumeHomeNavigateFromStock(navigate)) navigate(-1)
            }}
            style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, borderRadius: 8 }}
          >
            <i className="ti ti-arrow-left" style={{ fontSize: 18 }} />
          </button>

          {/* Stock identity */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', flexShrink: 0 }}>{sym}</span>
              <StagePill stage={price?.stage} />
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {company.name} · {company.sector}
            </p>
          </div>

          {/* Price */}
          <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 800, fontFamily: 'DM Mono,monospace', margin: 0, color: pct_from_ma > 5 ? C.green : pct_from_ma < -5 ? C.red : C.text }}>
              {fmt(price?.close)}
            </p>
            {pct_from_ma != null && (
              <p style={{ fontSize: 10, margin: 0, color: pct_from_ma > 0 ? C.green : pct_from_ma < 0 ? C.red : C.muted }}>
                {pct_from_ma > 0 ? '+' : ''}{pct_from_ma.toFixed(1)}% vs MA
              </p>
            )}
          </div>

          <button
            onClick={() => setShowShare(true)}
            title="Share"
            style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, borderRadius: 8, transition: 'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#E2E8F0'}
            onMouseLeave={e => e.currentTarget.style.color = C.muted}
          >
            <i className="ti ti-share" style={{ fontSize: 17 }} />
          </button>
          <button
            onClick={handleWatchToggle}
            disabled={watchLoading || !user}
            title={!user ? 'Sign in to add to watchlist' : watching ? 'Remove from watchlist' : 'Add to watchlist'}
            style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: watchLoading || !user ? 'default' : 'pointer', color: watching ? C.blue : C.muted, borderRadius: 8, opacity: watchLoading ? 0.5 : 1, transition: 'opacity .15s' }}>
            <i className={watchLoading ? 'ti ti-loader-2' : watching ? 'ti ti-bookmark-filled' : 'ti ti-bookmark'} style={{ fontSize: 17, animation: watchLoading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Signal badges — single scrollable row */}
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { show: true, color: price?.stage === 'Stage 2' ? C.green : price?.stage === 'Stage 4' ? C.red : C.blue, label: price?.stage || 'Unclassified' },
            { show: delivery?.avg_delivery_30d != null, color: delivery?.avg_delivery_30d > 55 ? C.green : C.muted, label: `Del ${delivery?.avg_delivery_30d?.toFixed(1) || '—'}% 30D` },
            { show: latest_sh.promoter_pledge_pct != null, color: latest_sh.promoter_pledge_pct > 0 ? C.red : C.green, label: latest_sh.promoter_pledge_pct > 0 ? `⚠ Pledge ${latest_sh.promoter_pledge_pct?.toFixed(1)}%` : '✓ No Pledge' },
            { show: rsVsNifty != null, color: rsVsNifty > 0 ? C.green : rsVsNifty < 0 ? C.red : C.muted, label: `RS ${fmtPct(rsVsNifty)}` },
            { show: Boolean(delivery?.high_conviction), color: C.green, label: '⚡ SwingX' },
          ].filter(b => b.show).map((b, i) => (
            <span key={i} style={{ background: b.color + '18', color: b.color, border: `1px solid ${b.color}33`, fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
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
                style={{ flex: 'none', padding: '10px 18px', fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.text : C.muted, background: 'none', border: 'none', borderBottom: `2px solid ${active ? C.blue : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color .15s, border-color .15s' }}>
                {tab}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div ref={tabRef} style={{ maxWidth: 800, margin: '0 auto', padding: '16px 12px 90px', display: 'flex', flexDirection: 'column', gap: 14 }}>

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
                        <th key={h} style={{ padding: '9px 14px', fontSize: 10, color: C.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Quarter' ? 'left' : 'right', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shareholdingByQuarter.map((r, i) => {
                      const prev = shareholdingByQuarter[i + 1]
                      const chgP = prev ? (r.promoter_pct || 0) - (prev.promoter_pct || 0) : null
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '9px 14px', fontSize: 12, color: C.muted, fontWeight: 500 }}>{r.quarter}</td>
                          <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right' }}>
                            <span style={{ color: C.text, fontWeight: 500 }}>{r.promoter_pct?.toFixed(2) || '—'}%</span>
                            {chgP != null && <span style={{ fontSize: 10, marginLeft: 5, color: chgP > 0 ? C.green : chgP < 0 ? C.red : C.faint }}>{chgP > 0 ? '↑' : chgP < 0 ? '↓' : '→'}</span>}
                          </td>
                          {[r.fii_pct, r.dii_pct, r.public_pct].map((v, j) => (
                            <td key={j} style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: C.text }}>{v?.toFixed(2) || '—'}%</td>
                          ))}
                          <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: r.promoter_pledge_pct > 0 ? C.red : C.faint, fontWeight: r.promoter_pledge_pct > 0 ? 600 : 400 }}>
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
            <StockChart
              priceHistory={priceHistory}
              symbol={sym}
              companyName={company?.name}
              stage={priceData?.stage}
              swing={swingConditions}
            />
            {priceData?.stage === 'Stage 2' && (() => {
              const deliveryData = delivery
              const weinsteinChecks = [
                {
                  label: 'Above rising 30W MA',
                  pass: priceData?.close > priceData?.ma30w && (priceData?.ma30w_slope || 0) > 0,
                  detail: priceData?.ma30w ? `₹${Number(priceData.ma30w).toFixed(0)}` : '—',
                },
                {
                  label: 'Positive RS vs Nifty',
                  pass: (priceData?.rs_vs_nifty || 0) > 0,
                  detail: priceData?.rs_vs_nifty != null
                    ? `${priceData.rs_vs_nifty > 0 ? '+' : ''}${Number(priceData.rs_vs_nifty).toFixed(1)}%` : '—',
                },
                {
                  label: 'Volume confirmation',
                  pass: (deliveryData?.vol_ratio || 0) >= 2.0,
                  detail: deliveryData?.vol_ratio ? `${Number(deliveryData.vol_ratio).toFixed(1)}x average` : '—',
                },
                {
                  label: 'Early in uptrend',
                  pass: deliveryData?.weeks_in_stage2 != null && deliveryData.weeks_in_stage2 < 39
                    && (deliveryData?.pct_from_30w || 0) < 15,
                  detail: deliveryData?.weeks_in_stage2 ? `Week ${deliveryData.weeks_in_stage2} of uptrend` : '—',
                },
                {
                  label: 'Sector in uptrend phase',
                  pass: sectorHealth === 'Strong' || sectorHealth === 'Good',
                  detail: sectorHealth ? `${company?.sector || '—'} · ${sectorHealth}` : (company?.sector || '—'),
                },
              ]
              const passCount = weinsteinChecks.filter(c => c.pass).length
              return (
                <Card>
                  <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>Weinstein Checklist</p>
                      <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>Stage 2 health indicators</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red }}>{passCount}/5</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                        background: passCount >= 4 ? C.greenDim : passCount >= 2 ? C.amberDim : C.redDim,
                        color: passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red,
                        border: `1px solid ${passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red}33`
                      }}>
                        {passCount >= 4 ? 'Strong Setup' : passCount >= 2 ? 'Developing' : 'Weak Setup'}
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column' }}>
                    {weinsteinChecks.map((chk, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < weinsteinChecks.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                        <span style={{ fontSize: 16, color: chk.pass ? C.green : C.faint, flexShrink: 0, width: 20, textAlign: 'center' }}>
                          {chk.pass ? '✓' : '○'}
                        </span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: chk.pass ? C.text : C.muted, margin: 0 }}>{chk.label}</p>
                          <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>{chk.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ margin: '0 16px 16px', padding: '12px 16px', borderRadius: 10,
                    background: passCount >= 4 ? C.greenDim : passCount >= 2 ? C.amberDim : C.redDim,
                    border: `1px solid ${passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red}33`
                  }}>
                    <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px',
                      color: passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red
                    }}>
                      {passCount >= 4 ? '✓ Quality Stage 2 setup' : passCount >= 2 ? '⚠ Partial confirmation' : '✗ Setup lacks confirmation'}
                    </p>
                    <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
                      {passCount >= 4
                        ? 'All key Weinstein criteria align — high-probability setup.'
                        : passCount >= 2
                          ? 'Some criteria missing — watch for improvement before entry.'
                          : 'Multiple criteria failing — caution advised.'}
                    </p>
                  </div>
                </Card>
              )
            })()}
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
                  <LargeStageBadge stage={priceData?.stage} substage={priceData?.weinstein_substage} />
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

          {/* Delivery Snapshot */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>Delivery Snapshot</p>
                {sessionDate && <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>{fmtDeliveryDate(sessionDate)}</p>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {['1D', '7D', '30D', '60D', '90D'].map(tf => (
                  <button key={tf} type="button" onClick={() => setDeliveryTab(tf)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${deliveryTab === tf ? C.blue : C.border}`, background: deliveryTab === tf ? C.blueDim : 'transparent', color: deliveryTab === tf ? C.blue : C.muted, fontSize: 11, fontWeight: deliveryTab === tf ? 700 : 500, cursor: 'pointer' }}
                  >{tf}</button>
                ))}
              </div>
            </div>
            <div style={{ padding: '20px 16px' }}>
              {(() => {
                const tabs = {
                  '1D':  { pct: sessionPct,                  label: 'Today',   vol: sessionDelVol,         totalVol: sessionTotalVol, vs30d: sessionVs30d },
                  '7D':  { pct: delivery?.avg_delivery_7d,   label: '7D Avg',  vol: delivery?.avg_volume_7d },
                  '30D': { pct: delivery?.avg_delivery_30d,  label: '30D Avg', vol: delivery?.avg_volume_30d },
                  '60D': { pct: delivery?.avg_delivery_60d,  label: '60D Avg' },
                  '90D': { pct: delivery?.avg_delivery_90d,  label: '90D Avg' },
                }
                const t = tabs[deliveryTab]
                const statCards = deliveryTab === '1D'
                  ? [
                      { label: 'Del. Volume',  value: fmtShares(t.vol),     color: C.text },
                      { label: 'Total Volume', value: fmtShares(t.totalVol), color: C.muted },
                      { label: 'vs 30D Avg',   value: t.vs30d != null ? Number(t.vs30d).toFixed(2) + 'x' : '—', color: t.vs30d > 1.2 ? C.green : t.vs30d < 0.8 ? C.red : C.muted },
                    ]
                  : t.vol != null
                    ? [{ label: `Avg Del. Volume (${deliveryTab})`, value: fmtCr(t.vol), color: C.text }]
                    : []
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: statCards.length ? 20 : 0 }}>
                      <DeliveryRing pct={t.pct} label={t.label} size={100} />
                    </div>
                    {statCards.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                        {statCards.map(item => (
                          <div key={item.label} style={{ background: C.card, borderRadius: 10, padding: '11px 13px', border: `1px solid ${C.border}` }}>
                            <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 5px' }}>{item.label}</p>
                            <p style={{ fontSize: 14, fontWeight: 700, color: item.color, margin: 0 }}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </Card>

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

          {/* TTM / latest summary */}
          <Card>
            <SectionLabel title={isAnnual ? 'Latest Annual' : 'Trailing 12 Months (TTM)'} />
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {isAnnual ? (<>
                <MetricCard label={`Revenue (${formatPeriod(withGrowth[0]?.quarter)})`} value={fmtCr(withGrowth[0]?.revenue)} />
                <MetricCard label={`PAT (${formatPeriod(withGrowth[0]?.quarter)})`} value={fmtCr(withGrowth[0]?.pat)} color={withGrowth[0]?.pat > 0 ? C.green : C.red} />
                {withGrowth[0]?.margin != null && <MetricCard label="Oper. Margin" value={withGrowth[0].margin?.toFixed(1) + '%'} color={withGrowth[0].margin > 20 ? C.green : withGrowth[0].margin > 10 ? C.text : C.red} />}
                {withGrowth[0]?.revenue_growth_yoy != null && <MetricCard label="Rev Growth YoY" value={fmtPct(withGrowth[0].revenue_growth_yoy)} color={withGrowth[0].revenue_growth_yoy > 0 ? C.green : C.red} />}
                {withGrowth[0]?.pat_growth_yoy != null && <MetricCard label="PAT Growth YoY" value={fmtPct(withGrowth[0].pat_growth_yoy)} color={withGrowth[0].pat_growth_yoy > 0 ? C.green : C.red} />}
              </>) : (<>
                <MetricCard label="Revenue TTM" value={fmtCr(ttm_rev)} sub="Last 4 quarters" />
                <MetricCard label="PAT TTM" value={fmtCr(ttm_pat)} sub="Net profit TTM" color={ttm_pat > 0 ? C.green : C.red} />
                {latest_fin?.margin != null && <MetricCard label="Oper. Margin" value={latest_fin.margin?.toFixed(1) + '%'} color={latest_fin.margin > 20 ? C.green : latest_fin.margin > 10 ? C.text : C.red} />}
                {latest_fin?.revenue_growth_yoy != null && <MetricCard label="Rev Growth YoY" value={fmtPct(latest_fin.revenue_growth_yoy)} color={latest_fin.revenue_growth_yoy > 0 ? C.green : C.red} />}
                {latest_fin?.pat_growth_yoy != null && <MetricCard label="PAT Growth YoY" value={fmtPct(latest_fin.pat_growth_yoy)} color={latest_fin.pat_growth_yoy > 0 ? C.green : C.red} />}
                {latest_fin?.eps != null && <MetricCard label="EPS (Latest Q)" value={'₹' + latest_fin.eps?.toFixed(2)} />}
              </>)}
            </div>
          </Card>

          {/* Results table */}
          {withGrowth.length > 0 && (
            <Card>
              <div style={{ padding: '14px 16px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {isAnnual ? 'Annual Results' : 'Quarterly Results'}
                  </span>
                  {isAnnual && (
                    <span style={{ fontSize: 10, color: '#FBBF24', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.2)', padding: '2px 8px', borderRadius: 4 }}>
                      Annual data only
                    </span>
                  )}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isAnnual ? 480 : 580 }}>
                  <thead>
                    <tr style={{ background: C.card }}>
                      {[
                        isAnnual ? 'Year' : 'Quarter',
                        'Revenue', 'PAT', 'Margin',
                        ...(!isAnnual ? ['Rev QoQ'] : []),
                        'Rev YoY',
                        ...(!isAnnual ? ['PAT QoQ'] : []),
                        'PAT YoY',
                      ].map(h => (
                        <th key={h} style={{ padding: '9px 14px', fontSize: 10, color: C.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Year' || h === 'Quarter' ? 'left' : 'right', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {withGrowth.map((r, i) => (
                      <tr key={r.quarter ?? i} style={{ borderBottom: `1px solid ${C.border}` }}
                        onMouseEnter={e => e.currentTarget.style.background = C.card}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '9px 14px', fontSize: 12, color: C.muted, fontWeight: 500 }}>{formatPeriod(r.quarter)}</td>
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: C.text }}>{fmtCr(r.revenue)}</td>
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: r.pat > 0 ? C.green : C.red }}>{fmtCr(r.pat)}</td>
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: marginColor(r.margin) }}>{r.margin != null ? r.margin.toFixed(1) + '%' : '—'}</td>
                        {!isAnnual && <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.revenue_growth_qoq) }}>{r.revenue_growth_qoq != null ? fmtPct(r.revenue_growth_qoq) : '—'}</td>}
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.revenue_growth_yoy) }}>{r.revenue_growth_yoy != null ? fmtPct(r.revenue_growth_yoy) : '—'}</td>
                        {!isAnnual && <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.pat_growth_qoq) }}>{r.pat_growth_qoq != null ? fmtPct(r.pat_growth_qoq) : '—'}</td>}
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.pat_growth_yoy) }}>{r.pat_growth_yoy != null ? fmtPct(r.pat_growth_yoy) : '—'}</td>
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

      {showShare && (
        <StockShareModal
          symbol={symbol}
          company={company}
          price={price}
          delivery={delivery}
          shareholding={shareholding}
          pctFromMa={pct_from_ma}
          rsVsNifty={rsVsNifty}
          priceHistory={priceHistory}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
    </>
  )
}
