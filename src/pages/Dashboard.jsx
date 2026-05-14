import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Skeleton from '../components/ui/Skeleton'
import SectionLabel from '../components/ui/SectionLabel'
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
  const [watchlistFetchError, setWatchlistFetchError] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editPrice, setEditPrice] = useState('')

  async function buildWatchlistBuilt(userId, watchlistData) {
    const watchRowsRaw = watchlistData || []

    const symbols = [...new Set(watchRowsRaw.map((w) => String(w.symbol || '').trim().toUpperCase()).filter(Boolean))]

    const companiesRes = symbols.length
      ? await supabase.from('companies').select('id,symbol,name,sector,industry').in('symbol', symbols)
      : { data: [] }
    const companyBySymbol = {}
    for (const c of companiesRes.data || []) {
      companyBySymbol[String(c.symbol || '').trim().toUpperCase()] = c
    }

    const companyIdsForPrices = [...new Set(
      watchRowsRaw.map((w) => {
        const symU = String(w.symbol || '').trim().toUpperCase()
        const co = companyBySymbol[symU]
        return w.company_id ?? co?.id ?? null
      }).filter(Boolean),
    )]

    let prices = []
    if (companyIdsForPrices.length > 0) {
      const pr = await supabase
        .from('price_data')
        .select('company_id, close, stage, ma30w, ma150, rs_vs_nifty, rsi, obv_slope')
        .eq('is_latest', true)
        .in('company_id', companyIdsForPrices)
      prices = pr.data || []
    }

    const priceMap = {}
    prices.forEach((p) => { priceMap[p.company_id] = p })

    const mergedBase = watchRowsRaw.map((w) => {
      const symU = String(w.symbol || '').trim().toUpperCase()
      const co = companyBySymbol[symU] || {}
      const cid = w.company_id ?? co?.id ?? null
      const price = cid ? priceMap[cid] || {} : {}

      const refFromFields = watchlistReferencePrice(w)
      const refPrice = refFromFields != null && Number.isFinite(refFromFields) && refFromFields > 0 ? refFromFields : null
      const currentPrice = price.close != null && Number.isFinite(Number(price.close)) ? Number(price.close) : null

      let gainPct = null
      let gainAbs = null
      if (refPrice != null && refPrice !== 0 && currentPrice != null) {
        gainPct = ((currentPrice - refPrice) / refPrice) * 100
        gainAbs = currentPrice - refPrice
      }

      let pctFromMa = null
      const pClose = Number(price.close)
      const ma150 = Number(price.ma150)
      if (Number.isFinite(pClose) && Number.isFinite(ma150) && ma150 !== 0) {
        pctFromMa = ((pClose - ma150) / ma150) * 100
      }

      const refDateStr = w.reference_date || (w.created_at ? String(w.created_at).split('T')[0] : null)
      const daysSince = refDateStr
        ? Math.floor((Date.now() - new Date(`${refDateStr}T12:00:00`).getTime()) / 86400000)
        : null
      const addedIso = w.created_at ?? null

      return {
        id: w.id,
        wlId: w.id,
        rowKey: `${w.id ?? symU}-${addedIso ?? symU}`,
        symbol: symU || w.symbol,
        company_id: cid,
        groupName: defaultWatchlistGroup(w),
        name: co?.name || symU || w.symbol,
        sector: (co?.sector && String(co.sector).trim()) || '',
        industry: (co?.industry && String(co.industry).trim()) || '',
        reference_date: w.reference_date || null,
        created_at: w.created_at ?? null,
        addedIso,
        daysSince,
        referencePrice: refPrice,
        refPrice,
        currentPrice,
        ma30w: price.ma30w ?? null,
        gainPct,
        gainAbs,
        pctFromMa,
        stage: price.stage ?? null,
        rs: price.rs_vs_nifty,
      }
    })

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
        pctMa: row.pctFromMa,
        gainSinceAddPct: row.gainPct,
        rsVsNifty: pd?.rs_vs_nifty != null && pd.rs_vs_nifty !== '' ? Number(pd.rs_vs_nifty) : null,
        avgDelivery30d: sigByCompany[id]?.avg_delivery_30d != null ? Number(sigByCompany[id].avg_delivery_30d) : null,
        headline: changes?.headline_change || changes?.ai_summary || 'No major recent change',
        conditionsMet: Number(latestSwingByCompany[id]?.conditions_met) || 0,
        updatedAt: changes?.created_at || null,
        watchNext: changes?.watch_next || null,
      }
    })

    const portfolioData = (holdingsRes.data || []).map((h) => ({
      symbol: h.symbol || h.ticker || '',
      name: h.name || h.company_name || h.symbol || 'Holding',
      invested: Number(h.invested_amount || h.total_invested || (h.quantity || 0) * (h.avg_price || 0) || 0),
      gainLossPct: Number(h.gain_loss_pct || h.pnl_pct || 0),
    }))

    return { built, portfolioData }
  }

  async function loadWatchlist() {
    if (!user?.id || !hasSupabaseEnv) return
    const { data: watchlistData, error: wlFetchErr } = await loadUserWatchlist(user.id)
    const { built, portfolioData } = await buildWatchlistBuilt(user.id, watchlistData)
    setWatchlistFetchError(!!(wlFetchErr && !(watchlistData && watchlistData.length)))
    setWatchRows(built)
    setPortfolio(portfolioData)
    setCalendar(built.filter((w) => w.watchNext).slice(0, 30).map((w) => ({ symbol: w.symbol, watchNext: w.watchNext })))
    setActivity(
      built
        .filter((w) => w.updatedAt)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 30),
    )
  }

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

      const { data: watchlistData, error: wlFetchErr } = await loadUserWatchlist(userId)
      const { built, portfolioData } = await buildWatchlistBuilt(userId, watchlistData)

      if (!active) return
      setWatchlistFetchError(!!(wlFetchErr && !(watchlistData && watchlistData.length)))

      setWatchRows(built)
      setPortfolio(portfolioData)
      setCalendar(built.filter((w) => w.watchNext).slice(0, 30).map((w) => ({ symbol: w.symbol, watchNext: w.watchNext })))
      setActivity(
        built
          .filter((w) => w.updatedAt)
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
          .slice(0, 30),
      )
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

  const invested = useMemo(() => portfolio.reduce((s, p) => s + (Number(p.invested) || 0), 0), [portfolio])

  return (
    <>
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
            {/* Full watchlist */}
            <section>
              <SectionLabel text="Full Watchlist" />
              {watchlistFetchError ? (
                <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: C.border, color: C.red, background: C.surface }}>
                  Failed to load watchlist. Please refresh.
                </div>
              ) : !watchRows.length ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border py-12 text-center" style={{ borderColor: C.border, background: C.surface }}>
                  <span style={{ fontSize: 28, color: C.textMuted }}>☆</span>
                  <p style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>No stocks in watchlist</p>
                  <p style={{ color: C.textMuted, fontSize: 12 }}>Visit any stock page and click Add to Watchlist</p>
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="mt-1 rounded-lg border px-4 py-2 text-xs font-semibold"
                    style={{ borderColor: C.border, background: C.blueBg, color: C.blue }}
                  >
                    Browse stocks →
                  </button>
                </div>
              ) : !filteredRows.length ? (
                <p className="text-sm" style={{ color: C.textMuted }}>No stocks match your search.</p>
              ) : (
                <>
                  {filteredRows.length > 0 && (() => {
                    const withGains = filteredRows.filter((w) => w.gainPct != null)
                    const avgGain = withGains.length ? withGains.reduce((s, w) => s + w.gainPct, 0) / withGains.length : null
                    const best = withGains.length ? withGains.reduce((a, b) => (a.gainPct > b.gainPct ? a : b)) : null
                    const worst = withGains.length ? withGains.reduce((a, b) => (a.gainPct < b.gainPct ? a : b)) : null
                    return (
                      <div
                        className="mb-2 flex flex-wrap items-center gap-4 rounded-lg border px-4 py-2.5 text-xs"
                        style={{ borderColor: C.border, background: C.surface }}
                      >
                        <span style={{ color: C.textMuted }}>{filteredRows.length} stocks</span>
                        {avgGain != null && (
                          <span style={{ color: avgGain >= 0 ? C.green : C.red, fontWeight: 600 }}>
                            Avg {avgGain >= 0 ? '+' : ''}{avgGain.toFixed(1)}%
                          </span>
                        )}
                        {best && (
                          <span style={{ color: C.green }}>
                            Best: {best.symbol} +{best.gainPct.toFixed(1)}%
                          </span>
                        )}
                        {worst && worst.symbol !== best?.symbol && (
                          <span style={{ color: C.red }}>
                            Worst: {worst.symbol} {worst.gainPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )
                  })()}
                  <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.border }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                          {['Stock', 'Added', 'Ref ₹', 'CMP', 'Gain %', 'Gain ₹', 'vs 150MA', 'Stage', ''].map((h) => (
                            <th
                              key={h || 'x'}
                              style={{
                                padding: '8px 12px',
                                textAlign: h === 'Stock' ? 'left' : 'right',
                                fontSize: 10,
                                color: C.textMuted,
                                fontWeight: 500,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((item) => {
                          const stageCfg = {
                            'Stage 2': { c: C.green, bg: C.greenBg, b: C.greenBorder },
                            'Stage 1': { c: C.blue, bg: C.blueBg, b: C.borderHover },
                            'Stage 3': { c: C.amber, bg: C.amberBg, b: C.amberBorder },
                            'Stage 4': { c: C.red, bg: C.redBg, b: C.redBorder },
                          }
                          const sc = stageCfg[item.stage] || { c: C.textMuted, bg: C.surface2, b: C.border }
                          const gainColor = item.gainPct == null
                            ? C.textMuted
                            : item.gainPct >= 10
                              ? C.green
                              : item.gainPct >= 0
                                ? C.accent
                                : item.gainPct >= -5
                                  ? C.amber
                                  : C.red
                          const maColor = item.pctFromMa == null
                            ? C.textMuted
                            : item.pctFromMa > 5
                              ? C.green
                              : item.pctFromMa > -3
                                ? C.amber
                                : C.red
                          return (
                            <tr
                              key={item.id}
                              style={{
                                borderBottom: `1px solid ${C.surface2}`,
                                cursor: 'pointer',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceCard }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                            >
                              <td
                                style={{ padding: '10px 12px' }}
                                onClick={() => navigate(`/stock/${item.symbol}`)}
                              >
                                <p style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{item.symbol}</p>
                                <p style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>{item.sector}</p>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: C.textMuted, whiteSpace: 'nowrap' }}>
                                <div>{item.reference_date || item.created_at?.split('T')[0] || '—'}</div>
                                {item.daysSince != null && (
                                  <div style={{ fontSize: 10 }}>{item.daysSince}d ago</div>
                                )}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                {editingId === item.id ? (
                                  <input
                                    value={editPrice}
                                    onChange={(e) => setEditPrice(e.target.value)}
                                    autoFocus
                                    style={{
                                      width: 72,
                                      textAlign: 'right',
                                      fontSize: 11,
                                      background: C.surface2,
                                      border: `1px solid ${C.border}`,
                                      borderRadius: 4,
                                      padding: '2px 6px',
                                      color: C.text,
                                    }}
                                    onKeyDown={async (e) => {
                                      if (e.key === 'Enter') {
                                        const val = parseFloat(editPrice)
                                        if (!user?.id) return
                                        if (!Number.isNaN(val)) {
                                          await supabase
                                            .from('watchlist')
                                            .update({
                                              reference_price: val,
                                              reference_date: new Date().toISOString().split('T')[0],
                                            })
                                            .eq('id', item.id)
                                            .eq('user_id', user.id)
                                          setEditingId(null)
                                          void loadWatchlist()
                                        }
                                      }
                                      if (e.key === 'Escape') setEditingId(null)
                                    }}
                                  />
                                ) : (
                                  <span
                                    title="Click to edit"
                                    style={{ color: C.textMuted, cursor: 'pointer' }}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditingId(item.id)
                                      setEditPrice(item.refPrice != null ? String(item.refPrice) : '')
                                    }}
                                  >
                                    {item.refPrice != null
                                      ? `₹${item.refPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                                      : '—'}
                                    <span style={{ marginLeft: 4, fontSize: 10, color: C.border }}>✎</span>
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: C.text }}>
                                {item.currentPrice != null
                                  ? `₹${item.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`
                                  : '—'}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: 13, color: gainColor }}>
                                {item.gainPct != null ? `${item.gainPct >= 0 ? '+' : ''}${item.gainPct.toFixed(2)}%` : '—'}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: gainColor }}>
                                {item.gainAbs != null
                                  ? `${item.gainAbs >= 0 ? '+₹' : '-₹'}${Math.abs(item.gainAbs).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: maColor }}>
                                {item.pctFromMa != null ? `${item.pctFromMa > 0 ? '+' : ''}${item.pctFromMa.toFixed(1)}%` : '—'}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                <span
                                  style={{
                                    background: sc.bg,
                                    color: sc.c,
                                    border: `1px solid ${sc.b}`,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: 3,
                                  }}
                                >
                                  {item.stage || '—'}
                                </span>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (!user?.id) return
                                    if (window.confirm(`Remove ${item.symbol} from watchlist?`)) {
                                      await supabase.from('watchlist').delete().eq('id', item.id).eq('user_id', user.id)
                                      void loadWatchlist()
                                    }
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: C.border,
                                    cursor: 'pointer',
                                    padding: 4,
                                    fontSize: 14,
                                    borderRadius: 4,
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = C.red }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = C.border }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
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
