import { useEffect, useState } from 'react'
import Modal from '../../components/ui/Modal'
import Skeleton from '../../components/ui/Skeleton'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'

const BORDER = '#1E293B'
const BORDER_TERM = '#1E2530'
const CARD = '#0D1525'
const MUTED = '#64748B'
const TEXT = '#E2E8F0'
const GREEN = '#00C805'
const RED = '#FF3B30'
const AMBER = '#FBBF24'
const ROW_HOVER = '#141820'
const INDIAN_API_CAP = 500

function StatCard({ label, value }) {
  return (
    <div className="border p-4" style={{ borderColor: BORDER, background: CARD, borderRadius: 6 }}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: TEXT }}>
        {value}
      </p>
    </div>
  )
}

function parseMeta(meta) {
  if (meta == null) return {}
  if (typeof meta === 'object') return meta
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta)
    } catch {
      return {}
    }
  }
  return {}
}

function istCalendarDateParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = f.formatToParts(d)
  const pick = (t) => parts.find((p) => p.type === t)?.value || ''
  return { y: pick('year'), m: pick('month'), day: pick('day') }
}

/** Start of current IST calendar day as ISO (+05:30). */
function istTodayStartISO() {
  const { y, m, day } = istCalendarDateParts()
  return `${y}-${m}-${day}T00:00:00+05:30`
}

function istLastNDatesStrings(nDays) {
  const out = []
  for (let i = 0; i < nDays; i += 1) {
    const t = Date.now() - i * 86400000
    const { y, m, day } = istCalendarDateParts(new Date(t))
    out.push(`${y}-${m}-${day}`)
  }
  return out
}

/** e.g. 16:01 IST, 10 May 2026 */
function formatISTLine(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
  return `${time} IST, ${date}`
}

function pickLatestRow(usageRow, adminRow, parseUsageMeta, parseAdminValue) {
  const uT = usageRow?.created_at ? new Date(usageRow.created_at).getTime() : 0
  const aT = adminRow?.created_at ? new Date(adminRow.created_at).getTime() : 0
  if (!uT && !aT) return null
  if (uT >= aT) {
    return { source: 'usage_events', created_at: usageRow.created_at, meta: parseUsageMeta(usageRow) }
  }
  return { source: 'admin_log', created_at: adminRow.created_at, meta: parseAdminValue(adminRow?.new_value) }
}

function isOverrideActive(row) {
  if (!row?.stage_override) return false
  const exp = row.stage_override_expires_at
  if (!exp) return true
  const t = new Date(exp).getTime()
  return Number.isFinite(t) && t > Date.now()
}

function progressColor(pct) {
  if (pct < 60) return GREEN
  if (pct <= 80) return AMBER
  return RED
}

function fmtIntTotal(n) {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

async function safeTableCount(table) {
  try {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
    if (error) return null
    return typeof count === 'number' ? count : 0
  } catch {
    return null
  }
}

function failureScriptFromType(eventType) {
  const t = String(eventType || '')
  if (t.includes('price_data')) return 'fetch_price_data.py'
  if (t.includes('indianapi')) return 'fetch_indianapi.py'
  return t || '—'
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(hasSupabaseEnv)
  const [stats, setStats] = useState(null)
  const [logRows, setLogRows] = useState([])
  const [health, setHealth] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [failures, setFailures] = useState([])
  const [confirmEodOpen, setConfirmEodOpen] = useState(false)
  const [eodBusy, setEodBusy] = useState(false)
  const [eodMsg, setEodMsg] = useState('')
  const [hoverFail, setHoverFail] = useState(null)

  useEffect(() => {
    if (!hasSupabaseEnv) {
      queueMicrotask(() => setLoading(false))
      return
    }
    let active = true

    ;(async () => {
      setLoading(true)
      const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString()
      const dauCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const istToday = istTodayStartISO()

      const [
        totalCompaniesRes,
        approvedRes,
        profilesTotalRes,
        stage2Res,
        stage4Res,
        liteCosRes,
        logsRes,
        ueFinishedRes,
        alFinishedRes,
        indianSymCountRes,
        priceCt,
        delCt,
        newsCt,
        finCt,
        fundCt,
        dauRes,
        failRes,
      ] = await Promise.all([
        supabase.from('companies').select('id', { count: 'exact', head: true }),
        supabase.from('companies').select('id', { count: 'exact', head: true }).eq('description_approved', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('price_data').select('id', { count: 'exact', head: true }).eq('is_latest', true).eq('stage', 'Stage 2'),
        supabase.from('price_data').select('id', { count: 'exact', head: true }).eq('is_latest', true).eq('stage', 'Stage 4'),
        supabase
          .from('companies')
          .select(
            'id, description, description_approved, stage_override, stage_override_expires_at, data_quality_flag',
          )
          .limit(20000),
        supabase.from('admin_log').select('*').order('created_at', { ascending: false }).limit(20),
        supabase
          .from('usage_events')
          .select('created_at, metadata')
          .eq('event_type', 'fetch_price_data_finished')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('admin_log')
          .select('created_at, new_value')
          .eq('action', 'fetch_price_data_finished')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('usage_events')
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'fetch_indianapi_symbol')
          .gte('created_at', istToday),
        safeTableCount('price_data'),
        safeTableCount('delivery_data'),
        safeTableCount('stock_news'),
        safeTableCount('financials'),
        safeTableCount('fundamentals'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active_at', dauCutoff),
        supabase
          .from('usage_events')
          .select('created_at, event_type, metadata')
          .in('event_type', ['fetch_price_data_failed', 'fetch_indianapi_failed'])
          .gte('created_at', cutoff7d)
          .order('created_at', { ascending: false })
          .limit(200),
      ])

      const viewDates = istLastNDatesStrings(7)
      let topViewed = []
      try {
        const { data: viewRows } = await supabase
          .from('daily_views')
          .select('company_id')
          .in('viewed_date', viewDates)
          .limit(25000)

        const freq = {}
        for (const r of viewRows || []) {
          const id = r.company_id
          if (!id) continue
          freq[id] = (freq[id] || 0) + 1
        }
        const ranked = Object.entries(freq)
          .map(([company_id, ct]) => ({ company_id, ct }))
          .sort((a, b) => b.ct - a.ct)
          .slice(0, 10)
        const ids = ranked.map((x) => x.company_id).filter(Boolean)
        if (ids.length) {
          const { data: symbols } = await supabase.from('companies').select('id,symbol').in('id', ids)
          const symById = Object.fromEntries((symbols || []).map((c) => [c.id, c.symbol]))
          topViewed = ranked.map((r) => ({ symbol: symById[r.company_id] || r.company_id, count: r.ct }))
        }
      } catch {
        topViewed = []
      }

      const cos = liteCosRes.data || []
      const pendingDesc = cos.filter(
        (c) => String(c.description || '').trim().length > 0 && c.description_approved !== true,
      ).length
      const overrides = cos.filter(isOverrideActive).length
      const dq = cos.filter((c) => {
        const f = c.data_quality_flag
        return f != null && String(f).trim() !== ''
      }).length

      const lastEod = pickLatestRow(ueFinishedRes.data, alFinishedRes.data, (row) => parseMeta(row?.metadata), parseMeta)

      let eodSuccess = null
      let eodRowsText = '—'
      if (lastEod?.meta && typeof lastEod.meta === 'object') {
        const m = lastEod.meta
        const fail = Number(m.failed_symbols ?? m.failed ?? NaN)
        const ok = Number(m.success_symbols ?? m.success ?? NaN)
        if (Number.isFinite(fail) && Number.isFinite(ok)) {
          eodSuccess = fail === 0 && ok > 0
          eodRowsText = `${ok} symbols updated`
        } else if (Number.isFinite(ok)) {
          eodSuccess = true
          eodRowsText = `${ok} symbols updated`
        }
      }

      const apiUsed = indianSymCountRes.count ?? 0
      const apiPctCap = Math.min(100, (apiUsed / INDIAN_API_CAP) * 100)

      let dbTotals = [(priceCt ?? 0), (delCt ?? 0), (newsCt ?? 0), (finCt ?? 0)]
      let dbLabels = ['price_data', 'delivery_data', 'stock_news', 'financials']
      if (fundCt != null) {
        dbTotals.push(fundCt)
        dbLabels.push('fundamentals')
      }
      const dbSum = dbTotals.reduce((s, x) => s + x, 0)

      const failList = (failRes.data || []).map((row) => {
        const meta = parseMeta(row.metadata)
        const err = meta.error ?? meta.message ?? ''
        return {
          id: `${row.created_at}-${row.event_type}-${meta.symbol || ''}`,
          created_at: row.created_at,
          symbol: meta.symbol ?? '—',
          error: String(err || '').slice(0, 500),
          script: failureScriptFromType(row.event_type),
        }
      })

      const logData = logsRes.error ? [] : logsRes.data || []

      if (!active) return
      setHealth({
        eodAt: lastEod?.created_at ?? null,
        eodOk: eodSuccess,
        eodRowsText,
        apiUsed,
        apiPctCap,
        dbCounts: dbLabels.map((name, i) => ({ name, count: dbTotals[i] ?? 0 })),
        dbSum,
      })
      setAnalytics({
        dau: dauRes.count ?? 0,
        topViewed,
      })
      setFailures(failList)
      setStats({
        row1: {
          totalCompanies: totalCompaniesRes.count ?? '—',
          approvedDesc: approvedRes.count ?? '—',
          overrides,
          profilesCt: profilesTotalRes.count ?? '—',
        },
        row2: {
          stage2: stage2Res.count ?? '—',
          stage4: stage4Res.count ?? '—',
          dq,
          pendingDesc,
        },
      })
      setLogRows(logData)
      setLoading(false)
    })()

    return () => {
      active = false
    }
  }, [])

  function fmtTime(v) {
    if (!v) return '—'
    return formatISTLine(v)
  }

  async function confirmRunEod() {
    setEodMsg('')
    setEodBusy(true)
    try {
      const res = await fetch('/.netlify/functions/admin-trigger-eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEodMsg(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`)
        return
      }
      setEodMsg(typeof body?.message === 'string' ? body.message : 'Dispatch sent.')
      setConfirmEodOpen(false)
    } catch (e) {
      setEodMsg(e?.message || 'Network error — use Netlify dev or deploy URL for functions.')
    } finally {
      setEodBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: TEXT }}>
          Dashboard
        </h1>
        <p className="text-sm" style={{ color: MUTED }}>
          Overview, system health, and recent admin activity
        </p>
      </div>

      <Modal
        isOpen={confirmEodOpen}
        onClose={() => {
          if (!eodBusy) setConfirmEodOpen(false)
        }}
        title="Force run EOD pipeline"
      >
        <p className="text-[13px] leading-snug" style={{ color: MUTED }}>
          This dispatches the GitHub Actions workflow for daily market data (<code style={{ color: TEXT }}>daily.yml</code>).
          Requires Netlify env <code style={{ color: TEXT }}>GITHUB_DISPATCH_TOKEN</code> +{' '}
          <code style={{ color: TEXT }}>GITHUB_REPOSITORY</code>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={eodBusy}
            className="rounded-md border px-3 py-2 text-[13px] font-semibold"
            style={{ borderColor: BORDER_TERM, background: CARD, color: TEXT }}
            onClick={() => setConfirmEodOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={eodBusy}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-semibold"
            style={{ borderColor: GREEN, background: ROW_HOVER, color: GREEN }}
            onClick={() => void confirmRunEod()}
          >
            {eodBusy ? (
              <>
                <i className="ti ti-loader-2 animate-spin text-lg" aria-hidden />
                Running…
              </>
            ) : (
              'Confirm run'
            )}
          </button>
        </div>
      </Modal>

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {[1, 2, 3].map((k) => (
              <Skeleton key={k} height={132} />
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton height={220} />
            <Skeleton height={220} />
          </div>
          <Skeleton height={48} />
          <Skeleton height={200} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((k) => (
              <Skeleton key={k} height={88} />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((k) => (
              <Skeleton key={k} height={88} />
            ))}
          </div>
          <Skeleton height={220} />
        </div>
      ) : (
        <>
          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              System health
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-4" style={{ borderColor: BORDER_TERM, background: CARD, borderRadius: 6 }}>
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                  Last EOD scrape
                </p>
                <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold" style={{ color: TEXT }}>
                  {health?.eodOk === true ? (
                    <>
                      <span style={{ color: GREEN }}>
                        <i className="ti ti-check text-lg" aria-hidden />
                      </span>
                      Success
                    </>
                  ) : health?.eodOk === false ? (
                    <>
                      <span style={{ color: RED }}>
                        <i className="ti ti-x text-lg" aria-hidden />
                      </span>
                      Failed
                    </>
                  ) : (
                    <>
                      <span style={{ color: MUTED }}>—</span>
                      No run logged
                    </>
                  )}
                </p>
                <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
                  Time: <span style={{ color: TEXT }}>{fmtTime(health?.eodAt)}</span>
                </p>
                <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
                  Rows: <span style={{ color: TEXT }}>{health?.eodRowsText}</span>
                </p>
                <p className="mt-2 text-[11px] leading-snug" style={{ color: MUTED }}>
                  Source:{' '}
                  <code style={{ color: TEXT }}>usage_events</code> (pipeline);{' '}
                  <code style={{ color: TEXT }}>admin_log</code> if newer. Script logs use <code style={{ color: TEXT }}>log_event</code> →{' '}
                  <code style={{ color: TEXT }}>usage_events</code>.
                </p>
              </div>

              <div className="rounded-md border p-4" style={{ borderColor: BORDER_TERM, background: CARD, borderRadius: 6 }}>
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                  IndianAPI calls today (IST)
                </p>
                <p className="mt-3 text-lg font-semibold tabular-nums" style={{ color: TEXT }}>
                  {health?.apiUsed ?? 0} / {INDIAN_API_CAP} calls used today
                </p>
                <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                  Developer plan limit · counts <code style={{ color: TEXT }}>fetch_indianapi_symbol</code> rows
                </p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-sm" style={{ background: ROW_HOVER }}>
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: `${Math.min(100, health?.apiPctCap ?? 0)}%`,
                      background: progressColor(health?.apiPctCap ?? 0),
                    }}
                  />
                </div>
              </div>

              <div className="rounded-md border p-4" style={{ borderColor: BORDER_TERM, background: CARD, borderRadius: 6 }}>
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                  Database size (row counts)
                </p>
                <ul className="mt-3 space-y-1 text-[13px]" style={{ color: TEXT }}>
                  {(health?.dbCounts || []).map((row) => (
                    <li key={row.name} className="flex justify-between gap-2 tabular-nums">
                      <span style={{ color: MUTED }}>{row.name}</span>
                      <span>{fmtIntTotal(row.count)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t pt-3 text-[13px] font-semibold tabular-nums" style={{ borderColor: BORDER_TERM, color: TEXT }}>
                  Total: {fmtIntTotal(health?.dbSum)} rows
                </p>
              </div>
            </div>
          </section>

          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              User analytics
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-4" style={{ borderColor: BORDER_TERM, background: CARD, borderRadius: 6 }}>
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                  Daily active users
                </p>
                <p className="mt-3 text-3xl font-bold tabular-nums" style={{ color: TEXT }}>
                  {analytics?.dau ?? 0}
                </p>
                <p className="mt-2 text-[12px]" style={{ color: MUTED }}>
                  Profiles with <code style={{ color: TEXT }}>last_active_at</code> in the last 24 hours
                </p>
              </div>
              <div className="rounded-md border p-4" style={{ borderColor: BORDER_TERM, background: CARD, borderRadius: 6 }}>
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                  Most viewed stocks
                </p>
                <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                  Last 7 days (IST calendar), from <code style={{ color: TEXT }}>daily_views</code> · top 10
                </p>
                <ol className="mt-3 list-none space-y-2 p-0">
                  {(analytics?.topViewed?.length ?? 0) ? (
                    analytics.topViewed.map((item, idx) => (
                      <li
                        key={item.symbol}
                        className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-[13px]"
                        style={{ background: idx % 2 ? 'transparent' : ROW_HOVER, color: TEXT }}
                      >
                        <span style={{ color: MUTED }}>{idx + 1}.</span>
                        <span className="min-w-0 flex-1 font-semibold truncate">{item.symbol}</span>
                        <span className="font-data tabular-nums" style={{ color: MUTED }}>
                          {item.count} opens
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="text-[13px]" style={{ color: MUTED }}>
                      No view data for the window yet.
                    </li>
                  )}
                </ol>
              </div>
            </div>
          </section>

          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              Manual controls
            </p>
            <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-[13px] font-semibold"
            style={{ borderColor: BORDER_TERM, background: ROW_HOVER, color: GREEN }}
            onClick={() => {
              setEodMsg('')
              setConfirmEodOpen(true)
            }}
          >
            <i className="ti ti-player-play text-lg" aria-hidden />
            Force run EOD pipeline
          </button>
              {eodMsg ? (
                <span className="max-w-xl text-[13px]" style={{ color: MUTED }}>
                  {eodMsg}
                </span>
              ) : null}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              Pipeline failures (last 7 days)
            </p>
            <p className="mb-2 text-[11px]" style={{ color: MUTED }}>
              From <code style={{ color: TEXT }}>usage_events</code>: fetch_price_data_failed, fetch_indianapi_failed (script telemetry)
            </p>
            <div className="overflow-x-auto rounded-md border" style={{ borderColor: BORDER_TERM, background: CARD, borderRadius: 6 }}>
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: BORDER_TERM, color: MUTED }}>
                    <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Time</th>
                    <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Symbol</th>
                    <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Error</th>
                    <th className="p-3 text-[11px] font-bold uppercase tracking-wider">Script</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.length ? (
                    failures.map((r) => {
                      const hov = hoverFail === r.id
                      return (
                        <tr
                          key={r.id}
                          className="border-b"
                          style={{
                            borderColor: BORDER_TERM,
                            color: TEXT,
                            background: hov ? ROW_HOVER : 'transparent',
                          }}
                          onMouseEnter={() => setHoverFail(r.id)}
                          onMouseLeave={() => setHoverFail(null)}
                        >
                          <td className="p-3 align-top whitespace-nowrap text-[12px]" style={{ color: MUTED }}>
                            {fmtTime(r.created_at)}
                          </td>
                          <td className="p-3 align-top font-semibold">{r.symbol}</td>
                          <td className="p-3 align-top text-[12px] break-all" title={r.error}>
                            {r.error || '—'}
                          </td>
                          <td className="p-3 align-top font-mono text-[12px]" style={{ color: MUTED }}>
                            {r.script}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td className="p-4" colSpan={4} style={{ color: MUTED }}>
                        No pipeline failures logged in this window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              KPIs — volume
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total companies tracked" value={stats?.row1.totalCompanies ?? '—'} />
              <StatCard label="Approved descriptions" value={stats?.row1.approvedDesc ?? '—'} />
              <StatCard label="Active stage overrides (sample≤20k rows)" value={stats?.row1.overrides ?? '—'} />
              <StatCard label="Registered users" value={stats?.row1.profilesCt ?? '—'} />
            </div>
          </section>

          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              Market snapshot
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Stage 2 (latest)" value={stats?.row2.stage2 ?? '—'} />
              <StatCard label="Stage 4 (latest)" value={stats?.row2.stage4 ?? '—'} />
              <StatCard label="Data-quality flag set (sample)" value={stats?.row2.dq ?? '—'} />
              <StatCard label="Pending descriptions (sample)" value={stats?.row2.pendingDesc ?? '—'} />
            </div>
          </section>

          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              Recent admin activity
            </p>
            <div className="overflow-x-auto rounded-md border" style={{ borderColor: BORDER, background: CARD, borderRadius: 6 }}>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: BORDER, color: MUTED }}>
                    <th className="p-3">Time</th>
                    <th className="p-3">Admin</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Target</th>
                    <th className="p-3">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {logRows.length ? (
                    logRows.map((r, idx) => (
                      <tr key={r.id || idx} className="border-b" style={{ borderColor: BORDER, color: TEXT }}>
                        <td className="whitespace-nowrap p-3 text-[12px]" style={{ color: MUTED }}>
                          {fmtTime(r.created_at ?? r.createdAt)}
                        </td>
                        <td className="p-3">{r.admin_email ?? r.adminEmail ?? '—'}</td>
                        <td className="p-3">{r.action ?? '—'}</td>
                        <td className="p-3 text-[12px]">
                          {[r.target_type, r.target_id].filter(Boolean).join(': ') || '—'}
                        </td>
                        <td className="max-w-xs truncate p-3 text-[12px]" title={`${r.old_value || ''} → ${r.new_value || ''}`}>
                          {r.old_value || '∅'} → {r.new_value || '∅'}
                          {r.notes ? ` — ${r.notes}` : ''}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="p-4" colSpan={5} style={{ color: MUTED }}>
                        No admin log entries yet (or admin_log table / created_at column missing).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
