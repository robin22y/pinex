import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { LoadingSpinner } from '../components/LoadingSpinner'
import PineXMark from '../components/PineXMark'
import { C } from '../styles/tokens'
import { TELEGRAM_BOT_HANDLE, TELEGRAM_BOT_LINK_URL } from '../lib/siteMeta'
import { motion, AnimatePresence } from 'framer-motion'
import {
  deleteGeminiKey,
  ensureKeyRegistered,
  getKeyAgeDays,
  getKeySavedAt,
  getStoredGeminiKey,
  logKeySaved,
  maskKey,
  saveGeminiKey,
  testConnection,
  validateKey,
  verifyKey,
} from '../lib/researchAssistant'
import Icon from '../components/ui/Icon'
import HowToUseDrawer from '../components/HowToUseDrawer'

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

function Card({ children, style, id }) {
  return (
    <div id={id} style={{
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

  // ── Rewards points banner ───────────────────────────────────────
  // Read the caller's user_points.total_points so the Profile page
  // can show a one-tap entry into /rewards with the live balance.
  // Failure is silent — banner just doesn't render until the value
  // resolves.
  const [rewardsPoints, setRewardsPoints] = useState(null)
  const [streakDays, setStreakDays] = useState(0)
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase
      .from('user_points')
      .select('total_points, current_streak')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setRewardsPoints(data?.total_points ?? 0)
        setStreakDays(Number(data?.current_streak || 0))
      })
    return () => { cancelled = true }
  }, [user?.id])

  // ── Your PineX progress card data ──────────────────────────────
  // academyDone = count of user_module_progress rows where the user
  // either passed the quiz or finished all lessons. academyTotal =
  // count of published modules. Failure quietly leaves the row at
  // "—" instead of breaking the page.
  const [academyDone, setAcademyDone] = useState(0)
  const [academyTotal, setAcademyTotal] = useState(0)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [progressRes, modulesRes] = await Promise.all([
          user?.id
            ? supabase
                .from('user_module_progress')
                .select('module_id, passed, lessons_completed')
                .eq('user_id', user.id)
            : Promise.resolve({ data: [] }),
          supabase
            .from('academy_modules')
            .select('id, is_published')
            .eq('is_published', true),
        ])
        if (cancelled) return
        const done = (progressRes.data || []).filter((r) => r.passed || r.lessons_completed).length
        setAcademyDone(done)
        setAcademyTotal((modulesRes.data || []).length)
      } catch {
        if (!cancelled) { setAcademyDone(0); setAcademyTotal(0) }
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const hasGeminiKey = Boolean(getStoredGeminiKey())

  // "How to use PineX" drawer — manual re-open from the button below.
  // The auto-trigger on first login lives on Home; here we just give
  // users a way back to the 7-step walkthrough whenever they want it.
  const [showHowTo, setShowHowTo] = useState(false)

  // ── Personal Telegram link ──────────────────────────────────────
  // Pulled from profiles on mount. The /link flow on the bot writes
  // these fields; this page reads them back and offers a Disconnect.
  // tgState: 'loading' | 'unlinked' | 'linked'
  const [tgState, setTgState] = useState('loading')
  const [tgUsername, setTgUsername] = useState(null)
  const [tgChatId, setTgChatId] = useState(null)
  const [tgClickedConnect, setTgClickedConnect] = useState(false)
  const [tgDisconnecting, setTgDisconnecting] = useState(false)
  const [tgError, setTgError] = useState('')

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('telegram_chat_id, telegram_username, telegram_linked_at')
          .eq('id', user.id)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          setTgState('unlinked'); return
        }
        if (data?.telegram_chat_id) {
          setTgState('linked')
          setTgUsername(data.telegram_username || null)
          setTgChatId(data.telegram_chat_id)
        } else {
          setTgState('unlinked')
        }
      } catch {
        if (!cancelled) setTgState('unlinked')
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const handleConnectTelegram = () => {
    // Open the bot deeplink in a new tab. The user then sends /link
    // and replies with their email; the bot writes the profile row
    // and they refresh this page to see "Connected".
    window.open(TELEGRAM_BOT_LINK_URL, '_blank', 'noopener,noreferrer')
    setTgClickedConnect(true)
  }

  const handleDisconnectTelegram = async () => {
    if (!user?.id || tgDisconnecting) return
    setTgError('')
    setTgDisconnecting(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          telegram_chat_id: null,
          telegram_username: null,
          telegram_linked_at: null,
        })
        .eq('id', user.id)
      if (error) {
        setTgError('Could not disconnect. Try again.')
      } else {
        setTgState('unlinked')
        setTgUsername(null)
        setTgChatId(null)
        setTgClickedConnect(false)
      }
    } catch (e) {
      setTgError('Could not disconnect. Try again.')
    } finally {
      setTgDisconnecting(false)
    }
  }

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

        {/* Rewards entry — prominent banner with the live points
            balance. Same visual weight as Invite friends below so
            both surfaces feel like first-class destinations. */}
        {rewardsPoints !== null && (
          <button
            type="button"
            onClick={() => navigate('/rewards')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 16px', borderRadius: 12,
              // Flat surface, plain border — no amber gradient/glow.
              // The amber accent is preserved on the points number +
              // the icon dot only.
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              cursor: 'pointer', textAlign: 'left',
              transition: 'border-color .15s',
              marginBottom: 12,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="coins" size={18} style={{ color: C.amber }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.amber, margin: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
                {Number(rewardsPoints).toLocaleString('en-IN')} points
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                View rewards
              </p>
            </div>
            <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0 }} />
          </button>
        )}

        {/* Invite friends — now routes to /rewards which owns the
            referral link surface (pinex.in/join/<code>). The old
            /dashboard#invite-section target was removed in this commit
            along with the legacy invite-credits system. */}
        <button
          type="button"
          onClick={() => navigate('/rewards')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 16px', borderRadius: 12,
            // Flat — no accent gradient or glow.
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'left',
            transition: 'border-color .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="user-plus" size={18} style={{ color: 'var(--accent)' }} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Invite friends</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>Share your referral link · earn points together</p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0 }} />
        </button>

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
              <Icon name="bookmark" style={{ fontSize: 16, color: 'var(--accent)' }} />
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
              <Icon name="bolt" style={{ fontSize: 16, color: 'var(--info)' }} />
            </span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>SwingX</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>Stocks meeting all cycle analysis criteria today</p>
            </div>
          </button>
        </div>

        {/* Theme toggle — full-width row right above the personal
            tiles so the user can find it fast. Reads / writes
            `pinex-theme` in localStorage and sets data-theme on
            <html>, matching ThemeToggle.jsx semantics. Fires a
            'pinex-theme-change' window event so other ThemeToggle
            instances (mobile bottom nav, header chip) sync. */}
        <button
          type="button"
          onClick={() => {
            const cur = document.documentElement.getAttribute('data-theme') === 'sepia' ? 'sepia' : 'dark'
            const next = cur === 'sepia' ? 'dark' : 'sepia'
            try { localStorage.setItem('pinex-theme', next) } catch {}
            if (next === 'sepia') document.documentElement.setAttribute('data-theme', 'sepia')
            else document.documentElement.removeAttribute('data-theme')
            try { window.dispatchEvent(new Event('pinex-theme-change')) } catch {}
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 16px', borderRadius: 12,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'left', width: '100%', marginTop: 10,
            transition: 'border-color .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <span
            aria-hidden
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'currentColor',
            }}
          >
            <Icon name="brightness" size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Appearance
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              {(typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'sepia')
                ? 'Sepia · tap to switch to Dark'
                : 'Dark · tap to switch to Sepia'}
            </p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0 }} />
        </button>

        {/* My Calls / Guru Score — re-entry tile. Bottom-nav slot
            was deliberately skipped so this tile + direct URL are
            the canonical paths to /my-calls. */}
        <button
          type="button"
          onClick={() => navigate('/my-calls')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 16px', borderRadius: 12,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'left', width: '100%', marginTop: 10,
            transition: 'border-color .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <span
            aria-hidden
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(245,159,11,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}
          >
            🏆
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              My Calls · Guru Score
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Track record + shareable achievement card
            </p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0 }} />
        </button>

        {/* Video walkthrough — opens the 2-min YouTube intro in a
            new tab. Sibling of the in-app drawer below: drawer is
            interactive step-by-step, this is the watch-once video.
            Both stay reachable forever for users who want a refresher. */}
        <button
          type="button"
          onClick={() => window.open('https://youtu.be/DqagWc_KpqE', '_blank', 'noopener,noreferrer')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 16px', borderRadius: 12,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'left', width: '100%', marginTop: 10,
            transition: 'border-color .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <span
            aria-hidden
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(239,68,68,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: '#F87171',
            }}
          >
            ▶
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Watch how to use PineX
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              2-minute video walkthrough · YouTube
            </p>
          </div>
          <Icon name="external-link" style={{ fontSize: 16, color: 'var(--text-hint)', flexShrink: 0 }} />
        </button>

        {/* How to use PineX — full-width button that re-opens the
            7-step walkthrough drawer. Auto-opens once on first login
            (gated by pinex_guide_seen on Home); this button is the
            re-entry for "I want to see that again". */}
        <button
          type="button"
          onClick={() => setShowHowTo(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 16px', borderRadius: 12,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'left', width: '100%', marginTop: 10,
            transition: 'border-color .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <span
            aria-hidden
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--accent-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}
          >
            ?
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              How to use PineX
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              7-step walkthrough · 1 minute
            </p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0 }} />
        </button>

        {/* Experimental — Breadth Lab.
            Reachable on mobile via Profile tab → Account → here.
            (Desktop users see it directly in the sidebar.)
            Amber tint + BETA chip mark it as experimental so it
            doesn't compete visually with the core quick-links. */}
        <button
          type="button"
          onClick={() => navigate('/breadth-lab')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 16px', borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(251,191,36,0.10) 0%, var(--bg-surface) 100%)',
            border: '1px solid rgba(251,191,36,0.30)',
            cursor: 'pointer', textAlign: 'left',
            transition: 'border-color .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(251,191,36,0.55)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(251,191,36,0.30)' }}
        >
          <span
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(251,191,36,0.15)',
              border: '1px solid rgba(251,191,36,0.30)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 18 }}>⚗️</span>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Breadth Lab
              </p>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'rgba(251,191,36,0.18)',
                  color: '#FBBF24',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Beta
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Nifty vs market breadth · Weinstein A/D line · experimental
            </p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0 }} />
        </button>

        {/* Your PineX progress — points, streak, progress bar to Pro,
            Academy modules count, Research Assistant status. Three
            rows, each tappable to its canonical destination. Lives
            above the Profile details card so it's the first thing
            below the avatar + invite + quick-links section. */}
        <Card>
          <SectionLabel>Your PineX</SectionLabel>

          {/* Row 1 — points + streak + progress bar to Pro */}
          <button
            type="button"
            onClick={() => navigate('/rewards')}
            style={{
              display: 'block',
              width: '100%',
              padding: '12px 14px',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                ⭐ {(rewardsPoints ?? 0).toLocaleString('en-IN')} pts
              </span>
              {streakDays > 0 && (
                <span style={{ fontSize: 13, color: C.text }}>
                  🔥 {streakDays} day{streakDays === 1 ? '' : 's'} streak
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: C.amber }}>View Rewards →</span>
            </div>
            {(() => {
              const goal = 1000
              const total = Number(rewardsPoints || 0)
              const pct = Math.max(0, Math.min(100, (total / goal) * 100))
              return (
                <>
                  <div style={{ height: 6, background: C.surface2, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: C.amber, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                    {total.toLocaleString('en-IN')}/{goal.toLocaleString('en-IN')} to Pro
                  </div>
                </>
              )
            })()}
          </button>

          {/* Row 2 — Academy progress */}
          <button
            type="button"
            onClick={() => navigate('/learn')}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '10px 14px',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: 10,
              gap: 10,
            }}
          >
            <span style={{ fontSize: 16 }} aria-hidden>📚</span>
            <span style={{ fontSize: 13, color: C.text }}>
              Academy: {academyDone}/{academyTotal || '—'} modules done
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.amber }}>
              {academyDone === 0 ? 'Start learning →' : 'Continue learning →'}
            </span>
          </button>

          {/* Row 3 — Research Assistant status */}
          <button
            type="button"
            onClick={() => navigate('/account#research')}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '10px 14px',
              background: hasGeminiKey ? 'rgba(34,197,94,0.06)' : 'transparent',
              border: `1px solid ${hasGeminiKey ? 'rgba(34,197,94,0.25)' : C.border}`,
              borderRadius: 10,
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 16 }} aria-hidden>🔬</span>
            <span style={{ fontSize: 13, color: C.text }}>
              Research Assistant: {hasGeminiKey ? <span style={{ color: C.green, fontWeight: 600 }}>Active ✓</span> : <span style={{ color: C.amber }}>Not set up</span>}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.amber }}>
              {hasGeminiKey ? 'Manage →' : 'Set up →'}
            </span>
          </button>
        </Card>

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


        {/* Personal Telegram link — DM alerts for watchlist changes.
            Distinct from the public-channel card below: this binds
            the user's own profile to a Telegram chat_id so the bot
            can DM them personalised stock-change pings via the
            /link flow on @PineXBot. */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: '#1a3a4a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
              <Icon name="brand-telegram" style={{ fontSize: 20, color: '#38BDF8' }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                Personal alerts {tgState === 'linked' && <span style={{ fontSize: 11, marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: 'rgba(52,211,153,0.12)', color: 'var(--positive)', fontWeight: 700, letterSpacing: '0.03em' }}>CONNECTED</span>}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {tgState === 'linked'
                  ? `Linked as @${tgUsername || tgChatId}`
                  : 'Get a DM when your watchlist stocks move'}
              </p>
            </div>
          </div>

          {tgState === 'loading' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
              Checking…
            </div>
          )}

          {tgState === 'unlinked' && !tgClickedConnect && (
            <button
              type="button"
              onClick={handleConnectTelegram}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: '#229ED9', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              <Icon name="brand-telegram" style={{ fontSize: 16 }} />
              Connect Telegram
            </button>
          )}

          {tgState === 'unlinked' && tgClickedConnect && (
            <div style={{
              fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 14px',
            }}>
              Open <strong style={{ color: 'var(--text-primary)' }}>{TELEGRAM_BOT_HANDLE}</strong> on Telegram and send <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>/link</strong>. Reply with the email you used to sign up here. Then refresh this page.
            </div>
          )}

          {tgState === 'linked' && (
            <>
              <button
                type="button"
                onClick={handleDisconnectTelegram}
                disabled={tgDisconnecting}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 12, fontWeight: 500,
                  background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                  border: '1px solid var(--border)', cursor: tgDisconnecting ? 'wait' : 'pointer',
                  opacity: tgDisconnecting ? 0.6 : 1,
                }}
              >
                {tgDisconnecting ? 'Disconnecting…' : 'Disconnect Telegram'}
              </button>
              {tgError && (
                <p style={{ fontSize: 11, color: 'var(--negative)', textAlign: 'center', margin: '8px 0 0' }}>{tgError}</p>
              )}
            </>
          )}
        </Card>

        {/* Research Assistant — BYOK Gemini. id="research" makes it
            the deep-link target from /account#research (Module 9 +
            StockDetail ResearchPanel teaser). All UI is rendered
            inline; the key never leaves localStorage. */}
        <ResearchAssistantSection />

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
            <Icon name="brand-telegram" style={{ fontSize: 16 }} />
            Join @pinexin
          </a>
        </Card>

        {/* Session */}
        <IQjetAccessSection />

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
    <HowToUseDrawer open={showHowTo} onClose={() => setShowHowTo(false)} />
    </>
  )
}


// ── Research Assistant Settings section ─────────────────────────────────
// All state is device-local. Save → localStorage. Test → minimal Gemini
// call. Delete → wipe localStorage. PineX servers, Supabase and Netlify
// never see the key.
//
// id="research" on the Card so /account#research scrolls here from the
// Module 9 link and the StockDetail teaser CTA.
//
// Pro gate: We always render the section. The Pro badge is informational
// — actual gating happens at the StockDetail Research panel where the
// usePlan().canAccess('research_assistant') check lives.
function ResearchAssistantSection() {
  // user.id is needed for logKeySaved so the admin Research AI tab can
  // count distinct registered users. useAuth runs at component scope
  // here (rather than threading user.id through props from the top
  // Account component) so this section stays a drop-in.
  const { user: _ra_user } = useAuth()

  // Retroactive registration — for users who saved a key BEFORE the
  // logKeySaved telemetry shipped. Fires once per browser per key;
  // idempotent via the pinex_gemini_key_logged flag.
  useEffect(() => {
    if (_ra_user?.id) ensureKeyRegistered(_ra_user.id).catch(() => {})
  }, [_ra_user?.id])
  const [input, setInput]       = useState('')
  const [showKey, setShowKey]   = useState(false)
  const [saved, setSaved]       = useState(getStoredGeminiKey())
  const [savedAt, setSavedAt]   = useState(getKeySavedAt())
  const [phase, setPhase]       = useState('idle')   // 'idle' | 'verifying' | 'success'
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [quotaWarning, setQuotaWarning] = useState('')
  const [message, setMessage]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [testing, setTesting]   = useState(false)
  const [testResult, setTestResult] = useState(null) // null | 'ok' | 'fail'
  const [testDetail, setTestDetail] = useState('')
  // Wow-moment toast — fixed-position banner at the bottom of the
  // viewport that slides up after a verified save. Auto-dismisses
  // after 5s; `wowKey` increments so a second consecutive save
  // restarts the animation cleanly.
  const [showToast, setShowToast] = useState(false)
  const [wowKey, setWowKey]       = useState(0)

  const ageDays = getKeyAgeDays()
  const validation = validateKey(input)
  const canSave = input.trim().length > 0 && validation.ok && phase !== 'verifying'

  // Verified save flow.
  // 1. Move into 'verifying' phase (button shows spinner).
  // 2. Race verifyKey() against a 1.5s minimum delay so the user always
  //    sees the verifying state — instant returns feel jarring and hide
  //    the fact that we actually called Google.
  // 3. If verify succeeds (or returns QUOTA — key is valid, just throttled),
  //    persist to localStorage, set the cross-page handoff flag for Home,
  //    and trigger the wow moment (amber glow + toast).
  // 4. On any other failure: surface the friendly error, stay on the
  //    input so the user can fix it.
  async function handleSave() {
    if (!canSave) return
    const candidate = input.trim()
    setBusy(true)
    setPhase('verifying')
    setError('')
    setQuotaWarning('')
    setMessage('')
    setTestResult(null)

    const minDelay = new Promise((r) => setTimeout(r, 1500))
    try {
      await Promise.all([verifyKey(candidate), minDelay])
      commitSave(candidate)
    } catch (e) {
      if (e && e.code === 'QUOTA') {
        // Quota hit but key works — still save, mark warning.
        await minDelay
        setQuotaWarning(e.message)
        commitSave(candidate)
        return
      }
      // Real validation failure — do NOT save.
      await minDelay
      setError(e?.message || 'Could not verify your key. Try again.')
      setPhase('idle')
      setBusy(false)
    }
  }

  function commitSave(key) {
    try {
      saveGeminiKey(key)
    } catch (e) {
      setError(e?.message || 'Could not save key to this browser.')
      setPhase('idle')
      setBusy(false)
      return
    }
    setSaved(key)
    setSavedAt(new Date().toISOString())
    setInput('')
    setShowKey(false)
    setPhase('success')
    setBusy(false)
    setWowKey((k) => k + 1)
    setShowToast(true)
    // Cross-page handoff: Home.jsx reads this on mount to pulse the
    // search bar amber once and update its placeholder copy. Cleared
    // by Home after consumption.
    try {
      localStorage.setItem('pinex_key_just_saved', new Date().toISOString())
    } catch {}
    // Funnel logging — admin uses this to count successful registrations
    // separately from "asked at least one question". Fire-and-forget;
    // never blocks the wow-moment UI.
    if (_ra_user?.id) {
      logKeySaved({ userId: _ra_user.id }).catch(() => {})
    }
  }

  // Auto-dismiss the wow toast after 5s.
  useEffect(() => {
    if (!showToast) return
    const t = setTimeout(() => setShowToast(false), 5000)
    return () => clearTimeout(t)
  }, [showToast, wowKey])

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    setTestDetail('')
    try {
      await testConnection()
      setTestResult('ok')
      setTestDetail('Connection working.')
    } catch (e) {
      setTestResult('fail')
      setTestDetail(
        e?.message || 'Key invalid or no quota remaining. Check aistudio.google.com.',
      )
    } finally {
      setTesting(false)
    }
  }

  function handleConfirmDelete() {
    deleteGeminiKey()
    setSaved('')
    setSavedAt(null)
    setConfirmDelete(false)
    setMessage('Key removed from this device.')
    setError('')
    setTestResult(null)
    setPhase('idle')
    setShowToast(false)
    try { localStorage.removeItem('pinex_key_just_saved') } catch {}
  }

  const fmtDate = (iso) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    } catch { return iso.slice(0, 10) }
  }

  // ── Wow-moment styling helpers ────────────────────────────────────────
  // The card transforms when phase === 'success': amber-tinted background,
  // amber border, and a one-shot boxShadow keyframe burst keyed off
  // `wowKey` so repeat saves replay the animation.
  const cardMotionStyle = {
    background: phase === 'success'
      ? 'rgba(245, 159, 11, 0.05)'   // very subtle amber tint
      : 'var(--bg-surface)',
    borderRadius: 16,
    transition: 'background 0.4s ease',
  }

  const cardAnimate = phase === 'success'
    ? {
        boxShadow: [
          '0 0 0px rgba(245,159,11,0)',
          '0 0 30px rgba(245,159,11,0.6)',
          '0 0 60px rgba(245,159,11,0.3)',
          '0 0 20px rgba(245,159,11,0.2)',
        ],
        borderColor: ['#1E2530', '#F59E0B', '#F59E0B', '#F59E0B'],
      }
    : { boxShadow: '0 0 0px rgba(245,159,11,0)', borderColor: '#1E2530' }

  return (
    <>
    <motion.div
      id="research"
      key={`research-card-${wowKey}`}
      animate={cardAnimate}
      transition={{ duration: 1.5 }}
      style={{
        border: '1px solid var(--border)',
        padding: '20px 20px',
        ...cardMotionStyle,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'rgba(251,191,36,0.12)',
          border: '1px solid rgba(251,191,36,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, flexShrink: 0,
        }}>
          🔬
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Research Assistant
            <span style={{
              fontSize: 9, fontWeight: 800,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: 99,
              background: C.amberBg, color: C.amber,
              border: `1px solid ${C.amberBorder}`,
            }}>
              PRO
            </span>
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', lineHeight: 1.5 }}>
            Power your research with your own Gemini API key. Stored only on this device. PineX never sees it.
          </p>
        </div>
      </div>

      {/* Wow-moment activation reveal — fires once per save. Staggered
          checkmarks below. The persistent "Key saved" block below (with
          masked key + last-saved date) handles steady-state display on
          subsequent visits. */}
      <AnimatePresence>
        {phase === 'success' && (
          <motion.div
            key={`wow-${wowKey}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            style={{
              marginBottom: 14,
              padding: '14px 16px',
              background: 'rgba(245,159,11,0.06)',
              border: `1px solid ${C.amberBorder}`,
              borderRadius: 12,
            }}
          >
            <div style={{
              fontSize: 18, fontWeight: 700, color: C.amber,
              marginBottom: 6, letterSpacing: '-0.01em',
            }}>
              🔬 Research Assistant Active
            </div>
            <p style={{
              fontSize: 14, color: 'var(--text-primary)',
              margin: '0 0 10px', lineHeight: 1.5,
              fontFamily: 'Newsreader, ui-serif, Georgia, serif',
            }}>
              Your personal AI analyst is ready. Ask anything about any stock directly from the search bar.
            </p>
            {[
              'Connected to Gemini',
              'Questions stay private',
              'PineX never sees your key',
            ].map((line, i) => (
              <motion.div
                key={line}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + i * 0.1, duration: 0.3 }}
                style={{
                  fontSize: 12, color: C.green, marginTop: 4, fontWeight: 600,
                }}
              >
                ✅ {line}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Existing key display — steady state */}
      {saved && phase !== 'success' && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          background: C.greenBg,
          border: `1px solid ${C.greenBorder}`,
          borderRadius: 10,
          fontSize: 12,
          color: C.green,
          fontWeight: 600,
        }}>
          ✅ Key saved on this device
          <div style={{
            marginTop: 4, fontSize: 11, color: C.textMuted, fontWeight: 400,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          }}>
            {maskKey(saved)}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: C.textMuted, fontWeight: 400 }}>
            Last saved: {fmtDate(savedAt)}
            {ageDays != null && ageDays >= 0 && (
              <> · {ageDays} day{ageDays === 1 ? '' : 's'} ago</>
            )}
          </div>
        </div>
      )}

      {/* 90-day rotation reminder */}
      {ageDays != null && ageDays >= 90 && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          background: C.amberBg,
          border: `1px solid ${C.amberBorder}`,
          borderRadius: 10,
          fontSize: 12,
          color: C.amber,
          lineHeight: 1.5,
        }}>
          ⚠ Your key is {ageDays} days old. Consider rotating it for security — generate a new one at aistudio.google.com and paste it below.
        </div>
      )}

      {/* "How to set up" inline guide — surfaces only when no key is
          saved yet. The down-arrow in step 3 literally points at the
          input field below. Hidden as soon as a key is saved (the
          "Existing key display" block above handles that state). */}
      {!saved && (
        <div style={{
          marginBottom: 14,
          padding: '12px 14px',
          background: 'var(--bg-elevated)',
          border: `1px solid ${C.border}`,
          borderRadius: 12,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: C.amber, marginBottom: 10,
          }}>
            How to set up (2 minutes)
          </div>
          <ol style={{
            margin: 0, paddingLeft: 0, listStyle: 'none',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <li style={{ display: 'flex', gap: 10 }}>
              <span style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                background: C.amber, color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
              }}>1</span>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)' }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Get your free key</strong>
                <a
                  href="https://aistudio.google.com"
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: C.amber, textDecoration: 'underline' }}
                >
                  aistudio.google.com
                </a>{' '}→ Get API key → Create
              </div>
            </li>
            <li style={{ display: 'flex', gap: 10 }}>
              <span style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                background: C.amber, color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
              }}>2</span>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)' }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Copy the key</strong>
                <span style={{ color: 'var(--text-muted)' }}>
                  A long key from aistudio.google.com — newer keys start
                  with{' '}
                  <code style={{
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    background: C.surface, padding: '1px 5px', borderRadius: 4,
                    fontSize: 11,
                  }}>AQ.</code>
                  {' '}or{' '}
                  <code style={{
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    background: C.surface, padding: '1px 5px', borderRadius: 4,
                    fontSize: 11,
                  }}>AIzaSy…</code>
                </span>
              </div>
            </li>
            <li style={{ display: 'flex', gap: 10 }}>
              <span style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                background: C.amber, color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
              }}>3</span>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)' }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Paste below and hit SAVE</strong>
                <span style={{ color: 'var(--text-muted)' }}>
                  ↓
                </span>
              </div>
            </li>
          </ol>
        </div>
      )}

      {/* Input + show/hide toggle */}
      <label style={{
        display: 'block', fontSize: 11,
        fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
        marginBottom: 6,
      }}>
        Gemini API key
      </label>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input
          type={showKey ? 'text' : 'password'}
          value={input}
          onChange={(e) => { setInput(e.target.value); setError('') }}
          placeholder={saved ? 'Paste a new key to replace…' : 'Paste your full key from aistudio.google.com'}
          autoComplete="off"
          spellCheck={false}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '11px 44px 11px 14px',
            background: 'var(--bg-input)',
            border: `1px solid ${input && !validation.ok ? C.red : 'var(--border)'}`,
            borderRadius: 10,
            color: 'var(--text-primary)',
            fontSize: 13,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => setShowKey((s) => !s)}
          aria-label={showKey ? 'Hide key' : 'Show key'}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer',
            padding: 6,
          }}
        >
          <i className={`ti ${showKey ? 'ti-eye-off' : 'ti-eye'}`} style={{ fontSize: 17 }} />
        </button>
      </div>

      {/* Inline validation hint */}
      {input && !validation.ok && (
        <div style={{
          marginBottom: 10, padding: 10,
          background: C.redBg, border: `1px solid ${C.redBorder}`,
          borderRadius: 8, color: C.red, fontSize: 12, lineHeight: 1.5,
        }}>
          {validation.error}
        </div>
      )}

      {/* SAVE KEY — the most important button on this page.
          Per spec: full width, amber, black text, always below the
          input, font-weight 700, big tap target. During the 1.5s
          verifying window we show a spinning indicator + "Verifying…"
          so the user knows we're actually calling Google. */}
      <button
        type="button"
        onClick={handleSave}
        disabled={!canSave}
        style={{
          display: 'flex', width: '100%',
          alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '14px',
          background: !canSave
            ? 'var(--bg-elevated)'
            : phase === 'verifying' ? C.amber : C.amber,
          color: !canSave ? 'var(--text-muted)' : '#000',
          border: 'none', borderRadius: 10,
          fontSize: 14, fontWeight: 700,
          letterSpacing: '0.04em',
          cursor: !canSave ? 'not-allowed' : 'pointer',
          marginBottom: 10,
        }}
      >
        {phase === 'verifying' ? (
          <>
            <motion.span
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              style={{
                display: 'inline-block',
                width: 14, height: 14, borderRadius: '50%',
                border: '2px solid rgba(0,0,0,0.25)',
                borderTopColor: '#000',
              }}
            />
            Verifying…
          </>
        ) : phase === 'success' ? (
          <>✓ Key saved</>
        ) : busy ? 'Saving…' : 'SAVE KEY'}
      </button>

      {/* Quota warning — key works but is throttled. We still saved it. */}
      {quotaWarning && (
        <div style={{
          marginBottom: 12, padding: '10px 12px',
          background: C.amberBg, border: `1px solid ${C.amberBorder}`,
          borderRadius: 8, color: C.amber, fontSize: 12, lineHeight: 1.5,
        }}>
          ⚠ {quotaWarning}
        </div>
      )}

      {/* Test + Delete buttons — only when a key exists */}
      {saved && !confirmDelete && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            style={{
              flex: 1, padding: '10px 12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: 12, fontWeight: 600,
              cursor: testing ? 'wait' : 'pointer',
            }}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            style={{
              flex: 1, padding: '10px 12px',
              background: 'transparent',
              border: `1px solid ${C.red}66`,
              borderRadius: 8,
              color: C.red,
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🗑 Delete key
          </button>
        </div>
      )}

      {/* Inline delete confirm */}
      {confirmDelete && (
        <div style={{
          marginBottom: 12, padding: 12,
          background: C.redBg, border: `1px solid ${C.redBorder}`,
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4, fontWeight: 600 }}>
            Remove your Gemini key from this device?
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            PineX never had this key. Deleting it only removes it from your browser storage.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleConfirmDelete}
              style={{
                flex: 1, padding: '9px 0',
                background: C.red, color: '#fff', border: 'none', borderRadius: 8,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
              Remove
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}
              style={{
                flex: 1, padding: '9px 0',
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Test connection result */}
      {testResult === 'ok' && (
        <div style={{
          marginBottom: 12, padding: '8px 10px',
          background: C.greenBg, border: `1px solid ${C.greenBorder}`,
          borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 600,
        }}>
          ✅ {testDetail}
        </div>
      )}
      {testResult === 'fail' && (
        <div style={{
          marginBottom: 12, padding: '12px 14px',
          background: C.redBg, border: `1px solid ${C.redBorder}`,
          borderRadius: 8, color: C.red, fontSize: 12, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            ❌ Test failed
          </div>
          {/* The exact error string thrown by testConnection. Includes
              Google's `error.message`, the apiStatus token, and any
              `details[].reason` codes so the user sees what really
              broke (PERMISSION_DENIED / API_KEY_INVALID / etc.). */}
          <div style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 11,
            background: 'rgba(0,0,0,0.25)',
            padding: '8px 10px',
            borderRadius: 6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: 8,
          }}>
            {testDetail}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            Common causes:
            {' '}invalid key, key restricted to wrong API, daily quota
            exceeded, or the key&apos;s Google Cloud project doesn&apos;t
            have the Generative Language API enabled. Generate a fresh
            key at{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank" rel="noopener noreferrer"
              style={{ color: C.amber, textDecoration: 'underline' }}
            >
              aistudio.google.com/apikey
            </a>
            .
          </div>
        </div>
      )}

      {/* General message / error banners */}
      {message && !testResult && (
        <div style={{
          marginBottom: 12, padding: '8px 10px',
          background: C.greenBg, border: `1px solid ${C.greenBorder}`,
          borderRadius: 8, color: C.green, fontSize: 12,
        }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{
          marginBottom: 12, padding: '8px 10px',
          background: C.redBg, border: `1px solid ${C.redBorder}`,
          borderRadius: 8, color: C.red, fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* How-to footer */}
      <div style={{
        marginTop: 8, paddingTop: 12,
        borderTop: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.65,
      }}>
        <strong style={{ color: 'var(--text-primary)' }}>How to get your free key:</strong><br />
        Go to <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer"
          style={{ color: C.amber, textDecoration: 'underline' }}>aistudio.google.com</a>
        {' '}→ Get API key → Create API key in new project.
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-muted)',
          fontSize: 11, lineHeight: 1.55,
        }}>
          ℹ This key is saved on this device only. If you use PineX on
          another device you will need to add it there too.
          PineX cannot see it. <Link to="/learn"
            style={{ color: C.amber, textDecoration: 'underline' }}>Learn more → Module 9</Link>
        </div>
      </div>

      {/* My Research Notes — index of saved AI insights. Only useful
          when the user has actually saved at least one note, but we
          show it unconditionally so they can discover the feature
          before saving their first. RLS scopes the listing to them. */}
      <Link
        to="/research-notes"
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12, padding: '10px 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: 'var(--text-primary)',
          fontSize: 13, fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>📝</span>
          My Research Notes
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>→</span>
      </Link>
    </motion.div>

    {/* Wow toast — portaled to document.body so it's pinned to the
        viewport, not to any transformed ancestor. Without the portal,
        framer-motion animations elsewhere on the page (page transitions,
        the Account card's own glow animation) create a containing block
        and the toast ends up offset / clipped — exactly the bug the
        user reported (toast spilling off the right edge on mobile).
        Slides up from below the viewport with a spring, auto-dismisses
        in 5s. Tap × to dismiss early. */}
    {createPortal(
    <AnimatePresence>
      {showToast && (
        <motion.div
          key="wow-toast"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 35 }}
          style={{
            position: 'fixed',
            bottom: 24,
            // Use left + right anchors (not transform-based centering)
            // so the toast stays inside the viewport edges even if a
            // future ancestor transform sneaks in. Auto margin centres
            // it horizontally up to its maxWidth.
            left: 16,
            right: 16,
            marginLeft: 'auto',
            marginRight: 'auto',
            maxWidth: 420,
            zIndex: 9999,
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)',
            color: '#000',
            borderRadius: 16,
            boxShadow: '0 10px 40px rgba(245,159,11,0.45), 0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column', gap: 6,
            boxSizing: 'border-box',
          }}
          role="status"
          aria-live="polite"
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 15, fontWeight: 800,
          }}>
            <span>🔬 Research Assistant Active</span>
            <button
              type="button"
              onClick={() => setShowToast(false)}
              aria-label="Dismiss"
              style={{
                background: 'transparent', border: 'none',
                color: 'rgba(0,0,0,0.6)', cursor: 'pointer',
                fontSize: 18, padding: 0, marginLeft: 12, lineHeight: 1,
              }}
            >×</button>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.45, fontWeight: 500 }}>
            Your Gemini key is saved. Search for any stock and ask your AI analyst anything.
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
            Try it: <Link
              to="/"
              onClick={() => setShowToast(false)}
              style={{ color: '#000', textDecoration: 'underline', fontWeight: 700 }}
            >open Home and search RELIANCE →</Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
    )}
    </>
  )
}


// ── IQjet Access section ───────────────────────────────────────────────
// Per-user state machine for IQjet subscription access. Reads the
// user's iqjet_access row via RLS (auth.uid() = user_id), so an
// unauthenticated read just returns nothing and the section renders
// the "no access" state.
//
// Passcode claim goes through the claim_iqjet_passcode() RPC defined
// in scripts/sql/create_iqjet_access.sql — that function runs
// SECURITY DEFINER so it can bind user_id on a previously-unclaimed
// row even though the caller's RLS prevents direct writes.
//
// Anchor id="iqjet" so the locked /iqjet page's deep link
// (/profile#iqjet) scrolls straight here.
const IQJET_ADMIN_EMAIL = 'robin22y@gmail.com'

function IQjetAccessSection() {
  const { user } = useAuth()
  const isIQjetAdmin = String(user?.email || '').trim().toLowerCase() === IQJET_ADMIN_EMAIL
  const SUPPORT_EMAIL = 'support@pinex.in'

  const [loading, setLoading] = useState(true)
  const [access,  setAccess]  = useState(null)
  // 'view' = state machine; 'enter' = passcode input panel.
  const [mode,    setMode]    = useState('view')
  const [code,    setCode]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [okMsg,   setOkMsg]   = useState('')

  const refresh = async () => {
    if (!user?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('iqjet_access')
        .select('expires_at,is_active,passcode,last_used_at')
        .eq('user_id', user.id)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setAccess(data || null)
    } catch {
      setAccess(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id])

  // /iqjet's LockedView links to /profile#iqjet — when this section
  // mounts, jump to the anchor so the user lands on it without
  // hunting.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash === '#iqjet') {
      // Wait one frame so the Card is in the DOM.
      requestAnimationFrame(() => {
        document.getElementById('iqjet')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [])

  async function onSubmitCode(e) {
    e?.preventDefault?.()
    if (busy) return
    const passcode = String(code || '').trim().toUpperCase()
    if (!passcode) return
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      const { data, error: rpcErr } = await supabase.rpc('claim_iqjet_passcode', {
        p_passcode: passcode,
      })
      if (rpcErr) throw rpcErr
      if (!data?.ok) {
        const reason = data?.reason || 'not_found'
        const msg = {
          not_signed_in: 'Please sign in again and retry.',
          not_found:     'Invalid passcode.',
          revoked:       'This passcode has been revoked.',
          expired:       'This passcode has expired.',
          taken:         'This passcode has already been used. ' +
                         'Each passcode is single-use only. ' +
                         'Message Robin for your own access.',
        }[reason] || 'Invalid passcode.'
        setError(msg)
      } else {
        setOkMsg('Access activated.')
        setCode('')
        setMode('view')
        await refresh()
      }
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // Email Robin instead of Telegram — keeps a paper trail in the
  // support inbox and works without the recipient already being on
  // Telegram. Subject + body switch tone based on whether this is a
  // fresh request, a renewal after expiry, or a revoked-account ping.
  function makeMailtoHref(subject) {
    const body = [
      'Hi Robin,',
      '',
      "I'd like to request access to IQjet.",
      '',
      `My PineX email: ${user?.email || '(not signed in)'}`,
      'Reason / how I came across PineX: ',
      '',
      'Thanks',
    ].join('\n')
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  const requestHref = makeMailtoHref('IQjet access request')
  const renewHref   = makeMailtoHref('IQjet access renewal')
  const reviewHref  = makeMailtoHref('IQjet access — revoked, please review')

  // ── State machine selector ────────────────────────────────────
  let phase = 'no_access'
  let expiresMs = 0
  if (loading) {
    phase = 'loading'
  } else if (access) {
    expiresMs = access.expires_at ? new Date(access.expires_at).valueOf() : 0
    if (!access.is_active) {
      phase = 'revoked'
    } else if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
      phase = 'expired'
    } else {
      phase = 'active'
    }
  }

  const daysLeft = (() => {
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return 0
    return Math.max(0, Math.ceil((expiresMs - Date.now()) / (24 * 3600 * 1000)))
  })()

  return (
    <Card id="iqjet">
      <SectionLabel>IQjet · Market Intelligence</SectionLabel>

      {isIQjetAdmin && (
        <div>
          <p style={{ fontSize: 14, color: 'var(--positive,#2ecc71)', fontWeight: 700, margin: '0 0 4px' }}>
            ✓ IQjet · Admin
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
            You're the admin — access never expires for this account. Grant other
            users from the admin dashboard.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link
              to="/iqjet"
              style={{
                display: 'inline-block',
                border: '1px solid var(--border)',
                padding: '10px 18px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                background: 'var(--bg-elevated)',
                textDecoration: 'none',
              }}
            >
              Open IQjet →
            </Link>
            <Link
              to="/admin"
              style={{
                display: 'inline-block',
                border: '1px solid var(--border)',
                padding: '10px 18px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-muted)',
                background: 'transparent',
                textDecoration: 'none',
              }}
            >
              Manage access
            </Link>
          </div>
        </div>
      )}

      {!isIQjetAdmin && phase === 'loading' && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checking access…</p>
      )}

      {!isIQjetAdmin && phase === 'active' && (
        <div>
          <p style={{ fontSize: 14, color: 'var(--positive,#2ecc71)', fontWeight: 700, margin: '0 0 4px' }}>
            ✓ IQjet Access · Active
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
            Valid until {new Date(access.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            {' '}({daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining).
          </p>
          <Link
            to="/iqjet"
            style={{
              display: 'inline-block',
              border: '1px solid var(--border)',
              padding: '10px 18px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
              textDecoration: 'none',
            }}
          >
            Open IQjet →
          </Link>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0' }}>
            Access expires automatically. Message Robin to renew.
          </p>
        </div>
      )}

      {!isIQjetAdmin && phase === 'expired' && (
        <div>
          <p style={{ fontSize: 14, color: 'var(--warning,#f1c40f)', fontWeight: 700, margin: '0 0 4px' }}>
            ⚠ IQjet Access · Expired
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
            Your access expired on {new Date(access.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.
          </p>
          <a
            href={renewHref}
            style={{
              display: 'inline-block',
              border: '1px solid var(--border)',
              padding: '10px 18px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
              textDecoration: 'none',
            }}
          >
            Renew via email
          </a>
        </div>
      )}

      {!isIQjetAdmin && phase === 'revoked' && (
        <div>
          <p style={{ fontSize: 14, color: 'var(--negative,#e74c3c)', fontWeight: 700, margin: '0 0 4px' }}>
            ⛔ IQjet Access · Revoked
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
            Reach out to Robin if you think this is a mistake.
          </p>
          <a
            href={reviewHref}
            style={{
              display: 'inline-block',
              border: '1px solid var(--border)',
              padding: '10px 18px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
              textDecoration: 'none',
            }}
          >
            Email Robin
          </a>
        </div>
      )}

      {!isIQjetAdmin && phase === 'no_access' && mode === 'view' && (
        <div>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: '0 0 8px', fontWeight: 600 }}>
            🔒 Private intelligence
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>
            IQjet is Robin's personal market intelligence desk — cycle analysis,
            earnings intelligence and market pulse. Access is by invitation only.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <a
              href={requestHref}
              style={{
                display: 'inline-block',
                border: '1px solid var(--border)',
                padding: '10px 18px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                background: 'var(--bg-elevated)',
                textDecoration: 'none',
              }}
            >
              Request access via email
            </a>
            <button
              type="button"
              onClick={() => setMode('enter')}
              style={{
                border: '1px solid var(--border)',
                padding: '10px 18px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-muted)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Enter passcode
            </button>
          </div>
        </div>
      )}

      {!isIQjetAdmin && phase === 'no_access' && mode === 'enter' && (
        <form onSubmit={onSubmitCode}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Paste the passcode Robin sent you.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="IQJET-XXXXXX"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              style={{
                flex: '1 1 200px',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 14,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            />
            <button
              type="submit"
              disabled={busy || !code.trim()}
              style={{
                border: '1px solid #1d8348',
                padding: '10px 18px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                color: '#0b1410',
                background: 'linear-gradient(180deg, #2ecc71 0%, #239d56 100%)',
                cursor: busy || !code.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !code.trim() ? 0.6 : 1,
              }}
            >
              {busy ? 'Activating…' : 'Activate'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('view'); setCode(''); setError(''); setOkMsg('') }}
              style={{
                border: 'none',
                padding: '10px 8px',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p style={{ fontSize: 13, color: 'var(--negative,#e74c3c)', margin: '10px 0 0' }}>{error}</p>
          )}
          {okMsg && (
            <p style={{ fontSize: 13, color: 'var(--positive,#2ecc71)', margin: '10px 0 0' }}>{okMsg}</p>
          )}
        </form>
      )}
    </Card>
  )
}
