import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { useAuth } from '../../context'
import { isAdmin } from '../../lib/isAdmin'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

const REFRESH_MS = 5 * 60 * 1000

function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function fmtInt(n) {
  return Number(n || 0).toLocaleString()
}

function eventTime(event) {
  return new Date(event.created_at || event.timestamp || event.updated_at || 0)
}

function isBetween(event, from, to) {
  const t = eventTime(event).getTime()
  return t >= from.getTime() && t <= to.getTime()
}

function usageMeta(event) {
  return event.metadata || event.meta || {}
}

function eventType(event) {
  return String(event.event_type || event.type || '').toLowerCase()
}

function rupeesFromTokens(inputTokens, outputTokens) {
  const usdPerMInput = 3
  const usdPerMOutput = 15
  const usdInr = 83
  const usd =
    (Number(inputTokens || 0) / 1_000_000) * usdPerMInput +
    (Number(outputTokens || 0) / 1_000_000) * usdPerMOutput
  return usd * usdInr
}

function safeText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

export default function AdminStats() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [usageEvents, setUsageEvents] = useState([])
  const [companies, setCompanies] = useState([])
  const [descriptions, setDescriptions] = useState([])
  const [warnings, setWarnings] = useState([])
  const [runs, setRuns] = useState([])

  useEffect(() => {
    if (!isAdmin(user) || !hasSupabaseEnv) return
    let active = true

    async function load() {
      if (!active) return
      setLoading(true)

      const results = await Promise.allSettled([
        supabase.from('profiles').select('*').limit(10000),
        supabase.from('usage_events').select('*').order('created_at', { ascending: false }).limit(10000),
        supabase.from('companies').select('*').limit(10000),
        supabase.from('companies').select('id,description,description_approved').limit(10000),
        supabase
          .from('financials')
          .select('symbol,quarter_name,data_quality_warning,data_quality_meta,updated_at')
          .order('updated_at', { ascending: false })
          .limit(5000),
        supabase
          .from('quarterly_changes')
          .select('company_id,changes,headline_change,ai_summary,created_at')
          .order('created_at', { ascending: false })
          .limit(5000),
      ])

      if (!active) return
      setProfiles(results[0].status === 'fulfilled' ? results[0].value.data || [] : [])
      setUsageEvents(results[1].status === 'fulfilled' ? results[1].value.data || [] : [])
      setCompanies(results[2].status === 'fulfilled' ? results[2].value.data || [] : [])
      setDescriptions(results[3].status === 'fulfilled' ? results[3].value.data || [] : [])
      setWarnings(results[4].status === 'fulfilled' ? results[4].value.data || [] : [])
      const runEvents = (results[1].status === 'fulfilled' ? results[1].value.data || [] : []).filter((e) => {
        const t = eventType(e)
        return t.includes('daily') || t.includes('weekly')
      })
      setRuns(runEvents)

      setLastRefreshed(new Date())
      setLoading(false)
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, REFRESH_MS)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [user])

  if (!isAdmin(user)) return <Navigate to="/" replace />

  const now = new Date()
  const todayStart = startOfDay(now)
  const weekStart = new Date(todayStart)
  weekStart.setDate(todayStart.getDate() - 6)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const totalUsers = profiles.length
  const newToday = profiles.filter((p) => isBetween({ created_at: p.created_at }, todayStart, now)).length
  const newWeek = profiles.filter((p) => isBetween({ created_at: p.created_at }, weekStart, now)).length
  const newMonth = profiles.filter((p) => isBetween({ created_at: p.created_at }, monthStart, now)).length
  const paidUsers = profiles.filter((p) => String(p.plan || '').toLowerCase() === 'paid').length
  const freeUsers = Math.max(0, totalUsers - paidUsers)

  const eventsToday = usageEvents.filter((e) => isBetween(e, todayStart, now))
  const eventsMonth = usageEvents.filter((e) => isBetween(e, monthStart, monthEnd))
  const dau = new Set(eventsToday.map((e) => usageMeta(e).user_id || e.user_id).filter(Boolean)).size
  const mau = new Set(eventsMonth.map((e) => usageMeta(e).user_id || e.user_id).filter(Boolean)).size

  const totalCompanies = companies.length
  const tier1 = companies.filter((c) => Number(c.tier) === 1).length
  const tier2 = companies.filter((c) => Number(c.tier) === 2).length
  const approvedDescriptions = descriptions.filter((d) => d.description_approved === true).length
  const pendingDescriptions = descriptions.filter((d) => d.description && d.description_approved !== true).length

  const stockViewsToday = eventsToday.filter((e) => eventType(e).includes('view')).length
  const shareEventsToday = eventsToday.filter((e) => eventType(e).includes('share')).length
  const downloadsToday = eventsToday.filter((e) => eventType(e).includes('download')).length
  const downloadsMonth = eventsMonth.filter((e) => eventType(e).includes('download')).length

  const viewedStocksMap = {}
  for (const e of usageEvents) {
    const t = eventType(e)
    if (!t.includes('view')) continue
    const symbol = safeText(usageMeta(e).symbol || e.symbol, '')
    if (!symbol) continue
    viewedStocksMap[symbol] = (viewedStocksMap[symbol] || 0) + 1
  }
  const topViewed = Object.entries(viewedStocksMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const sectorSearchMap = {}
  for (const e of usageEvents) {
    const t = eventType(e)
    if (!t.includes('search')) continue
    const sector = safeText(usageMeta(e).sector || usageMeta(e).query_sector, '')
    if (!sector) continue
    sectorSearchMap[sector] = (sectorSearchMap[sector] || 0) + 1
  }
  const topSectors = Object.entries(sectorSearchMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const dailyRun = runs.find((e) => eventType(e).includes('daily'))
  const weeklyRun = runs.find((e) => eventType(e).includes('weekly'))

  const warningRows = warnings
    .filter((w) => w.data_quality_warning)
    .slice(0, 20)
    .map((w) => ({
      symbol: safeText(w.symbol),
      issue: safeText(w.data_quality_meta?.warning_reasons?.join(', ') || w.data_quality_warning, 'Quality warning'),
    }))
  const missingDataAlerts = warningRows.filter((w) => w.issue.toLowerCase().includes('missing')).length

  const todayClaudeEvents = eventsToday.filter((e) => eventType(e).includes('ai') || eventType(e).includes('claude'))
  const weekClaudeEvents = usageEvents.filter((e) => (eventType(e).includes('ai') || eventType(e).includes('claude')) && isBetween(e, weekStart, now))
  const monthClaudeEvents = usageEvents.filter((e) => (eventType(e).includes('ai') || eventType(e).includes('claude')) && isBetween(e, monthStart, now))

  const costSeriesMap = {}
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    costSeriesMap[key] = { day: key.slice(5), calls: 0, cost: 0 }
  }
  for (const e of monthClaudeEvents) {
    const key = eventTime(e).toISOString().slice(0, 10)
    if (!costSeriesMap[key]) continue
    const meta = usageMeta(e)
    const inputTokens = Number(meta.input_tokens || 0)
    const outputTokens = Number(meta.output_tokens || 0)
    costSeriesMap[key].calls += 1
    costSeriesMap[key].cost += rupeesFromTokens(inputTokens, outputTokens)
  }
  const costSeries = Object.values(costSeriesMap)
  const estCostToday = todayClaudeEvents.reduce((sum, e) => {
    const m = usageMeta(e)
    return sum + rupeesFromTokens(m.input_tokens, m.output_tokens)
  }, 0)
  const estCostWeek = weekClaudeEvents.reduce((sum, e) => {
    const m = usageMeta(e)
    return sum + rupeesFromTokens(m.input_tokens, m.output_tokens)
  }, 0)
  const estCostMonth = monthClaudeEvents.reduce((sum, e) => {
    const m = usageMeta(e)
    return sum + rupeesFromTokens(m.input_tokens, m.output_tokens)
  }, 0)

  const failedRuns = usageEvents
    .filter((e) => eventType(e).includes('failed'))
    .slice(0, 20)
    .map((e) => ({
      ts: eventTime(e).toLocaleString(),
      name: safeText(eventType(e)),
      err: safeText(usageMeta(e).error || usageMeta(e).message, 'Error'),
    }))

  const flaggedErrors = usageEvents
    .filter((e) => {
      const t = eventType(e)
      return t.includes('report') || t.includes('flag')
    })
    .slice(0, 20)

  return (
    <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold" style={{ color: C.text }}>
            Superadmin Stats Dashboard
          </h2>
          <p className="text-xs" style={{ color: C.textMuted }}>
            Auto-refresh: every 5 minutes {lastRefreshed ? `• Last: ${lastRefreshed.toLocaleTimeString()}` : ''}
          </p>
        </div>

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton height={140} />
            <Skeleton height={140} />
            <Skeleton height={140} />
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Card>
                <SectionLabel text="Users" />
                <p style={{ color: C.text }} className="text-sm">Total: {fmtInt(totalUsers)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">New today/week/month: {newToday}/{newWeek}/{newMonth}</p>
                <p style={{ color: C.textMuted }} className="text-sm">Free vs Paid: {fmtInt(freeUsers)} / {fmtInt(paidUsers)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">DAU / MAU: {fmtInt(dau)} / {fmtInt(mau)}</p>
              </Card>

              <Card>
                <SectionLabel text="Content" />
                <p style={{ color: C.text }} className="text-sm">Total companies: {fmtInt(totalCompanies)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">Tier 1 vs Tier 2: {fmtInt(tier1)} / {fmtInt(tier2)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">Approved descriptions: {fmtInt(approvedDescriptions)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">Pending reviews: {fmtInt(pendingDescriptions)}</p>
              </Card>

              <Card>
                <SectionLabel text="Activity" />
                <p style={{ color: C.text }} className="text-sm">Stock views today: {fmtInt(stockViewsToday)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">Downloads today/month: {fmtInt(downloadsToday)} / {fmtInt(downloadsMonth)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">Share events today: {fmtInt(shareEventsToday)}</p>
              </Card>

              <Card>
                <SectionLabel text="Top 10 Most Viewed Stocks" />
                <div className="space-y-1 text-sm" style={{ color: C.textMuted }}>
                  {topViewed.length ? topViewed.map(([sym, cnt]) => (
                    <p key={sym}>{sym}: {fmtInt(cnt)}</p>
                  )) : <p>No view events found.</p>}
                </div>
              </Card>

              <Card>
                <SectionLabel text="Most Searched Sectors" />
                <div className="space-y-1 text-sm" style={{ color: C.textMuted }}>
                  {topSectors.length ? topSectors.map(([sector, cnt]) => (
                    <p key={sector}>{sector}: {fmtInt(cnt)}</p>
                  )) : <p>No sector search events found.</p>}
                </div>
              </Card>

              <Card>
                <SectionLabel text="Data Pipeline" />
                <p style={{ color: C.text }} className="text-sm">
                  Last daily run: {dailyRun ? `${eventTime(dailyRun).toLocaleString()} (${eventType(dailyRun)})` : '-'}
                </p>
                <p style={{ color: C.text }} className="text-sm">
                  Last weekly run: {weeklyRun ? `${eventTime(weeklyRun).toLocaleString()} (${eventType(weeklyRun)})` : '-'}
                </p>
                <p style={{ color: C.textMuted }} className="text-sm">Companies with quality warnings: {fmtInt(warningRows.length)}</p>
                <p style={{ color: C.textMuted }} className="text-sm">Missing data alerts: {fmtInt(missingDataAlerts)}</p>
              </Card>

              <Card className="md:col-span-2 xl:col-span-2">
                <SectionLabel text="API Costs (Approx)" />
                <p style={{ color: C.text }} className="text-sm">Claude calls today/week/month: {todayClaudeEvents.length}/{weekClaudeEvents.length}/{monthClaudeEvents.length}</p>
                <p style={{ color: C.textMuted }} className="text-sm">
                  Estimated cost (INR): ₹{estCostToday.toFixed(2)} / ₹{estCostWeek.toFixed(2)} / ₹{estCostMonth.toFixed(2)}
                </p>
                <div className="mt-2" style={{ width: '100%', height: 220, minWidth: 0, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={costSeries}>
                      <XAxis dataKey="day" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: C.surface, border: '1px solid var(--border)', color: C.text }}
                        labelStyle={{ color: C.textMuted }}
                      />
                      <Line type="monotone" dataKey="cost" stroke={C.blue} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <SectionLabel text="Data Quality Warnings" />
                <div className="space-y-1 text-sm" style={{ color: C.textMuted }}>
                  {warningRows.length ? warningRows.slice(0, 10).map((w, idx) => (
                    <p key={`${w.symbol}-${idx}`}>{w.symbol}: {w.issue}</p>
                  )) : <p>No warnings found.</p>}
                </div>
              </Card>

              <Card>
                <SectionLabel text="Failed Script Runs" />
                <div className="space-y-1 text-sm" style={{ color: C.textMuted }}>
                  {failedRuns.length ? failedRuns.slice(0, 10).map((r, idx) => (
                    <p key={`${r.name}-${idx}`}>{r.name} • {r.ts}</p>
                  )) : <p>No failed runs logged.</p>}
                </div>
              </Card>

              <Card>
                <SectionLabel text="Flagged Data Errors" />
                <div className="space-y-1 text-sm" style={{ color: C.textMuted }}>
                  {flaggedErrors.length ? flaggedErrors.slice(0, 10).map((e, idx) => (
                    <p key={`${eventType(e)}-${idx}`}>{eventType(e)} • {eventTime(e).toLocaleString()}</p>
                  )) : <p>No user-reported flags found.</p>}
                </div>
              </Card>
            </div>
          </>
        )}
    </div>
  )
}
