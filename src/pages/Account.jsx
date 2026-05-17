import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { LoadingSpinner } from '../components/LoadingSpinner'
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
    border: `2px solid ${C.border}`, flexShrink: 0, overflow: 'hidden',
    background: C.surface2, display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: size * 0.3, fontWeight: 700,
    color: C.text,
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
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 16, padding: '20px 20px',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, marginBottom: 12 }}>
      {children}
    </p>
  )
}

function Row({ icon, label, children, noBorder }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '13px 0',
      borderBottom: noBorder ? 'none' : `1px solid ${C.border}`,
    }}>
      {icon && (
        <span style={{ width: 32, height: 32, borderRadius: 8, background: C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className={`ti ${icon}`} style={{ fontSize: 15, color: C.textMuted }} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>{label}</p>
        {children}
      </div>
    </div>
  )
}

function UsageBar({ label, current, max }) {
  const pct = Math.min(100, max > 0 ? Math.round((current / max) * 100) : 0)
  const color = pct >= 90 ? C.red : pct >= 60 ? C.amber : C.blue
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: C.text }}>{label}</span>
        <span style={{ fontSize: 12, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
          {current} <span style={{ color: C.textFaint }}>/ {max}</span>
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: C.surface2, overflow: 'hidden' }}>
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
    <div style={{ minHeight: '100vh', background: C.base, color: C.text, paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 20px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted }}>Account</p>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Profile card */}
        <Card>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Avatar url={avatarUrl} initials={initials} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: C.textHeading }}>
                  {fullNameShown || 'User'}
                </p>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '2px 8px', borderRadius: 99,
                  background: isPaid ? '#052818' : C.surface2,
                  color: isPaid ? C.green : C.textMuted,
                  border: `1px solid ${isPaid ? C.greenBorder : C.border}`,
                }}>
                  {isPaid ? 'PRO' : 'FREE'}
                </span>
              </div>
              <p style={{ fontSize: 13, color: C.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayEmail}
              </p>
              <p style={{ fontSize: 12, color: C.textFaint, marginTop: 4 }}>
                Member since {memberSince}
              </p>
            </div>
          </div>
        </Card>

        {/* Profile details */}
        <Card>
          <SectionLabel>Profile</SectionLabel>

          <Row icon="ti-user" label="Full name">
            {!isEditingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, color: C.text }}>{fullNameShown || '—'}</span>
                <button
                  type="button" onClick={startEditName}
                  style={{ fontSize: 12, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
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
                    border: `1px solid ${C.borderHover}`, background: C.surface2,
                    color: C.text, fontSize: 13, outline: 'none',
                  }}
                />
                {nameError && <p style={{ fontSize: 11, color: C.red }}>{nameError}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button" onClick={saveFullName} disabled={nameSaving}
                    style={{
                      padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: C.blue, color: '#05070a', border: 'none', cursor: 'pointer',
                      opacity: nameSaving ? 0.6 : 1,
                    }}
                  >
                    {nameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button" onClick={cancelEditName} disabled={nameSaving}
                    style={{
                      padding: '7px 16px', borderRadius: 8, fontSize: 12,
                      background: 'none', color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Row>

          <Row icon="ti-mail" label="Email" noBorder>
            <span style={{ fontSize: 14, color: C.text }}>{displayEmail || '—'}</span>
          </Row>
        </Card>

        {/* Usage */}
        {!isPaid && (
          <Card>
            <SectionLabel>Usage this month</SectionLabel>
            <UsageBar label="Watchlist stocks" current={usage.watchlistCount} max={USAGE_LIMITS.watchlistStocks} />
            <UsageBar label="Portfolio holdings" current={usage.portfolioCount} max={USAGE_LIMITS.portfolioHoldings} />
            <UsageBar label="Downloads" current={usage.downloadsThisMonth} max={USAGE_LIMITS.downloadsMonthly} />
            <p style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
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
              <p style={{ fontSize: 14, fontWeight: 600, color: C.textHeading }}>PineX Channel</p>
              <p style={{ fontSize: 12, color: C.textMuted }}>Daily &amp; weekly market updates</p>
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
              background: C.surface2, color: C.text, border: `1px solid ${C.border}`,
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
                background: 'none', color: C.textMuted, border: `1px solid ${C.border}`,
                cursor: 'pointer', opacity: signingOut || deletingAccount ? 0.5 : 1,
              }}
            >
              Delete account
            </button>
          ) : (
            <div style={{ border: `1px solid ${C.redBorder}`, borderRadius: 10, padding: 14, background: C.redBg }}>
              <p style={{ fontSize: 13, color: C.text, marginBottom: 10 }}>
                Permanently delete your account? This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button" onClick={handleSoftDelete} disabled={deletingAccount}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: C.red, color: '#05070a', border: 'none',
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
                    background: 'none', color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Footer links — visible on mobile where sidebar is hidden */}
        <div className="md:hidden" style={{ marginTop: 8, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 20 }}>
          {[['Learn', '/learn'], ['About', '/about'], ['Terms', '/terms'], ['Privacy', '/privacy']].map(([label, path]) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 13, cursor: 'pointer', padding: 0 }}
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
