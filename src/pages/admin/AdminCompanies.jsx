import { useEffect, useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { buildCompanyPatch, formatSupabaseError, normalizeCompanyDescription } from '../../lib/companyPatch'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

const SECTORS = [
  'Auto Ancillary',
  'Automobile',
  'Aviation',
  'Banking',
  'Capital Goods',
  'Cement',
  'Chemicals',
  'Construction',
  'Consumer Durables',
  'Defence',
  'Diagnostics',
  'E-Commerce',
  'Electrical Equipment',
  'Engineering',
  'FMCG',
  'Fertilizers',
  'Fintech',
  'Food Processing',
  'Healthcare',
  'Hospitality',
  'IT Services',
  'Infrastructure',
  'Insurance',
  'Jewellery',
  'Logistics',
  'Media',
  'Metals & Mining',
  'Miscellaneous',
  'NBFC',
  'Oil & Gas',
  'Paints',
  'Paper',
  'Pharma',
  'Power',
  'Real Estate',
  'Retail',
  'Specialty Chemicals',
  'Sugar',
  'Telecom',
  'Textiles',
  'Tyres',
]

const EMPTY_FORM = {
  symbol: '',
  name: '',
  sector: '',
  bse_code: '',
  tier: '1',
  website_url: '',
}

function fmtDate(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString()
}

export default function AdminCompanies() {
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [rows, setRows] = useState([])
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', sector: '', website_url: '', tier: '1' })
  const [aiProvider, setAiProvider] = useState('claude')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiPreview, setAiPreview] = useState('')
  const [aiError, setAiError] = useState('')
  const [tierFilter, setTierFilter] = useState('all')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [descFilter, setDescFilter] = useState('all')

  async function queueRefresh(symbol, source = 'admin_companies') {
    try {
      await supabase.from('usage_events').insert({
        event_type: 'admin_force_refresh_requested',
        metadata: { symbol, source },
        created_at: new Date().toISOString(),
      })
    } catch {
      // no-op
    }
  }

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const PAGE = 1000
        let all = []
        let from = 0
        while (true) {
          const { data, error } = await supabase
            .from('companies')
            .select('*')
            .order('symbol', { ascending: true })
            .range(from, from + PAGE - 1)
          if (error || !data?.length) break
          all = all.concat(data)
          if (data.length < PAGE) break
          from += PAGE
        }
        if (!active) return
        setRows(all)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [reloadTick])

  const sectors = useMemo(() => {
    const set = new Set(rows.map((r) => r.sector).filter(Boolean))
    return [...set].sort((a, b) => String(a).localeCompare(String(b)))
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tierFilter !== 'all' && String(r.tier || '') !== tierFilter) return false
      if (sectorFilter !== 'all' && String(r.sector || '') !== sectorFilter) return false
      if (descFilter === 'approved' && r.description_approved !== true) return false
      if (descFilter === 'pending' && r.description_approved === true) return false
      if (descFilter === 'missing' && String(r.description || '').trim()) return false
      return true
    })
  }, [rows, tierFilter, sectorFilter, descFilter])

  async function submitAddCompany(e) {
    e.preventDefault()
    setMessage('')
    if (!form.symbol.trim() || !form.name.trim()) {
      setMessage('Symbol and Name are required.')
      return
    }
    const fnRoot = (import.meta.env.VITE_NETLIFY_FUNCTIONS_URL || '/.netlify/functions').replace(/\/$/, '')
    const payload = {
      symbol: form.symbol.trim().toUpperCase(),
      name: form.name.trim(),
      sector: form.sector.trim() || 'Others',
      bse_code: form.bse_code.trim() || null,
      tier: Number(form.tier) || 1,
      website_url: form.website_url.trim() || null,
    }
    let res, json
    try {
      res = await fetch(`${fnRoot}/admin-add-company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      json = await res.json()
    } catch (err) {
      setMessage(`Network error: ${err.message}`)
      return
    }
    if (!json.ok) {
      setMessage(`Could not add company: ${json.error || 'unknown error'}`)
      return
    }
    await queueRefresh(payload.symbol, 'admin_add_company')
    setForm(EMPTY_FORM)
    setMessage(`Added ${payload.symbol} and queued refresh.`)
    setReloadTick((x) => x + 1)
  }

  function startEdit(row) {
    setEditingId(row.id)
    setEditForm({
      name: row.name || '',
      sector: row.sector || '',
      website_url: row.website_url || row.website || '',
      tier: String(row.tier || '1'),
    })
    setAiPreview('')
    setAiError('')
  }

  async function generateDescription(row) {
    setAiLoading(true)
    setAiError('')
    setAiPreview('')
    try {
      const fnRoot = (import.meta.env.VITE_NETLIFY_FUNCTIONS_URL || '/.netlify/functions').replace(/\/$/, '')
      const res = await fetch(`${fnRoot}/admin-generate-ai-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: row.symbol,
          name: editForm.name || row.name,
          sector: editForm.sector || row.sector,
          provider: aiProvider,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Generation failed')
      setAiPreview(json.description)
    } catch (e) {
      setAiError(e.message)
    } finally {
      setAiLoading(false)
    }
  }

  async function saveEdit(row) {
    const website = editForm.website_url.trim() || null
    const payload = buildCompanyPatch(row, {
      name: editForm.name.trim(),
      sector: editForm.sector.trim(),
      tier: Number(editForm.tier) || 1,
      website_url: website,
      ...(aiPreview
        ? {
            description: normalizeCompanyDescription(aiPreview),
            description_approved: false,
          }
        : {}),
    })
    if (!Object.keys(payload).length) {
      setEditingId(null)
      return
    }
    const { error } = await supabase.from('companies').update(payload).eq('id', row.id)
    if (error) {
      setMessage(`Could not update ${row.symbol}: ${formatSupabaseError(error)}`)
      return
    }
    setEditingId(null)
    setMessage(`Updated ${row.symbol}.`)
    setReloadTick((x) => x + 1)
  }

  async function forceRefresh(row) {
    await queueRefresh(row.symbol, 'admin_force_refresh')
    setMessage(`Queued force refresh for ${row.symbol}.`)
  }

  return (
    <div className="space-y-5">
        <h2 className="text-xl font-semibold" style={{ color: C.text }}>
          Company Management
        </h2>

        <Card>
          <SectionLabel text="Add Company" />
          <form onSubmit={submitAddCompany} className="grid gap-2 md:grid-cols-3">
            <input value={form.symbol} onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value }))} placeholder="Symbol" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
            <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
            <select value={form.sector} onChange={(e) => setForm((p) => ({ ...p, sector: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="">— Select sector —</option>
              {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input value={form.bse_code} onChange={(e) => setForm((p) => ({ ...p, bse_code: e.target.value }))} placeholder="BSE code" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
            <select value={form.tier} onChange={(e) => setForm((p) => ({ ...p, tier: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="1">Tier 1</option>
              <option value="2">Tier 2</option>
            </select>
            <input value={form.website_url} onChange={(e) => setForm((p) => ({ ...p, website_url: e.target.value }))} placeholder="Website URL" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
            <div className="md:col-span-3 flex items-center justify-between">
              <p className="text-sm" style={{ color: C.textMuted }}>{message}</p>
              <button type="submit" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: C.border, color: C.blue, background: C.blueBg }}>
                Add Company
              </button>
            </div>
          </form>
        </Card>

        <Card>
          <SectionLabel text="Companies" />
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="all">All tiers</option>
              <option value="1">Tier 1</option>
              <option value="2">Tier 2</option>
            </select>
            <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="all">All sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select value={descFilter} onChange={(e) => setDescFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="all">All description statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending review</option>
              <option value="missing">Missing</option>
            </select>
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton height={38} />
              <Skeleton height={38} />
              <Skeleton height={38} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr style={{ color: C.textMuted }}>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Symbol</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Name</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Sector</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Tier</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Description status</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Last updated</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isEditing = editingId === row.id
                    const descStatus = row.description
                      ? row.description_approved ? 'Approved' : 'Pending'
                      : 'Missing'

                    return (
                      <tr key={row.id} style={{ color: C.text }}>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>{row.symbol}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>
                          {isEditing ? (
                            <input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} className="w-full rounded border px-2 py-1" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />
                          ) : row.name}
                        </td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>
                          {isEditing ? (
                            <select value={editForm.sector} onChange={(e) => setEditForm((p) => ({ ...p, sector: e.target.value }))} className="w-full rounded border px-2 py-1" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
                              <option value="">— Select —</option>
                              {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : row.sector}
                        </td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>
                          {isEditing ? (
                            <select value={editForm.tier} onChange={(e) => setEditForm((p) => ({ ...p, tier: e.target.value }))} className="rounded border px-2 py-1" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
                              <option value="1">1</option>
                              <option value="2">2</option>
                            </select>
                          ) : row.tier}
                        </td>
                        <td className="border-b p-2" style={{ borderColor: C.border, color: C.textMuted }}>{descStatus}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border, color: C.textMuted }}>{fmtDate(row.updated_at)}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>
                          <div className="flex items-center gap-2">
                            {isEditing ? (
                              <>
                                <button type="button" onClick={() => saveEdit(row)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.blue }}>Save</button>
                                <button type="button" onClick={() => setEditingId(null)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted }}>Cancel</button>
                              </>
                            ) : (
                              <button type="button" onClick={() => startEdit(row)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted }}>
                                Edit
                              </button>
                            )}
                            <button type="button" onClick={() => forceRefresh(row)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.amber }}>
                              Force refresh
                            </button>
                            <a href={`/stock/${row.symbol}`} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.green }}>
                              View
                            </a>
                          </div>
                          {isEditing ? (
                            <div className="mt-2 space-y-2">
                              <input value={editForm.website_url} onChange={(e) => setEditForm((p) => ({ ...p, website_url: e.target.value }))} placeholder="Website URL" className="w-full rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, background: C.surface2, color: C.text }} />

                              {/* AI Description Generator */}
                              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 6 }}>
                                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: C.textMuted, marginBottom: 6 }}>Generate Description</p>
                                <div className="flex gap-2 flex-wrap">
                                  <select
                                    value={aiProvider}
                                    onChange={(e) => setAiProvider(e.target.value)}
                                    className="rounded border px-2 py-1 text-xs"
                                    style={{ borderColor: C.border, background: C.surface2, color: C.text }}
                                  >
                                    <option value="claude">Claude (Haiku)</option>
                                    <option value="gemini">Gemini 2.5 Flash Lite</option>
                                  </select>
                                  <button
                                    type="button"
                                    disabled={aiLoading}
                                    onClick={() => generateDescription(row)}
                                    className="rounded border px-2 py-1 text-xs font-medium"
                                    style={{ borderColor: C.blueBorder || '#38BDF8', color: C.blue, background: 'rgba(56,189,248,0.08)', opacity: aiLoading ? 0.6 : 1, cursor: aiLoading ? 'wait' : 'pointer' }}
                                  >
                                    {aiLoading ? 'Generating…' : '✦ Generate'}
                                  </button>
                                </div>
                                {aiError && (
                                  <p style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{aiError}</p>
                                )}
                                {aiPreview && (
                                  <div style={{ marginTop: 6 }}>
                                    <p style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Preview (saved as draft — approve in Descriptions tab):</p>
                                    <p style={{ fontSize: 12, color: C.text, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', lineHeight: 1.55 }}>{aiPreview}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
    </div>
  )
}
