// SendEmail — admin bulk-email composer.
//
// WHY THIS EXISTS
//   The earlier EmailAdmin page (now at /admin/email-templates) only
//   edits the HTML/subject of the three transactional templates that
//   admin-send-email.js consumes by id. It does NOT compose and send
//   ad-hoc plain-text broadcasts.
//
//   This page does. Three sections:
//     1. Re-engage Inactive Users — pre-counts profiles whose
//        last_active_at is null OR older than 10 days.
//     2. Compose — recipient mode (all-inactive / all-registered /
//        custom) + plain-text subject + body. English + Malayalam
//        template buttons pre-fill the form.
//     3. Send — calls the send-bulk-email Netlify function. Returns
//        { sent, failed, errors[] }; we render the counts.
//
//   The function does its own per-recipient {name} interpolation so
//   the body stays a single template even though each email lands
//   personalised in the recipient's inbox.
//
// ?to= QUERY PARAM
//   AdminUsers row's "Email" button navigates here with
//   ?to=<encoded_email>. We read it on mount, switch the recipient
//   mode to "custom", prefill the address, and seed the body with the
//   English template. This is the one-tap path from "see inactive user"
//   to "send them a nudge".

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Icon from '../../components/ui/Icon'

const BORDER = 'var(--border)'
const MUTED  = 'var(--text-muted)'
const TEXT   = 'var(--text-primary)'
const SURF   = 'var(--bg-surface)'

// Cut-off for "inactive" — matches the spec's 10-day window.
const INACTIVE_DAYS = 10

// ── Template bodies — used by the two pre-fill buttons.
// The {name} placeholder is replaced by the Netlify function on a
// per-recipient basis (recipient.name.split(' ')[0] || 'there').
// Keep the templates plain-text — Resend renders \n as <br>.
const ENGLISH_TEMPLATE = {
  subject: 'Did you get in to PineX?',
  body: `Hi {name},

I approved your PineX access a few weeks ago.

I am not sure you got a chance to log in yet.

PineX shows where any NSE stock is in its market cycle — in plain English, no jargon.

Log in at pinex.in and search for any stock you follow.

We also have a Telegram bot: t.me/pinexin

/stock RELIANCE — see where a stock stands right now
/sector — see which sectors are strong this week

If you have any trouble logging in just reply to this email.

Robin
Founder, PineX
pinex.in`,
}

const MALAYALAM_TEMPLATE = {
  subject: 'PineX-ൽ ലോഗിൻ ചെയ്യാൻ കഴിഞ്ഞിരുന്നോ?',
  body: `നമസ്കാരം {name},

കുറച്ചാഴ്ചകൾ മുൻപ് നിങ്ങളുടെ PineX access approve ചെയ്തിരുന്നു.

Login ചെയ്തോ എന്ന് ഉറപ്പില്ല.

PineX ൽ ഏത് NSE stock ഇപ്പോൾ market cycle ൽ എവിടെ നിൽക്കുന്നു എന്ന് ലളിതമായ ഭാഷയിൽ കാണാം.

ഒരു stock search ചെയ്തു നോക്കൂ.

Login: pinex.in

Telegram bot: t.me/pinexin

Login ചെയ്യാൻ പ്രശ്നമുണ്ടെങ്കിൽ reply ചെയ്യൂ.

Robin
PineX — pinex.in`,
}

const RECIPIENT_MODES = [
  { value: 'inactive', label: `Inactive users (${INACTIVE_DAYS}+ days)` },
  { value: 'all',      label: 'All registered users' },
  { value: 'custom',   label: 'Custom — paste emails' },
]

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

export default function SendEmail() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillTo = searchParams.get('to') || ''

  // Recipient pool fetches happen on mount + when the cut-off date
  // changes (it doesn't here, so they're effectively one-shot).
  const [inactiveUsers, setInactiveUsers] = useState([])
  const [allUsers,      setAllUsers]      = useState([])
  const [loadingPool,   setLoadingPool]   = useState(true)
  const [poolError,     setPoolError]     = useState('')

  // Compose form state
  const [recipientMode, setRecipientMode] = useState(prefillTo ? 'custom' : 'inactive')
  const [customEmails,  setCustomEmails]  = useState(prefillTo)
  const [subject,       setSubject]       = useState('')
  const [body,          setBody]          = useState('')

  // Preview + send state
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)
  const [sendError, setSendError]   = useState('')

  // Belt-and-braces gate: AdminRoute already protects /admin/* but a
  // route-config mistake shouldn't silently expose this page.
  useEffect(() => {
    if (profile && profile.role !== 'admin' && profile.role !== 'superadmin') {
      navigate('/')
    }
  }, [profile, navigate])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingPool(true)
      setPoolError('')
      try {
        // Cut-off computed in JS so the Supabase REST URL stays simple.
        const cutoff = new Date(Date.now() - INACTIVE_DAYS * 86400 * 1000).toISOString()

        // We don't want to OR null/old in a single REST query (PostgREST
        // requires the .or() filter syntax with each branch self-quoted);
        // run two narrow queries and merge client-side.
        const [neverActiveQ, oldActiveQ, allQ] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, email, full_name, last_active_at, created_at')
            .is('last_active_at', null)
            .not('email', 'is', null)
            .order('created_at', { ascending: false })
            .limit(2000),
          supabase
            .from('profiles')
            .select('id, email, full_name, last_active_at, created_at')
            .lt('last_active_at', cutoff)
            .not('email', 'is', null)
            .order('last_active_at', { ascending: true })
            .limit(2000),
          supabase
            .from('profiles')
            .select('id, email, full_name, last_active_at, created_at')
            .not('email', 'is', null)
            .order('created_at', { ascending: false })
            .limit(5000),
        ])
        if (cancelled) return

        const neverActive = neverActiveQ.data || []
        const oldActive   = oldActiveQ.data || []
        const all         = allQ.data || []

        // Dedupe inactive merge by profile id.
        const inactiveMap = new Map()
        for (const u of neverActive) inactiveMap.set(u.id, u)
        for (const u of oldActive)   if (!inactiveMap.has(u.id)) inactiveMap.set(u.id, u)
        setInactiveUsers(Array.from(inactiveMap.values()))
        setAllUsers(all)
      } catch (e) {
        if (!cancelled) setPoolError(e?.message || 'Failed to load users')
      } finally {
        if (!cancelled) setLoadingPool(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // If we landed here with ?to=<email>, also auto-prefill the English
  // template so the admin lands one click away from "Send". Mirrors
  // the spec's "see inactive user → click Email → pre-filled compose"
  // flow.
  useEffect(() => {
    if (!prefillTo) return
    setRecipientMode('custom')
    setCustomEmails(prefillTo)
    setSubject(ENGLISH_TEMPLATE.subject)
    setBody(ENGLISH_TEMPLATE.body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillTo])

  // Resolve the recipient pool from current form state. Returns
  // [{ email, name }] ready for the Netlify function.
  const recipients = useMemo(() => {
    if (recipientMode === 'inactive') {
      return inactiveUsers
        .filter((u) => u.email)
        .map((u) => ({ email: u.email, name: u.full_name || '' }))
    }
    if (recipientMode === 'all') {
      return allUsers
        .filter((u) => u.email)
        .map((u) => ({ email: u.email, name: u.full_name || '' }))
    }
    // custom — parse one email per line, comma, or semicolon
    const parsed = customEmails
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    return parsed.map((email) => ({ email, name: '' }))
  }, [recipientMode, inactiveUsers, allUsers, customEmails])

  const recipientCount = recipients.length

  function applyTemplate(t) {
    setSubject(t.subject)
    setBody(t.body)
  }

  async function handleSend() {
    if (!recipientCount) {
      setSendError('No recipients selected.')
      return
    }
    if (!subject.trim() || !body.trim()) {
      setSendError('Subject and body are required.')
      return
    }
    setSending(true)
    setSendError('')
    setSendResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not signed in.')

      const res = await fetch('/.netlify/functions/send-bulk-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipients,
          subject: subject.trim(),
          body: body.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`)
      setSendResult(data)
    } catch (e) {
      setSendError(e?.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const charCount = body.length
  const subjectChars = subject.length

  return (
    <div className="space-y-4">
      {/* SECTION 1 — RE-ENGAGE INACTIVE USERS */}
      <Card>
        <SectionLabel text="Re-engage Inactive Users" />
        <div style={{ marginTop: 8, marginBottom: 14, fontSize: 13, color: MUTED }}>
          Auto-fetched profiles whose <code style={{ color: TEXT }}>last_active_at</code> is null or older
          than {INACTIVE_DAYS} days.
        </div>

        {loadingPool ? (
          <div style={{ fontSize: 13, color: MUTED }}>Loading users…</div>
        ) : poolError ? (
          <div style={{ fontSize: 13, color: 'var(--negative)' }}>
            Could not load users: {poolError}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: TEXT,
              padding: '6px 12px', borderRadius: 8,
              background: 'var(--warning-dim)', border: '1px solid var(--warning-border)',
            }}>
              {inactiveUsers.length} users inactive {INACTIVE_DAYS}+ days
            </div>
            <button
              type="button"
              onClick={() => {
                setRecipientMode('inactive')
                applyTemplate(ENGLISH_TEMPLATE)
              }}
              className="rounded border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: BORDER, color: TEXT, background: 'transparent' }}
            >
              ✉️ English template
            </button>
            <button
              type="button"
              onClick={() => {
                setRecipientMode('inactive')
                applyTemplate(MALAYALAM_TEMPLATE)
              }}
              className="rounded border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: BORDER, color: TEXT, background: 'transparent' }}
            >
              ✉️ Malayalam template
            </button>
          </div>
        )}
      </Card>

      {/* SECTION 2 — COMPOSE */}
      <Card>
        <SectionLabel text="Compose" />

        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            To
          </label>
          <select
            value={recipientMode}
            onChange={(e) => setRecipientMode(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            style={{ borderColor: BORDER, background: 'var(--bg-input)', color: TEXT }}
          >
            {RECIPIENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {recipientMode === 'custom' && (
            <textarea
              value={customEmails}
              onChange={(e) => setCustomEmails(e.target.value)}
              placeholder="paste one email per line, or comma / semicolon separated"
              rows={3}
              className="mt-2 w-full rounded border px-3 py-2 text-sm font-mono"
              style={{ borderColor: BORDER, background: 'var(--bg-input)', color: TEXT }}
            />
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: MUTED }}>
            {recipientCount} recipient{recipientCount === 1 ? '' : 's'}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            Subject
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            style={{ borderColor: BORDER, background: 'var(--bg-input)', color: TEXT }}
            maxLength={200}
          />
          <div style={{ marginTop: 4, fontSize: 10, color: MUTED, textAlign: 'right' }}>
            {subjectChars}/200
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            Body (plain text · use <code style={{ color: TEXT }}>{'{name}'}</code> for first-name personalisation)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Plain text body. Use {name} where the recipient's first name should appear."
            rows={14}
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            style={{
              borderColor: BORDER, background: 'var(--bg-input)', color: TEXT,
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              lineHeight: 1.55,
            }}
          />
          <div style={{ marginTop: 4, fontSize: 10, color: MUTED, textAlign: 'right' }}>
            {charCount.toLocaleString()} characters
          </div>
        </div>
      </Card>

      {/* SECTION 3 — SEND */}
      <Card>
        <SectionLabel text="Send" />
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            disabled={!recipientCount}
            className="rounded border px-3 py-2 text-xs font-semibold"
            style={{
              borderColor: BORDER,
              color: recipientCount ? TEXT : MUTED,
              background: 'transparent',
              cursor: recipientCount ? 'pointer' : 'not-allowed',
            }}
          >
            {previewOpen ? 'Hide' : 'Preview'} recipients ({recipientCount})
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !recipientCount || !subject.trim() || !body.trim()}
            className="rounded border px-3 py-2 text-xs font-semibold"
            style={{
              borderColor: 'var(--accent-border)',
              color: 'var(--accent)',
              background: 'var(--accent-dim)',
              cursor: (sending || !recipientCount || !subject.trim() || !body.trim()) ? 'not-allowed' : 'pointer',
              opacity: (sending || !recipientCount || !subject.trim() || !body.trim()) ? 0.6 : 1,
            }}
          >
            {sending ? 'Sending…' : `Send via Resend → ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}`}
          </button>
        </div>

        {previewOpen && recipientCount > 0 && (
          <div style={{
            marginTop: 12, padding: 10,
            border: `1px solid ${BORDER}`, borderRadius: 8,
            background: SURF, maxHeight: 220, overflowY: 'auto',
            fontSize: 12, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            color: MUTED,
          }}>
            {recipients.slice(0, 200).map((r, i) => (
              <div key={i} style={{ padding: '2px 0' }}>
                {r.email}{r.name ? ` — ${r.name}` : ''}
              </div>
            ))}
            {recipients.length > 200 && (
              <div style={{ marginTop: 6, fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
                … {recipients.length - 200} more (preview truncated)
              </div>
            )}
          </div>
        )}

        {sendResult && (
          <div style={{
            marginTop: 12, padding: '10px 12px',
            borderRadius: 8,
            background: sendResult.failed > 0 ? 'var(--warning-dim)' : 'var(--accent-dim)',
            border: `1px solid ${sendResult.failed > 0 ? 'var(--warning-border)' : 'var(--accent-border)'}`,
            color: TEXT, fontSize: 13,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Sent to {sendResult.sent} of {recipientCount} recipients
              {sendResult.failed > 0 ? ` · ${sendResult.failed} failed` : ''}
            </div>
            {Array.isArray(sendResult.errors) && sendResult.errors.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: MUTED }}>
                  Show {sendResult.errors.length} error{sendResult.errors.length === 1 ? '' : 's'}
                </summary>
                <div style={{
                  marginTop: 6, fontSize: 11, fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {sendResult.errors.slice(0, 20).map((e, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>
                      {e.email}: {e.error}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {sendError && (
          <div style={{
            marginTop: 12, padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--negative-dim)',
            border: '1px solid var(--negative-border)',
            color: 'var(--negative)', fontSize: 13,
          }}>
            {sendError}
          </div>
        )}

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}`, fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
          Resend handles per-recipient delivery. Each email is sent individually (not BCC) and the
          <code style={{ color: TEXT, margin: '0 4px' }}>{'{name}'}</code>
          placeholder is replaced with the recipient's first name (from <code style={{ color: TEXT }}>profiles.full_name</code>),
          or "there" if no name is on file.
          {' '}
          <button
            type="button"
            onClick={() => navigate('/admin/email-templates')}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--info)', cursor: 'pointer',
              textDecoration: 'underline', fontSize: 11,
            }}
          >
            Edit transactional templates →
          </button>
        </div>
      </Card>
    </div>
  )
}
