import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { LoadingSpinner } from '../components/LoadingSpinner'
import PineXMark from '../components/PineXMark'
import { C } from '../styles/tokens'

const USAGE_LIMITS = {
  watchlistStocks: 10,
  portfolioHoldings: 10,
  downloadsMonthly: 5,
}

function getInitials(name, email) {
  const n = name?.trim()
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    return parts[0]?.slice(0, 2).toUpperCase() || '?'
  }
  return (email?.split('@')[0] ?? '?').slice(0, 2).toUpperCase()
}

function formatMemberSince(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(d)
}

function Avatar({ url, initials, size = 72 }) {
  const [broken, setBroken] = useState(false)
  const style = {
    width: size, height: size, borderRadius: '50%',
    border: `2px solid ${'var(--border)'}`, flexShrink: 0, overflow: 'hidden',
    background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: size * 0.3, fontWeight: 700,
    color: 'var(--text-primary)',
  }
  if (url && !broken) {
    return (
      <img
        src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)}
        style={{ ...style, objectFit: 'cover' }}
      />
    )
  }
  return <div style={style}>{initials}</div>
}

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 16, padding: '20px 20px',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
      {children}
    </p>
  )
}

function Row({ icon, label, children, noBorder }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '13px 0',
      borderBottom: noBorder ? 'none' : '1px solid var(--border)',
    }}>
      {icon && (
        <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className={`ti ${icon}`} style={{ fontSize: 15, color: 'var(--text-muted)' }} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</p>
        {children}
      </div>
    </div>
  )
}

function UsageBar({ label, current, max }) {
  const pct = Math.min(100, max > 0 ? Math.round((current / max) * 100) : 0)
  const color = pct >= 90 ? 'var(--negative)' : pct >= 60 ? C.amber : 'var(--info)'
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {current} <span style={{ color: 'var(--text-hint)' }}>/ {max}</span>
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: color, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

export default function Account() {
  const navigate = useNavigate()
  const { user, profile, loading: authLoading, isPaid } = useAuth()

  const [usage] = useState({ watchlistCount: 0, portfolioCount: 0, downloadsThisMonth: 0 })
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [nameOverride, setNameOverride] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null
  const displayEmail = profile?.email ?? user?.email ?? ''
  const fullNameFromProfile =
    profile?.full_name?.trim() ??
    user?.user_metadata?.full_name?.trim() ??
    user?.user_metadata?.name?.trim() ?? ''
  const fullNameShown = (nameOverride.trim() || fullNameFromProfile).trim()
  const memberSince = formatMemberSince(profile?.created_at ?? user?.created_at)

  const initials = useMemo(
    () => getInitials(isEditingName ? nameDraft : fullNameShown, displayEmail),
    [isEditingName, nameDraft, fullNameShown, displayEmail],
  )

  function startEditName() {
    setNameError('')
    setNameDraft(fullNameShown || fullNameFromProfile)
    setIsEditingName(true)
  }

  function cancelEditName() {
    setNameError('')
    setIsEditingName(false)
  }

  async function saveFullName() {
    const uid = user?.id
    if (!uid) return
    const next = nameDraft.trim()
    setNameError('')
    if (!next) { setNameError('Name cannot be empty.'); return }
    setNameSaving(true)
    const { error } = await supabase.from('profiles').update({ full_name: next }).eq('id', uid)
    setNameSaving(false)
    if (error) { setNameError(error.message); return }
    setNameOverride(next)
    setIsEditingName(false)
  }

  async function handleSoftDelete() {
    if (!user?.id) return
    setDeletingAccount(true)
    const { error } = await supabase
      .from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', user.id)
    if (error) {
      setDeletingAccount(false)
      setShowDeleteConfirm(false)
      window.alert(error.message)
      return
    }
    await signOut()
  }

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
  }

  if (authLoading) return <LoadingSpinner />
  if (!user) return null

  return (
    <>
      <Helmet>
        <title>Account — PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)', paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '16px 20px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Account</p>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Profile card */}
        <Card>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Avatar url={avatarUrl} initials={initials} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {fullNameShown || 'User'}
                </p>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '2px 8px', borderRadius: 99,
                  background: isPaid ? 'var(--stage2-bg)' : 'var(--bg-elevated)',
                  color: isPaid ? 'var(--positive)' : 'var(--text-muted)',
                  border: `1px solid ${isPaid ? 'var(--accent-border)' : 'var(--border)'}`,
                }}>
                  {isPaid ? 'PRO' : 'FREE'}
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayEmail}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>
                Member since {memberSince}
              </p>
            </div>
          </div>
        </Card>

        {/* Quick links */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
              padding: '14px 16px', borderRadius: 12,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ti ti-bookmark" style={{ fontSize: 16, color: 'var(--accent)' }} />
            </span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Watchlist</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>Your saved stocks</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/home?tab=screens')}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
              padding: '14px 16px', borderRadius: 12,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--info)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--info-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ti ti-bolt" style={{ fontSize: 16, color: 'var(--info)' }} />
            </span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>SwingX</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>Top setups today</p>
            </div>
          </button>
        </div>

        {/* Profile details */}
        <Card>
          <SectionLabel>Profile</SectionLabel>

          <Row icon="ti-user" label="Full name">
            {!isEditingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{fullNameShown || '—'}</span>
                <button
                  type="button" onClick={startEditName}
                  style={{ fontSize: 12, color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Edit
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <input
                  type="text" value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${'var(--border-hover)'}`, background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)', fontSize: 13, outline: 'none',
                  }}
                />
                {nameError && <p style={{ fontSize: 11, color: 'var(--negative)' }}>{nameError}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button" onClick={saveFullName} disabled={nameSaving}
                    style={{
                      padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: 'var(--info)', color: 'var(--bg-primary)', border: 'none', cursor: 'pointer',
                      opacity: nameSaving ? 0.6 : 1,
                    }}
                  >
                    {nameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button" onClick={cancelEditName} disabled={nameSaving}
                    style={{
                      padding: '7px 16px', borderRadius: 8, fontSize: 12,
                      background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Row>

          <Row icon="ti-mail" label="Email" noBorder>
            <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{displayEmail || '—'}</span>
          </Row>
        </Card>

        {/* Usage — watchlist is open to all users while the Pro
            tier is on the roadmap. The portfolio + downloads
            counters stay so the existing usage tracking still has
            its display surface; bumping watchlist to an "unlimited"
            row keeps the section honest without ripping out the
            future-pro infrastructure (see usePlan.js → OPEN_FREE). */}
        {!isPaid && (
          <Card>
            <SectionLabel>Usage this month</SectionLabel>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Watchlist stocks</span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--accent)',
                  padding: '2px 8px',
                  borderRadius: 99,
                  background: 'rgba(0,200,5,0.10)',
                  border: '1px solid rgba(0,200,5,0.25)',
                  letterSpacing: '0.04em',
                }}>
                  Free · Unlimited
                </span>
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-hint)', margin: '4px 0 0' }}>
                Pro tier coming soon — until then, watchlist is open to everyone.
              </p>
            </div>
            <UsageBar label="Portfolio holdings" current={usage.portfolioCount} max={USAGE_LIMITS.portfolioHoldings} />
            <UsageBar label="Downloads" current={usage.downloadsThisMonth} max={USAGE_LIMITS.downloadsMonthly} />
            <p style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 4 }}>
              Counters sync once usage tracking goes live.
            </p>
          </Card>
        )}


        {/* Telegram */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: '#1a3a4a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
              ✈️
            </span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}><PineXMark /> Channel</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Daily &amp; weekly market updates</p>
            </div>
          </div>
          <a
            href="https://t.me/pinexin"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: '#229ED9', color: '#fff', textDecoration: 'none',
            }}
          >
            <i className="ti ti-brand-telegram" style={{ fontSize: 16 }} />
            Join @pinexin
          </a>
        </Card>

        {/* Session */}
        <Card>
          <SectionLabel>Session</SectionLabel>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut || deletingAccount}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)',
              cursor: signingOut ? 'wait' : 'pointer', marginBottom: 10,
              opacity: signingOut || deletingAccount ? 0.6 : 1,
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>

          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={signingOut || deletingAccount}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 13,
                background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)',
                cursor: 'pointer', opacity: signingOut || deletingAccount ? 0.5 : 1,
              }}
            >
              Delete account
            </button>
          ) : (
            <div style={{ border: `1px solid ${'var(--negative-dim)'}`, borderRadius: 10, padding: 14, background: 'var(--negative-dim)' }}>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 10 }}>
                Permanently delete your account? This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button" onClick={handleSoftDelete} disabled={deletingAccount}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: 'var(--negative)', color: 'var(--bg-primary)', border: 'none',
                    cursor: deletingAccount ? 'wait' : 'pointer',
                    opacity: deletingAccount ? 0.6 : 1,
                  }}
                >
                  {deletingAccount ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  type="button" onClick={() => setShowDeleteConfirm(false)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 12,
                    background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Footer links — visible on mobile where sidebar is hidden */}
        <div className="md:hidden" style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 20 }}>
          {[['Learn', '/learn'], ['About', '/about'], ['Terms', '/terms'], ['Privacy', '/privacy']].map(([label, path]) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: 0 }}
            >
              {label}
            </button>
          ))}
        </div>

      </div>
    </div>
    </>
  )
}
