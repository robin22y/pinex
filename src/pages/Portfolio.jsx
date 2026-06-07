import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import Card from '../components/ui/Card'
import SectionLabel from '../components/ui/SectionLabel'
import Skeleton from '../components/ui/Skeleton'
import { C } from '../styles/tokens'
import { useAuth } from '../context'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

import Icon from '../components/ui/Icon'
function asNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function money(v) {
  return `₹${asNum(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function pct(v) {
  const n = asNum(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function parseDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString()
}

function headlineFromRow(row) {
  if (!row?.headline_change) return 'No major recent change'
  return String(row.headline_change).replaceAll('_', ' ')
}

export default function Portfolio() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [message, setMessage] = useState('')
  const [companies, setCompanies] = useState([])
  const [holdings, setHoldings] = useState([])
  const [editingId, setEditingId] = useState(null)

  const [query, setQuery] = useState('')
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [shares, setShares] = useState('')
  const [buyPrice, setBuyPrice] = useState('')
  const [buyDate, setBuyDate] = useState('')
  const [notes, setNotes] = useState('')

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return companies
      .filter((c) => c.name?.toLowerCase().includes(q) || c.symbol?.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, companies])

  useEffect(() => {
    if (!user?.id || !hasSupabaseEnv) return
    let active = true
    ;(async () => {
      setLoading(true)
      setMessage('')
      const userId = user.id
      try {
        const [companyRes, holdingsRes, latestPriceDateRes] = await Promise.all([
          supabase.from('companies').select('id,name,symbol,sector').limit(2500),
          supabase.from('portfolio_holdings').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
          supabase.from('price_data').select('date').order('date', { ascending: false }).limit(1),
        ])
        const companiesRows = companyRes.data || []
        const holdingsRows = holdingsRes.data || []
        const latestPriceDate = latestPriceDateRes.data?.[0]?.date
        const companyIds = [...new Set(holdingsRows.map((h) => h.company_id).filter(Boolean))]
        const [priceRes, changesRes] = await Promise.all([
          latestPriceDate && companyIds.length
            ? supabase.from('price_data').select('company_id,close').eq('date', latestPriceDate).in('company_id', companyIds)
            : Promise.resolve({ data: [] }),
          companyIds.length
            ? supabase.from('quarterly_changes').select('company_id,headline_change,changes,created_at').in('company_id', companyIds).order('created_at', { ascending: false }).limit(5000)
            : Promise.resolve({ data: [] }),
        ])
        const companyById = Object.fromEntries(companiesRows.map((c) => [c.id, c]))
        const companyBySymbol = Object.fromEntries(companiesRows.map((c) => [c.symbol, c]))
        const priceByCompany = Object.fromEntries((priceRes.data || []).map((p) => [p.company_id, p.close]))
        const latestChangeByCompany = {}
        for (const row of changesRes.data || []) {
          if (!row?.company_id || latestChangeByCompany[row.company_id]) continue
          latestChangeByCompany[row.company_id] = row
        }
        const mapped = holdingsRows.map((h) => {
          const symbol = h.symbol || h.ticker || ''
          const company = companyById[h.company_id] || companyBySymbol[symbol] || {}
          const qty = asNum(h.shares ?? h.quantity)
          const avg = asNum(h.buy_price ?? h.avg_price)
          const invested = qty * avg
          const current = asNum(priceByCompany[h.company_id] ?? h.current_price)
          const currentValue = qty * current
          const gainLoss = currentValue - invested
          const gainLossPct = invested > 0 ? (gainLoss / invested) * 100 : 0
          const change = latestChangeByCompany[company.id] || {}
          const firstTimeEvent = Array.isArray(change?.changes) && change.changes.some((x) => x?.is_first_time)
          return {
            id: h.id,
            company_id: h.company_id || company.id || null,
            symbol,
            name: company.name || h.name || symbol,
            sector: company.sector || 'Unknown',
            shares: qty,
            buy_price: avg,
            buy_date: h.buy_date || '',
            notes: h.notes || '',
            current_price: current,
            invested,
            currentValue,
            gainLoss,
            gainLossPct,
            headline: headlineFromRow(change),
            firstTimeEvent,
          }
        })
        if (!active) return
        setCompanies(companiesRows)
        setHoldings(mapped)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user?.id, reloadTick])

  async function addHolding() {
    if (!user?.id) {
      setMessage('Please sign in to add holdings.')
      return
    }
    if (!selectedCompany?.symbol || asNum(shares) <= 0 || asNum(buyPrice) <= 0) {
      setMessage('Select a stock and enter valid shares and buy price.')
      return
    }

    const payload = {
      user_id: user.id,
      company_id: selectedCompany.id,
      symbol: selectedCompany.symbol,
      shares: asNum(shares),
      quantity: asNum(shares),
      buy_price: asNum(buyPrice),
      avg_price: asNum(buyPrice),
      buy_date: buyDate || null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('portfolio_holdings').insert(payload)
    if (error) {
      setMessage('Could not add holding right now.')
      return
    }

    setMessage('Holding added.')
    setQuery('')
    setSelectedCompany(null)
    setShares('')
    setBuyPrice('')
    setBuyDate('')
    setNotes('')
    setReloadTick((x) => x + 1)
  }

  function startEdit(h) {
    setEditingId(h.id)
    setSelectedCompany({ id: h.company_id, symbol: h.symbol, name: h.name, sector: h.sector })
    setQuery(`${h.name} (${h.symbol})`)
    setShares(String(h.shares))
    setBuyPrice(String(h.buy_price))
    setBuyDate(h.buy_date ? h.buy_date.slice(0, 10) : '')
    setNotes(h.notes || '')
  }

  async function saveEdit() {
    if (!editingId) return
    const { error } = await supabase
      .from('portfolio_holdings')
      .update({
        company_id: selectedCompany?.id || null,
        symbol: selectedCompany?.symbol || null,
        shares: asNum(shares),
        quantity: asNum(shares),
        buy_price: asNum(buyPrice),
        avg_price: asNum(buyPrice),
        buy_date: buyDate || null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId)
      .eq('user_id', user?.id || '')

    if (error) {
      setMessage('Could not update holding.')
      return
    }
    setMessage('Holding updated.')
    setEditingId(null)
    setQuery('')
    setSelectedCompany(null)
    setShares('')
    setBuyPrice('')
    setBuyDate('')
    setNotes('')
    setReloadTick((x) => x + 1)
  }

  async function deleteHolding(id) {
    const { error } = await supabase.from('portfolio_holdings').delete().eq('id', id).eq('user_id', user?.id || '')
    setMessage(error ? 'Could not delete holding.' : 'Holding removed.')
    if (!error) setReloadTick((x) => x + 1)
  }

  const totalInvested = useMemo(() => holdings.reduce((s, h) => s + h.invested, 0), [holdings])
  const totalCurrent = useMemo(() => holdings.reduce((s, h) => s + h.currentValue, 0), [holdings])
  const totalPnL = totalCurrent - totalInvested
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

  const firstTimeHoldings = holdings.filter((h) => h.firstTimeEvent)

  return (
    <>
      <Helmet>
        <title>Portfolio — PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-12 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/')}
          title="Home"
          aria-label="Go to Home"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
          style={{ borderColor: C.border, background: C.surface2, color: C.text }}
        >
          <Icon name="home" className="text-base" aria-hidden />
          Home
        </button>
        <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.textMuted }}>
          Portfolio
        </span>
      </div>

      <section>
        <SectionLabel text="Portfolio Summary" />
        {loading ? (
          <Skeleton height={110} />
        ) : (
          <Card>
            <p style={{ color: C.text }} className="text-sm">Total invested: <span className="font-semibold">{money(totalInvested)}</span></p>
            <p style={{ color: C.text }} className="mt-1 text-sm">Current value: <span className="font-semibold">{money(totalCurrent)}</span></p>
            <p className="mt-2 text-base font-bold" style={{ color: totalPnL >= 0 ? C.green : C.red }}>
              Overall: {totalPnL >= 0 ? '+' : '-'}{money(Math.abs(totalPnL))} ({pct(totalPnLPct)})
            </p>
            <p className="mt-2 text-xs" style={{ color: C.textMuted }}>
              Portfolio tracker is for your reference only.
              <br />
              Not a trading tool. Not investment advice.
            </p>
          </Card>
        )}
      </section>

      <section>
        <SectionLabel text="Add Holding" />
        <Card>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="md:col-span-2 relative">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedCompany(null)
                }}
                placeholder="Search stock name or symbol"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ borderColor: C.border, background: C.surface2, color: C.text }}
              />
              {query && !selectedCompany && filteredCompanies.length ? (
                <div className="absolute z-20 mt-1 w-full rounded-lg border p-1" style={{ borderColor: C.border, background: C.surface }}>
                  {filteredCompanies.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCompany(c)
                        setQuery(`${c.name} (${c.symbol})`)
                      }}
                      className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-black/20"
                      style={{ color: C.text }}
                    >
                      {c.name} ({c.symbol}) - {c.sector}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <input value={shares} onChange={(e) => setShares(e.target.value)} type="number" min="0" step="any" placeholder="Shares" className="rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
            <input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} type="number" min="0" step="any" placeholder="Buy price (₹)" className="rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
            <input value={buyDate} onChange={(e) => setBuyDate(e.target.value)} type="date" className="rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} type="text" placeholder="Notes (optional)" className="rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-sm" style={{ color: C.textMuted }}>{message}</p>
            <button
              type="button"
              onClick={editingId ? saveEdit : addHolding}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: C.border, background: C.blueBg, color: C.blue }}
            >
              {editingId ? 'Save changes' : 'Add'}
            </button>
          </div>
        </Card>
      </section>

      <section>
        <SectionLabel text="Holdings" />
        {loading ? (
          <div className="space-y-2">
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : holdings.length ? (
          <div className="space-y-3">
            {holdings.map((h) => (
              <Card key={h.id || `${h.symbol}-${h.buy_price}`} highlight={h.firstTimeEvent ? C.amber : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: C.text }}>
                      {h.name} ({h.symbol}) - {h.sector}
                    </p>
                    <p className="mt-1 text-sm" style={{ color: C.textMuted }}>
                      {h.shares} shares @ {money(h.buy_price)} avg {h.buy_date ? `• ${parseDate(h.buy_date)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => startEdit(h)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted }}>✏️</button>
                    <button type="button" onClick={() => deleteHolding(h.id)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted }}>🗑️</button>
                  </div>
                </div>

                <div className="mt-2 text-sm">
                  <p style={{ color: C.text }}>
                    Current price: {money(h.current_price)}
                  </p>
                  <p style={{ color: h.gainLoss >= 0 ? C.green : C.red }}>
                    Gain/Loss: {h.gainLoss >= 0 ? '+' : '-'}{money(Math.abs(h.gainLoss))} ({pct(h.gainLossPct)})
                  </p>
                  <p className="text-xs" style={{ color: C.textMuted }}>
                    Price updated daily — not real-time
                  </p>
                </div>

                <button type="button" onClick={() => navigate(`/stock/${h.symbol}`)} className="mt-2 text-left text-sm" style={{ color: C.textMuted }}>
                  {h.headline}
                </button>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: C.textMuted }}>
            No holdings yet. Add your first stock above.
          </p>
        )}
      </section>

      <section>
        <SectionLabel text="Significant changes in your holdings this quarter" />
        <Card>
          {firstTimeHoldings.length ? (
            <div className="space-y-2">
              {firstTimeHoldings.map((h) => (
                <button key={`first-${h.id || h.symbol}`} type="button" onClick={() => navigate(`/stock/${h.symbol}`)} className="block w-full rounded border px-3 py-2 text-left" style={{ borderColor: C.border, background: C.surface2 }}>
                  <p className="text-sm font-medium" style={{ color: C.text }}>{h.symbol}</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>{h.headline}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: C.textMuted }}>
              No significant changes detected this quarter
            </p>
          )}
        </Card>
      </section>
    </div>
    </>
  )
}
