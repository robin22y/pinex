import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StagePill from '../../components/StagePill'
import Modal from '../../components/ui/Modal'
import Skeleton from '../../components/ui/Skeleton'
import { logAdminAction } from '../../lib/adminLog'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { stageBadge } from '../../lib/stageUi'

const BORDER = '#1E293B'
const CARD = '#0f172a'
const MUTED = '#94a3b8'

const PAGE_SIZE = 50

/** Sectors merged with DB list so the add-stock modal always has sane defaults. */
const SECTOR_FALLBACK = [
  'Others',
  'Retail',
  'FMCG',
  'Banking',
  'IT Services',
  'Pharma',
  'Auto',
  'Power',
  'Renewable Energy',
  'Infrastructure',
  'NBFC',
  'Logistics',
  'Healthcare Hospitals',
  'Insurance',
  'Steel',
  'Cement',
  'Chemicals',
  'Telecom',
]

async function postNetlifyFunction(functionName, payload) {
  const root = (import.meta.env.VITE_NETLIFY_FUNCTIONS_URL || '/.netlify/functions').replace(/\/$/, '')
  const res = await fetch(`${root}/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  return { ok: res.ok, status: res.status, json }
}

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
  const [statusF, setStatusF] = useState('all')
  const [extraF, setExtraF] = useState('all')
  const [page, setPage] = useState(0)
  const [reloadTick, setReloadTick] = useState(0)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addExchange, setAddExchange] = useState(/** @type {'NSE' | 'BSE' | 'BOTH'} */ ('NSE'))
  const [addSym, setAddSym] = useState('')
  const [addBseCode, setAddBseCode] = useState('')
  const [addName, setAddName] = useState('')
  const [addSector, setAddSector] = useState('')
  const [modalError, setModalError] = useState('')
  const [modalBusy, setModalBusy] = useState(false)
  const [bannerMsg, setBannerMsg] = useState({ type: '', text: '' })

  const reloadData = useCallback(async () => {
    if (!hasSupabaseEnv) {
      setLoading(false)
      return
    }
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
      setCompanies(cos)
      setPriceMap(priceByCo)
      setDeliveryMap(delByCo)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void reloadData()
    })
  }, [reloadData, reloadTick])

  useEffect(() => {
    queueMicrotask(() => setPage(0))
  }, [search, sector, stageF, statusF, extraF])

  const sectors = useMemo(() => {
    const s = new Set(companies.map((c) => c.sector).filter(Boolean))
    return [...s].sort((a, b) => String(a).localeCompare(String(b)))
  }, [companies])

  const sectorOptionsForModal = useMemo(() => {
    const s = new Set([...sectors, ...SECTOR_FALLBACK])
    return [...s].sort((a, b) => String(a).localeCompare(String(b)))
  }, [sectors])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return companies.filter((r) => {
      if (statusF === 'active' && r.is_suspended === true) return false
      if (statusF === 'suspended' && r.is_suspended !== true) return false

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
  }, [companies, search, sector, stageF, statusF, extraF, priceMap])

  async function submitAddStock() {
    setModalError('')
    if (!hasSupabaseEnv) {
      setModalError('Supabase is not configured.')
      return
    }

    const nse = addSym.trim().toUpperCase()
    const bse = addBseCode.replace(/\D/g, '').slice(0, 6)
    const nameRaw = addName.trim()
    const sectorVal = (addSector || '').trim() || 'Others'

    let symbolToInsert
    let exchangeVal
    /** @type {string|null} */
    let bseCodeVal

    if (addExchange === 'NSE') {
      if (!nse) {
        setModalError('NSE symbol is required.')
        return
      }
      symbolToInsert = nse
      exchangeVal = 'NSE'
      bseCodeVal = null
    } else if (addExchange === 'BSE') {
      if (bse.length !== 6) {
        setModalError('Enter a valid 6-digit BSE code.')
        return
      }
      if (!nameRaw) {
        setModalError('Company name is required for BSE-only listings.')
        return
      }
      symbolToInsert = nse || bse
      exchangeVal = 'BSE'
      bseCodeVal = bse
    } else {
      if (!nse) {
        setModalError('NSE symbol is required for dual-listed stocks.')
        return
      }
      if (bse.length !== 6) {
        setModalError('Enter a valid 6-digit BSE code for dual-listed stocks.')
        return
      }
      symbolToInsert = nse
      exchangeVal = 'BOTH'
      bseCodeVal = bse
    }

    const name = nameRaw || (exchangeVal === 'NSE' ? nse : exchangeVal === 'BOTH' ? nse : nameRaw)

    setModalBusy(true)
    try {
      const { data: exists } = await supabase
        .from('companies')
        .select('symbol')
        .eq('symbol', symbolToInsert)
        .maybeSingle()
      if (exists) {
        setModalError(`Already tracking ${symbolToInsert}`)
        return
      }

      const payload = {
        symbol: symbolToInsert,
        name,
        sector: sectorVal,
        exchange: exchangeVal,
        bse_code: bseCodeVal,
        tier: 1,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('companies').insert(payload)
      if (error) {
        setModalError(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'add_stock',
          target_type: 'company',
          target_id: symbolToInsert,
          new_value: JSON.stringify({ symbol: symbolToInsert, exchange: exchangeVal }),
        })
      } catch {
        /* optional */
      }
      const fetchRes = await postNetlifyFunction('admin-fetch-price', { symbol: symbolToInsert })
      if (!fetchRes.ok) {
        const errText = fetchRes.json?.error || JSON.stringify(fetchRes.json).slice(0, 200)
        setBannerMsg({
          type: 'warn',
          text: `${symbolToInsert} added but price fetch call failed (${fetchRes.status}): ${errText}`,
        })
      } else {
        setBannerMsg({ type: 'ok', text: `${symbolToInsert} added. Data will appear after next fetch.` })
      }
      setAddModalOpen(false)
      setAddExchange('NSE')
      setAddSym('')
      setAddBseCode('')
      setAddName('')
      setAddSector('')
      setReloadTick((t) => t + 1)
    } finally {
      setModalBusy(false)
    }
  }

  function openAddModal() {
    setModalError('')
    setAddExchange('NSE')
    setAddSym('')
    setAddBseCode('')
    setAddName('')
    setAddSector(sector !== 'all' ? sector : 'Others')
    setBannerMsg({ type: '', text: '' })
    setAddModalOpen(true)
  }

  const pageRows = useMemo(() => {
    const start = page * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Stocks</h1>
        <button
          type="button"
          onClick={() => openAddModal()}
          className="rounded-lg border px-4 py-2 text-sm font-medium"
          style={{ borderColor: '#38bdf8', color: '#38bdf8', background: 'rgba(56,189,248,0.08)' }}
        >
          + Add Stock
        </button>
      </div>

      {bannerMsg.text ? (
        <p
          className="text-sm"
          style={{ color: bannerMsg.type === 'ok' ? '#22c55e' : bannerMsg.type === 'warn' ? '#fbbf24' : MUTED }}
        >
          {bannerMsg.text}
        </p>
      ) : null}

      <Modal
        isOpen={addModalOpen}
        onClose={() => (!modalBusy ? setAddModalOpen(false) : null)}
        title="Add New Stock"
      >
        <div className="space-y-3 text-sm" style={{ color: '#e2e8f0' }}>
          <div>
            <p className="mb-2 text-xs" style={{ color: MUTED }}>
              Exchange
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Exchange">
              {(
                [
                  { id: 'NSE', label: 'NSE' },
                  { id: 'BSE', label: 'BSE' },
                  { id: 'BOTH', label: 'Both', hint: 'Dual listed' },
                ]
              ).map(({ id, label, hint }) => {
                const on = addExchange === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={hint}
                    disabled={modalBusy}
                    onClick={() => setAddExchange(id)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      borderColor: on ? '#38bdf8' : BORDER,
                      color: on ? '#7dd3fc' : MUTED,
                      background: on ? 'rgba(56,189,248,0.12)' : '#080c14',
                    }}
                  >
                    {label}
                    {hint ? <span className="ml-1 hidden text-[10px] opacity-80 sm:inline">({hint})</span> : null}
                  </button>
                )
              })}
            </div>
            {addExchange === 'BOTH' ? (
              <p className="mt-1 text-[10px]" style={{ color: MUTED }}>
                Dual listed: yfinance uses NSE first ({addSym.trim().toUpperCase() || 'SYMBOL'}.NS), with BSE fallback.
              </p>
            ) : null}
          </div>

          {(addExchange === 'NSE' || addExchange === 'BOTH') && (
            <label className="block text-xs" style={{ color: MUTED }}>
              NSE Symbol (required)
              <input
                value={addSym}
                onChange={(e) => setAddSym(e.target.value.toUpperCase())}
                placeholder="e.g. RELIANCE"
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
                style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                disabled={modalBusy}
              />
              <span className="mt-0.5 block text-[10px]" style={{ color: MUTED }}>
                yfinance: {addSym.trim() ? `${addSym.trim().toUpperCase()}.NS` : 'SYMBOL.NS'}
              </span>
            </label>
          )}

          {(addExchange === 'BSE' || addExchange === 'BOTH') && (
            <label className="block text-xs" style={{ color: MUTED }}>
              BSE Code (6-digit number, required)
              <input
                inputMode="numeric"
                value={addBseCode}
                onChange={(e) => setAddBseCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="e.g. 543272"
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
                style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                disabled={modalBusy}
              />
              <span className="mt-0.5 block text-[10px]" style={{ color: MUTED }}>
                yfinance: {addBseCode.length === 6 ? `${addBseCode}.BO` : 'BSECODE.BO'}
              </span>
            </label>
          )}

          <label className="block text-xs" style={{ color: MUTED }}>
            Company Name
            {addExchange === 'BSE' ? (
              <span className="text-fuchsia-300"> (required)</span>
            ) : (
              <span> (optional for NSE; defaults to NSE symbol)</span>
            )}
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
              disabled={modalBusy}
            />
          </label>

          {addExchange === 'BSE' ? (
            <label className="block text-xs" style={{ color: MUTED }}>
              NSE Symbol (optional)
              <input
                value={addSym}
                onChange={(e) => setAddSym(e.target.value.toUpperCase())}
                placeholder="If known — otherwise symbol = BSE code"
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
                style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                disabled={modalBusy}
              />
            </label>
          ) : null}

          <label className="block text-xs" style={{ color: MUTED }}>
            Sector
            <select
              value={addSector || 'Others'}
              onChange={(e) => setAddSector(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
              disabled={modalBusy}
            >
              {sectorOptionsForModal.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div
            className="rounded border px-3 py-2 text-xs leading-relaxed"
            style={{ borderColor: BORDER, background: 'rgba(15,23,42,0.6)', color: MUTED }}
          >
            <p>
              <span aria-hidden>ℹ️</span> BSE-only stocks use the BSE code for price data (e.g. 543272). Delivery data is
              available for NSE-listed stocks only.
            </p>
          </div>

          {modalError ? (
            <p className="text-xs" style={{ color: '#f87171' }}>
              {modalError}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={modalBusy}
              onClick={() => setAddModalOpen(false)}
              className="rounded border px-4 py-2 text-sm"
              style={{ borderColor: BORDER, color: '#e2e8f0' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={modalBusy}
              onClick={() => void submitAddStock()}
              className="rounded border px-4 py-2 text-sm font-medium"
              style={{ borderColor: '#22c55e', color: '#86efac' }}
            >
              {modalBusy ? 'Adding…' : 'Add & Queue Fetch'}
            </button>
          </div>
        </div>
      </Modal>

      <div className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-6" style={{ borderColor: BORDER, background: CARD }}>
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
          value={statusF}
          onChange={(e) => setStatusF(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
          title="Tracking status"
        >
          <option value="all">Status: All</option>
          <option value="active">Status: Active</option>
          <option value="suspended">Status: Suspended</option>
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
