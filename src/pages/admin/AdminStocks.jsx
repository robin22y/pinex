import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StagePill from '../../components/StagePill'
import Skeleton from '../../components/ui/Skeleton'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { stageBadge } from '../../lib/stageUi'

const BORDER = '#1E293B'
const CARD = '#0f172a'
const MUTED = '#94a3b8'

const PAGE_SIZE = 50

function normalizeStage(stage) {
  const s = String(stage || '').trim()
  if (!s) return 'Unclassified'
  if (['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Unclassified'].includes(s)) return s
  return s.startsWith('Stage') ? s : 'Unclassified'
}

function fmtDelivery(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `${Number(n).toFixed(1)}%`
}

function overrideDaysLeft(exp) {
  if (!exp) return ''
  const t = new Date(exp).getTime()
  if (!Number.isFinite(t)) return ''
  const d = Math.ceil((t - Date.now()) / 86400000)
  return d > 0 ? `${d}d left` : 'expired'
}

function activeOverride(row) {
  if (!row?.stage_override) return false
  if (!row.stage_override_expires_at) return true
  return overrideDaysLeft(row.stage_override_expires_at) !== 'expired'
}

function DescCell({ approved, hasDesc }) {
  if (!hasDesc)
    return <span style={{ color: '#f87171' }}>✗</span>
  if (approved === true)
    return <span style={{ color: '#22c55e' }} title="Approved">✅</span>
  return (
    <span style={{ color: '#fbbf24' }} title="Pending">
      ⏳
    </span>
  )
}

export default function AdminStocks() {
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState([])
  const [priceMap, setPriceMap] = useState({})
  const [deliveryMap, setDeliveryMap] = useState({})
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('all')
  const [stageF, setStageF] = useState('all')
  const [extraF, setExtraF] = useState('all')
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setLoading(false)
      return
    }
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const [coRes, pdRes, delRes] = await Promise.all([
          supabase.from('companies').select('*').order('symbol', { ascending: true }).limit(25000),
          supabase.from('price_data').select('company_id, stage').eq('is_latest', true).limit(25000),
          supabase.from('delivery_signals').select('company_id, avg_delivery_30d, date').order('date', { ascending: false }).limit(25000),
        ])
        const cos = coRes.data || []
        const pRows = pdRes.data || []
        const priceByCo = {}
        for (const p of pRows) {
          priceByCo[p.company_id] = p
        }
        const delByCo = {}
        for (const d of delRes.data || []) {
          if (!(d.company_id in delByCo)) delByCo[d.company_id] = d
        }
        if (!active) return
        setCompanies(cos)
        setPriceMap(priceByCo)
        setDeliveryMap(delByCo)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setPage(0)
  }, [search, sector, stageF, extraF])

  const sectors = useMemo(() => {
    const s = new Set(companies.map((c) => c.sector).filter(Boolean))
    return [...s].sort((a, b) => String(a).localeCompare(String(b)))
  }, [companies])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return companies.filter((r) => {
      if (sector !== 'all' && String(r.sector || '') !== sector) return false
      if (q) {
        const hay = `${r.symbol || ''} ${r.name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }

      const price = priceMap[r.id]
      const st = normalizeStage(price?.stage)
      if (stageF !== 'all') {
        const want = stageF === 'Unclassified' ? 'Unclassified' : `Stage ${stageF}`
        if (st !== want) return false
      }

      const ovOn = activeOverride(r)
      const needReview =
        r.needs_review === true ||
        r.description_review_pending === true ||
        (Boolean(String(r.description || '').trim()) && r.description_approved !== true)
      const suspended = r.is_suspended === true || r.suspended === true
      const missDesc = !String(r.description || '').trim()

      if (extraF === 'override') {
        if (!ovOn) return false
      } else if (extraF === 'review') {
        if (!needReview) return false
      } else if (extraF === 'suspended') {
        if (!suspended) return false
      } else if (extraF === 'missing_desc') {
        if (!missDesc) return false
      }

      return true
    })
  }, [companies, search, sector, stageF, extraF, priceMap])

  const pageRows = useMemo(() => {
    const start = page * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Stocks</h1>

      <div className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5" style={{ borderColor: BORDER, background: CARD }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol or name"
          className="rounded-md border px-3 py-2 text-sm lg:col-span-2"
          style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
        />
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
        >
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={stageF}
          onChange={(e) => setStageF(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
        >
          <option value="all">All stages</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="Unclassified">Unclassified</option>
        </select>
        <select
          value={extraF}
          onChange={(e) => setExtraF(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
        >
          <option value="all">All flags</option>
          <option value="override">Has override</option>
          <option value="review">Needs review</option>
          <option value="suspended">Suspended</option>
          <option value="missing_desc">Missing description</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : (
        <>
          <p className="text-sm" style={{ color: MUTED }}>
            Showing {pageRows.length} of {filtered.length} filtered ({companies.length} total)
          </p>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: BORDER, background: CARD }}>
            <table className="min-w-[1100px] w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase" style={{ borderColor: BORDER, color: MUTED }}>
                  <th className="p-2">Symbol</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Sector</th>
                  <th className="p-2">Stage</th>
                  <th className="p-2">Override</th>
                  <th className="p-2">Delivery%</th>
                  <th className="p-2">Description</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const p = priceMap[r.id]
                  const stLabel = normalizeStage(p?.stage)
                  const dm = deliveryMap[r.id]?.avg_delivery_30d
                  const ovActive = activeOverride(r)

                  return (
                    <tr key={r.id} className="border-b" style={{ borderColor: BORDER }}>
                      <td className="p-2 font-mono font-medium text-slate-100">{r.symbol}</td>
                      <td className="p-2 text-slate-200">{r.name}</td>
                      <td className="p-2 text-xs text-slate-400">{r.sector || '—'}</td>
                      <td className="p-2">
                        <StagePill stage={stLabel === 'Unclassified' ? undefined : stLabel} className="text-[10px]" />
                      </td>
                      <td className="p-2">
                        {ovActive ? (
                          <span
                            className="rounded border px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              borderColor: stageBadge('Stage 3').color,
                              color: '#fcd34d',
                              background: 'rgba(245,158,11,0.08)',
                            }}
                          >
                            {overrideDaysLeft(r.stage_override_expires_at)}
                          </span>
                        ) : (
                          <span style={{ color: MUTED }}>—</span>
                        )}
                      </td>
                      <td className="p-2 font-data tabular-nums text-slate-300">{fmtDelivery(dm)}</td>
                      <td className="p-2 text-center">
                        <DescCell approved={r.description_approved} hasDesc={Boolean(String(r.description || '').trim())} />
                      </td>
                      <td className="p-2">
                        <Link
                          to={`/admin/stocks/${encodeURIComponent(String(r.symbol || '').trim())}`}
                          className="rounded border px-2 py-1 text-xs no-underline"
                          style={{ borderColor: BORDER, color: '#38bdf8' }}
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: MUTED }}>
            <button
              type="button"
              disabled={page <= 0}
              className="rounded border px-3 py-1 disabled:opacity-40"
              style={{ borderColor: BORDER, color: '#e2e8f0' }}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>
            <span>
              Page {page + 1} / {pages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pages}
              className="rounded border px-3 py-1 disabled:opacity-40"
              style={{ borderColor: BORDER, color: '#e2e8f0' }}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}
