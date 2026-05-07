import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/ui/Card'
import SectionLabel from '../components/ui/SectionLabel'
import Skeleton from '../components/ui/Skeleton'
import { C } from '../styles/tokens'
import { useAuth } from '../context'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

const TOAST_KEY = 'stockiq_toast'

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [watchlist, setWatchlist] = useState([])
  const [portfolio, setPortfolio] = useState([])
  const [calendar, setCalendar] = useState([])
  const [activity, setActivity] = useState([])

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
    if (!user?.id || !hasSupabaseEnv) return
    let active = true
    async function load() {
      setLoading(true)
      const userId = user.id
      const [watchRes, holdingsRes] = await Promise.all([
        supabase.from('watchlist').select('symbol,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
        supabase.from('portfolio_holdings').select('*').eq('user_id', userId).limit(200),
      ])

      const symbols = [...new Set((watchRes.data || []).map((w) => w.symbol).filter(Boolean))]
      const companiesRes = symbols.length
        ? await supabase.from('companies').select('id,symbol,name').in('symbol', symbols)
        : { data: [] }
      const companyBySymbol = Object.fromEntries((companiesRes.data || []).map((c) => [c.symbol, c]))
      const companyIds = (companiesRes.data || []).map((c) => c.id).filter(Boolean)

      const [swingDateRes, swingsRes, changesRes] = await Promise.all([
        supabase.from('swing_conditions').select('trading_date').order('trading_date', { ascending: false }).limit(1),
        symbols.length
          ? supabase.from('swing_conditions').select('symbol,conditions_met,trading_date').order('trading_date', { ascending: false }).limit(3000)
          : Promise.resolve({ data: [] }),
        companyIds.length
          ? supabase.from('quarterly_changes').select('company_id,headline,watch_next,updated_at').in('company_id', companyIds).order('updated_at', { ascending: false }).limit(5000)
          : Promise.resolve({ data: [] }),
      ])

      const latestSwingDate = swingDateRes.data?.[0]?.trading_date
      const latestSwingBySymbol = {}
      for (const s of swingsRes.data || []) {
        if (!s?.symbol) continue
        if (latestSwingDate && s.trading_date !== latestSwingDate) continue
        if (!latestSwingBySymbol[s.symbol]) latestSwingBySymbol[s.symbol] = s
      }

      const changesByCompany = {}
      for (const c of changesRes.data || []) {
        if (!c?.company_id || changesByCompany[c.company_id]) continue
        changesByCompany[c.company_id] = c
      }

      const watchData = symbols.map((symbol) => {
        const c = companyBySymbol[symbol] || {}
        const qc = changesByCompany[c.id] || {}
        return {
          symbol,
          name: c.name || symbol,
          headline: qc.headline || 'No major recent change',
          conditionsMet: Number(latestSwingBySymbol[symbol]?.conditions_met) || 0,
          updatedAt: qc.updated_at || null,
          watchNext: qc.watch_next || null,
        }
      })

      const portfolioData = (holdingsRes.data || []).map((h) => ({
        symbol: h.symbol || h.ticker || '',
        name: h.name || h.company_name || h.symbol || 'Holding',
        invested: Number(h.invested_amount || h.total_invested || (h.quantity || 0) * (h.avg_price || 0) || 0),
        gainLossPct: Number(h.gain_loss_pct || h.pnl_pct || 0),
      }))

      const calendarData = watchData
        .filter((w) => w.watchNext)
        .slice(0, 30)
        .map((w) => ({ symbol: w.symbol, watchNext: w.watchNext }))

      const recentActivity = watchData
        .filter((w) => w.updatedAt)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 30)

      if (!active) return
      setWatchlist(watchData)
      setPortfolio(portfolioData)
      setCalendar(calendarData)
      setActivity(recentActivity)
      setLoading(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [user?.id])

  const filteredWatchlist = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return watchlist
    return watchlist.filter((w) => w.symbol.toLowerCase().includes(q) || w.name.toLowerCase().includes(q))
  }, [query, watchlist])

  const invested = useMemo(
    () => portfolio.reduce((sum, p) => sum + (Number(p.invested) || 0), 0),
    [portfolio],
  )

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>Dashboard</h1>
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
            <Skeleton height={160} />
            <Skeleton height={240} />
            <Skeleton height={220} />
          </div>
        ) : (
          <>
            <section>
              <SectionLabel text="Full Watchlist" />
              {filteredWatchlist.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredWatchlist.map((w) => (
                    <button
                      key={w.symbol}
                      type="button"
                      onClick={() => navigate(`/stock/${w.symbol}`)}
                      className="text-left"
                    >
                      <Card>
                        <p className="text-sm font-semibold" style={{ color: C.text }}>{w.symbol} - {w.name}</p>
                        <p className="mt-1 line-clamp-2 text-xs" style={{ color: C.textMuted }}>
                          {String(w.headline).replaceAll('_', ' ')}
                        </p>
                        <p className="mt-2 text-xs" style={{ color: C.amber }}>
                          {w.conditionsMet}/5 swing conditions
                        </p>
                      </Card>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm" style={{ color: C.textMuted }}>No watchlist stocks found.</p>
              )}
            </section>

            <section>
              <SectionLabel text="Full Portfolio Summary" />
              <Card>
                <p className="text-sm font-semibold" style={{ color: C.text }}>
                  Your portfolio — ₹{invested.toLocaleString()} invested
                </p>
                <div className="mt-2 space-y-1">
                  {portfolio.length ? portfolio.map((p, idx) => (
                    <button
                      key={`${p.symbol}-${idx}`}
                      type="button"
                      onClick={() => navigate('/portfolio')}
                      className="flex w-full items-center justify-between rounded-md border px-2 py-1 text-sm"
                      style={{ borderColor: C.border, background: C.surface2 }}
                    >
                      <span style={{ color: C.text }}>{p.name}</span>
                      <span style={{ color: p.gainLossPct >= 0 ? C.green : C.red }}>
                        {p.gainLossPct >= 0 ? '+' : ''}{p.gainLossPct.toFixed(2)}%
                      </span>
                    </button>
                  )) : (
                    <p className="text-sm" style={{ color: C.textMuted }}>No holdings found.</p>
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
                  <p className="text-sm" style={{ color: C.textMuted }}>No upcoming results in your watchlist.</p>
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
                        <p className="text-sm font-medium" style={{ color: C.text }}>{a.symbol}</p>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {String(a.headline || '').replaceAll('_', ' ')}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: C.textMuted }}>No recent watchlist changes found.</p>
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
