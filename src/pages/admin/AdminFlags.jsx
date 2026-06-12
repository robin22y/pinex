// AdminFlags — review queue for user-submitted stage mismatch reports.
//
// Three tabs:
//   Pending   → action: Correct / Dismiss
//   Reviewed  → audit list (corrected + dismissed both)
//   All       → everything ever submitted
//
// Correct opens a sub-modal with two override modes:
//   Temporary → swing_conditions.stage_override (today's row only) +
//               override_expires = tomorrow. Pipeline resets it next run.
//   Permanent → companies.stage_override. Persists until manually cleared.
//
// Dismiss flips the flag to status='dismissed' with an optional note.

import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useAuth } from '../../context'
import { supabase } from '../../lib/supabase'

const C = {
  bg: '#05070A',
  surface: '#0B0F18',
  surface2: '#111620',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  faint: '#3D4F63',
  green: '#34D399',
  amber: 'var(--warning)',
  red: '#F87171',
  blue: '#38BDF8',
}

const STAGE_OPTIONS = ['Basing', 'Advancing', 'Topping', 'Declining']
const TABS = [
  { key: 'pending',  label: 'Pending',  status: ['pending'] },
  { key: 'reviewed', label: 'Reviewed', status: ['corrected', 'dismissed'] },
  { key: 'all',      label: 'All',      status: ['pending', 'corrected', 'dismissed', 'reviewed'] },
]

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  } catch { return iso }
}

export default function AdminFlags() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('pending')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [correctFlag, setCorrectFlag] = useState(null)   // flag row → opens Correct modal
  const [dismissFlag, setDismissFlag] = useState(null)   // flag row → opens Dismiss modal
  const [pendingCount, setPendingCount] = useState(0)

  const adminEmail = profile?.email || null

  async function loadFlags() {
    setLoading(true)
    const def = TABS.find((t) => t.key === tab) || TABS[0]
    try {
      const { data } = await supabase
        .from('stage_flags')
        .select('*')
        .in('status', def.status)
        .order('created_at', { ascending: false })
        .limit(500)
      setRows(data || [])
    } finally { setLoading(false) }
  }

  async function loadPendingCount() {
    try {
      const { count } = await supabase
        .from('stage_flags')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      setPendingCount(count || 0)
    } catch { setPendingCount(0) }
  }

  useEffect(() => { loadFlags() }, [tab])
  useEffect(() => { loadPendingCount() }, [])

  const renderRow = (f) => (
    <tr key={f.id} style={{ borderBottom: `1px solid ${C.border}` }}>
      <td style={tdCell}><strong style={{ color: C.text }}>{f.symbol}</strong></td>
      <td style={tdCell}>{f.company_id ? f.company_id.slice(0, 8) + '…' : '—'}</td>
      <td style={tdCell}>{f.reported_stage || '—'}</td>
      <td style={tdCell}>
        <span style={{ color: C.amber, fontWeight: 600 }}>{f.suggested_stage || '—'}</span>
      </td>
      <td style={{ ...tdCell, maxWidth: 280 }} title={f.reason || ''}>
        <span style={{
          display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', maxWidth: 260, verticalAlign: 'bottom',
          color: f.reason ? C.muted : C.faint,
        }}>{f.reason || '—'}</span>
      </td>
      <td style={tdCell}>{fmtDate(f.created_at)}</td>
      <td style={tdCell}>
        {f.status === 'pending' ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setCorrectFlag(f)} style={btnPrimary}>Correct</button>
            <button type="button" onClick={() => setDismissFlag(f)} style={btnGhost}>Dismiss</button>
          </div>
        ) : f.status === 'corrected' ? (
          <span style={{ color: C.green }}>
            Corrected{f.suggested_stage ? ` → ${f.suggested_stage}` : ''}
          </span>
        ) : (
          <span style={{ color: C.muted }}>Dismissed</span>
        )}
      </td>
    </tr>
  )

  return (
    <>
      <Helmet><title>Stage Flags — Admin | PineX</title></Helmet>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>
            Stage Mismatch Reports
          </h2>
          {pendingCount > 0 && (
            <span style={{
              padding: '3px 10px', borderRadius: 999,
              background: 'rgba(245,159,11,0.10)',
              border: `1px solid ${C.amber}55`,
              color: C.amber, fontSize: 11, fontWeight: 700,
            }}>
              {pendingCount} pending review
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          User-submitted phase mismatch reports. Correct creates a stage override; Dismiss closes without changes.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.border}` }}>
        {TABS.map((t) => {
          const on = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${on ? C.amber : 'transparent'}`,
                color: on ? C.text : C.muted,
                fontSize: 13,
                fontWeight: on ? 700 : 500,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>
          {tab === 'pending' ? 'No pending stage flags ✅' : 'No flags in this tab yet.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface2 }}>
              <tr>
                {['Symbol', 'Company', 'Reported As', 'Suggested', 'Reason', 'Date', 'Action'].map((h) => (
                  <th key={h} style={thCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>{rows.map(renderRow)}</tbody>
          </table>
        </div>
      )}

      {correctFlag && (
        <CorrectModal
          flag={correctFlag}
          adminEmail={adminEmail}
          onClose={() => setCorrectFlag(null)}
          onDone={() => { setCorrectFlag(null); loadFlags(); loadPendingCount() }}
        />
      )}
      {dismissFlag && (
        <DismissModal
          flag={dismissFlag}
          adminEmail={adminEmail}
          onClose={() => setDismissFlag(null)}
          onDone={() => { setDismissFlag(null); loadFlags(); loadPendingCount() }}
        />
      )}
    </>
  )
}

// ── Sub-modals ──────────────────────────────────────────────────────────────

function modalShell(title, onClose, children) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, background: C.surface,
          border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 18, color: C.text,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 4 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function CorrectModal({ flag, adminEmail, onClose, onDone }) {
  const [newStage, setNewStage] = useState(flag.suggested_stage || 'Basing')
  const [mode, setMode] = useState('temporary')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function apply() {
    setBusy(true); setErr('')
    try {
      const todayIso = new Date().toISOString().slice(0, 10)
      const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

      if (mode === 'permanent') {
        const { error } = await supabase
          .from('companies')
          .update({ stage_override: newStage, stage_override_reason: note || null })
          .eq('symbol', flag.symbol)
        if (error) throw error
      } else {
        // Temporary — write to the latest swing_conditions row for
        // this stock so the StockDetail merge picks it up next fetch.
        const { error } = await supabase
          .from('swing_conditions')
          .update({
            stage_override: newStage,
            override_note: note || null,
            override_expires: tomorrowIso,
          })
          .eq('company_id', flag.company_id)
          .eq('date', todayIso)
        if (error) throw error
      }

      // Flip the flag itself to corrected.
      const { error: flagErr } = await supabase
        .from('stage_flags')
        .update({
          status: 'corrected',
          admin_note: note || null,
          reviewed_by: adminEmail || 'admin',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', flag.id)
      if (flagErr) throw flagErr

      onDone?.()
    } catch (e) {
      setErr(e?.message || 'Could not apply override.')
    } finally { setBusy(false) }
  }

  return modalShell(`Override stage for ${flag.symbol}`, onClose, (
    <>
      <label style={lblBlock}>
        <span style={lblText}>New stage</span>
        <select value={newStage} onChange={(e) => setNewStage(e.target.value)} style={selectStyle}>
          {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <div style={{ ...lblBlock, marginTop: 12 }}>
        <span style={lblText}>Override type</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 }}>
          <input type="radio" name="mode" value="temporary" checked={mode === 'temporary'} onChange={() => setMode('temporary')} style={{ accentColor: C.amber }} />
          Temporary (until next pipeline run)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="radio" name="mode" value="permanent" checked={mode === 'permanent'} onChange={() => setMode('permanent')} style={{ accentColor: C.amber }} />
          Permanent (lock this stage)
        </label>
      </div>

      <label style={{ ...lblBlock, marginTop: 12 }}>
        <span style={lblText}>Admin note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Never had Stage 2 — misclassified by pipeline."
          style={{ ...selectStyle, fontFamily: 'inherit', resize: 'vertical', padding: '8px 10px' }}
        />
      </label>

      {err && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button type="button" onClick={onClose} disabled={busy} style={{ ...btnGhost, padding: '8px 14px' }}>
          Cancel
        </button>
        <button type="button" onClick={apply} disabled={busy} style={{ ...btnPrimary, padding: '8px 14px' }}>
          {busy ? 'Applying…' : 'Apply Correction'}
        </button>
      </div>
    </>
  ))
}

function DismissModal({ flag, adminEmail, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function apply() {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase
        .from('stage_flags')
        .update({
          status: 'dismissed',
          admin_note: note || null,
          reviewed_by: adminEmail || 'admin',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', flag.id)
      if (error) throw error
      onDone?.()
    } catch (e) {
      setErr(e?.message || 'Could not dismiss.')
    } finally { setBusy(false) }
  }

  return modalShell(`Dismiss flag for ${flag.symbol}`, onClose, (
    <>
      <p style={{ fontSize: 13, color: C.muted, marginTop: 0 }}>
        No stage change will be made. The flag will be marked dismissed.
      </p>
      <label style={lblBlock}>
        <span style={lblText}>Admin note <span style={{ color: C.faint }}>(optional)</span></span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Pipeline classification is correct."
          style={{ ...selectStyle, fontFamily: 'inherit', resize: 'vertical', padding: '8px 10px' }}
        />
      </label>

      {err && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button type="button" onClick={onClose} disabled={busy} style={{ ...btnGhost, padding: '8px 14px' }}>
          Cancel
        </button>
        <button type="button" onClick={apply} disabled={busy} style={{ ...btnPrimary, padding: '8px 14px' }}>
          {busy ? 'Dismissing…' : 'Dismiss Flag'}
        </button>
      </div>
    </>
  ))
}

// ── Shared styles ───────────────────────────────────────────────────────────
const thCell = { padding: '10px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, fontWeight: 600 }
const tdCell = { padding: '10px 12px', color: C.text, verticalAlign: 'middle' }
const btnPrimary = { padding: '5px 12px', borderRadius: 8, background: C.amber, color: '#000', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }
const btnGhost = { padding: '5px 12px', borderRadius: 8, background: 'transparent', color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const lblBlock = { display: 'block' }
const lblText = { display: 'block', fontSize: 12, color: C.muted, marginBottom: 6 }
const selectStyle = { width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: C.text }
