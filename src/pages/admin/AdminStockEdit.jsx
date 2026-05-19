import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import StagePill from '../../components/StagePill'
import { logAdminAction } from '../../lib/adminLog'
import { buildCompanyPatch, formatSupabaseError, normalizeCompanyDescription } from '../../lib/companyPatch'
import { ADMIN_EMAIL } from '../../lib/isAdmin'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'

const BORDER = '#1E293B'
const CARD = '#0f172a'
const MUTED = '#94a3b8'

/** @param {unknown} s */
function obvTrendFromSlope(s) {
  const v = Number(s)
  if (!Number.isFinite(v)) return '—'
  if (v > 0.02) return 'rising'
  if (v < -0.02) return 'falling'
  return 'flat'
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString()
}

function addDays(d, n) {
  const x = new Date(d.getTime())
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString()
}

function money(x) {
  const n = Number(x)
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'
}

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

export default function AdminStockEdit() {
  const { symbol: rawSymbol } = useParams()
  const navigate = useNavigate()
  const symbol = String(rawSymbol || '').trim().toUpperCase()

  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState(null)
  const [sectors, setSectors] = useState([])
  const [priceLatest, setPriceLatest] = useState(null)
  const [shareLatest, setShareLatest] = useState(null)
  const [financials4, setFinancials4] = useState([])
  const [deliverySig, setDeliverySig] = useState(null)
  const [corpRows, setCorpRows] = useState([])

  const [coForm, setCoForm] = useState({
    name: '',
    sector: '',
    industry: '',
    description: '',
    admin_notes: '',
    exchange: 'NSE',
    bse_code: '',
  })

  const [overrideStage, setOverrideStage] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideDays, setOverrideDays] = useState('3')

  const [suspend, setSuspend] = useState(false)
  const [corpPending, setCorpPending] = useState(false)
  const [dqFlag, setDqFlag] = useState('')

  const [corpForm, setCorpForm] = useState({
    action_type: 'split',
    action_date: new Date().toISOString().slice(0, 10),
    ratio: '',
    notes: '',
  })
  const [showCorpForm, setShowCorpForm] = useState(false)

  const [msg, setMsg] = useState('')
  const [busySave, setBusySave] = useState(false)
  const [busyAction, setBusyAction] = useState(null)
  const [newSymbol, setNewSymbol] = useState('')
  const [aiGenerating, setAiGenerating] = useState(null) // 'claude' | 'gemini' | null

  useEffect(() => {
    queueMicrotask(() => setNewSymbol(''))
  }, [symbol])

  const reload = useCallback(async () => {
    if (!hasSupabaseEnv || !symbol) {
      setLoading(false)
      return
    }
    setLoading(true)
    setMsg('')
    try {
      const coRes = await supabase.from('companies').select('*').eq('symbol', symbol).maybeSingle()
      const c = coRes.data
      if (!c) {
        setCompany(null)
        setMsg('Company not found.')
        return
      }
      setCompany(c)
      setCoForm({
        name: c.name || '',
        sector: c.sector || '',
        industry: c.industry || '',
        description: String(c.description || '').slice(0, 300),
        admin_notes: String(c.admin_notes || ''),
        exchange: String(c.exchange || 'NSE').toUpperCase() === 'BOTH' ? 'BOTH' : String(c.exchange || 'NSE').toUpperCase() === 'BSE' ? 'BSE' : 'NSE',
        bse_code: String(c.bse_code ?? '').replace(/\D/g, '').slice(0, 6),
      })
      setSuspend(Boolean(c.is_suspended || c.suspended))
      setCorpPending(Boolean(c.corporate_action_pending))
      setDqFlag(String(c.data_quality_flag || '').trim())

      const secRes = await supabase.from('companies').select('sector').limit(5000)
      const set = new Set((secRes.data || []).map((r) => r.sector).filter(Boolean))
      setSectors([...set].sort((a, b) => String(a).localeCompare(String(b))))

      const [pRes, shRes, finRes, delRes, caRes] = await Promise.all([
        supabase.from('price_data').select('*').eq('company_id', c.id).eq('is_latest', true).maybeSingle(),
        supabase.from('shareholding').select('*').eq('company_id', c.id).order('quarter', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('financials').select('*').eq('company_id', c.id).order('quarter', { ascending: false }).limit(4),
        supabase.from('delivery_signals').select('*').eq('company_id', c.id).order('date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('corporate_actions').select('*').eq('company_id', c.id).order('action_date', { ascending: false }).limit(50),
      ])

      setPriceLatest(pRes.data ?? null)
      setShareLatest(shRes.data ?? null)
      setFinancials4(finRes.data || [])
      setDeliverySig(delRes.data ?? null)
      if (caRes.error) setCorpRows([])
      else setCorpRows(caRes.data || [])
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    queueMicrotask(() => {
      void reload()
    })
  }, [reload])

  const derivedYfTickerPreview = useMemo(() => {
    const ex = String(coForm.exchange || 'NSE').toUpperCase()
    const bc = String(coForm.bse_code || '').trim()
    const sym = String(symbol || '').trim().toUpperCase()
    if (ex === 'BSE' && bc) return `${bc}.BO`
    if (ex === 'BOTH' && bc && sym) return `${sym}.NS (if empty, try ${bc}.BO)`
    if (sym) return `${sym}.NS`
    return '—'
  }, [coForm.exchange, coForm.bse_code, symbol])

  const activeOverride = useMemo(() => {
    if (!company?.stage_override) return null
    const exp = company.stage_override_expires_at
    if (!exp) return { stage: company.stage_override, exp: null, reason: company.stage_override_reason }
    if (new Date(exp) <= new Date()) return null
    return { stage: company.stage_override, exp, reason: company.stage_override_reason }
  }, [company])

  async function saveCompany() {
    if (!company) return
    setBusySave(true)
    setMsg('')
    try {
      const exNorm = String(coForm.exchange || 'NSE').toUpperCase()
      const exchangeVal = exNorm === 'BOTH' ? 'BOTH' : exNorm === 'BSE' ? 'BSE' : 'NSE'
      const bseRaw = String(coForm.bse_code || '').replace(/\D/g, '').trim()
      if (exchangeVal !== 'NSE' && bseRaw.length !== 6) {
        setMsg('BSE and dual-listed companies need a 6-digit BSE code.')
        return
      }
      const descNorm = normalizeCompanyDescription(coForm.description)
      const payload = buildCompanyPatch(company, {
        name: coForm.name.trim(),
        sector: coForm.sector.trim() || company.sector || 'Others',
        description: descNorm,
        industry: coForm.industry.trim() || null,
        admin_notes: coForm.admin_notes.trim() || null,
        exchange: exchangeVal,
        bse_code: exchangeVal === 'NSE' ? null : bseRaw || null,
        ...(descNorm !== normalizeCompanyDescription(company.description) && {
          description_approved: false,
        }),
      })

      if (!Object.keys(payload).length) {
        setMsg('Nothing to save.')
        return
      }

      const { error } = await supabase.from('companies').update(payload).eq('id', company.id)
      if (error) {
        console.error('[saveCompany] payload:', payload, 'error:', error)
        setMsg(`Save failed: ${formatSupabaseError(error)}`)
        return
      }
      try {
        await logAdminAction({
          action: 'company_update',
          target_type: 'company',
          target_id: company.id,
          old_value: company.name,
          new_value: payload.name,
          notes: symbol,
        })
      } catch {
        /* log optional */
      }
      setMsg('Company saved.')
      await reload()
    } finally {
      setBusySave(false)
    }
  }

  async function setOverride() {
    if (!company) return
    const reason = overrideReason.trim()
    if (!overrideStage || !reason) {
      setMsg('Pick a stage and enter a reason.')
      return
    }
    const days = Number(overrideDays) || 3
    const expires = addDays(new Date(), days)
    setBusyAction('override')
    setMsg('')
    try {
      const { error } = await supabase.from('companies').update({
        stage_override: overrideStage,
        stage_override_expires_at: expires,
        stage_override_reason: reason,
      }).eq('id', company.id)
      if (error) {
        setMsg(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'stage_override_set',
          target_type: 'company',
          target_id: company.id,
          old_value: company.stage_override,
          new_value: overrideStage,
          notes: reason,
        })
      } catch {
        /* optional */
      }
      setOverrideReason('')
      setMsg('Override applied. Re-run price fetch to reflect in price_data if needed.')
      await reload()
    } finally {
      setBusyAction(null)
    }
  }

  async function clearOverride() {
    if (!company) return
    setBusyAction('clear_ov')
    setMsg('')
    try {
      const { error } = await supabase
        .from('companies')
        .update({
          stage_override: null,
          stage_override_expires_at: null,
          stage_override_reason: null,
        })
        .eq('id', company.id)
      if (error) {
        setMsg(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'stage_override_clear',
          target_type: 'company',
          target_id: company.id,
          old_value: company.stage_override,
          new_value: '',
        })
      } catch {
        /* optional */
      }
      setMsg('Override cleared.')
      await reload()
    } finally {
      setBusyAction(null)
    }
  }

  async function saveQuality() {
    if (!company) return
    setBusyAction('dq')
    setMsg('')
    try {
      const payload = buildCompanyPatch(company, {
        is_suspended: suspend,
        corporate_action_pending: corpPending,
        data_quality_flag: dqFlag || null,
      })
      const { error } = await supabase.from('companies').update(payload).eq('id', company.id)
      if (error) {
        setMsg(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'data_quality_update',
          target_type: 'company',
          target_id: company.id,
          notes: JSON.stringify({ dq: dqFlag, suspend, corpPending }),
        })
      } catch {
        /* optional */
      }
      setMsg('Data quality flags saved.')
      await reload()
    } finally {
      setBusyAction(null)
    }
  }

  async function saveCorpAction() {
    if (!company) return
    setBusyAction('corp')
    setMsg('')
    try {
      const row = {
        company_id: company.id,
        action_type: corpForm.action_type,
        action_date: corpForm.action_date,
        ratio: corpForm.ratio === '' ? null : Number(corpForm.ratio),
        notes: corpForm.notes.trim() || null,
        created_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('corporate_actions').insert(row)
      if (error) {
        setMsg(`Corporate action: ${error.message} (check table schema).`)
        return
      }
      try {
        await logAdminAction({
          action: 'corporate_action_add',
          target_type: 'company',
          target_id: company.id,
          new_value: corpForm.action_type,
          notes: corpForm.notes,
        })
      } catch {
        /* optional */
      }
      setShowCorpForm(false)
      setMsg('Corporate action saved.')
      await reload()
    } finally {
      setBusyAction(null)
    }
  }

  async function runPipeline(fnName) {
    if (!symbol) return
    setBusyAction(fnName)
    setMsg('')
    try {
      const { ok, status, json } = await postNetlifyFunction(fnName, { symbol })
      if (!ok) {
        setMsg(`Request failed (${status}): ${json?.error || JSON.stringify(json).slice(0, 200)}`)
        return
      }
      setMsg(typeof json?.message === 'string' ? json.message : 'Triggered successfully.')
    } catch (e) {
      setMsg(String(e?.message || e))
    } finally {
      setBusyAction(null)
    }
  }

  async function updateListedSymbol() {
    if (!company) return
    const nu = newSymbol.trim().toUpperCase()
    if (!nu) {
      setMsg('Enter a new NSE symbol.')
      return
    }
    if (nu === symbol) {
      setMsg('New symbol matches the current one.')
      return
    }
    setBusyAction('rename_sym')
    setMsg('')
    try {
      const { data: clash } = await supabase.from('companies').select('id').eq('symbol', nu).neq('id', company.id).maybeSingle()
      if (clash) {
        setMsg(`${nu} is already used by another company.`)
        return
      }
      const { error } = await supabase
        .from('companies')
        .update({ symbol: nu })
        .eq('id', company.id)
      if (error) {
        setMsg(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'symbol_rename',
          target_type: 'company',
          target_id: symbol,
          old_value: symbol,
          new_value: nu,
          notes: `id:${company.id}`,
        })
      } catch {
        /* optional */
      }
      setNewSymbol('')
      setMsg('Symbol updated. Run price fetch to get data under new symbol.')
      navigate(`/admin/stocks/${encodeURIComponent(nu)}`, { replace: true })
    } finally {
      setBusyAction(null)
    }
  }

  async function removeFromTrackingConfirmed() {
    if (!company) return
    const ok = window.confirm(
      `Are you sure you want to stop tracking ${symbol}? Existing data will be preserved but no new data will be fetched.`,
    )
    if (!ok) return
    setBusyAction('suspend_track')
    setMsg('')
    try {
      const { error } = await supabase
        .from('companies')
        .update(buildCompanyPatch(company, { is_suspended: true }))
        .eq('id', company.id)
      if (error) {
        setMsg(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'suspend_stock',
          target_type: 'company',
          target_id: symbol,
        })
      } catch {
        /* optional */
      }
      navigate('/admin/stocks')
    } finally {
      setBusyAction(null)
    }
  }

  async function generateDescription(model) {
    setAiGenerating(model)
    setMsg('')
    try {
      const financialContext = financials4.length
        ? `Latest quarter revenue: ${financials4[0]?.revenue ?? '—'}, net profit: ${financials4[0]?.net_profit ?? '—'}`
        : ''
      const { ok, status, json } = await postNetlifyFunction('admin-generate-description', {
        symbol,
        model,
        name: coForm.name,
        sector: coForm.sector,
        industry: coForm.industry,
        financialContext,
      })
      if (!ok) {
        setMsg(`AI error (${status}): ${json?.error || 'Unknown error'}`)
        return
      }
      if (json?.description) {
        // Normalize AI output — strip newlines/tabs, collapse spaces, trim
        const cleaned = normalizeCompanyDescription(json.description)
        setCoForm((s) => ({ ...s, description: cleaned }))
        setMsg(`Description generated by ${model === 'gemini' ? 'Gemini' : 'Claude'}. Review and save.`)
      }
    } catch (e) {
      setMsg(String(e?.message || e))
    } finally {
      setAiGenerating(null)
    }
  }

  if (!symbol) {
    return <p style={{ color: MUTED }}>Missing symbol.</p>
  }

  if (loading) {
    return <p style={{ color: MUTED }}>Loading…</p>
  }

  if (!company) {
    return (
      <div className="space-y-3">
        <p style={{ color: MUTED }}>No company for {symbol}.</p>
        <button type="button" className="text-sky-400 underline" onClick={() => navigate('/admin/stocks')}>
          Back to list
        </button>
      </div>
    )
  }

  const calcStage = priceLatest?.stage || '—'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/stocks" className="text-sm no-underline" style={{ color: '#38bdf8' }}>
          ← Stocks
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">
          {symbol} — {company.name}
        </h1>
      </div>
      {msg ? (
        <p className="text-sm" style={{ color: MUTED }}>
          {msg}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT */}
        <div className="space-y-4">
          <section className="rounded-lg border p-4" style={{ borderColor: BORDER, background: CARD }}>
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Company info</h2>
            <div className="mb-4 rounded border p-3" style={{ borderColor: BORDER }}>
              <p className="text-xs" style={{ color: MUTED }}>
                NSE symbol
              </p>
              <p className="mt-1 font-mono text-sm font-medium text-slate-100">Current: {symbol}</p>
              <label className="mt-2 block text-xs" style={{ color: MUTED }}>
                New symbol
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. ETERNAL"
                  className="mt-1 w-full rounded border px-2 py-2 font-mono text-sm"
                  style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                />
              </label>
              <button
                type="button"
                disabled={busyAction === 'rename_sym'}
                onClick={() => void updateListedSymbol()}
                className="mt-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                style={{ borderColor: BORDER, color: '#e2e8f0' }}
              >
                {busyAction === 'rename_sym' ? 'Updating…' : 'Update Symbol'}
              </button>
              <p className="mt-2 text-[10px]" style={{ color: MUTED }}>
                Use when the listing symbol changes (e.g. Zomato to Eternal). Historical rows stay keyed by company id.
              </p>
            </div>
            <div className="grid gap-2">
              <label className="text-xs" style={{ color: MUTED }}>
                Name
                <input
                  value={coForm.name}
                  onChange={(e) => setCoForm((s) => ({ ...s, name: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                />
              </label>
              <label className="text-xs" style={{ color: MUTED }}>
                Sector
                <select
                  value={coForm.sector}
                  onChange={(e) => setCoForm((s) => ({ ...s, sector: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                >
                  <option value="">—</option>
                  {sectors.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs" style={{ color: MUTED }}>
                Exchange
                <select
                  value={coForm.exchange}
                  onChange={(e) => setCoForm((s) => ({ ...s, exchange: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                >
                  <option value="NSE">NSE</option>
                  <option value="BSE">BSE</option>
                  <option value="BOTH">Both (dual listed)</option>
                </select>
              </label>
              {(coForm.exchange === 'BSE' || coForm.exchange === 'BOTH') && (
                <label className="text-xs" style={{ color: MUTED }}>
                  BSE scrip code (6-digit)
                  <input
                    inputMode="numeric"
                    value={coForm.bse_code}
                    onChange={(e) =>
                      setCoForm((s) => ({
                        ...s,
                        bse_code: e.target.value.replace(/\D/g, '').slice(0, 6),
                      }))
                    }
                    placeholder="e.g. 543272"
                    className="mt-1 w-full rounded border px-2 py-2 font-mono text-sm"
                    style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                  />
                </label>
              )}
              <div className="rounded border px-2 py-2 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
                <p className="font-medium text-slate-300">yfinance ticker</p>
                <p className="mt-1">
                  Stored (last successful price fetch):{' '}
                  <span className="font-mono text-slate-200">{String(company.yf_symbol || '').trim() || '—'}</span>
                </p>
                <p className="mt-1">
                  From exchange rules (preview): <span className="font-mono text-sky-300">{derivedYfTickerPreview}</span>
                </p>
                <p className="mt-1 text-[10px]">
                  Price job uses explicit yf_symbol when set; else BSE→code.BO, Both→SYMBOL.NS with BSE fallback, NSE→SYMBOL.NS.
                </p>
              </div>
              <label className="text-xs" style={{ color: MUTED }}>
                Industry
                <input
                  value={coForm.industry}
                  onChange={(e) => setCoForm((s) => ({ ...s, industry: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                />
              </label>
              <div className="text-xs" style={{ color: MUTED }}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span>Description (max 300) · {coForm.description.length}/300</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={!!aiGenerating}
                      onClick={() => void generateDescription('claude')}
                      className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                      style={{ borderColor: '#7c3aed', background: 'rgba(124,58,237,0.1)', color: '#c4b5fd' }}
                    >
                      {aiGenerating === 'claude' ? (
                        <><i className="ti ti-loader-2 animate-spin" style={{ fontSize: 11 }} /> Generating…</>
                      ) : (
                        <><i className="ti ti-sparkles" style={{ fontSize: 11 }} /> Claude Haiku</>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!!aiGenerating}
                      onClick={() => void generateDescription('gemini')}
                      className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                      style={{ borderColor: '#0369a1', background: 'rgba(3,105,161,0.1)', color: '#7dd3fc' }}
                    >
                      {aiGenerating === 'gemini' ? (
                        <><i className="ti ti-loader-2 animate-spin" style={{ fontSize: 11 }} /> Generating…</>
                      ) : (
                        <><i className="ti ti-sparkles" style={{ fontSize: 11 }} /> Gemini 2.5 Lite</>
                      )}
                    </button>
                  </div>
                </div>
                <textarea
                  value={coForm.description}
                  maxLength={300}
                  rows={4}
                  onChange={(e) => setCoForm((s) => ({ ...s, description: e.target.value }))}
                  className="mt-0 w-full rounded border px-2 py-2 text-sm"
                  style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                />
              </div>
              <label className="text-xs" style={{ color: MUTED }}>
                Admin notes (internal)
                <textarea
                  value={coForm.admin_notes}
                  rows={3}
                  onChange={(e) => setCoForm((s) => ({ ...s, admin_notes: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busySave}
              onClick={() => void saveCompany()}
              className="mt-4 rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: BORDER, color: '#e2e8f0' }}
            >
              {busySave ? 'Saving…' : 'Save changes'}
            </button>
          </section>

          <section className="rounded-lg border p-4" style={{ borderColor: BORDER, background: CARD }}>
            <h2 className="mb-2 text-sm font-semibold text-slate-100">Stage override</h2>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
              <span>Calculated:</span>
              <StagePill stage={calcStage === '—' ? null : calcStage} className="text-[10px]" />
              <span>Override:</span>
              {activeOverride ? (
                <StagePill stage={activeOverride.stage} className="text-[10px]" />
              ) : (
                <span>None</span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setOverrideStage(s)}
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: overrideStage === s ? '#38bdf8' : BORDER,
                    color: '#e2e8f0',
                  }}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOverrideStage('')}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                Clear
              </button>
            </div>

            <label className="mt-3 block text-xs" style={{ color: MUTED }}>
              Reason (required)
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-2 text-sm"
                style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
              />
            </label>

            <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: MUTED }}>
              {[
                ['3', '3 days'],
                ['7', '7 days'],
                ['30', '30 days'],
              ].map(([v, label]) => (
                <label key={v} className="flex items-center gap-1">
                  <input type="radio" name="ex" checked={overrideDays === v} onChange={() => setOverrideDays(v)} />
                  {label}
                </label>
              ))}
            </div>

            <button
              type="button"
              disabled={busyAction === 'override'}
              onClick={() => void setOverride()}
              className="mt-3 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: '#fbbf24', color: '#fde68a' }}
            >
              {busyAction === 'override' ? 'Setting…' : 'Set override'}
            </button>

            {activeOverride ? (
              <div className="mt-4 rounded border p-3 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
                <p>{`Override set by ${ADMIN_EMAIL}`}</p>
                <p>{`Expires: ${activeOverride.exp ? fmtDate(activeOverride.exp) : '—'}`}</p>
                <p>{`Reason: ${activeOverride.reason || '—'}`}</p>
                <button
                  type="button"
                  disabled={busyAction === 'clear_ov'}
                  onClick={() => void clearOverride()}
                  className="mt-2 rounded border px-3 py-1 text-xs disabled:opacity-50"
                  style={{ borderColor: BORDER, color: '#fca5a5' }}
                >
                  Clear override
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border p-4" style={{ borderColor: BORDER, background: CARD }}>
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Data quality</h2>
            <label className="flex items-center gap-2 text-sm" style={{ color: '#e2e8f0' }}>
              <input type="checkbox" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} />
              Is suspended (hide from users)
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm" style={{ color: '#e2e8f0' }}>
              <input type="checkbox" checked={corpPending} onChange={(e) => setCorpPending(e.target.checked)} />
              Corporate action pending
            </label>
            <p className="mt-3 text-xs" style={{ color: MUTED }}>
              Data quality flag
            </p>
            <select
              value={dqFlag}
              onChange={(e) => setDqFlag(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-2 text-sm"
              style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
            >
              <option value="">None</option>
              <option value="price_suspect">Price suspect</option>
              <option value="delivery_missing">Delivery missing</option>
              <option value="financials_stale">Financials stale</option>
              <option value="symbol_changed">Symbol changed</option>
            </select>
            <button
              type="button"
              disabled={busyAction === 'dq'}
              onClick={() => void saveQuality()}
              className="mt-3 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: BORDER, color: '#e2e8f0' }}
            >
              {busyAction === 'dq' ? 'Saving…' : 'Save'}
            </button>
          </section>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          <section className="rounded-lg border p-4" style={{ borderColor: BORDER, background: CARD }}>
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Current data snapshot</h2>
            <ul className="space-y-1 text-sm text-slate-200">
              <li>Close: {money(priceLatest?.close)}</li>
              <li>MA30W: {money(priceLatest?.ma30w)}</li>
              <li>
                MA30W slope: {priceLatest?.ma30w_slope != null ? `${Number(priceLatest.ma30w_slope).toFixed(4)}%` : '—'}
              </li>
              <li className="flex items-center gap-2">
                Stage (calculated):
                <StagePill stage={calcStage === '—' ? null : calcStage} className="text-[10px]" />
              </li>
              <li>OBV: {obvTrendFromSlope(priceLatest?.obv_slope)}</li>
              <li>RS vs Nifty: {priceLatest?.rs_vs_nifty != null ? `${Number(priceLatest.rs_vs_nifty).toFixed(2)}%` : '—'}</li>
              <li>52W High: {money(priceLatest?.high_52w)}</li>
              <li>52W Low: {money(priceLatest?.low_52w)}</li>
              <li>RSI: {priceLatest?.rsi != null ? Number(priceLatest.rsi).toFixed(1) : '—'}</li>
            </ul>
            <p className="mt-3 text-[10px]" style={{ color: MUTED }}>
              Shareholding latest: {shareLatest ? shareLatest.quarter || '—' : 'none'} · Financials rows:{' '}
              {financials4.length} · Delivery signals: {deliverySig?.date ? String(deliverySig.date) : 'none'}
            </p>
          </section>

          <section className="rounded-lg border p-4" style={{ borderColor: BORDER, background: CARD }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">Corporate actions</h2>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: BORDER, color: '#38bdf8' }}
                onClick={() => setShowCorpForm((v) => !v)}
              >
                + Add action
              </button>
            </div>

            {showCorpForm ? (
              <div className="mb-4 rounded border p-3" style={{ borderColor: BORDER }}>
                <label className="block text-xs" style={{ color: MUTED }}>
                  Type
                  <select
                    value={corpForm.action_type}
                    onChange={(e) => setCorpForm((s) => ({ ...s, action_type: e.target.value }))}
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                  >
                    <option value="split">Split</option>
                    <option value="bonus">Bonus</option>
                    <option value="name_change">Name change</option>
                    <option value="dividend">Dividend</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs" style={{ color: MUTED }}>
                  Date
                  <input
                    type="date"
                    value={corpForm.action_date}
                    onChange={(e) => setCorpForm((s) => ({ ...s, action_date: e.target.value }))}
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                  />
                </label>
                <label className="mt-2 block text-xs" style={{ color: MUTED }}>
                  Ratio
                  <input
                    value={corpForm.ratio}
                    onChange={(e) => setCorpForm((s) => ({ ...s, ratio: e.target.value }))}
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                  />
                </label>
                <label className="mt-2 block text-xs" style={{ color: MUTED }}>
                  Notes
                  <input
                    value={corpForm.notes}
                    onChange={(e) => setCorpForm((s) => ({ ...s, notes: e.target.value }))}
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    style={{ borderColor: BORDER, background: '#080c14', color: '#e2e8f0' }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busyAction === 'corp'}
                  onClick={() => void saveCorpAction()}
                  className="mt-2 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                  style={{ borderColor: BORDER, color: '#e2e8f0' }}
                >
                  Save action
                </button>
              </div>
            ) : null}

            <ul className="space-y-2 text-sm" style={{ color: MUTED }}>
              {corpRows.length ? (
                corpRows.map((r, i) => (
                  <li key={r.id || i} className="border-b pb-2" style={{ borderColor: BORDER }}>
                    <span className="text-slate-200">{r.action_type}</span> · {fmtDate(r.action_date)}
                    {r.ratio != null ? ` · ratio ${r.ratio}` : ''}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </li>
                ))
              ) : (
                <li>No corporate actions (or table missing).</li>
              )}
            </ul>
          </section>

          <section className="rounded-lg border p-4" style={{ borderColor: BORDER, background: CARD }}>
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Re-fetch data</h2>
            <p className="mb-2 text-xs" style={{ color: MUTED }}>
              Configure Netlify paths via env{' '}
              <code className="text-slate-400">VITE_NETLIFY_FUNCTIONS_URL</code>. Defaults use{' '}
              <code className="text-slate-400">/.netlify/functions/&lt;name&gt;</code>.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busyAction === 'admin-fetch-price'}
                onClick={() => void runPipeline('admin-fetch-price')}
                className="rounded border px-3 py-2 text-left text-sm disabled:opacity-50"
                style={{ borderColor: BORDER, color: '#e2e8f0' }}
              >
                {busyAction === 'admin-fetch-price' ? 'Running…' : 'Re-fetch price data'}
              </button>
              <button
                type="button"
                disabled={busyAction === 'admin-fetch-financials'}
                onClick={() => void runPipeline('admin-fetch-financials')}
                className="rounded border px-3 py-2 text-left text-sm disabled:opacity-50"
                style={{ borderColor: BORDER, color: '#e2e8f0' }}
              >
                {busyAction === 'admin-fetch-financials' ? 'Running…' : 'Re-fetch financials'}
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-lg border p-4" style={{ borderColor: '#991b1b', background: 'rgba(127,29,29,0.12)' }}>
        <h2 className="mb-2 text-sm font-semibold text-red-200">Danger zone</h2>
        <p className="text-sm text-slate-200">Remove from tracking</p>
        <p className="mt-1 text-xs" style={{ color: MUTED }}>
          This stops fetching data for this stock. Existing data is preserved.
        </p>
        <button
          type="button"
          disabled={busyAction === 'suspend_track'}
          onClick={() => void removeFromTrackingConfirmed()}
          className="mt-3 rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: '#dc2626', background: 'rgba(220,38,38,0.15)', color: '#fecaca' }}
        >
          {busyAction === 'suspend_track' ? 'Removing…' : 'Remove Stock'}
        </button>
      </section>
    </div>
  )
}
