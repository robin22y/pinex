import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import AdUnit from '../components/AdUnit'
import DailyScanner from '../components/DailyScanner'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import SectionLabel from '../components/ui/SectionLabel'
import { useAuth } from '../context'
import { usePlan } from '../hooks/usePlan'
import { signInWithGoogle } from '../lib/auth'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

const RECENT_SEARCHES_KEY = 'stockiq_recent_searches'

function greetingLabel() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function stageToStatus(stage) {
  const v = String(stage || '').toLowerCase().replace(/\s+/g, '')
  if (v === 'stage2') return 'green'
  if (v === 'stage1') return 'amber'
  if (v === 'stage3' || v === 'stage4') return 'red'
  return 'neutral'
}

function stageLabel(stage) {
  const value = String(stage || '').toUpperCase()
  return value || 'N/A'
}

function initials(name, email) {
  const source = String(name || email || '').trim()
  if (!source) return 'U'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || 'U'
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function formatLastUpdated(ts) {
  if (!ts) return 'Just now'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'Just now'
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function loadRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 5) : []
  } catch {
    return []
  }
}

function saveRecentSearch(item) {
  const prev = loadRecentSearches()
  const next = [item, ...prev.filter((x) => x?.symbol !== item?.symbol)].slice(0, 5)
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
}

function LockedCta() {
  return (
    <div className="mt-3 rounded-lg border p-3 text-center" style={{ borderColor: C.border, background: C.surface2 }}>
      <p className="mb-2 text-xs" style={{ color: C.textMuted }}>
        Sign up free with Google — takes 10 seconds
      </p>
      <button
        type="button"
        onClick={signInWithGoogle}
        className="rounded-lg px-3 py-2 text-sm font-medium"
        style={{ color: C.blue, border: `1px solid ${C.border}`, background: C.blueBg }}
      >
        Continue with Google
      </button>
    </div>
  )
}

function PulseList({ items, locked, renderItem }) {
  const visible = locked ? items.slice(0, 3) : items
  return (
    <>
      <div className="space-y-2">
        {visible.map((item, idx) => (
          <div key={item.symbol || item.name || idx}>{renderItem(item)}</div>
        ))}
        {locked && items.length > 3 ? (
          <div
            className="relative overflow-hidden rounded-lg border p-3"
            style={{ borderColor: C.border, background: C.surface2, color: C.textMuted }}
          >
            <p className="blur-[2px]">More stocks are available after signup</p>
            <span className="absolute right-3 top-2">🔒</span>
          </div>
        ) : null}
      </div>
      {locked ? <LockedCta /> : null}
    </>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { user, profile, loading } = useAuth()
  const { isPaid } = usePlan()
  const loggedIn = Boolean(user)
  const [lastUpdated, setLastUpdated] = useState(null)

  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [recentSearches, setRecentSearches] = useState(() => loadRecentSearches())
  const [searchOpen, setSearchOpen] = useState(false)

  const [marketPulse, setMarketPulse] = useState({
    breakingOut: [],
    newStage2: [],
    unusualDelivery: [],
    changedThisWeek: [],
    swingSetups: [],
    sectors: [],
  })
  const [watchlist, setWatchlist] = useState([])
  const [resultsCalendar, setResultsCalendar] = useState([])
  const [portfolio, setPortfolio] = useState([])

  const displayName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.user_metadata?.name?.trim() ||
    user?.email ||
    'there'

  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true

    async function loadPulse() {
      try {
        const latestSwingRes = await supabase
          .from('swing_conditions')
          .select('trading_date')
          .order('trading_date', { ascending: false })
          .limit(1)
        const latestSwingDate = latestSwingRes.data?.[0]?.trading_date

        const latestDeliveryRes = await supabase
          .from('delivery_data')
          .select('trading_date')
          .order('trading_date', { ascending: false })
          .limit(1)
        const latestDeliveryDate = latestDeliveryRes.data?.[0]?.trading_date

        const latestPriceRes = await supabase
          .from('price_data')
          .select('trading_date')
          .order('trading_date', { ascending: false })
          .limit(1)
        const latestPriceDate = latestPriceRes.data?.[0]?.trading_date

        const [swingRes, deliveryRes, priceRes, quarterlyRes, sectorsRes, companiesRes] = await Promise.all([
          latestSwingDate
            ? supabase
                .from('swing_conditions')
                .select('symbol,conditions_met,breakout_52w,stage2_new_this_week,trading_date')
                .eq('trading_date', latestSwingDate)
            : Promise.resolve({ data: [] }),
          latestDeliveryDate
            ? supabase
                .from('delivery_data')
                .select('symbol,delivery_pct,vs_30d_avg,is_unusual,trading_date')
                .eq('trading_date', latestDeliveryDate)
            : Promise.resolve({ data: [] }),
          latestPriceDate
            ? supabase
                .from('price_data')
                .select('symbol,stage,is_52w_high,trading_date')
                .eq('trading_date', latestPriceDate)
            : Promise.resolve({ data: [] }),
          supabase
            .from('quarterly_changes')
            .select('company_id,headline,changes,updated_at')
            .order('updated_at', { ascending: false })
            .limit(400),
          supabase
            .from('sectors')
            .select('sector,health,stage2_count,total_companies,total_count,trading_date')
            .order('trading_date', { ascending: false })
            .limit(100),
          supabase.from('companies').select('id,symbol,name,sector').limit(1200),
        ])

        const companies = companiesRes.data || []
        const bySymbol = Object.fromEntries(companies.map((c) => [c.symbol, c]))
        const byId = Object.fromEntries(companies.map((c) => [c.id, c]))
        const stageBySymbol = Object.fromEntries((priceRes.data || []).map((p) => [p.symbol, p.stage]))

        const breakingOut = (swingRes.data || [])
          .filter((r) => r.breakout_52w)
          .map((r) => ({
            symbol: r.symbol,
            name: bySymbol[r.symbol]?.name || r.symbol,
            stage: stageBySymbol[r.symbol],
            delivery: (deliveryRes.data || []).find((d) => d.symbol === r.symbol)?.vs_30d_avg || null,
          }))
          .slice(0, 8)

        const newStage2 = (swingRes.data || [])
          .filter((r) => r.stage2_new_this_week)
          .map((r) => ({
            symbol: r.symbol,
            name: bySymbol[r.symbol]?.name || r.symbol,
            stage: stageBySymbol[r.symbol],
            delivery: (deliveryRes.data || []).find((d) => d.symbol === r.symbol)?.vs_30d_avg || null,
          }))
          .slice(0, 8)

        const unusualDelivery = (deliveryRes.data || [])
          .filter((d) => Number(d.vs_30d_avg) > 1.8)
          .map((d) => ({
            symbol: d.symbol,
            name: bySymbol[d.symbol]?.name || d.symbol,
            stage: stageBySymbol[d.symbol],
            delivery: d.vs_30d_avg,
          }))
          .slice(0, 8)

        const changedThisWeek = (quarterlyRes.data || [])
          .filter((q) => Array.isArray(q.changes) && q.changes.some((c) => c?.is_first_time))
          .map((q) => ({
            symbol: byId[q.company_id]?.symbol || '',
            name: byId[q.company_id]?.name || 'Unknown',
            headline: q.headline,
          }))
          .filter((x) => x.symbol)
          .slice(0, 8)

        const swingSetups = (swingRes.data || [])
          .filter((r) => Number(r.conditions_met) >= 4)
          .map((r) => ({
            symbol: r.symbol,
            name: bySymbol[r.symbol]?.name || r.symbol,
            conditionsMet: Number(r.conditions_met) || 0,
            stage: stageBySymbol[r.symbol],
          }))
          .slice(0, 8)

        const seenSectors = new Set()
        const sectors = (sectorsRes.data || [])
          .filter((s) => {
            if (!s?.sector || seenSectors.has(s.sector)) return false
            seenSectors.add(s.sector)
            return true
          })
          .slice(0, 25)

        if (!active) return
        setMarketPulse({
          breakingOut,
          newStage2,
          unusualDelivery,
          changedThisWeek,
          swingSetups,
          sectors,
        })
        setLastUpdated(new Date().toISOString())
      } catch {
        if (!active) return
        setMarketPulse({
          breakingOut: [],
          newStage2: [],
          unusualDelivery: [],
          changedThisWeek: [],
          swingSetups: [],
          sectors: [],
        })
      }
    }

    loadPulse()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!loggedIn || !user?.id || !hasSupabaseEnv) return
    let active = true

    async function loadPersonalData() {
      const userId = user.id

      let watchRows
      try {
        const watchRes = await supabase
          .from('watchlist')
          .select('symbol,company_id,created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20)
        watchRows = watchRes.data || []
      } catch {
        watchRows = []
      }

      let holdingsRows
      try {
        const holdingsRes = await supabase
          .from('portfolio_holdings')
          .select('*')
          .eq('user_id', userId)
          .limit(30)
        holdingsRows = holdingsRes.data || []
      } catch {
        holdingsRows = []
      }

      const symbols = [...new Set((watchRows || []).map((w) => w.symbol).filter(Boolean))]
      const [companiesRes, changesRes, swingsRes] = await Promise.all([
        symbols.length
          ? supabase.from('companies').select('id,symbol,name').in('symbol', symbols)
          : Promise.resolve({ data: [] }),
        symbols.length
          ? supabase
              .from('quarterly_changes')
              .select('headline,watch_next,company_id,updated_at')
              .order('updated_at', { ascending: false })
              .limit(600)
          : Promise.resolve({ data: [] }),
        symbols.length
          ? supabase
              .from('swing_conditions')
              .select('symbol,conditions_met,trading_date')
              .order('trading_date', { ascending: false })
              .limit(1200)
          : Promise.resolve({ data: [] }),
      ])

      const companiesBySymbol = Object.fromEntries((companiesRes.data || []).map((c) => [c.symbol, c]))
      const companiesById = Object.fromEntries((companiesRes.data || []).map((c) => [c.id, c]))

      const latestSwingBySymbol = {}
      for (const row of swingsRes.data || []) {
        if (!row?.symbol || latestSwingBySymbol[row.symbol]) continue
        latestSwingBySymbol[row.symbol] = row
      }

      const watchDecorated = symbols.map((symbol) => {
        const c = companiesBySymbol[symbol] || {}
        const change = (changesRes.data || []).find((q) => companiesById[q.company_id]?.symbol === symbol)
        const swing = latestSwingBySymbol[symbol]
        return {
          symbol,
          name: c.name || symbol,
          headline: change?.headline || 'No major recent change',
          conditionsMet: Number(swing?.conditions_met) || 0,
        }
      })

      const results = (changesRes.data || [])
        .filter((q) => q.watch_next)
        .map((q) => ({
          symbol: companiesById[q.company_id]?.symbol || '',
          watchNext: q.watch_next,
        }))
        .filter((x) => symbols.includes(x.symbol))
        .slice(0, 7)

      const holdings = (holdingsRows || []).map((h) => ({
        symbol: h.symbol || h.ticker || '',
        name: h.name || h.company_name || h.symbol || 'Holding',
        invested: Number(h.invested_amount || h.total_invested || (h.quantity || 0) * (h.avg_price || 0) || 0),
        gainLossPct: Number(h.gain_loss_pct || h.pnl_pct || 0),
      }))

      if (!active) return
      setWatchlist(watchDecorated)
      setResultsCalendar(results)
      setPortfolio(holdings)
    }

    loadPersonalData()
    return () => {
      active = false
    }
  }, [loggedIn, user?.id])

  useEffect(() => {
    if (!hasSupabaseEnv) return
    const q = search.trim()
    const timer = window.setTimeout(async () => {
      if (!q) {
        setSearchResults([])
        return
      }
      try {
        const { data } = await supabase
          .from('companies')
          .select('id,name,symbol,sector')
          .or(`name.ilike.%${q}%,symbol.ilike.%${q}%`)
          .limit(8)

        const symbols = (data || []).map((d) => d.symbol).filter(Boolean)
        let stageBySymbol = {}
        if (symbols.length) {
          const latestDateRes = await supabase
            .from('price_data')
            .select('trading_date')
            .order('trading_date', { ascending: false })
            .limit(1)
          const latestDate = latestDateRes.data?.[0]?.trading_date
          if (latestDate) {
            const stageRes = await supabase
              .from('price_data')
              .select('symbol,stage')
              .eq('trading_date', latestDate)
              .in('symbol', symbols)
            stageBySymbol = Object.fromEntries((stageRes.data || []).map((s) => [s.symbol, s.stage]))
          }
        }

        setSearchResults(
          (data || []).map((d) => ({
            ...d,
            stage: stageBySymbol[d.symbol] || null,
          })),
        )
      } catch {
        setSearchResults([])
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [search])

  const portfolioInvested = useMemo(
    () => portfolio.reduce((sum, p) => sum + (Number(p.invested) || 0), 0),
    [portfolio],
  )

  function goToStock(result) {
    if (!result?.symbol) return
    saveRecentSearch(result)
    setRecentSearches(loadRecentSearches())
    setSearch('')
    setSearchOpen(false)
    navigate(`/stock/${result.symbol}`)
  }

  const lockedForAnon = !loggedIn

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 pt-4 sm:px-6">
      <Helmet>
        <title>StockIQ — Indian Stock Intelligence</title>
        <meta
          name="description"
          content="Plain language analysis of 1,500+ Indian stocks. What changed, who's buying, swing setups — updated daily."
        />
      </Helmet>
      <nav className="mb-6 flex items-center gap-3">
        <Link to="/" className="text-xl font-bold" style={{ color: C.blue }}>
          StockIQ
        </Link>

        <div className="relative mx-auto w-full max-w-2xl">
          <input
            value={search}
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stocks..."
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: C.border, background: C.surface, color: C.text }}
          />

          {searchOpen ? (
            <div
              className="absolute z-20 mt-1 w-full rounded-lg border p-2"
              style={{ borderColor: C.border, background: C.surface2 }}
            >
              {(search ? searchResults : recentSearches).length ? (
                <div className="space-y-1">
                  {(search ? searchResults : recentSearches).map((item) => (
                    <button
                      key={`${item.symbol}-${item.name}`}
                      type="button"
                      onClick={() => goToStock(item)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-black/20"
                    >
                      <div>
                        <p className="text-sm font-medium" style={{ color: C.text }}>
                          {item.name} ({item.symbol})
                        </p>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {item.sector || 'Unknown sector'}
                        </p>
                      </div>
                      <Badge status={stageToStatus(item.stage)} text={stageLabel(item.stage)} size="sm" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-2 text-xs" style={{ color: C.textMuted }}>
                  No results yet.
                </p>
              )}
            </div>
          ) : null}
        </div>

        {!loggedIn ? (
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
              Sign in
            </Link>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="rounded-lg px-3 py-2 text-sm font-medium"
              style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.border}` }}
            >
              Get started
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/account')}
            className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border"
            style={{ borderColor: C.border, background: C.surface2, color: C.text }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span>{initials(displayName, user?.email)}</span>
            )}
          </button>
        )}
      </nav>

      {loggedIn && !loading ? (
        <section className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>
            {greetingLabel()}, {displayName}
          </h1>
          <p className="mt-1 text-sm" style={{ color: C.textMuted }}>
            Last updated: {formatLastUpdated(lastUpdated)}
          </p>

          <div className="mt-4">
            <SectionLabel text="Watchlist" />
            {watchlist.length ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {watchlist.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    onClick={() => navigate(`/stock/${item.symbol}`)}
                    className="min-w-[260px]"
                  >
                    <Card className="h-full text-left">
                      <p className="text-sm font-semibold" style={{ color: C.text }}>
                        {item.symbol} - {item.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs" style={{ color: C.textMuted }}>
                        {item.headline}
                      </p>
                      <p className="mt-2 text-xs" style={{ color: C.amber }}>
                        {item.conditionsMet} swing conditions
                      </p>
                    </Card>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: C.textMuted }}>
                Search for a stock to start tracking
              </p>
            )}
          </div>

          <div className="mt-4">
            <SectionLabel text="Results Calendar (Next 7 Days)" />
            {resultsCalendar.length ? (
              <div className="space-y-1">
                {resultsCalendar.map((r, idx) => (
                  <p key={`${r.symbol}-${idx}`} className="text-sm" style={{ color: C.text }}>
                    {r.symbol} results expected: ~{r.watchNext}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: C.textMuted }}>
                No upcoming results found in your watchlist.
              </p>
            )}
          </div>

          {portfolio.length ? (
            <div className="mt-4">
              <SectionLabel text="Portfolio Summary" />
              <button
                type="button"
                onClick={() => navigate('/portfolio')}
                className="mb-2 text-left text-sm font-medium"
                style={{ color: C.text }}
              >
                Your portfolio — ₹{portfolioInvested.toLocaleString()} invested
              </button>
              <div className="space-y-1">
                {portfolio.slice(0, 8).map((h, idx) => (
                  <button
                    key={`${h.symbol}-${idx}`}
                    type="button"
                    onClick={() => navigate('/portfolio')}
                    className="flex w-full items-center justify-between rounded-md border px-2 py-1 text-sm"
                    style={{ borderColor: C.border, background: C.surface2 }}
                  >
                    <span style={{ color: C.text }}>
                      {h.name}
                    </span>
                    <span style={{ color: h.gainLossPct >= 0 ? C.green : C.red }}>
                      {h.gainLossPct >= 0 ? '+' : ''}
                      {h.gainLossPct.toFixed(2)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {!loggedIn ? (
        <section className="mb-6 rounded-2xl border p-5" style={{ borderColor: C.border, background: C.surface }}>
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>
            Know what&apos;s happening in Indian markets today
          </h1>
          <p className="mt-1 text-base" style={{ color: C.textMuted }}>
            No jargon. No tips. Just clarity.
          </p>
        </section>
      ) : null}

      <section className="mb-6">
        <DailyScanner loggedIn={loggedIn} isPaid={isPaid} />
      </section>

      <section>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <SectionLabel text="🚀 Breaking out today" />
            <PulseList
              items={marketPulse.breakingOut}
              locked={lockedForAnon}
              renderItem={(item) => (
                <button type="button" onClick={() => navigate(`/stock/${item.symbol}`)} className="w-full text-left">
                  <div className="rounded-lg border p-2" style={{ borderColor: C.border, background: C.surface2 }}>
                    <p className="text-sm font-semibold" style={{ color: C.text }}>{item.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge status={stageToStatus(item.stage)} text={stageLabel(item.stage)} size="sm" />
                      <span className="text-xs" style={{ color: C.textMuted }}>
                        {item.delivery ? `${item.delivery.toFixed(1)}x delivery` : 'Delivery N/A'}
                      </span>
                    </div>
                  </div>
                </button>
              )}
            />
          </Card>

          <Card>
            <SectionLabel text="📈 New Stage 2 this week" />
            <PulseList
              items={marketPulse.newStage2}
              locked={lockedForAnon}
              renderItem={(item) => (
                <button type="button" onClick={() => navigate(`/stock/${item.symbol}`)} className="w-full text-left">
                  <div className="rounded-lg border p-2" style={{ borderColor: C.border, background: C.surface2 }}>
                    <p className="text-sm font-semibold" style={{ color: C.text }}>{item.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge status={stageToStatus(item.stage)} text={stageLabel(item.stage)} size="sm" />
                      <span className="text-xs" style={{ color: C.textMuted }}>
                        {item.delivery ? `${item.delivery.toFixed(1)}x delivery` : 'Delivery N/A'}
                      </span>
                    </div>
                  </div>
                </button>
              )}
            />
          </Card>

          <Card>
            <SectionLabel text="⚡ Unusual delivery today" />
            <PulseList
              items={marketPulse.unusualDelivery}
              locked={lockedForAnon}
              renderItem={(item) => (
                <button type="button" onClick={() => navigate(`/stock/${item.symbol}`)} className="w-full text-left">
                  <div className="rounded-lg border p-2" style={{ borderColor: C.border, background: C.surface2 }}>
                    <p className="text-sm font-semibold" style={{ color: C.text }}>{item.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge status={stageToStatus(item.stage)} text={stageLabel(item.stage)} size="sm" />
                      <span className="text-xs" style={{ color: C.textMuted }}>
                        {item.delivery ? `${item.delivery.toFixed(1)}x vs 30d` : 'Delivery N/A'}
                      </span>
                    </div>
                  </div>
                </button>
              )}
            />
          </Card>

          <AdUnit slot={import.meta.env.VITE_ADSENSE_HOME_SLOT || 'YOUR_SLOT_ID'} format="horizontal" />

          <Card>
            <SectionLabel text="⚠️ What changed this week" />
            <PulseList
              items={marketPulse.changedThisWeek}
              locked={lockedForAnon}
              renderItem={(item) => (
                <button type="button" onClick={() => navigate(`/stock/${item.symbol}`)} className="w-full text-left">
                  <div className="rounded-lg border p-2" style={{ borderColor: C.border, background: C.surface2 }}>
                    <p className="text-sm font-semibold" style={{ color: C.text }}>{item.name}</p>
                    <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
                      {String(item.headline || '').replaceAll('_', ' ')}
                    </p>
                  </div>
                </button>
              )}
            />
          </Card>

          <Card>
            <SectionLabel text="📊 Top swing setups today" />
            <PulseList
              items={marketPulse.swingSetups}
              locked={lockedForAnon}
              renderItem={(item) => (
                <button type="button" onClick={() => navigate(`/stock/${item.symbol}`)} className="w-full text-left">
                  <div className="rounded-lg border p-2" style={{ borderColor: C.border, background: C.surface2 }}>
                    <p className="text-sm font-semibold" style={{ color: C.text }}>{item.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge status="green" text={`${item.conditionsMet}/5 conditions`} size="sm" />
                    </div>
                  </div>
                </button>
              )}
            />
          </Card>

          <Card className="md:col-span-2 xl:col-span-1">
            <SectionLabel text="🏭 Sector pulse" />
            <div className="max-h-[320px] space-y-1 overflow-auto pr-1">
              {marketPulse.sectors.map((s, idx) => {
                const total = s.total_companies ?? s.total_count ?? 0
                const health = String(s.health || '').toLowerCase()
                const badgeStatus = health === 'strong' ? 'green' : health === 'weak' ? 'red' : 'amber'
                return (
                  <button
                    key={`${s.sector}-${idx}`}
                    type="button"
                    onClick={() => navigate(`/sector/${encodeURIComponent(s.sector)}`)}
                    className="flex w-full items-center justify-between rounded-md border px-2 py-2 text-left"
                    style={{ borderColor: C.border, background: C.surface2 }}
                  >
                    <span className="text-sm" style={{ color: C.text }}>{s.sector}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: C.textMuted }}>
                        {s.stage2_count || 0}/{total}
                      </span>
                      <Badge status={badgeStatus} text={health || 'neutral'} size="sm" />
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>
        </div>
      </section>
    </div>
  )
}
