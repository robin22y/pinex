import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import Skeleton from '../components/ui/Skeleton'
import { C } from '../styles/tokens'
import { useAuth } from '../context'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { loadUserWatchlist } from '../lib/watchlistTable'

const TOAST_KEY = 'stockiq_toast'
const BORDER = '#1E2530'
const HOVER_ROW = '#141820'
const TEXT = '#E2E8F0'
const MUTED = '#64748B'
const AMBER = '#FBBF24'
const GREEN = '#00C805'
const RED = '#FF3B30'

const WL_SUBSTAGE_CFG = {
  '2A+': { bg: 'rgba(0,200,5,.15)',    color: '#00C805', border: 'rgba(0,200,5,.3)',      label: 'S2 A+' },
  '2A-': { bg: 'rgba(134,239,172,.1)', color: '#86EFAC', border: 'rgba(134,239,172,.25)', label: 'S2 A-' },
  '2B+': { bg: 'rgba(251,191,36,.15)', color: '#FBBF24', border: 'rgba(251,191,36,.3)',   label: 'S2 B+' },
  '2B-': { bg: 'rgba(249,115,22,.15)', color: '#F97316', border: 'rgba(249,115,22,.3)',   label: 'S2 B-' },
}
const WL_STAGE_CFG = {
  'Stage 2': { bg: 'rgba(0,200,5,.15)',    color: '#00C805', border: 'rgba(0,200,5,.3)',    label: 'S2' },
  'Stage 1': { bg: 'rgba(96,165,250,.15)', color: '#60A5FA', border: 'rgba(96,165,250,.3)', label: 'S1' },
  'Stage 3': { bg: 'rgba(251,191,36,.15)', color: '#FBBF24', border: 'rgba(251,191,36,.3)', label: 'S3' },
  'Stage 4': { bg: 'rgba(255,59,48,.15)',  color: '#FF3B30', border: 'rgba(255,59,48,.3)',  label: 'S4' },
}
const WL_BADGE_STYLE = { display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.05em', flexShrink: 0 }
function getWlStageBadge(row, className = '') {
  const sub = row?.weinstein_substage
  const stage = row?.stage
  if (!stage && !sub) return null
  const cfg = (sub && WL_SUBSTAGE_CFG[sub]) || WL_STAGE_CFG[stage]
  if (!cfg) return null
  return <span style={{ ...WL_BADGE_STYLE, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }} className={className}>{cfg.label}</span>
}

function watchlistReferencePrice(entry) {
  for (const k of ['reference_price', 'price_at_add']) {
    const n = Number(entry?.[k])
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function formatInr(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `₹${x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function gainCellStyle(gainPct) {
  if (gainPct == null || !Number.isFinite(gainPct)) return { pctColor: MUTED, pctWeight: 400 }
  if (gainPct > 10) return { pctColor: '#00C805', pctWeight: 700 }
  if (gainPct > 5) return { pctColor: '#86EFAC', pctWeight: 500 }
  if (gainPct > 0) return { pctColor: '#64748B', pctWeight: 400 }
  if (gainPct >= -5) return { pctColor: '#FCA5A5', pctWeight: 400 }
  return { pctColor: '#FF3B30', pctWeight: 700 }
}

function pctFromMaColor(pct) {
  if (pct == null || !Number.isFinite(pct)) return MUTED
  if (pct > 5) return GREEN
  if (pct >= -2) return AMBER
  if (pct < -5) return RED
  return '#FCA5A5'
}

function embeddedCompany(entry) {
  const c = entry?.company ?? entry?.companies
  if (!c) return null
  return Array.isArray(c) ? c[0] : c
}

function defaultWatchlistGroup(row) {
  const g = row?.group_name ?? row?.watchlist_group ?? row?.group
  if (typeof g === 'string' && g.trim()) return g.trim()
  return 'My Watchlist'
}

function firstRowPerCompany(rows, idKey = 'company_id') {
  const m = {}
  for (const r of rows || []) {
    const id = r?.[idKey]
    if (!id || m[id]) continue
    m[id] = r
  }
  return m
}

const TH = {
  textAlign: 'left', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  color: MUTED, padding: '0 10px', height: 36,
  borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
}
const TD = {
  padding: '0 10px', height: 46, fontSize: 13,
  color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: 'middle',
}

function Card({ children, style }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${BORDER}`,
      borderRadius: 12, overflow: 'hidden', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionHeading({ icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <i className={`ti ${icon}`} style={{ fontSize: 15, color: MUTED }} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MUTED }}>
        {title}
      </span>
      {count != null && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
          background: C.surface2, color: MUTED, border: `1px solid ${BORDER}`,
        }}>
          {count}
        </span>
      )}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [watchRows, setWatchRows] = useState([])
  const [portfolio, setPortfolio] = useState([])
  const [calendar, setCalendar] = useState([])
  const [activity, setActivity] = useState([])
  const [hoveredRow, setHoveredRow] = useState(null)
  const [watchlistFetchError, setWatchlistFetchError] = useState(false)

  useEffect(() => {
    const message = sessionStorage.getItem(TOAST_KEY)
    if (!message) return
    sessionStorage.removeItem(TOAST_KEY)
    queueMicrotask(() => setToast(message))
    const id = window.setTimeout(() => setToast(''), 4500)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!user?.id || !hasSupabaseEnv) {
      queueMicrotask(() => { setWatchRows([]); setWatchlistFetchError(false); setLoading(false) })
      return
    }
    let active = true
    const userId = user.id

    async function runLoad() {
      setLoading(true)
      setWatchlistFetchError(false)

      const { data: watchlistData, sourceTable, error: wlFetchErr } = await loadUserWatchlist(userId)

      const companyIdsForPrices = [
        ...new Set(
          (watchlistData || []).map((w) => {
            const co = embeddedCompany(w)
            return w.company_id ?? co?.id ?? null
          }).filter(Boolean),
        ),
      ]

      let prices = []
      if (companyIdsForPrices.length > 0) {
        const pr = await supabase
          .from('price_data')
          .select('company_id, close, stage, ma30w, rs_vs_nifty, rsi, obv_slope')
          .eq('is_latest', true)
          .in('company_id', companyIdsForPrices)
        prices = pr.data || []
      }

      const priceMap = {}
      prices.forEach((p) => { priceMap[p.company_id] = p })

      const mergedBase = (watchlistData || []).map((w) => {
        const co = embeddedCompany(w)
        const cid = w.company_id ?? co?.id ?? null
        const price = cid ? priceMap[cid] || {} : {}

        const refFromFields = watchlistReferencePrice(w)
        const refPrice = refFromFields != null && Number.isFinite(refFromFields) && refFromFields > 0 ? refFromFields : null
        const currentPrice = price.close != null && Number.isFinite(Number(price.close)) ? Number(price.close) : null

        let gainPct = null, gainAbs = null
        if (refPrice != null && refPrice !== 0 && currentPrice != null) {
          gainPct = ((currentPrice - refPrice) / refPrice) * 100
          gainAbs = currentPrice - refPrice
        }

        let pctFromMa = null
        const pClose = Number(price.close), ma30w = Number(price.ma30w)
        if (Number.isFinite(pClose) && Number.isFinite(ma30w) && ma30w !== 0) {
          pctFromMa = ((pClose - ma30w) / ma30w) * 100
        }

        const addedIso = w.added_at ?? w.created_at
        const daysSince = addedIso ? Math.floor((Date.now() - new Date(addedIso).getTime()) / 86400000) : null
        const sym = String(w.symbol || '').trim().toUpperCase()

        return {
          wlId: w.id, _sourceTable: sourceTable,
          rowKey: `${w.id ?? sym}-${addedIso}`, symbol: sym || w.symbol,
          company_id: cid, groupName: defaultWatchlistGroup(w),
          name: co?.name || sym || w.symbol,
          sector: (co?.sector && String(co.sector).trim()) || '',
          industry: (co?.industry && String(co.industry).trim()) || '',
          addedIso, daysSince, referencePrice: refPrice, currentPrice,
          ma30w: price.ma30w ?? null, gainPct, gainAbs, pctFromMa,
          stage: price.stage ?? null, weinstein_substage: price.weinstein_substage ?? null, rs: price.rs_vs_nifty,
        }
      })

      if (!active) return
      setWatchlistFetchError(!!(wlFetchErr && !(watchlistData && watchlistData.length)))

      const mergedCompanyIds = [...new Set(mergedBase.map((m) => m.company_id).filter(Boolean))]

      const [sigRes, holdingsRes, swingDateRes, swingsRes, changesRes] = await Promise.all([
        mergedCompanyIds.length
          ? supabase.from('delivery_signals').select('company_id,avg_delivery_30d,date')
              .in('company_id', mergedCompanyIds).order('date', { ascending: false }).limit(4000)
          : Promise.resolve({ data: [] }),
        supabase.from('portfolio').select('*').eq('user_id', userId).limit(200),
        supabase.from('swing_conditions').select('date').order('date', { ascending: false }).limit(1),
        mergedCompanyIds.length
          ? supabase.from('swing_conditions').select('company_id,conditions_met,date')
              .order('date', { ascending: false }).limit(3000)
          : Promise.resolve({ data: [] }),
        mergedCompanyIds.length
          ? supabase.from('quarterly_changes')
              .select('company_id,headline_change,watch_next,ai_summary,created_at')
              .in('company_id', mergedCompanyIds).order('created_at', { ascending: false }).limit(5000)
          : Promise.resolve({ data: [] }),
      ])

      if (!active) return

      const sigByCompany = firstRowPerCompany(sigRes.data || [])
      const latestSwingDate = swingDateRes.data?.[0]?.date
      const latestSwingByCompany = {}
      for (const s of swingsRes.data || []) {
        if (!s?.company_id) continue
        if (latestSwingDate && s.date !== latestSwingDate) continue
        if (!latestSwingByCompany[s.company_id]) latestSwingByCompany[s.company_id] = s
      }

      const changesByCompany = {}
      for (const c of changesRes.data || []) {
        if (!c?.company_id || changesByCompany[c.company_id]) continue
        changesByCompany[c.company_id] = c
      }

      const built = mergedBase.map((row) => {
        const id = row.company_id
        const pd = id ? priceMap[id] : null
        const changes = id ? changesByCompany[id] : {}
        return {
          ...row,
          close: row.currentPrice ?? (pd?.close != null ? Number(pd.close) : null),
          pctMa: row.pctFromMa, gainSinceAddPct: row.gainPct,
          rsVsNifty: pd?.rs_vs_nifty != null && pd.rs_vs_nifty !== '' ? Number(pd.rs_vs_nifty) : null,
          avgDelivery30d: sigByCompany[id]?.avg_delivery_30d != null ? Number(sigByCompany[id].avg_delivery_30d) : null,
          headline: changes?.headline_change || changes?.ai_summary || 'No major recent change',
          conditionsMet: Number(latestSwingByCompany[id]?.conditions_met) || 0,
          updatedAt: changes?.created_at || null, watchNext: changes?.watch_next || null,
        }
      })

      const portfolioData = (holdingsRes.data || []).map((h) => ({
        symbol: h.symbol || h.ticker || '',
        name: h.name || h.company_name || h.symbol || 'Holding',
        invested: Number(h.invested_amount || h.total_invested || (h.quantity || 0) * (h.avg_price || 0) || 0),
        gainLossPct: Number(h.gain_loss_pct || h.pnl_pct || 0),
      }))

      setWatchRows(built)
      setPortfolio(portfolioData)
      setCalendar(built.filter((w) => w.watchNext).slice(0, 30).map((w) => ({ symbol: w.symbol, watchNext: w.watchNext })))
      setActivity(built.filter((w) => w.updatedAt).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 30))
      setLoading(false)
    }

    void runLoad()
    return () => { active = false }
  }, [user?.id])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return watchRows
    return watchRows.filter((w) =>
      w.symbol.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || w.sector.toLowerCase().includes(q)
    )
  }, [query, watchRows])

  const groupedFiltered = useMemo(() => {
    const m = {}
    for (const r of filteredRows) {
      const g = r.groupName || 'My Watchlist'
      if (!m[g]) m[g] = []
      m[g].push(r)
    }
    const keys = Object.keys(m).sort((a, b) => {
      if (a === 'My Watchlist') return -1
      if (b === 'My Watchlist') return 1
      return a.localeCompare(b)
    })
    return keys.map((name) => ({ name, rows: m[name] }))
  }, [filteredRows])

  const stats = useMemo(() => {
    const gains = watchRows.map((r) => r.gainPct).filter((g) => g != null && Number.isFinite(g))
    const avg = gains.length ? gains.reduce((s, g) => s + g, 0) / gains.length : null
    const best = gains.length ? Math.max(...gains) : null
    const bestRow = watchRows.find((r) => r.gainPct === best)
    const winners = gains.filter((g) => g > 0).length
    return { total: watchRows.length, avg, best, bestSymbol: bestRow?.symbol, winners }
  }, [watchRows])

  function recalcGains(referencePrice, currentPrice) {
    if (!(referencePrice > 0) || !(currentPrice != null && Number.isFinite(currentPrice))) return { gainPct: null, gainAbs: null }
    return { gainPct: ((currentPrice - referencePrice) / referencePrice) * 100, gainAbs: currentPrice - referencePrice }
  }

  async function patchReferencePrice(row) {
    if (!user?.id || !hasSupabaseEnv || row?.wlId == null) return
    const hint = row.referencePrice != null ? String(row.referencePrice) : ''
    const next = window.prompt('Reference price (₹)', hint)
    if (next === null) return
    const val = Number(String(next).trim().replace(/,/g, ''))
    if (!Number.isFinite(val) || val <= 0) return
    const { error } = await supabase
      .from(row._sourceTable || 'watchlists')
      .update({ reference_price: val, price_at_add: val })
      .eq('id', row.wlId).eq('user_id', user.id)
    if (!error) {
      const { gainPct, gainAbs } = recalcGains(val, row.currentPrice)
      setWatchRows((prev) =>
        prev.map((r) => r.rowKey === row.rowKey ? { ...r, referencePrice: val, gainPct, gainAbs, gainSinceAddPct: gainPct } : r)
      )
    }
  }

  async function removeFromWatchlistRow(row) {
    if (!user?.id || !hasSupabaseEnv || row?.wlId == null) return
    if (!window.confirm(`Remove ${row.symbol} from your watchlist?`)) return
    const { error } = await supabase
      .from(row._sourceTable || 'watchlists').delete()
      .eq('id', row.wlId).eq('user_id', user.id)
    if (!error) setWatchRows((prev) => prev.filter((r) => r.rowKey !== row.rowKey))
  }

  function fmtPct(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
    return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`
  }

  function renderMobileCard(w) {
    const pctMa = w.pctFromMa
    const pctColor = pctFromMaColor(pctMa)
    const gStyle = gainCellStyle(w.gainPct)
    const gainStr = fmtPct(w.gainPct)
    const maStr = pctMa != null && Number.isFinite(pctMa)
      ? `${pctMa >= 0 ? '+' : ''}${pctMa.toFixed(1)}% vs MA`
      : '—'

    return (
      <div
        key={w.rowKey}
        onClick={() => navigate(`/stock/${w.symbol}`)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', cursor: 'pointer',
          borderBottom: `1px solid ${BORDER}`,
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = HOVER_ROW }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* Left: symbol + name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>{w.symbol}</span>
            {getWlStageBadge(w, 'rounded px-1.5 py-0.5 text-[9px]')}
          </div>
          <p style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '52vw' }}>
            {w.name || w.sector || '—'}
          </p>
          <p style={{ fontSize: 10, color: pctColor, marginTop: 2 }}>{maStr}</p>
        </div>

        {/* Right: price + gain */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 14, color: TEXT, marginBottom: 2 }}>{formatInr(w.currentPrice)}</p>
          <p style={{ fontSize: 12, color: gStyle.pctColor, fontWeight: gStyle.pctWeight }}>{gainStr}</p>
        </div>
      </div>
    )
  }

  function renderDesktopTable(rows) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>
              {['Stock', 'Added', 'Ref price', 'CMP', 'Gain', '% vs 30W MA', 'Stage', ''].map((h, i) => (
                <th key={h || i} style={{ ...TH, textAlign: i >= 2 && i <= 5 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const hover = hoveredRow === w.rowKey
              const pctMa = w.pctFromMa
              const pctColor = pctFromMaColor(pctMa)
              const pctStr = pctMa != null && Number.isFinite(pctMa) ? `${pctMa >= 0 ? '+' : ''}${pctMa.toFixed(2)}%` : '—'
              const gStyle = gainCellStyle(w.gainPct)
              const gainStr = fmtPct(w.gainPct)
              const absStr = w.gainAbs != null && Number.isFinite(w.gainAbs)
                ? `${w.gainAbs >= 0 ? '+' : '−'}${formatInr(Math.abs(w.gainAbs))}`
                : '—'

              let dateLine = '—', daysLine = ''
              if (w.addedIso) {
                const d = new Date(w.addedIso)
                if (!Number.isNaN(d.getTime())) {
                  dateLine = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
                  daysLine = typeof w.daysSince === 'number'
                    ? (w.daysSince === 0 ? 'Today' : `${w.daysSince}d ago`)
                    : ''
                }
              }

              return (
                <tr
                  key={w.rowKey}
                  onClick={() => navigate(`/stock/${w.symbol}`)}
                  onMouseEnter={() => setHoveredRow(w.rowKey)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ cursor: 'pointer', background: hover ? HOVER_ROW : 'transparent', transition: 'background 0.1s' }}
                >
                  <td style={TD}>
                    <p style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>{w.symbol}</p>
                    <p style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{w.name || '—'}</p>
                    <p style={{ fontSize: 10, color: C.textFaint }}>{w.sector || '—'}</p>
                  </td>
                  <td style={TD}>
                    <p style={{ fontSize: 11, color: MUTED }}>{dateLine}</p>
                    {daysLine && <p style={{ fontSize: 10, color: C.textFaint }}>{daysLine}</p>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatInr(w.referencePrice)}</span>
                      <button
                        type="button"
                        onClick={() => void patchReferencePrice(w)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: MUTED, lineHeight: 1 }}
                        title="Edit reference price"
                      >
                        <i className="ti ti-pencil" style={{ fontSize: 12 }} />
                      </button>
                    </div>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatInr(w.currentPrice)}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <p style={{ color: gStyle.pctColor, fontWeight: gStyle.pctWeight, fontVariantNumeric: 'tabular-nums' }}>{gainStr}</p>
                    <p style={{ fontSize: 11, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{absStr}</p>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', color: pctColor, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {pctStr}
                  </td>
                  <td style={TD}>
                    {getWlStageBadge(w, 'rounded-md px-2 py-0.5 text-[10px]')}
                  </td>
                  <td style={{ ...TD, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => void removeFromWatchlistRow(w)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 4, lineHeight: 1 }}
                      title={`Remove ${w.symbol}`}
                    >
                      <i className="ti ti-x" style={{ fontSize: 16 }} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const invested = useMemo(() => portfolio.reduce((s, p) => s + (Number(p.invested) || 0), 0), [portfolio])

  return (
    <>
      <Helmet>
        <title>Dashboard — PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      {/* Page header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${BORDER}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, flexShrink: 0 }}>
          Watchlist
        </p>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <i className="ti ti-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: MUTED, pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search watchlist…"
            style={{
              width: '100%', padding: '7px 10px 7px 30px', borderRadius: 8,
              border: `1px solid ${BORDER}`, background: C.surface2,
              color: TEXT, fontSize: 13, outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ padding: '16px', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 90 }}>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={80} />
            <Skeleton height={200} />
            <Skeleton height={160} />
          </div>
        ) : (
          <>
            {/* Stats strip */}
            {watchRows.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Watching', value: stats.total, color: TEXT },
                  { label: 'Avg gain', value: fmtPct(stats.avg), color: stats.avg != null ? (stats.avg >= 0 ? GREEN : RED) : MUTED },
                  { label: 'Best', value: stats.bestSymbol ? `${stats.bestSymbol} ${fmtPct(stats.best)}` : '—', color: GREEN },
                  { label: 'Winners', value: stats.winners != null ? `${stats.winners}/${stats.total}` : '—', color: AMBER },
                ].map((s) => (
                  <div key={s.label} style={{
                    flex: '1 1 120px', background: C.surface, border: `1px solid ${BORDER}`,
                    borderRadius: 10, padding: '10px 14px',
                  }}>
                    <p style={{ fontSize: 10, color: MUTED, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</p>
                    <p style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Watchlist */}
            <section>
              <SectionHeading icon="ti-bookmark" title="Watchlist" count={watchRows.length || undefined} />
              {watchlistFetchError ? (
                <div style={{ padding: '16px', color: '#FCA5A5', fontSize: 13 }}>Failed to load watchlist. Please refresh.</div>
              ) : !watchRows.length ? (
                <Card>
                  <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <i className="ti ti-bookmark" style={{ fontSize: 40, color: MUTED, display: 'block', marginBottom: 12 }} />
                    <p style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 6 }}>Your watchlist is empty</p>
                    <p style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>Visit any stock page and tap + Watchlist to start tracking.</p>
                    <button
                      type="button" onClick={() => navigate('/')}
                      style={{
                        padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: C.surface2, color: TEXT, border: `1px solid ${BORDER}`, cursor: 'pointer',
                      }}
                    >
                      Browse stocks
                    </button>
                  </div>
                </Card>
              ) : !filteredRows.length ? (
                <p style={{ fontSize: 13, color: MUTED }}>No stocks match your search.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {groupedFiltered.map(({ name, rows }) => (
                    <div key={name}>
                      {groupedFiltered.length > 1 && (
                        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>{name}</p>
                      )}
                      {/* Mobile */}
                      <div className="home-mobile-list" style={{ background: C.surface, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                        {rows.map(renderMobileCard)}
                      </div>
                      {/* Desktop */}
                      <div className="home-desktop-table" style={{ background: C.surface, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                        {renderDesktopTable(rows)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Portfolio */}
            <section>
              <SectionHeading icon="ti-chart-pie" title="Portfolio" />
              <Card>
                {portfolio.length ? (
                  <>
                    <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: MUTED }}>Total invested</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>₹{invested.toLocaleString('en-IN')}</span>
                    </div>
                    {portfolio.map((p, idx) => (
                      <div
                        key={`${p.symbol}-${idx}`}
                        onClick={() => navigate('/portfolio')}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '11px 14px', borderBottom: idx < portfolio.length - 1 ? `1px solid ${BORDER}` : 'none',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = HOVER_ROW }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{p.symbol}</p>
                          <p style={{ fontSize: 11, color: MUTED }}>{p.name}</p>
                        </div>
                        <span style={{
                          fontSize: 13, fontWeight: 700,
                          color: p.gainLossPct >= 0 ? GREEN : RED,
                        }}>
                          {p.gainLossPct >= 0 ? '+' : ''}{p.gainLossPct.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ padding: '24px 14px', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: MUTED }}>No holdings found.</p>
                  </div>
                )}
              </Card>
            </section>

            {/* Results Calendar */}
            {calendar.length > 0 && (
              <section>
                <SectionHeading icon="ti-calendar" title="Results Calendar" count={calendar.length} />
                <Card>
                  {calendar.map((c, idx) => (
                    <div
                      key={`${c.symbol}-${idx}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px',
                        borderBottom: idx < calendar.length - 1 ? `1px solid ${BORDER}` : 'none',
                      }}
                    >
                      <i className="ti ti-clock" style={{ fontSize: 12, color: AMBER, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, minWidth: 70 }}>{c.symbol}</span>
                      <span style={{ fontSize: 12, color: MUTED }}>~{c.watchNext}</span>
                    </div>
                  ))}
                </Card>
              </section>
            )}

            {/* Recent Activity */}
            {activity.length > 0 && (
              <section>
                <SectionHeading icon="ti-activity" title="Recent Activity" count={activity.length} />
                <Card>
                  {activity.map((a, idx) => (
                    <div
                      key={`${a.symbol}-${a.updatedAt}`}
                      onClick={() => navigate(`/stock/${a.symbol}`)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '11px 14px', cursor: 'pointer',
                        borderBottom: idx < activity.length - 1 ? `1px solid ${BORDER}` : 'none',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = HOVER_ROW }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{
                        width: 28, height: 28, borderRadius: 6, background: C.surface2,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, fontSize: 10, fontWeight: 700, color: C.blue,
                      }}>
                        {a.symbol.slice(0, 2)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 2 }}>{a.symbol}</p>
                        <p style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(a.headline || '').replaceAll('_', ' ')}
                        </p>
                      </div>
                      <i className="ti ti-chevron-right" style={{ fontSize: 14, color: C.textFaint, flexShrink: 0, marginTop: 4 }} />
                    </div>
                  ))}
                </Card>
              </section>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast ? (
        <div
          style={{
            position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9999, background: C.surface, border: `1px solid ${BORDER}`,
            borderRadius: 10, padding: '10px 18px', fontSize: 13, color: TEXT,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
          }}
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </>
  )
}
