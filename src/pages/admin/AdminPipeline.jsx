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
    const newValue = (editValue[row.config_key] || '').trim()
    if (!newValue || newValue === row.config_value) return
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

  if (rows === null) {
    return <p style={{ color: C.textMuted, fontSize: 12 }}>Loading config…</p>
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 12px', lineHeight: 1.5 }}>
        Change model names here — no code deployment needed.
        Changes take effect immediately for the next call.
      </p>

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

      {/* Config table */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, overflow: 'hidden',
      }}>
        {rows.length === 0 ? (
          <p style={{ padding: 16, color: C.textFaint, fontSize: 12, margin: 0 }}>
            No ai_config rows yet. Run scripts/sql/create_ai_config_table.sql.
          </p>
        ) : rows.map((r, i) => {
          const flashing = flashKey === r.config_key
          const saving = savingKey === r.config_key
          const testing = testingKey === r.config_key
          const testR = testResult[r.config_key]
          const dirty = (editValue[r.config_key] || '') !== r.config_value
          return (
            <div key={r.config_key} style={{
              padding: '14px 16px',
              borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${C.border}`,
              opacity: r.is_active ? 1 : 0.55,
            }}>
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
                <input
                  type="text"
                  value={editValue[r.config_key] ?? r.config_value}
                  onChange={(e) => setEditValue(prev => ({ ...prev, [r.config_key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(r) }}
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
        })}
      </div>
    </div>
  )
}
