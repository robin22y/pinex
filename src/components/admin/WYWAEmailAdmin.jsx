// WYWAEmailAdmin — admin tool that re-engages users who have been
// inactive for 3+ days by sending them a personalised 'While You
// Were Away' email. The per-user insights (breadth / stage-2 /
// sector delta lines) are computed here, then handed to the
// existing admin-send-email Netlify function via its userVariables
// payload — see netlify/functions/admin-send-email.js.
//
// FLOW
//   1. Mount → query eligible users + most-recent send timestamp
//   2. Preview → compute insights for the first eligible user and
//                show the rendered email in a modal
//   3. Send all → for each eligible user, compute insights, hit the
//                admin-send-email function with userVariables filled
//                in. Sleep ~1 s between sends to respect Resend's
//                free-tier 2/sec ceiling. Stamp wywa_email_sent_at
//                on success. Live progress + per-user errors.
//
// DEPENDENCIES (read-only against the rest of the app)
//   - profiles                    (read + UPDATE wywa_email_sent_at)
//   - market_internals            (read — same query shape as the
//                                  WhileYouWereAway component)
//   - sectors                     (read — top stage2_pct sector on
//                                  the visit date + latest)
//   - email_templates             (read — admin-send-email lookups
//                                  the 'while_you_were_away' row)
//   - netlify/functions/admin-send-email  (mutated to accept the
//                                          userVariables param —
//                                          see that file's diff)

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context'

const AWAY_MS    = 3 * 24 * 60 * 60 * 1000        //  ≥3 days inactive
const DEDUPE_MS  = 7 * 24 * 60 * 60 * 1000        //  ≥7 days since prior send
const THROTTLE_MS = 1000                          //  1 s between sends
const PAGE_SIZE   = 1000                          //  PostgREST cap

// ── Insight builders — match WhileYouWereAway.jsx ──────────────────
async function fetchInternalsOnOrBefore(date) {
  const { data } = await supabase
    .from('market_internals')
    .select('date, above_ma30w_pct, stage2_count')
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

async function fetchLatestInternals() {
  const { data } = await supabase
    .from('market_internals')
    .select('date, above_ma30w_pct, stage2_count')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

async function fetchTopSector(date) {
  if (!date) return null
  const { data } = await supabase
    .from('sectors')
    .select('display_name, name, stage2_pct')
    .eq('date', date)
    .order('stage2_pct', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

async function fetchLatestSectorDate() {
  const { data } = await supabase
    .from('sectors')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.date || null
}

// Given a user's last_active_at, return { daysAway, insight_1..3 }.
// Same plain-English transforms as the in-app WhileYouWereAway
// component so the email and on-site block read identically.
async function buildInsights(lastActiveIso) {
  const refDate = String(lastActiveIso).slice(0, 10)
  const latestSectorDate = await fetchLatestSectorDate()

  const [thenInternals, nowInternals, thenSector, nowSector] = await Promise.all([
    fetchInternalsOnOrBefore(refDate),
    fetchLatestInternals(),
    fetchTopSector(refDate),
    latestSectorDate ? fetchTopSector(latestSectorDate) : Promise.resolve(null),
  ])
  if (!thenInternals || !nowInternals) return null

  const daysAway = Math.floor((Date.now() - new Date(lastActiveIso).getTime()) / (24 * 60 * 60 * 1000))

  const breadthThen = Number(thenInternals.above_ma30w_pct)
  const breadthNow  = Number(nowInternals.above_ma30w_pct)
  const breadthChg  = Number.isFinite(breadthThen) && Number.isFinite(breadthNow)
    ? breadthNow - breadthThen : null

  const stage2Then = Number(thenInternals.stage2_count)
  const stage2Now  = Number(nowInternals.stage2_count)
  const stage2Chg  = Number.isFinite(stage2Then) && Number.isFinite(stage2Now)
    ? stage2Now - stage2Then : null

  const sectorThenName = thenSector?.display_name || thenSector?.name || null
  const sectorNowName  = nowSector?.display_name  || nowSector?.name  || null

  const lines = []

  if (breadthChg != null) {
    const sub = ` (${breadthThen.toFixed(0)}% → ${breadthNow.toFixed(0)}%)`
    if (breadthChg > 2)       lines.push('Market participation improved' + sub)
    else if (breadthChg < -2) lines.push('Market participation weakened' + sub)
    else                      lines.push('Market participation held steady' + sub)
  }

  if (stage2Chg != null) {
    const sub = ` (${stage2Then} → ${stage2Now})`
    if (stage2Chg > 20)       lines.push(`${stage2Chg} more stocks in advancing phase` + sub)
    else if (stage2Chg < -20) lines.push(`${Math.abs(stage2Chg)} fewer stocks in advancing phase` + sub)
    else                      lines.push('Advancing stock count stable' + sub)
  }

  if (sectorThenName && sectorNowName) {
    if (sectorThenName === sectorNowName) lines.push(`${sectorNowName} continued leading`)
    else                                  lines.push(`Sector leadership shifted to ${sectorNowName}`)
  }

  if (lines.length === 0) return null

  return {
    days_away: String(daysAway),
    insight_1: lines[0] || '',
    insight_2: lines[1] || '',
    insight_3: lines[2] || '',
  }
}

// ── Eligibility query ────────────────────────────────────────────
// Server-side filters on profiles for performance: inactive 3+ days,
// has email + email_notifications on, is_active, and the 7-day
// dedupe (wywa_email_sent_at IS NULL OR < now() - 7d).
async function fetchEligibleUsers() {
  const inactiveCutoff = new Date(Date.now() - AWAY_MS).toISOString()
  const dedupeCutoff   = new Date(Date.now() - DEDUPE_MS).toISOString()

  // PostgREST has no native OR-NULL on filtered columns the way SQL
  // does, so we pull both partitions and merge.
  const baseSelect = 'id, email, full_name, last_active_at, wywa_email_sent_at'

  const neverSent = await supabase
    .from('profiles')
    .select(baseSelect)
    .lt('last_active_at', inactiveCutoff)
    .eq('email_notifications', true)
    .eq('is_active', true)
    .is('wywa_email_sent_at', null)
    .not('email', 'is', null)
    .limit(PAGE_SIZE)

  const sentLongAgo = await supabase
    .from('profiles')
    .select(baseSelect)
    .lt('last_active_at', inactiveCutoff)
    .eq('email_notifications', true)
    .eq('is_active', true)
    .lt('wywa_email_sent_at', dedupeCutoff)
    .not('email', 'is', null)
    .limit(PAGE_SIZE)

  const rows = [...(neverSent.data || []), ...(sentLongAgo.data || [])]
  // Dedupe by id (a row could theoretically match neither / both —
  // never sent + sent-long-ago are disjoint in practice but cheap to
  // defend).
  const seen = new Set()
  const uniq = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    uniq.push(r)
  }
  return uniq
}

// ── Most-recent send across all users — drives the 'Last sent' line.
async function fetchLastSentAt() {
  const { data } = await supabase
    .from('profiles')
    .select('wywa_email_sent_at')
    .not('wywa_email_sent_at', 'is', null)
    .order('wywa_email_sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.wywa_email_sent_at || null
}

// ── Resolve the admin's Bearer token for the Netlify call.
async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

// ── Send one user via admin-send-email with per-user vars.
async function sendOne(user, insights, token) {
  const res = await fetch('/.netlify/functions/admin-send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      type: 'while_you_were_away',
      userIds: [user.id],
      userVariables: { [user.id]: insights },
    }),
  })
  let json = null
  try { json = await res.json() } catch { /* ignore */ }
  return { ok: res.ok && (json?.sent ?? 0) > 0, status: res.status, error: json?.error || null }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fmtRelative(iso) {
  if (!iso) return 'Never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString()
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function WYWAEmailAdmin() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin'

  const [loading, setLoading]       = useState(true)
  const [users, setUsers]           = useState([])
  const [lastSentAt, setLastSentAt] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewData, setPreviewData] = useState(null)  // { user, insights } | null
  const [sending, setSending]       = useState(false)
  const [progress, setProgress]     = useState(null)    // { sent, failed, total }
  const [errors, setErrors]         = useState([])      // [{ email, status, error }]

  // Initial load — only for signed-in admins.
  useEffect(() => {
    if (!isAdmin) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const [u, l] = await Promise.all([fetchEligibleUsers(), fetchLastSentAt()])
        if (cancelled) return
        setUsers(u)
        setLastSentAt(l)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isAdmin])

  const handlePreview = async () => {
    if (!users.length) return
    setPreviewing(true)
    try {
      const u = users[0]
      const insights = await buildInsights(u.last_active_at)
      setPreviewData({ user: u, insights })
    } finally {
      setPreviewing(false)
    }
  }

  const handleSend = async () => {
    if (!users.length || sending) return
    if (!window.confirm(`Send WYWA email to ${users.length} inactive user${users.length === 1 ? '' : 's'}?`)) return
    const token = await getAccessToken()
    if (!token) {
      window.alert('Missing admin session — please sign in again.')
      return
    }
    setSending(true)
    setErrors([])
    setProgress({ sent: 0, failed: 0, total: users.length })

    for (let i = 0; i < users.length; i++) {
      const u = users[i]
      if (i > 0) await sleep(THROTTLE_MS)
      let insights = null
      try {
        insights = await buildInsights(u.last_active_at)
      } catch {
        insights = null
      }
      if (!insights) {
        setErrors((prev) => [...prev, { email: u.email, status: 0, error: 'no insight data' }])
        setProgress((p) => p && { ...p, failed: p.failed + 1 })
        continue
      }
      const result = await sendOne(u, insights, token)
      if (result.ok) {
        // Stamp the success — same row, so subsequent runs hit the
        // 7-day dedupe and skip them.
        await supabase
          .from('profiles')
          .update({ wywa_email_sent_at: new Date().toISOString() })
          .eq('id', u.id)
        setProgress((p) => p && { ...p, sent: p.sent + 1 })
      } else {
        setErrors((prev) => [...prev, { email: u.email, status: result.status, error: result.error }])
        setProgress((p) => p && { ...p, failed: p.failed + 1 })
      }
    }
    setSending(false)
    // Refresh the eligibility list + last-sent stamp after the batch.
    try {
      const [u, l] = await Promise.all([fetchEligibleUsers(), fetchLastSentAt()])
      setUsers(u)
      setLastSentAt(l)
    } catch { /* ignore */ }
  }

  if (!isAdmin) return null

  // ── UI ──
  return (
    <section
      style={{
        background: 'var(--bg-surface, #0F1217)',
        border: '1px solid var(--border, #1E2530)',
        borderRadius: 8,
        padding: 20,
        marginTop: 24,
      }}
    >
      <header style={{
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, #64748B)',
        fontWeight: 700,
        marginBottom: 12,
      }}>
        Re-engagement email
      </header>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 13,
        color: 'var(--text-primary, #E2E8F0)',
        marginBottom: 16,
      }}>
        <div>
          Users inactive 3+ days:{' '}
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '…' : users.length.toLocaleString('en-IN')}
          </strong>
        </div>
        <div style={{ color: 'var(--text-muted, #64748B)' }}>
          Last sent: <strong style={{ color: 'var(--text-primary, #E2E8F0)' }}>{fmtRelative(lastSentAt)}</strong>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handlePreview}
          disabled={loading || sending || users.length === 0 || previewing}
          style={{
            padding: '8px 14px',
            background: 'transparent',
            border: '1px solid var(--border, #1E2530)',
            color: 'var(--text-primary, #E2E8F0)',
            fontSize: 13,
            fontWeight: 600,
            cursor: (loading || sending || users.length === 0 || previewing) ? 'default' : 'pointer',
            opacity: (loading || sending || users.length === 0 || previewing) ? 0.5 : 1,
            borderRadius: 4,
          }}
        >
          {previewing ? 'Building preview…' : 'Preview email'}
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || sending || users.length === 0}
          style={{
            padding: '8px 14px',
            background: '#92400E',
            border: 'none',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: (loading || sending || users.length === 0) ? 'default' : 'pointer',
            opacity: (loading || sending || users.length === 0) ? 0.5 : 1,
            borderRadius: 4,
          }}
        >
          {sending ? 'Sending…' : `Send to all inactive (${users.length})`}
        </button>
      </div>

      {progress && (
        <div style={{
          marginTop: 14,
          fontSize: 12,
          color: 'var(--text-muted, #64748B)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {progress.sent + progress.failed} / {progress.total} ·{' '}
          <span style={{ color: '#22C55E' }}>{progress.sent} sent</span>
          {' · '}
          <span style={{ color: progress.failed > 0 ? '#EF4444' : 'inherit' }}>
            {progress.failed} failed
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted, #64748B)' }}>
          <summary style={{ cursor: 'pointer' }}>
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {errors.slice(0, 30).map((e, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {e.email || '(no email)'} — {e.status} · {e.error || 'unknown'}
              </li>
            ))}
            {errors.length > 30 && <li>+ {errors.length - 30} more</li>}
          </ul>
        </details>
      )}

      {previewData && (
        <div
          role="dialog"
          aria-label="Preview"
          onClick={() => setPreviewData(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface, #141820)',
              border: '1px solid var(--border, #1E2530)',
              borderRadius: 6,
              padding: 20,
              maxWidth: 540,
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
              fontSize: 13,
              color: 'var(--text-primary, #E2E8F0)',
            }}
          >
            <header style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#FBBF24',
              fontWeight: 700,
              marginBottom: 8,
            }}>
              Preview · {previewData.user.email}
            </header>
            {!previewData.insights && (
              <div style={{ color: 'var(--text-muted, #64748B)', lineHeight: 1.5 }}>
                Could not build insights for this user. Likely the
                market_internals row for{' '}
                {String(previewData.user.last_active_at).slice(0, 10)} is missing —
                this user would be skipped in a real send.
              </div>
            )}
            {previewData.insights && (
              <div style={{ lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>
                  Subject: You missed {previewData.insights.days_away} days of market movement
                </div>
                <div style={{ marginBottom: 6 }}>→ {previewData.insights.insight_1}</div>
                {previewData.insights.insight_2 && (
                  <div style={{ marginBottom: 6 }}>→ {previewData.insights.insight_2}</div>
                )}
                {previewData.insights.insight_3 && (
                  <div style={{ marginBottom: 6 }}>→ {previewData.insights.insight_3}</div>
                )}
                <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted, #64748B)' }}>
                  Data observation only. Not investment advice.
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setPreviewData(null)}
              style={{
                marginTop: 18,
                padding: '8px 14px',
                background: 'transparent',
                border: '1px solid var(--border, #1E2530)',
                color: 'var(--text-primary, #E2E8F0)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
