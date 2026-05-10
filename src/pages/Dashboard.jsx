import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/ui/Card'
import SectionLabel from '../components/ui/SectionLabel'
import Skeleton from '../components/ui/Skeleton'
import StagePill from '../components/StagePill'
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
  if (gainPct == null || !Number.isFinite(gainPct)) {
    return { pctColor: MUTED, absColor: MUTED, pctWeight: 400 }
  }
  if (gainPct > 10) return { pctColor: '#00C805', absColor: MUTED, pctWeight: 700 }
  if (gainPct > 5) return { pctColor: '#86EFAC', absColor: MUTED, pctWeight: 400 }
  if (gainPct > 0) return { pctColor: '#64748B', absColor: MUTED, pctWeight: 400 }
  if (gainPct >= -5) return { pctColor: '#FCA5A5', absColor: MUTED, pctWeight: 400 }
  return { pctColor: '#FF3B30', absColor: MUTED, pctWeight: 700 }
}

function pctFromMaColorForWatch(pct) {
  if (pct == null || !Number.isFinite(pct)) return MUTED
  if (pct > 5) return GREEN
  if (pct >= -2 && pct <= 5) return AMBER
  if (pct < -5) return RED
  return '#FCA5A5'
}

/** PostgREST may return FK embed as object or length-1 array. */
function embeddedCompany(entry) {
  const c = entry?.companies
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

const TH_STYLE = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: MUTED,
  padding: '0 8px',
  height: 36,
  borderBottom: `1px solid ${BORDER}`,
  whiteSpace: 'nowrap',
}

const TD_STYLE = {
  padding: '0 8px',
  height: 44,
  fontSize: 13,
  color: TEXT,
  borderBottom: `1px solid ${BORDER}`,
  verticalAlign: 'middle',
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
    queueMicrotask(() => {
      setToast(message)
    })
    const id = window.setTimeout(() => setToast(''), 4500)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!user?.id || !hasSupabaseEnv) {
      queueMicrotask(() => {
        setWatchRows([])
        setWatchlistFetchError(false)
        setLoading(false)
      })
      return
    }

    let active = true
    const userId = user.id

    async function runLoad() {
      setLoading(true)
      setWatchlistFetchError(false)

      const { data: watchlistData, sourceTable, error: wlFetchErr } = await loadUserWatchlist(userId)
      console.log('watchlist load:', watchlistData, wlFetchErr, 'table:', sourceTable)

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

        console.log('prices for watchlist:', pr.data, pr.error)
        prices = pr.data || []
      }

      const priceMap = {}
      prices.forEach((p) => {
        priceMap[p.company_id] = p
      })

      const mergedBase = (watchlistData || []).map((w) => {
        const co = embeddedCompany(w)
        const cid = w.company_id ?? co?.id ?? null
        const price = cid ? priceMap[cid] || {} : {}

        const refFromFields = watchlistReferencePrice(w)
        const refPrice =
          refFromFields != null && Number.isFinite(refFromFields) && refFromFields > 0 ? refFromFields : null

        const currentPriceRaw = price.close
        const currentPrice =
          currentPriceRaw != null && Number.isFinite(Number(currentPriceRaw))
            ? Number(currentPriceRaw)
            : null

        let gainPct = null
        let gainAbs = null
        if (refPrice != null && refPrice !== 0 && currentPrice != null) {
          gainPct = ((currentPrice - refPrice) / refPrice) * 100
          gainAbs = currentPrice - refPrice
        }

        let pctFromMa = null
        const pClose = Number(price.close)
        const ma30w = Number(price.ma30w)
        if (Number.isFinite(pClose) && Number.isFinite(ma30w) && ma30w !== 0) {
          pctFromMa = ((pClose - ma30w) / ma30w) * 100
        }

        const addedIso = w.added_at ?? w.created_at
        const daysSince =
          addedIso ? Math.floor((Date.now() - new Date(addedIso).getTime()) / 86400000) : null

        const sym = String(w.symbol || '').trim().toUpperCase()

        return {
          wlId: w.id,
          _sourceTable: sourceTable,
          rowKey: `${w.id ?? sym}-${addedIso}`,
          symbol: sym || w.symbol,
          company_id: cid,
          groupName: defaultWatchlistGroup(w),
          name: co?.name || sym || w.symbol,
          sector: (co?.sector && String(co.sector).trim()) || '',
          industry: (co?.industry && String(co.industry).trim()) || '',
          addedIso,
          daysSince,
          referencePrice: refPrice,
          currentPrice,
          ma30w: price.ma30w ?? null,
          gainPct,
          gainAbs,
          pctFromMa,
          stage: price.stage ?? null,
          rs: price.rs_vs_nifty,
        }
      })

      console.log('merged watchlist:', mergedBase)

      if (!active) return

      const fatalWl = !!(wlFetchErr && !(watchlistData && watchlistData.length))
      setWatchlistFetchError(fatalWl)

      const mergedCompanyIds = [...new Set(mergedBase.map((m) => m.company_id).filter(Boolean))]

      const [sigRes, holdingsRes, swingDateRes, swingsRes, changesRes] = await Promise.all([
        mergedCompanyIds.length
          ? supabase
              .from('delivery_signals')
              .select('company_id,avg_delivery_30d,date')
              .in('company_id', mergedCompanyIds)
              .order('date', { ascending: false })
              .limit(4000)
          : Promise.resolve({ data: [] }),
        supabase.from('portfolio_holdings').select('*').eq('user_id', userId).limit(200),
        supabase.from('swing_conditions').select('date').order('date', { ascending: false }).limit(1),
        mergedCompanyIds.length
          ? supabase.from('swing_conditions').select('company_id,conditions_met,date').order('date', { ascending: false }).limit(3000)
          : Promise.resolve({ data: [] }),
        mergedCompanyIds.length
          ? supabase
              .from('quarterly_changes')
              .select('company_id,headline_change,watch_next,ai_summary,created_at')
              .in('company_id', mergedCompanyIds)
              .order('created_at', { ascending: false })
              .limit(5000)
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
        const sig = id ? sigByCompany[id] : null
        const qc = id ? changesByCompany[id] : {}

        return {
          ...row,
          close: row.currentPrice ?? (pd?.close != null ? Number(pd.close) : null),
          pctMa: row.pctFromMa,
          gainSinceAddPct: row.gainPct,
          rsVsNifty: pd?.rs_vs_nifty != null && pd.rs_vs_nifty !== '' ? Number(pd.rs_vs_nifty) : null,
          avgDelivery30d: sig?.avg_delivery_30d != null ? Number(sig.avg_delivery_30d) : null,
          headline: qc.headline_change || qc.ai_summary || 'No major recent change',
          conditionsMet: Number(latestSwingByCompany[id]?.conditions_met) || 0,
          updatedAt: qc.created_at || null,
          watchNext: qc.watch_next || null,
        }
      })

      const portfolioData = (holdingsRes.data || []).map((h) => ({
        symbol: h.symbol || h.ticker || '',
        name: h.name || h.company_name || h.symbol || 'Holding',
        invested: Number(h.invested_amount || h.total_invested || (h.quantity || 0) * (h.avg_price || 0) || 0),
        gainLossPct: Number(h.gain_loss_pct || h.pnl_pct || 0),
      }))

      const calendarData = built
        .filter((w) => w.watchNext)
        .slice(0, 30)
        .map((w) => ({ symbol: w.symbol, watchNext: w.watchNext }))

      const recentActivity = built
        .filter((w) => w.updatedAt)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 30)

      setWatchRows(built)
      setPortfolio(portfolioData)
      setCalendar(calendarData)
      setActivity(recentActivity)
      setLoading(false)
    }

    void runLoad()
    return () => {
      active = false
    }
  }, [user?.id])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return watchRows
    return watchRows.filter((w) => w.symbol.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || w.sector.toLowerCase().includes(q))
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

  const invested = useMemo(
    () => portfolio.reduce((sum, p) => sum + (Number(p.invested) || 0), 0),
    [portfolio],
  )

  function recalcGains(referencePrice, currentPrice) {
    if (!(referencePrice > 0) || !(currentPrice != null && Number.isFinite(currentPrice))) {
      return { gainPct: null, gainAbs: null }
    }
    const gp = ((currentPrice - referencePrice) / referencePrice) * 100
    return { gainPct: gp, gainAbs: currentPrice - referencePrice }
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
      .eq('id', row.wlId)
      .eq('user_id', user.id)
    console.log('[watchlist ref patch]', row.symbol, val, error)
    if (!error) {
      const { gainPct, gainAbs } = recalcGains(val, row.currentPrice)
      setWatchRows((prev) =>
        prev.map((r) =>
          r.rowKey === row.rowKey
            ? { ...r, referencePrice: val, gainPct, gainAbs, gainSinceAddPct: gainPct }
            : r,
        ),
      )
    }
  }

  async function removeFromWatchlistRow(row) {
    if (!user?.id || !hasSupabaseEnv || row?.wlId == null) return
    if (!window.confirm(`Remove ${row.symbol} from your watchlist?`)) return
    const { error } = await supabase
      .from(row._sourceTable || 'watchlists')
      .delete()
      .eq('id', row.wlId)
      .eq('user_id', user.id)
    console.log('[watchlist delete]', row.symbol, row._sourceTable, error)
    if (!error) setWatchRows((prev) => prev.filter((r) => r.rowKey !== row.rowKey))
  }

  function renderWatchSummary(rows) {
    const n = rows.length
    if (!n) return null
    const gainsNumeric = rows.map((r) => r.gainPct).filter((g) => g != null && Number.isFinite(g))
    const rawAvgSum = rows.reduce((s, w) => s + (w.gainPct != null && Number.isFinite(w.gainPct) ? w.gainPct : 0), 0)
    const avgGain = rawAvgSum / n
    const bestGain = gainsNumeric.length ? Math.max(...gainsNumeric) : null
    const bestSymbol = rows.find((r) => r.gainPct === bestGain)?.symbol || rows[0].symbol

    const fmt = (x) =>
      typeof x === 'number' && Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}%` : '—'

    return (
      <p className="mb-3 text-[12px]" style={{ color: TEXT }}>
        {n} stocks · Avg gain: {fmt(avgGain)} · Best: {bestSymbol}{' '}
        {bestGain != null ? fmt(bestGain) : '—'}
      </p>
    )
  }

  function renderWatchlistTable(rows) {
    return (
      <div
        className="w-full overflow-x-auto rounded-md border border-solid"
        style={{ borderColor: BORDER, background: '#0B0E11', borderRadius: 6 }}
      >
        <table className="w-full border-collapse" style={{ minWidth: 880 }}>
          <thead>
            <tr>
              <th style={{ ...TH_STYLE }}>Stock</th>
              <th style={{ ...TH_STYLE }}>Since</th>
              <th style={{ ...TH_STYLE, textAlign: 'right' }}>Ref price</th>
              <th style={{ ...TH_STYLE, textAlign: 'right' }}>CMP</th>
              <th style={{ ...TH_STYLE, textAlign: 'right' }}>Gain</th>
              <th style={{ ...TH_STYLE, textAlign: 'right' }}>% from 30W MA</th>
              <th style={{ ...TH_STYLE }}>Stage</th>
              <th style={{ ...TH_STYLE, width: 44, textAlign: 'center' }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const rowKey = w.rowKey
              const hover = hoveredRow === rowKey
              const pctMa = w.pctFromMa
              const pctColor = pctFromMaColorForWatch(pctMa)
              const pctStr =
                pctMa != null && Number.isFinite(pctMa) ? `${pctMa >= 0 ? '+' : ''}${pctMa.toFixed(2)}%` : '—'
              const gStyle = gainCellStyle(w.gainPct)
              const gainPctStr =
                w.gainPct != null && Number.isFinite(w.gainPct)
                  ? `${w.gainPct >= 0 ? '+' : ''}${w.gainPct.toFixed(1)}%`
                  : '—'
              const signedAbsRupee =
                w.gainAbs != null && Number.isFinite(w.gainAbs)
                  ? `${w.gainAbs >= 0 ? '+' : '−'}${formatInr(Math.abs(w.gainAbs))}`
                  : '—'

              let dateLine = '—'
              let daysLine = ''
              if (w.addedIso) {
                const d = new Date(w.addedIso)
                if (!Number.isNaN(d.getTime())) {
                  dateLine = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                  daysLine =
                    typeof w.daysSince === 'number' && Number.isFinite(w.daysSince)
                      ? `${w.daysSince === 0 ? 'Today' : `${w.daysSince} day${w.daysSince === 1 ? '' : 's'} ago`}`
                      : ''
                }
              }

              return (
                <tr
                  key={rowKey}
                  onClick={() => navigate(`/stock/${w.symbol}`)}
                  onMouseEnter={() => setHoveredRow(rowKey)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    cursor: 'pointer',
                    background: hover ? HOVER_ROW : 'transparent',
                  }}
                >
                  <td style={{ ...TD_STYLE }}>
                    <div className="font-bold" style={{ color: TEXT, fontSize: 13 }}>
                      {w.symbol}
                    </div>
                    <div className="leading-tight" style={{ color: MUTED, fontSize: 10 }}>
                      {w.name || '—'}
                    </div>
                    <div className="truncate leading-tight" style={{ color: MUTED, fontSize: 10, maxWidth: 200 }}>
                      {w.sector || '—'}
                    </div>
                  </td>
                  <td style={{ ...TD_STYLE }}>
                    <div className="leading-tight" style={{ color: MUTED, fontSize: 10 }}>
                      {dateLine}
                    </div>
                    <div className="leading-tight" style={{ color: MUTED, fontSize: 10 }}>
                      {daysLine || '—'}
                    </div>
                  </td>
                  <td
                    className="font-data tabular-nums text-right"
                    style={{ ...TD_STYLE }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{formatInr(w.referencePrice)}</span>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center justify-center rounded border-0 bg-transparent p-0"
                        style={{ color: MUTED }}
                        title="Edit reference price"
                        aria-label={`Edit reference price for ${w.symbol}`}
                        onClick={() => void patchReferencePrice(w)}
                      >
                        <i className="ti ti-pencil text-[14px]" aria-hidden />
                      </button>
                    </div>
                  </td>
                  <td
                    className="font-data tabular-nums text-right font-bold"
                    style={{ ...TD_STYLE, fontSize: 14, color: TEXT }}
                  >
                    {formatInr(w.currentPrice)}
                  </td>
                  <td className="text-right font-data tabular-nums" style={{ ...TD_STYLE }}>
                    <div
                      className="font-semibold"
                      style={{
                        color: gStyle.pctColor,
                        fontWeight: gStyle.pctWeight,
                      }}
                    >
                      {gainPctStr}
                    </div>
                    <div className="text-[11px]" style={{ color: MUTED }}>
                      {signedAbsRupee}
                    </div>
                  </td>
                  <td
                    className="font-data tabular-nums text-right font-semibold"
                    style={{ ...TD_STYLE, color: pctColor }}
                  >
                    {pctStr}
                  </td>
                  <td style={{ ...TD_STYLE }}>
                    <StagePill stage={w.stage} className="rounded-md px-2 py-0.5 text-[10px]" />
                  </td>
                  <td style={{ ...TD_STYLE, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded border-0 bg-transparent p-0"
                      style={{ color: MUTED }}
                      title="Remove from watchlist"
                      aria-label={`Remove ${w.symbol}`}
                      onClick={() => void removeFromWatchlistRow(w)}
                    >
                      <i className="ti ti-x text-[18px]" aria-hidden />
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

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              title="Home"
              aria-label="Go to Home"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: C.border, background: C.surface2, color: C.text }}
            >
              <i className="ti ti-home text-base" aria-hidden />
              Home
            </button>
            <h1 className="text-2xl font-bold" style={{ color: C.text }}>
              Dashboard
            </h1>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search watchlist..."
            className="w-full max-w-md rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: C.border, background: C.surface, color: C.text }}
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton height={200} />
            <Skeleton height={160} />
            <Skeleton height={220} />
          </div>
        ) : (
          <>
            <section>
              <SectionLabel text="Watchlist" />
              {watchlistFetchError ? (
                <p className="text-[13px]" style={{ color: '#FCA5A5' }}>
                  Failed to load watchlist. Please refresh.
                </p>
              ) : !watchRows.length ? (
                <div
                  className="flex flex-col items-center justify-center rounded-md border border-dashed px-6 py-12 text-center"
                  style={{ borderColor: BORDER, background: '#0F1217', borderRadius: 6 }}
                >
                  <i className="ti ti-bookmark mb-3 text-5xl" style={{ color: MUTED }} aria-hidden />
                  <p className="text-[15px] font-semibold" style={{ color: TEXT }}>
                    Your watchlist is empty
                  </p>
                  <p className="mt-1 max-w-md text-[12px] leading-relaxed" style={{ color: MUTED }}>
                    Visit any stock page and click + Watchlist to track it.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="mt-5 rounded-lg border px-4 py-2 text-[13px] font-semibold"
                    style={{ borderColor: BORDER, color: TEXT, background: '#141820' }}
                  >
                    Browse stocks →
                  </button>
                </div>
              ) : !filteredRows.length ? (
                <p className="text-[13px]" style={{ color: MUTED }}>
                  No stocks match your search.
                </p>
              ) : (
                <div className="flex flex-col">
                  {renderWatchSummary(filteredRows)}
                  <div className="flex flex-col gap-6">
                    {groupedFiltered.map(({ name, rows }) => (
                      <div key={name}>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                          {name}
                        </p>
                        {renderWatchlistTable(rows)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section>
              <SectionLabel text="Full Portfolio Summary" />
              <Card>
                <p className="text-sm font-semibold" style={{ color: C.text }}>
                  Your portfolio — ₹{invested.toLocaleString('en-IN')} invested
                </p>
                <div className="mt-2 space-y-1">
                  {portfolio.length ? (
                    portfolio.map((p, idx) => (
                      <button
                        key={`${p.symbol}-${idx}`}
                        type="button"
                        onClick={() => navigate('/portfolio')}
                        className="flex w-full items-center justify-between rounded-md border px-2 py-1 text-sm"
                        style={{ borderColor: C.border, background: C.surface2 }}
                      >
                        <span style={{ color: C.text }}>{p.name}</span>
                        <span style={{ color: p.gainLossPct >= 0 ? C.green : C.red }}>
                          {p.gainLossPct >= 0 ? '+' : ''}
                          {p.gainLossPct.toFixed(2)}%
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="text-sm" style={{ color: C.textMuted }}>
                      No holdings found.
                    </p>
                  )}
                </div>
              </Card>
            </section>

            <section>
              <SectionLabel text="Results Calendar — Next 30 Days" />
              <Card>
                {calendar.length ? (
                  <div className="space-y-1">
                    {calendar.map((c, idx) => (
                      <p key={`${c.symbol}-${idx}`} className="text-sm" style={{ color: C.text }}>
                        {c.symbol} results expected: ~{c.watchNext}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: C.textMuted }}>
                    No upcoming results in your watchlist.
                  </p>
                )}
              </Card>
            </section>

            <section>
              <SectionLabel text="Recent Activity — This Week" />
              <Card>
                {activity.length ? (
                  <div className="space-y-2">
                    {activity.map((a) => (
                      <button
                        key={`${a.symbol}-${a.updatedAt}`}
                        type="button"
                        onClick={() => navigate(`/stock/${a.symbol}`)}
                        className="w-full rounded-md border px-2 py-2 text-left"
                        style={{ borderColor: C.border, background: C.surface2 }}
                      >
                        <p className="text-sm font-medium" style={{ color: C.text }}>
                          {a.symbol}
                        </p>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {String(a.headline || '').replaceAll('_', ' ')}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: C.textMuted }}>
                    No recent watchlist changes found.
                  </p>
                )}
              </Card>
            </section>
          </>
        )}
      </div>
      {toast ? (
        <div
          className="fixed bottom-8 left-1/2 z-50 max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-lg border border-border-subtle bg-surface px-4 py-3 text-center text-sm text-[#E2E8F0] shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </>
  )
}
