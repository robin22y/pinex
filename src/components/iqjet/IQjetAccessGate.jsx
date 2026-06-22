// IQjetAccessGate — wraps the /iqjet page.
//
// Behaviour:
//   1. On mount, read `iqjet_access_code` from localStorage.
//   2. If a code exists, call the Supabase RPC `verify_iqjet_access`
//      to confirm it's still active. We re-verify on every mount
//      (cheap; one RPC call) so a revoked code stops working
//      immediately on next page load — no need to invalidate
//      localStorage from the server side.
//   3. If verified → render children (the actual IQjet dashboard).
//   4. Otherwise → render the code-prompt form.
//
// Why the RPC and not a direct SELECT: see comments in
// scripts/sql/add_iqjet_access.sql. RLS hides the table; only the
// function can read it; the function returns a single boolean.
// Result: the anon key can't enumerate codes from the browser.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const STORAGE_KEY = 'iqjet_access_code'

export default function IQjetAccessGate({ children }) {
  // 'checking' = initial RPC roundtrip; 'gated' = no/invalid code;
  // 'open' = verified, render children.
  const [status, setStatus] = useState('checking')
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // On mount: try whatever's in localStorage.
  useEffect(() => {
    const stored = (() => {
      try { return localStorage.getItem(STORAGE_KEY) || '' }
      catch { return '' }
    })()
    if (!stored.trim()) {
      setStatus('gated')
      return
    }
    verify(stored).then(ok => setStatus(ok ? 'open' : 'gated'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function verify(code) {
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        'verify_iqjet_access', { p_code: code },
      )
      if (rpcErr) {
        console.warn('[iqjet] verify RPC error', rpcErr)
        return false
      }
      return Boolean(data)
    } catch (e) {
      console.warn('[iqjet] verify threw', e)
      return false
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!input.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    const ok = await verify(input.trim())
    setSubmitting(false)
    if (!ok) {
      setError('That code isn’t recognised or has been revoked.')
      return
    }
    try { localStorage.setItem(STORAGE_KEY, input.trim()) } catch {}
    setStatus('open')
  }

  if (status === 'checking') {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <p style={{ margin: 0, color: 'var(--text-secondary, #888)' }}>
            Checking access…
          </p>
        </div>
      </div>
    )
  }

  if (status === 'open') {
    return children
  }

  // status === 'gated'
  return (
    <div style={pageStyle}>
      <form style={cardStyle} onSubmit={onSubmit}>
        <h1 style={titleStyle}>IQjet</h1>
        <p style={subtitleStyle}>
          Private market intelligence. Enter your access code.
        </p>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Access code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          style={inputStyle}
          disabled={submitting}
        />
        {error && (
          <p style={errorStyle}>{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting || !input.trim()}
          style={{
            ...buttonStyle,
            opacity: submitting || !input.trim() ? 0.5 : 1,
            cursor: submitting || !input.trim() ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Verifying…' : 'Unlock'}
        </button>
        <p style={footnoteStyle}>
          IQjet is invite-only. Access codes are managed manually by
          Robin. If you need one, reach out directly.
        </p>
      </form>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────
// Inline so the gate has no external CSS dependency and renders
// identically across themes (uses CSS variables that the rest of
// pinex.in defines globally).

const pageStyle = {
  minHeight:      '100vh',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  padding:        '24px',
  background:     'var(--bg, #0b0b14)',
  color:          'var(--text-primary, #e6e6e6)',
}

const cardStyle = {
  width:        '100%',
  maxWidth:     '420px',
  padding:      '32px 28px',
  background:   'var(--surface, rgba(255,255,255,0.04))',
  border:       '1px solid var(--border, rgba(255,255,255,0.08))',
  borderRadius: '12px',
  display:      'flex',
  flexDirection:'column',
  gap:          '14px',
  boxShadow:    '0 4px 24px rgba(0,0,0,0.25)',
}

const titleStyle = {
  margin:     0,
  fontSize:   '24px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
}

const subtitleStyle = {
  margin:    0,
  fontSize:  '14px',
  color:     'var(--text-secondary, #888)',
}

const inputStyle = {
  width:        '100%',
  padding:      '10px 12px',
  fontSize:     '14px',
  background:   'var(--surface-2, rgba(0,0,0,0.25))',
  border:       '1px solid var(--border, rgba(255,255,255,0.10))',
  borderRadius: '8px',
  color:        'inherit',
  outline:      'none',
  boxSizing:    'border-box',
}

const buttonStyle = {
  appearance:   'none',
  border:       '1px solid var(--accent, #4a90e2)',
  background:   'var(--accent, #4a90e2)',
  color:        '#fff',
  padding:      '10px 14px',
  fontSize:     '14px',
  fontWeight:   500,
  borderRadius: '8px',
  transition:   'opacity 0.15s',
}

const errorStyle = {
  margin:   0,
  fontSize: '13px',
  color:    'var(--negative, #e57373)',
}

const footnoteStyle = {
  margin:    '8px 0 0',
  fontSize:  '12px',
  lineHeight: 1.5,
  color:     'var(--text-muted, #666)',
}
