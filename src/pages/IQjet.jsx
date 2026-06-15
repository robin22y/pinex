// IQjet — /iqjet public subscriber page.
//
// Access flow:
//   1. Not signed in  → redirect to /login (preserve ?next= so they
//                       land back here after auth)
//   2. Admin email    → full access always (Robin can never lock
//                       himself out)
//   3. iqjet_access   → row exists, is_active=true, expires_at > now()
//                       → granted
//   4. Anything else  → locked screen pointing at /profile to enter
//                       a passcode (or request access via Telegram)
//
// The actual content is intentionally a placeholder for now —
// granted users see a holding screen describing what's coming.
// Robin can wire the real /iqjet content (Market Pulse cards,
// Earnings panel, Robin's Desk view) by editing this file later.
// The point of THIS file is the gate, not the content.

import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const SUPPORT_EMAIL = 'support@pinex.in'

export default function IQjet() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const [state, setState] = useState({ status: 'checking' })

  // Check access whenever auth resolves.
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setState({ status: 'signed_out' })
      return
    }
    const email = String(user.email || '').trim().toLowerCase()
    if (email === ADMIN_EMAIL) {
      setState({ status: 'granted', expires_at: null, admin: true })
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        // Pull the user's own iqjet_access row (RLS limits this to
        // auth.uid() = user_id, so the read is a no-op for anyone
        // without a claimed row).
        const { data, error } = await supabase
          .from('iqjet_access')
          .select('expires_at,is_active,passcode,last_used_at')
          .eq('user_id', user.id)
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cancelled) return
        if (error) throw error

        if (!data) {
          setState({ status: 'no_access' })
          return
        }

        const now = Date.now()
        const expiresMs = data.expires_at ? new Date(data.expires_at).valueOf() : 0
        if (!data.is_active) {
          setState({ status: 'revoked' })
          return
        }
        if (!Number.isFinite(expiresMs) || expiresMs <= now) {
          setState({ status: 'expired', expires_at: data.expires_at })
          return
        }
        setState({ status: 'granted', expires_at: data.expires_at })
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: String(e?.message || e) })
      }
    })()
    return () => { cancelled = true }
  }, [authLoading, user])

  if (authLoading || state.status === 'checking') {
    return <PageShell title="IQjet"><p style={muted}>Checking access…</p></PageShell>
  }

  if (state.status === 'signed_out') {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  if (state.status === 'error') {
    return (
      <PageShell title="IQjet">
        <p style={{ ...muted, color: 'var(--negative,#e74c3c)' }}>
          Couldn't verify access: {state.message}
        </p>
      </PageShell>
    )
  }

  if (state.status === 'granted') {
    return <GrantedView expiresAt={state.expires_at} admin={state.admin} />
  }

  // no_access / revoked / expired all show the locked screen with
  // a contextual message at the top.
  return <LockedView state={state} />
}

// ── Granted view ─────────────────────────────────────────────────

function GrantedView({ expiresAt, admin }) {
  return (
    <PageShell title="IQjet">
      <section style={card}>
        <p style={eyebrow}>IQjet · Private Intelligence</p>
        <h1 style={h1}>Welcome.</h1>
        <p style={leadText}>
          Your access is active. Market Pulse, Earnings Intelligence
          and Robin's Desk are rolling out here in the coming days.
        </p>
        {admin ? (
          <p style={muted}>
            You're signed in as the admin — access never expires for this account.
          </p>
        ) : expiresAt ? (
          <p style={muted}>
            Valid until {fmtDate(expiresAt)} ({daysUntil(expiresAt)} days remaining).
          </p>
        ) : null}
        <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/profile" style={primaryLink}>Manage access in profile</Link>
          {admin && (
            <Link to="/iqjet-desk" style={ghostLink}>Open IQjet Desk →</Link>
          )}
        </div>
      </section>
    </PageShell>
  )
}

// ── Locked view ──────────────────────────────────────────────────

function LockedView({ state }) {
  let headline = 'IQjet is invitation-only'
  let detail   = (
    <>
      IQjet is Robin's personal market intelligence desk — cycle
      analysis, earnings intelligence and market pulse. Access is
      passcode-gated and not publicly available.
    </>
  )
  let badge = '🔒 Locked'
  let subject = 'IQjet access request'

  if (state.status === 'expired') {
    headline = 'Your IQjet access expired'
    detail = (
      <>
        Your passcode lapsed on <b>{fmtDate(state.expires_at)}</b>. Email
        support for a renewal, or enter a new passcode on the profile page.
      </>
    )
    badge = '⏱ Expired'
    subject = 'IQjet access renewal'
  } else if (state.status === 'revoked') {
    headline = 'Your IQjet access was revoked'
    detail = (
      <>
        Reach out if you think this is a mistake.
      </>
    )
    badge = '⛔ Revoked'
    subject = 'IQjet access — revoked, please review'
  }

  const emailBody = [
    'Hi Robin,',
    '',
    "I'd like to request access to IQjet (Private Intelligence Service).",
    '',
    'Name: ',
    'Reason / how I came across PineX: ',
    '',
    'Thanks',
  ].join('\n')
  const mailtoHref =
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(emailBody)}`

  return (
    <PageShell title="IQjet — access required">
      <section style={card}>
        <p style={eyebrow}>{badge}</p>
        <h1 style={h1}>{headline}</h1>
        <p style={leadText}>{detail}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 }}>
          <a href={mailtoHref} style={primaryLink}>
            Request access via email
          </a>
          <Link to="/profile#iqjet" style={ghostLink}>
            I have a passcode — enter it on my profile
          </Link>
        </div>
        <p style={{ ...muted, marginTop: 18, fontSize: 12 }}>
          Email <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'inherit' }}>{SUPPORT_EMAIL}</a>{' '}
          — Robin replies with a one-time passcode you enter on your
          profile to activate access for 30 days.
        </p>
      </section>
    </PageShell>
  )
}

// ── Layout primitives ────────────────────────────────────────────

function PageShell({ title, children }) {
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <main style={page}>{children}</main>
    </>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.valueOf())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso) {
  if (!iso) return 0
  const ms = new Date(iso).valueOf() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)))
}

// ── Styles ───────────────────────────────────────────────────────

const page = {
  minHeight:    '100vh',
  width:        '100%',
  padding:      '48px 20px 96px',
  display:      'flex',
  flexDirection:'column',
  alignItems:   'center',
  background:   'var(--bg-primary, #0b0b14)',
  color:        'var(--text-primary, #e6e6e6)',
  fontFamily:   'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

const card = {
  width:        '100%',
  maxWidth:     640,
  background:   'var(--bg-surface, rgba(255,255,255,0.04))',
  border:       '1px solid var(--border, rgba(255,255,255,0.08))',
  borderRadius: 14,
  padding:      '28px 32px',
}

const eyebrow = {
  margin:        0,
  fontSize:      11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         'var(--text-muted, #888)',
}

const h1 = {
  margin:     '6px 0 14px',
  fontSize:   24,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color:      'var(--text-primary, #fff)',
}

const leadText = {
  margin:     0,
  fontSize:   14,
  lineHeight: 1.6,
  color:      'var(--text-secondary, #ccc)',
}

const muted = {
  margin:    '12px 0 0',
  fontSize:  13,
  color:     'var(--text-muted, #888)',
}

const primaryLink = {
  appearance:   'none',
  display:      'inline-block',
  border:       '1px solid #1d8348',
  background:   'linear-gradient(180deg, #2ecc71 0%, #239d56 100%)',
  color:        '#0b1410',
  padding:      '10px 18px',
  fontSize:     13,
  fontWeight:   700,
  borderRadius: 10,
  textDecoration: 'none',
}

const ghostLink = {
  appearance:   'none',
  display:      'inline-block',
  border:       '1px solid var(--border, rgba(255,255,255,0.18))',
  background:   'transparent',
  color:        'var(--text-primary, #e6e6e6)',
  padding:      '10px 18px',
  fontSize:     13,
  fontWeight:   500,
  borderRadius: 10,
  textDecoration: 'none',
}
