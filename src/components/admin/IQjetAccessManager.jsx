// IQjetAccessManager — admin-only widget for granting and revoking
// passcode-based access to /iqjet (the public subscriber page).
//
// Generates passcodes in the format IQJET-XXXXXX (6 uppercase
// alphanumerics, ambiguous chars 0/O/1/I removed). Stores rows in
// public.iqjet_access — see scripts/sql/create_iqjet_access.sql.
//
// Mounted by src/pages/admin/AdminDashboard.jsx. The Supabase RLS
// policies enforce the admin-only writes; the UI guards the same
// rules so non-admins never see the section.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context'

const ADMIN_EMAIL = 'robin22y@gmail.com'

const PASSCODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generatePasscode() {
  let s = 'IQJET-'
  for (let i = 0; i < 6; i++) {
    s += PASSCODE_CHARS[Math.floor(Math.random() * PASSCODE_CHARS.length)]
  }
  return s
}

function daysFromNow(iso) {
  if (!iso) return null
  const t = new Date(iso).valueOf()
  if (!Number.isFinite(t)) return null
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000))
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.valueOf())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_COLOURS = {
  ACTIVE:  { bg: 'rgba(46,204,113,0.16)', fg: '#2ecc71' },
  PENDING: { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' },
  EXPIRED: { bg: 'rgba(231,76,60,0.18)',  fg: '#e74c3c' },
  REVOKED: { bg: 'rgba(255,255,255,0.06)', fg: '#888'   },
}

export default function IQjetAccessManager() {
  const { user } = useAuth()
  const isAdmin = String(user?.email || '').trim().toLowerCase() === ADMIN_EMAIL

  // Active + pending rows always visible; expired/revoked collapsed.
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // Generate-form state.
  const [genEmail,    setGenEmail]    = useState('')
  const [genNotes,    setGenNotes]    = useState('')
  const [genDays,     setGenDays]     = useState(30)
  const [generating,  setGenerating]  = useState(false)
  const [generated,   setGenerated]   = useState(null) // { passcode, expires_at, email }
  const [genError,    setGenError]    = useState('')

  // Per-row action busy flags so the disabling is granular.
  const [busyRowId, setBusyRowId] = useState(null)

  // "Show expired" toggle.
  const [showHistory, setShowHistory] = useState(false)

  const refresh = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    setError('')
    try {
      // The view joins profiles → email and computes status.
      const { data, error: err } = await supabase
        .from('iqjet_access_with_email')
        .select('*')
        .order('granted_at', { ascending: false })
      if (err) throw err
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { refresh() }, [refresh])

  if (!isAdmin) {
    // Defensive — the admin route gate should already prevent this.
    return null
  }

  const active  = rows.filter((r) => r.status === 'ACTIVE' || r.status === 'PENDING')
  const expired = rows.filter((r) => r.status === 'EXPIRED' || r.status === 'REVOKED')

  async function onGenerate(e) {
    e?.preventDefault?.()
    if (generating) return
    setGenerating(true)
    setGenerated(null)
    setGenError('')
    try {
      const days = Math.max(1, Math.min(365, Math.floor(Number(genDays) || 30)))
      const expires_at = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
      const passcode = generatePasscode()

      // Email-to-user_id resolution. Optional — if no match, the
      // passcode goes out as PENDING and any logged-in user can
      // claim it. The email lookup goes through `profiles` (which
      // exposes .email) since the auth.users table isn't reachable
      // from the anon/auth client.
      let user_id = null
      const email = String(genEmail || '').trim().toLowerCase()
      if (email) {
        const { data: p } = await supabase
          .from('profiles')
          .select('id,email')
          .ilike('email', email)
          .limit(1)
          .maybeSingle()
        if (p?.id) user_id = p.id
      }

      const insertPayload = {
        passcode,
        user_id,
        expires_at,
        notes: genNotes || (email ? `Intended for ${email}` : null),
        granted_by: user?.email || ADMIN_EMAIL,
        is_active: true,
      }
      const { error: insErr } = await supabase.from('iqjet_access').insert(insertPayload)
      if (insErr) throw insErr

      setGenerated({ passcode, expires_at, email })
      setGenEmail('')
      setGenNotes('')
      await refresh()
    } catch (e) {
      setGenError(String(e?.message || e))
    } finally {
      setGenerating(false)
    }
  }

  async function rowAction(rowId, patch) {
    setBusyRowId(rowId)
    try {
      const { error: err } = await supabase
        .from('iqjet_access')
        .update(patch)
        .eq('id', rowId)
      if (err) throw err
      await refresh()
    } catch (e) {
      alert('Update failed: ' + String(e?.message || e))
    } finally {
      setBusyRowId(null)
    }
  }

  function revoke(rowId)  { rowAction(rowId, { is_active: false }) }
  function extend30(rowId, currentExpires) {
    const base = new Date(currentExpires).valueOf()
    const from = Number.isFinite(base) && base > Date.now() ? base : Date.now()
    const newExpires = new Date(from + 30 * 24 * 3600 * 1000).toISOString()
    rowAction(rowId, { expires_at: newExpires, is_active: true })
  }
  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text) }
    catch { /* ignore */ }
  }

  return (
    <div style={panel}>
      <div style={panelHead}>
        <h2 style={panelTitle}>IQjet · Access Manager</h2>
        <p style={panelSub}>
          Passcode-based gate for /iqjet. Auto-expires after the validity
          window — no cron required.
        </p>
      </div>

      {/* ── Generate form ─────────────────────────────────────── */}
      <div style={generateCard}>
        <p style={sectionLabel}>Generate new passcode</p>
        <form onSubmit={onGenerate}>
          <div style={formGrid}>
            <Field label="User email (optional)">
              <input
                type="email"
                value={genEmail}
                onChange={(e) => setGenEmail(e.target.value)}
                placeholder="kerala-friend@example.com"
                autoComplete="off"
                style={inputStyle}
              />
            </Field>
            <Field label="Notes (optional)">
              <input
                type="text"
                value={genNotes}
                onChange={(e) => setGenNotes(e.target.value)}
                placeholder="e.g. Kerala community member"
                style={inputStyle}
              />
            </Field>
            <Field label="Validity (days)">
              <input
                type="number"
                value={genDays}
                onChange={(e) => setGenDays(e.target.value)}
                min={1} max={365} step={1}
                style={inputStyle}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={generating}
            style={{
              ...primaryBtn,
              marginTop: 12,
              opacity: generating ? 0.7 : 1,
              cursor: generating ? 'wait' : 'pointer',
            }}
          >
            {generating ? 'Generating…' : 'Generate Passcode'}
          </button>
          {genError && (
            <p style={{ ...muted, color: 'var(--negative,#e74c3c)', marginTop: 10 }}>{genError}</p>
          )}
        </form>

        {generated && (
          <div style={generatedBox}>
            <p style={{ ...muted, margin: 0 }}>
              Share this with the user privately. Valid for {daysFromNow(generated.expires_at)} days.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <code style={passcodeText}>{generated.passcode}</code>
              <button
                type="button"
                onClick={() => copyToClipboard(generated.passcode)}
                style={ghostBtn}
              >Copy</button>
            </div>
            {generated.email && (
              <p style={{ ...muted, margin: '8px 0 0' }}>Intended for: {generated.email}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Active + Pending table ────────────────────────────── */}
      <div style={{ marginTop: 18 }}>
        <p style={sectionLabel}>Active access ({active.length})</p>
        {loading && <p style={muted}>Loading…</p>}
        {error && <p style={{ ...muted, color: 'var(--negative,#e74c3c)' }}>{error}</p>}
        {!loading && !error && active.length === 0 && (
          <p style={muted}>No active passcodes.</p>
        )}
        {active.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>Claimed by</th>
                  <th style={th}>Passcode</th>
                  <th style={th}>Granted</th>
                  <th style={th}>Expires</th>
                  <th style={thRight}>Days left</th>
                  <th style={th}>Status</th>
                  <th style={th}>Notes</th>
                  <th style={thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <AccessRow
                    key={r.id}
                    row={r}
                    busy={busyRowId === r.id}
                    onRevoke={() => revoke(r.id)}
                    onExtend={() => extend30(r.id, r.expires_at)}
                    onCopy={() => copyToClipboard(r.passcode)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Expired / Revoked (collapsed) ─────────────────────── */}
      <div style={{ marginTop: 18 }}>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          style={collapseBtn}
        >
          {showHistory ? 'Hide' : 'Show'} expired / revoked ({expired.length})
        </button>
        {showHistory && expired.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>Claimed by</th>
                  <th style={th}>Passcode</th>
                  <th style={th}>Granted</th>
                  <th style={th}>Expires</th>
                  <th style={th}>Status</th>
                  <th style={th}>Notes</th>
                  <th style={thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {expired.map((r) => (
                  <AccessRow
                    key={r.id}
                    row={r}
                    historical
                    busy={busyRowId === r.id}
                    onExtend={() => extend30(r.id, r.expires_at)}
                    onCopy={() => copyToClipboard(r.passcode)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function AccessRow({ row, busy, historical, onRevoke, onExtend, onCopy }) {
  const c = STATUS_COLOURS[row.status] || STATUS_COLOURS.PENDING
  const days = daysFromNow(row.expires_at)
  // Claimed by: the joined profile.email when a real user owns it,
  // "Unclaimed" when user_id IS NULL (PENDING). For PENDING rows
  // generated with an intended-recipient email, surface that as a
  // secondary line so Robin knows who it was supposed to go to.
  const intendedMatch = !row.user_id && row.notes
    && row.notes.match(/^Intended for (.+)$/i)
  return (
    <tr style={busy ? { opacity: 0.55 } : null}>
      <td style={td}>
        {row.user_email ? (
          <span>{row.user_email}</span>
        ) : (
          <>
            <span style={{ color: '#888', fontStyle: 'italic' }}>Unclaimed</span>
            {intendedMatch && (
              <div style={{ fontSize: 11, color: '#666' }}>
                intended for {intendedMatch[1]}
              </div>
            )}
          </>
        )}
      </td>
      <td style={tdMono}>{row.passcode}</td>
      <td style={td}>{fmtDate(row.granted_at)}</td>
      <td style={td}>{fmtDate(row.expires_at)}</td>
      {!historical && (
        <td style={tdRight}>{days != null ? `${days}d` : '—'}</td>
      )}
      <td style={td}>
        <span style={{
          ...statusChip,
          background: c.bg, color: c.fg, border: `1px solid ${c.fg}`,
        }}>{row.status}</span>
      </td>
      <td style={td}>{row.notes || '—'}</td>
      <td style={{ ...tdRight, whiteSpace: 'nowrap' }}>
        <button type="button" onClick={onCopy} disabled={busy} style={smallBtn}>Copy</button>
        {!historical && row.status !== 'REVOKED' && (
          <button type="button" onClick={onRevoke} disabled={busy} style={{ ...smallBtn, color: '#e74c3c', marginLeft: 4 }}>Revoke</button>
        )}
        <button type="button" onClick={onExtend} disabled={busy} style={{ ...smallBtn, marginLeft: 4 }}>Extend 30d</button>
      </td>
    </tr>
  )
}

function Field({ label, children }) {
  return (
    <label style={field}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

// ── Styles ──────────────────────────────────────────────────────

const panel = {
  background:   'var(--bg-surface, rgba(255,255,255,0.04))',
  border:       '1px solid var(--border, rgba(255,255,255,0.08))',
  borderRadius: 12,
  padding:      '20px 22px',
}
const panelHead = { marginBottom: 18 }
const panelTitle = {
  margin: 0, fontSize: 18, fontWeight: 700,
  color: 'var(--text-primary, #e6e6e6)',
}
const panelSub = {
  margin: '4px 0 0',
  fontSize: 13,
  color: 'var(--text-muted, #888)',
}
const sectionLabel = {
  margin: '0 0 10px',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted, #888)',
  fontWeight: 700,
}
const generateCard = {
  padding: '14px 16px',
  background: 'rgba(0,0,0,0.18)',
  border: '1px solid var(--border, rgba(255,255,255,0.06))',
  borderRadius: 10,
}
const formGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
}
const field = { display: 'flex', flexDirection: 'column', gap: 4 }
const fieldLabel = {
  fontSize: 10, letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted, #888)',
}
const inputStyle = {
  background:   'var(--bg-primary, #0b0b14)',
  border:       '1px solid var(--border, rgba(255,255,255,0.15))',
  borderRadius: 8,
  color:        'var(--text-primary, #e6e6e6)',
  fontSize:     13,
  padding:      '8px 10px',
  outline:      'none',
  fontFamily:   'inherit',
}
const primaryBtn = {
  appearance:   'none',
  border:       '1px solid #1d8348',
  background:   'linear-gradient(180deg, #2ecc71 0%, #239d56 100%)',
  color:        '#0b1410',
  padding:      '9px 16px',
  fontSize:     13,
  fontWeight:   700,
  borderRadius: 8,
  cursor:       'pointer',
}
const ghostBtn = {
  appearance:   'none',
  border:       '1px solid var(--border, rgba(255,255,255,0.18))',
  background:   'transparent',
  color:        'var(--text-primary, #e6e6e6)',
  padding:      '6px 12px',
  fontSize:     12,
  borderRadius: 8,
  cursor:       'pointer',
}
const generatedBox = {
  marginTop: 14,
  padding: '12px 14px',
  background: 'rgba(46,204,113,0.06)',
  border: '1px solid rgba(46,204,113,0.3)',
  borderRadius: 10,
}
const passcodeText = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#2ecc71',
  background: 'rgba(0,0,0,0.3)',
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid rgba(46,204,113,0.25)',
}
const tableStyle = {
  width:          '100%',
  borderCollapse: 'collapse',
  fontSize:       13,
}
const th = {
  textAlign:     'left',
  padding:       '8px 10px',
  borderBottom:  '1px solid var(--border, rgba(255,255,255,0.1))',
  fontSize:      11,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color:         'var(--text-muted, #888)',
  fontWeight:    600,
  whiteSpace:    'nowrap',
}
const thRight = { ...th, textAlign: 'right' }
const td = {
  padding:      '8px 10px',
  borderBottom: '1px solid var(--border-dim, rgba(255,255,255,0.05))',
  color:        'var(--text-primary, #ddd)',
}
const tdMono = {
  ...td,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontWeight: 600,
}
const tdRight = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const statusChip = {
  display:      'inline-block',
  padding:      '2px 8px',
  borderRadius: 999,
  fontSize:     10,
  fontWeight:   700,
  letterSpacing: '0.05em',
}
const smallBtn = {
  appearance:   'none',
  background:   'transparent',
  border:       '1px solid var(--border, rgba(255,255,255,0.18))',
  color:        'var(--text-primary, #ddd)',
  padding:      '4px 8px',
  fontSize:     11,
  fontWeight:   600,
  borderRadius: 6,
  cursor:       'pointer',
}
const collapseBtn = {
  appearance:   'none',
  background:   'transparent',
  border:       'none',
  color:        'var(--text-muted, #888)',
  fontSize:     12,
  cursor:       'pointer',
  padding:      '4px 0',
  textDecoration: 'underline',
}
const muted = {
  margin: 0,
  fontSize: 13,
  color: 'var(--text-muted, #888)',
}
