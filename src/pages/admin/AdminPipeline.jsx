import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

// ── /admin/pipeline ──────────────────────────────────────────────────────
// Three sections:
//   1. Last 7 runs — daily-pipeline summary aggregated from usage_events
//   2. Error log  — last 20 events with 'error' or 'failed' in event_type
//   3. Data freshness — current row counts + latest date for each core table

const TODAY = () => new Date().toISOString().slice(0, 10)
function daysAgoIso(n) {
  return new Date(Date.now() - n * 86400000).toISOString()
}
function fmt(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function H1({ children }) {
  return (
    <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>{children}</h1>
  )
}

function SectionLabel({ children }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: C.textMuted,
      margin: '24px 0 12px',
    }}>
      {children}
    </p>
  )
}

// ── Section 1: Last 7 runs ──────────────────────────────────────────────
function LastRuns({ runs }) {
  if (runs.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: C.textFaint, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
        No pipeline runs logged in the last 7 days.
      </div>
    )
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Date', 'Steps completed', 'Errors', 'Stocks processed', 'Status'].map(h => (
              <th key={h} style={{
                padding: '10px 12px', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                color: C.textMuted, textAlign: 'left',
                borderBottom: `1px solid ${C.border}`,
                background: C.surface,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={r.date} style={{ background: i % 2 ? C.surface : C.base }}>
              <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{r.date}</td>
              <td style={{ padding: '10px 12px', color: C.textMuted }}>{r.stepsCompleted}</td>
              <td style={{ padding: '10px 12px', color: r.errors > 0 ? C.red : C.textMuted, fontWeight: r.errors > 0 ? 700 : 400 }}>
                {r.errors}
              </td>
              <td style={{ padding: '10px 12px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{r.stocks}</td>
              <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                {r.status === 'success' && <span style={{ color: C.green }}>✅ success</span>}
                {r.status === 'partial' && <span style={{ color: C.amber }}>⚠️ partial</span>}
                {r.status === 'failed'  && <span style={{ color: C.red }}>❌ failed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Section 2: Error log ────────────────────────────────────────────────
function ErrorLog({ rows }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: C.green, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
        ✅ No errors in the last 7 days.
      </div>
    )
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Time (IST)', 'Script', 'Error', 'Resolved'].map(h => (
              <th key={h} style={{
                padding: '10px 12px', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                color: C.textMuted, textAlign: 'left',
                borderBottom: `1px solid ${C.border}`,
                background: C.surface,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} style={{ background: i % 2 ? C.surface : C.base }}>
              <td style={{ padding: '10px 12px', color: C.textMuted, whiteSpace: 'nowrap', fontSize: 11 }}>
                {fmt(r.created_at)}
              </td>
              <td style={{ padding: '10px 12px', color: C.text, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11 }}>
                {r.script}
              </td>
              <td style={{ padding: '10px 12px', color: C.red, wordBreak: 'break-word', maxWidth: 480 }}>
                {r.message || '—'}
              </td>
              <td style={{ padding: '10px 12px', color: C.textMuted }}>—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Section 3: Data freshness ───────────────────────────────────────────
function DataFreshness({ tables, todayIso }) {
  const todayIsWeekday = (() => {
    const d = new Date()
    const dow = d.getDay()
    return dow >= 1 && dow <= 5
  })()

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: 16,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tables.map(t => {
          const isStale = todayIsWeekday && t.latest && t.latest < todayIso
          return (
            <div key={t.name} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px',
              background: isStale ? C.redBg : C.base,
              border: `1px solid ${isStale ? C.redBorder : C.border}`,
              borderRadius: 8,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                  {t.name}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  latest: {t.latest || '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                  {(t.count || 0).toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>rows</div>
              </div>
            </div>
          )
        })}
      </div>

      {tables.some(t => todayIsWeekday && t.latest && t.latest < todayIso) && (
        <div style={{
          marginTop: 12, padding: 12,
          background: C.redBg, border: `1px solid ${C.redBorder}`,
          borderRadius: 8, color: C.red, fontSize: 12, fontWeight: 600,
        }}>
          ⚠️ Data may be stale — pipeline may not have run today.
        </div>
      )}
    </div>
  )
}

// ── Top level ───────────────────────────────────────────────────────────
export default function AdminPipeline() {
  const [runs, setRuns] = useState(null)
  const [errors, setErrors] = useState(null)
  const [tables, setTables] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const since = daysAgoIso(7)

      const [evtRes, errRes, ...freshRes] = await Promise.all([
        supabase.from('usage_events').select('event_type,created_at,metadata').gte('created_at', since).limit(5000),
        supabase.from('usage_events').select('id,event_type,created_at,metadata')
          .or('event_type.like.%failed%,event_type.like.%error%')
          .gte('created_at', since).order('created_at', { ascending: false }).limit(20),
        // Table freshness probes (count + latest date)
        supabase.from('price_data').select('id', { count: 'exact', head: true }),
        supabase.from('price_data').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('swing_conditions').select('id', { count: 'exact', head: true }),
        supabase.from('swing_conditions').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('stock_descriptions').select('id', { count: 'exact', head: true }),
        supabase.from('stock_descriptions').select('trading_date').order('trading_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('sectors').select('id', { count: 'exact', head: true }),
        supabase.from('sectors').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
      ])

      if (cancelled) return

      // ── Group last 7 runs by date ──
      const events = evtRes.data || []
      const byDate = {}
      for (const e of events) {
        const d = (e.created_at || '').slice(0, 10)
        if (!d) continue
        if (!byDate[d]) byDate[d] = { date: d, steps: new Set(), errors: 0, stocks: 0 }
        byDate[d].steps.add(e.event_type)
        if (/failed|error/i.test(e.event_type)) byDate[d].errors += 1
        const meta = e.metadata || {}
        const n = Number(meta.processed_symbols ?? meta.success ?? meta.processed ?? 0)
        if (n > byDate[d].stocks) byDate[d].stocks = n
      }
      const runRows = Object.values(byDate)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(r => ({
          date: r.date,
          stepsCompleted: r.steps.size,
          errors: r.errors,
          stocks: r.stocks,
          status: r.errors === 0
            ? 'success'
            : r.errors >= r.steps.size
              ? 'failed'
              : 'partial',
        }))
      setRuns(runRows)

      // ── Error log ──
      setErrors((errRes.data || []).map(e => {
        const meta = e.metadata || {}
        return {
          id: e.id,
          created_at: e.created_at,
          script: e.event_type,
          message: meta.error || meta.message || '',
        }
      }))

      // ── Freshness ──
      const [pdC, pdL, swC, swL, sdC, sdL, scC, scL] = freshRes
      setTables([
        { name: 'price_data',         count: pdC?.count ?? 0, latest: pdL?.data?.date         || null },
        { name: 'swing_conditions',   count: swC?.count ?? 0, latest: swL?.data?.date         || null },
        { name: 'stock_descriptions', count: sdC?.count ?? 0, latest: sdL?.data?.trading_date || null },
        { name: 'sectors',            count: scC?.count ?? 0, latest: scL?.data?.date         || null },
      ])
    })()
    return () => { cancelled = true }
  }, [])

  if (runs === null) return <p style={{ color: C.textMuted }}>Loading…</p>

  return (
    <div style={{ maxWidth: 1200 }}>
      <H1>Pipeline Logs</H1>
      <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
        Last 7 daily runs · error log · data freshness check.
      </p>

      <SectionLabel>Last 7 runs</SectionLabel>
      <LastRuns runs={runs} />

      <SectionLabel>Error log</SectionLabel>
      <ErrorLog rows={errors || []} />

      <SectionLabel>Data freshness</SectionLabel>
      <DataFreshness tables={tables || []} todayIso={TODAY()} />

      <SectionLabel>AI Model Configuration</SectionLabel>
      <AiConfigSection />
    </div>
  )
}

// ── Known Gemini models for the admin dropdown ─────────────────────────
// Hardcoded "verified" list — admins pick from this in the dropdown
// instead of free-typing a model string (typo → silently broken
// pipeline). The "OTHER" sentinel falls back to the original text
// input for preview / brand-new models the dropdown doesn't list yet.
//
// The list is REFRESHED on demand via /.netlify/functions/fetch-gemini-models
// which calls Google's official models endpoint. Live results get
// merged with this baseline so anything new shows up with a (NEW)
// badge. Last-refreshed timestamp is cached in localStorage.
const KNOWN_GEMINI_MODELS = [
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    tier: 'Cheapest · 1000 RPD free',
    use:  'Simple tasks, chips, summaries',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    tier: 'Balanced · 250 RPD free',
    use:  'Complex tasks, narratives',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    tier: 'Premium · 50 RPD free',
    use:  'Highest quality tasks only',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    tier: 'Newer · Lite-tier ($0.25 in / $1.50 out)',
    use:  'Mid-cost BYOK default — 3.x quality at lite price',
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    tier: 'Latest · Free tier available',
    use:  'Current generation flagship',
  },
]

// Sentinel for the "type a model name manually" option in the dropdown.
const MANUAL_ENTRY_ID = '__OTHER__'

// Sunset models — when an ai_config row's value matches one of these,
// the admin sees an amber warning card with a one-click "Update now"
// jump to the row's dropdown. Update this list as Google sunsets more
// models (kept inline so the warning is admin-side, no DB hop).
const DEPRECATED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-1.0-pro',
]

// Manual-entry validator. The dropdown short-circuits on a valid
// well-known model id; OTHER → text input → this regex gates Save so
// a typo like "gimini-2.5-flash" can't slip through.
const MANUAL_MODEL_RE = /^gemini-[\w.-]+$/

// Localised display of a "last refreshed" timestamp. ISO in / friendly
// out, falls back to null on a bad input.
function formatRefreshTs(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return null }
}

// localStorage keys for the live-model cache (admin refresh).
const LIVE_MODELS_LS_KEY = 'pinex_ai_config_live_models'
const LIVE_MODELS_TS_LS_KEY = 'pinex_ai_config_live_models_ts'

// ── AI Model Configuration ───────────────────────────────────────────────
// Lets admins change Gemini model names without a code deployment.
// Each row in ai_config is rendered as an editable input + toggle +
// test button. Saves are immediate; the test button issues a minimal
// generateContent call to verify the model is reachable.

function AiConfigSection() {
  const [rows, setRows]       = useState(null)
  const [savingKey, setSaving] = useState(null)
  const [flashKey,  setFlash]  = useState(null)
  const [testingKey, setTesting] = useState(null)
  const [testResult, setTestResult] = useState({}) // configKey -> { ok, message }
  const [editValue,  setEditValue]  = useState({}) // configKey -> current input string
  const [adminEmail, setAdminEmail] = useState('')
  // Per-row toggle: when true, the row renders the manual text input
  // instead of the dropdown. Flipped by selecting "Enter manually…"
  // in the dropdown OR by the "Update now" CTA on a deprecation card.
  const [manualMode, setManualMode] = useState({})  // config_key -> bool
  // Live model list fetched from Google via the Netlify proxy. Seeded
  // from localStorage so a refreshed page keeps the previous result
  // visible while a new fetch is in flight. null = not refreshed yet.
  const [liveModels, setLiveModels] = useState(() => {
    try {
      const raw = localStorage.getItem(LIVE_MODELS_LS_KEY)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const [liveRefreshedAt, setLiveRefreshedAt] = useState(() => {
    try { return localStorage.getItem(LIVE_MODELS_TS_LS_KEY) || null } catch { return null }
  })
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { getAllAiConfig } = await import('../../lib/aiConfig')
      const data = await getAllAiConfig()
      if (cancelled) return
      setRows(data)
      const seed = {}
      for (const r of data) seed[r.config_key] = r.config_value
      setEditValue(seed)

      // Pull admin's email for the updated_by audit column
      try {
        const { data: userRes } = await supabase.auth.getUser()
        if (!cancelled) setAdminEmail(userRes?.user?.email || '')
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  async function handleSave(row) {
    // The dropdown auto-save path passes _overrideValue so handleSave
    // doesn't race the async editValue state update — without this the
    // first dropdown change would compare an empty/stale editValue
    // against row.config_value and silently no-op.
    const newValue = String(
      row._overrideValue ?? editValue[row.config_key] ?? '',
    ).trim()
    if (!newValue || newValue === row.config_value) return

    // Strict manual-format gate for the Gemini text input. The dropdown
    // never triggers this because its values are pre-validated against
    // KNOWN_GEMINI_MODELS / liveModels. Only manual entry needs the
    // regex check ("gimini-2.5-flash" typo → friendly inline error
    // instead of silently breaking the pipeline).
    if (/^gemini_/.test(row.config_key) && !MANUAL_MODEL_RE.test(newValue)) {
      window.alert(
        `"${newValue}" doesn\'t look like a valid Gemini model id.\n` +
        `Expected something matching: gemini-X.Y-flash[-lite|-preview|…]\n\n` +
        `Pick from the dropdown, or check the model name at\n` +
        `aistudio.google.com/models`,
      )
      return
    }

    const { updateAiConfig, validateModelName } = await import('../../lib/aiConfig')

    // Soft warning — never blocks save. We surface it once via window.confirm
    // so an unusual model name still requires an extra click.
    const v = validateModelName(newValue)
    if (!v.ok) {
      const proceed = window.confirm(
        `${v.warning}\n\nProceed with "${newValue}" anyway?`,
      )
      if (!proceed) return
    }

    setSaving(row.config_key)
    try {
      const updated = await updateAiConfig(
        row.config_key,
        { config_value: newValue },
        adminEmail || null,
      )
      setRows(prev => (prev || []).map(r =>
        r.config_key === row.config_key ? { ...r, ...updated, config_value: newValue } : r,
      ))
      setFlash(row.config_key)
      setTimeout(() => setFlash(null), 2000)
    } catch (e) {
      window.alert(`Save failed: ${e?.message || 'unknown error'}`)
    } finally {
      setSaving(null)
    }
  }

  async function handleToggleActive(row) {
    const { updateAiConfig } = await import('../../lib/aiConfig')
    try {
      const updated = await updateAiConfig(
        row.config_key,
        { is_active: !row.is_active },
        adminEmail || null,
      )
      setRows(prev => (prev || []).map(r =>
        r.config_key === row.config_key ? { ...r, ...updated, is_active: !row.is_active } : r,
      ))
    } catch (e) {
      window.alert(`Toggle failed: ${e?.message || 'unknown error'}`)
    }
  }

  async function handleTest(row) {
    setTesting(row.config_key)
    setTestResult(prev => ({ ...prev, [row.config_key]: null }))
    const { testModel } = await import('../../lib/aiConfig')
    // Use the admin's own browser-stored Gemini key — no server-side key needed.
    let apiKey = ''
    try { apiKey = localStorage.getItem('pinex_gemini_key') || '' } catch {}
    if (!apiKey) {
      setTestResult(prev => ({
        ...prev,
        [row.config_key]: {
          ok: false,
          message: 'No Gemini key in this browser. Add one at /account#research first.',
        },
      }))
      setTesting(null)
      return
    }
    const result = await testModel(editValue[row.config_key] || row.config_value, apiKey)
    setTestResult(prev => ({ ...prev, [row.config_key]: result }))
    setTesting(null)
  }

  // ── Refresh-from-Google handler ──────────────────────────────────
  // Hits the Netlify proxy that uses GEMINI_API_KEY from server-side
  // env (admin doesn't paste their own key just to list models).
  // Result is cached in localStorage so the page can show the
  // previous list immediately on next mount while the next refresh
  // is in flight.
  async function handleRefreshLiveModels() {
    setRefreshing(true)
    setRefreshError('')
    try {
      const res = await fetch('/.netlify/functions/fetch-gemini-models')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const models = Array.isArray(data?.models) ? data.models : []
      const ts = data?.fetchedAt || new Date().toISOString()
      setLiveModels(models)
      setLiveRefreshedAt(ts)
      try {
        localStorage.setItem(LIVE_MODELS_LS_KEY, JSON.stringify(models))
        localStorage.setItem(LIVE_MODELS_TS_LS_KEY, ts)
      } catch { /* private browsing — non-fatal */ }
    } catch (e) {
      setRefreshError(e?.message || 'Could not reach Google.')
    } finally {
      setRefreshing(false)
    }
  }

  // ── Merged dropdown options ──────────────────────────────────────
  // KNOWN_GEMINI_MODELS is the always-visible baseline. liveModels
  // (when present) merges in — anything we don't already know about
  // gets a (NEW) badge. De-duped by id. MANUAL_ENTRY_ID is appended
  // last as the sentinel.
  function buildDropdownOptions() {
    const out = []
    const known = new Set()
    for (const m of KNOWN_GEMINI_MODELS) {
      known.add(m.id)
      out.push({ ...m, isNew: false })
    }
    if (Array.isArray(liveModels)) {
      for (const lm of liveModels) {
        if (!lm?.id || known.has(lm.id)) continue
        known.add(lm.id)
        // Only surface Gemini-family models in this dropdown — the
        // ai_config rows we render are all Gemini. Other model
        // providers (if any are added later) would get their own
        // dropdown wired through the same pattern.
        if (!/^gemini-/i.test(lm.id)) continue
        out.push({
          id: lm.id,
          label: lm.displayName || lm.id,
          tier: '',
          use:  lm.description ? String(lm.description).slice(0, 80) : '',
          isNew: true,
        })
      }
    }
    out.push({
      id: MANUAL_ENTRY_ID,
      label: '✏️ Enter manually…',
      tier: '',
      use:  'For preview / brand-new models',
      isNew: false,
    })
    return out
  }

  if (rows === null) {
    return <p style={{ color: C.textMuted, fontSize: 12 }}>Loading config…</p>
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px', lineHeight: 1.5 }}>
        Change model names here — no code deployment needed.
        Changes take effect immediately for the next call.
      </p>

      {/* ── Refresh-from-Google toolbar ───────────────────────────────
          Hits /.netlify/functions/fetch-gemini-models which proxies
          Google's models endpoint (so the admin doesn't paste their
          own key just to list models). The merged result widens the
          dropdown options below — new models appear with a (NEW)
          badge. */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: 10, marginBottom: 12,
      }}>
        <button
          type="button"
          onClick={handleRefreshLiveModels}
          disabled={refreshing}
          style={{
            padding: '7px 12px',
            background: refreshing ? C.surface2 : C.surface,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 12, fontWeight: 600,
            cursor: refreshing ? 'wait' : 'pointer',
          }}
        >
          {refreshing ? '🔄 Refreshing…' : '🔄 Refresh from Google'}
        </button>
        {liveRefreshedAt && (
          <span style={{ fontSize: 11, color: C.textMuted }}>
            Last refreshed: {formatRefreshTs(liveRefreshedAt) || liveRefreshedAt}
          </span>
        )}
        {refreshError && (
          <span style={{ fontSize: 11, color: C.red }}>
            {refreshError}
          </span>
        )}
      </div>

      {/* ── Deprecation warnings ──────────────────────────────────────
          For every row whose current config_value is in
          DEPRECATED_MODELS, show an amber alert that jumps the row's
          dropdown into focus on click. Quiet (renders nothing) when
          no rows are deprecated. */}
      {(() => {
        const deprecated = rows.filter((r) => DEPRECATED_MODELS.includes(r.config_value))
        if (deprecated.length === 0) return null
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {deprecated.map((r) => (
              <div
                key={`dep-${r.config_key}`}
                style={{
                  background: 'rgba(245,159,11,0.08)',
                  border: `1px solid ${C.amberBorder}`,
                  borderLeft: `3px solid ${C.amber}`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: 13, color: C.text, lineHeight: 1.55,
                }}
              >
                <div style={{ fontWeight: 700, color: C.amber, marginBottom: 4 }}>
                  ⚠️ Deprecated model detected
                </div>
                <div style={{ marginBottom: 8 }}>
                  <code style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                    {r.config_key}
                  </code>{' '}
                  is set to{' '}
                  <code style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                    {r.config_value}
                  </code>{' '}
                  which Google has scheduled for sunset.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // Make sure the row is in dropdown mode (not manual)
                    // and scroll it into view so the admin can pick the
                    // replacement with one click.
                    setManualMode((prev) => ({ ...prev, [r.config_key]: false }))
                    const node = document.querySelector(
                      `[data-ai-config-row="${r.config_key}"]`,
                    )
                    if (node && typeof node.scrollIntoView === 'function') {
                      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      const sel = node.querySelector('select')
                      if (sel) sel.focus()
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    background: C.amber,
                    color: '#000',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12, fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Update now
                </button>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Warning box */}
      <div style={{
        background: C.surface,
        border: `1px solid ${C.amberBorder}`,
        borderLeft: `3px solid ${C.amber}`,
        borderRadius: 10,
        padding: '12px 14px',
        marginBottom: 14,
        fontSize: 12, color: C.text, lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 700, color: C.amber, marginBottom: 6 }}>
          ⚠️ Important
        </div>
        Only use model names from Google AI Studio. Wrong model names will
        break the pipeline silently.<br /><br />
        <span style={{ color: C.textMuted }}>Current valid models:</span>{' '}
        <code style={{
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          background: C.surface2, padding: '1px 5px', borderRadius: 4, marginRight: 4,
        }}>gemini-2.5-flash</code>
        <code style={{
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          background: C.surface2, padding: '1px 5px', borderRadius: 4, marginRight: 4,
        }}>gemini-2.5-flash-lite</code>
        <code style={{
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          background: C.surface2, padding: '1px 5px', borderRadius: 4,
        }}>gemini-2.5-pro</code>
        <br /><br />
        <span style={{ color: C.textMuted }}>Check latest at:</span>{' '}
        <a href="https://aistudio.google.com/models" target="_blank" rel="noopener noreferrer"
          style={{ color: C.amber }}>aistudio.google.com/models</a>
      </div>

      {/* Config table — rows are split into two groups so the admin
          immediately sees which models cost PineX (pipeline, shared
          server-side key) vs which cost the END USER (BYOK Research
          Assistant + Lab NL translator). Membership lookup is a small
          hardcoded Set rather than a DB column because BYOK status is
          a property of the CALLER, not of the model row. */}
      {(() => {
        if (rows.length === 0) {
          return (
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: 16,
            }}>
              <p style={{ color: C.textFaint, fontSize: 12, margin: 0 }}>
                No ai_config rows yet. Run scripts/sql/create_ai_config_table.sql.
              </p>
            </div>
          )
        }

        const BYOK_KEYS = new Set([
          'gemini_research_model',
          'gemini_simple_model',
          'gemini_complex_model',
        ])
        const pipelineRows = rows.filter((r) => !BYOK_KEYS.has(r.config_key))
        const byokRows     = rows.filter((r) =>  BYOK_KEYS.has(r.config_key))

        const SectionLabel = ({ children }) => (
          <div style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: C.textMuted,
            marginTop: 16,
            marginBottom: 8,
            fontWeight: 700,
          }}>
            {children}
          </div>
        )

        const renderRow = (r, i, groupLen) => {
          const flashing = flashKey === r.config_key
          const saving = savingKey === r.config_key
          const testing = testingKey === r.config_key
          const testR = testResult[r.config_key]
          const dirty = (editValue[r.config_key] || '') !== r.config_value
          // Rows whose config_key starts with `gemini_` render the
          // dropdown selector; everything else (Claude/legacy etc.)
          // falls through to the plain text input. The data-attribute
          // is consumed by the deprecation "Update now" CTA to scroll
          // + focus this row.
          const isGeminiRow = /^gemini_/.test(r.config_key)
          const dropdownOptions = isGeminiRow ? buildDropdownOptions() : null
          const currentValue = editValue[r.config_key] ?? r.config_value
          // Show the dropdown when (a) this is a Gemini row, (b) the
          // current value is recognised (in known list OR live list),
          // AND (c) the admin hasn't explicitly flipped to manual.
          const isKnownGeminiValue = isGeminiRow && (
            dropdownOptions?.some((o) => o.id === currentValue) || false
          )
          const showDropdown = isGeminiRow && isKnownGeminiValue && !manualMode[r.config_key]
          return (
            <div
              key={r.config_key}
              data-ai-config-row={r.config_key}
              style={{
                padding: '14px 16px',
                borderBottom: i === groupLen - 1 ? 'none' : `1px solid ${C.border}`,
                opacity: r.is_active ? 1 : 0.55,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    {r.display_name}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, lineHeight: 1.5 }}>
                    {r.description}
                  </div>
                  <div style={{ fontSize: 10, color: C.textFaint, marginTop: 4 }}>
                    <code style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                      {r.config_key}
                    </code>
                  </div>
                </div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, color: C.textMuted, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>
                  <input
                    type="checkbox"
                    checked={r.is_active}
                    onChange={() => handleToggleActive(r)}
                    style={{ accentColor: C.amber }}
                  />
                  {r.is_active ? 'Active' : 'Inactive (using fallback)'}
                </label>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                {showDropdown ? (
                  <select
                    value={currentValue}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === MANUAL_ENTRY_ID) {
                        // Flip to manual entry; seed the editValue with
                        // whatever was there so the admin can refine it.
                        setManualMode((prev) => ({ ...prev, [r.config_key]: true }))
                        // Microtask defer to let the input render before focus.
                        setTimeout(() => {
                          const node = document.querySelector(`[data-ai-config-row="${r.config_key}"] input[type="text"]`)
                          if (node) node.focus()
                        }, 0)
                        return
                      }
                      setEditValue((prev) => ({ ...prev, [r.config_key]: v }))
                      // Spec: "Update the config_value immediately."
                      // Pass an override row so handleSave's dirty check
                      // uses the just-picked value rather than the stale
                      // editValue (state update is async).
                      handleSave({ ...r, _overrideValue: v })
                    }}
                    style={{
                      flex: 1, minWidth: 220,
                      padding: '8px 10px',
                      background: 'var(--bg-input)',
                      border: `1px solid ${dirty ? C.amber : C.border}`,
                      borderRadius: 8,
                      color: C.text,
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  >
                    {dropdownOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.id === MANUAL_ENTRY_ID
                          ? o.label
                          : `${o.label}${o.isNew ? ' (NEW)' : ''}${o.tier ? ` · ${o.tier}` : ''}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={currentValue}
                    onChange={(e) => setEditValue(prev => ({ ...prev, [r.config_key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(r) }}
                    placeholder={isGeminiRow ? 'gemini-X.Y-flash[-…]' : ''}
                    style={{
                      flex: 1, minWidth: 220,
                      padding: '8px 10px',
                      background: 'var(--bg-input)',
                      border: `1px solid ${dirty ? C.amber : C.border}`,
                      borderRadius: 8,
                      color: C.text,
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                )}
                {/* Manual-mode admins get a one-click way back to the
                    dropdown — useful if the typed value matches a
                    known model after all and they'd rather pick it. */}
                {isGeminiRow && !showDropdown && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualMode((prev) => ({ ...prev, [r.config_key]: false }))
                      // If the typed value isn't recognised, the
                      // dropdown will still show but the displayed
                      // option won't match; that's acceptable — the
                      // admin can then pick a known one explicitly.
                    }}
                    style={{
                      padding: '8px 10px',
                      background: 'transparent',
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      color: C.textMuted,
                      fontSize: 11,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title="Switch back to the dropdown"
                  >
                    ↩ Picker
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSave(r)}
                  disabled={saving || !dirty}
                  style={{
                    padding: '8px 14px',
                    background: flashing ? C.green : (dirty ? C.amber : C.surface2),
                    color: flashing ? '#000' : (dirty ? '#000' : C.textMuted),
                    border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 700,
                    cursor: saving || !dirty ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Saving…' : (flashing ? 'Saved ✓' : 'Save')}
                </button>
                <button
                  type="button"
                  onClick={() => handleTest(r)}
                  disabled={testing}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    color: C.text,
                    fontSize: 12, fontWeight: 600,
                    cursor: testing ? 'wait' : 'pointer',
                  }}
                >
                  {testing ? 'Testing…' : 'Test'}
                </button>
              </div>

              {testR && (
                <div style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  background: testR.ok ? C.greenBg : C.redBg,
                  border: `1px solid ${testR.ok ? C.greenBorder : C.redBorder}`,
                  borderRadius: 6,
                  color: testR.ok ? C.green : C.red,
                  fontSize: 11, lineHeight: 1.5,
                }}>
                  {testR.ok ? '✅ ' : '❌ '}{testR.message}
                </div>
              )}

              <div style={{ marginTop: 6, fontSize: 10, color: C.textFaint }}>
                Last updated {r.updated_at ? new Date(r.updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                {r.updated_by ? ` by ${r.updated_by}` : ''}
              </div>
            </div>
          )
        }

        return (
          <>
            {pipelineRows.length > 0 && (
              <>
                <SectionLabel>Pipeline Models (your API key)</SectionLabel>
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 10, overflow: 'hidden',
                }}>
                  {pipelineRows.map((r, i) => renderRow(r, i, pipelineRows.length))}
                </div>
              </>
            )}
            {byokRows.length > 0 && (
              <>
                <SectionLabel>Research Assistant Models (user key)</SectionLabel>
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 10, overflow: 'hidden',
                }}>
                  {byokRows.map((r, i) => renderRow(r, i, byokRows.length))}
                </div>
              </>
            )}
          </>
        )
      })()}
    </div>
  )
}
