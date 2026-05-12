import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'

const USAGE_LIMITS = {
  watchlistStocks: 10,
  portfolioHoldings: 10,
  downloadsMonthly: 5,
}

function getInitials(name, email) {
  const n = name?.trim()
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      const a = parts[0][0]
      const b = parts[parts.length - 1][0]
      if (a && b) return `${a}${b}`.toUpperCase()
    }
    return parts[0]?.slice(0, 2).toUpperCase() || '?'
  }
  const local = email?.split('@')[0] ?? '?'
  return local.slice(0, 2).toUpperCase()
}

function formatMemberSince(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(d)
}

function UsageBar({ label, current, max }) {
  const pct = Math.min(100, max > 0 ? Math.round((current / max) * 100) : 0)
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-[#E2E8F0]">{label}</span>
        <span className="text-text-muted">
          {current} of {max}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full border border-border-subtle bg-base">
        <div
          className="h-full rounded-full bg-blue-accent transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function AvatarBlock({ url, initials }) {
  const [broken, setBroken] = useState(false)
  return url && !broken ? (
    <img
      src={url}
      alt=""
      className="block h-16 w-16 shrink-0 rounded-full border border-border-subtle object-cover"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-base text-lg font-bold text-[#E2E8F0]">
      {initials}
    </div>
  )
}

function ProfileField({ label, children }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <div>{children}</div>
    </div>
  )
}

export default function Account() {
  const { user, profile, loading: authLoading, isPaid } = useAuth()

  const [usage] = useState({
    watchlistCount: 0,
    portfolioCount: 0,
    downloadsThisMonth: 0,
  })

  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [nameOverride, setNameOverride] = useState('')

  const [signingOut, setSigningOut] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)

  const avatarUrl =
    user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null

  const displayEmail = profile?.email ?? user?.email ?? ''
  const fullNameFromProfile =
    profile?.full_name?.trim()
    ?? user?.user_metadata?.full_name?.trim()
    ?? user?.user_metadata?.name?.trim()
    ?? ''

  const fullNameShown = (nameOverride.trim() || fullNameFromProfile).trim()

  const memberSince = formatMemberSince(
    profile?.created_at ?? user?.created_at,
  )

  const initials = useMemo(
    () =>
      getInitials(isEditingName ? nameDraft : fullNameShown, displayEmail),
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
    if (!next) {
      setNameError('Name cannot be empty.')
      return
    }

    setNameSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: next })
      .eq('id', uid)
    setNameSaving(false)

    if (error) {
      setNameError(error.message)
      return
    }

    setNameOverride(next)
    setIsEditingName(false)
  }

  async function handleSoftDelete() {
    if (!user?.id) return

    const ok = window.confirm(
      'Permanently remove your StockIQ account? Your access will stop and associated data may be anonymized. This cannot be undone from the app.',
    )
    if (!ok) return

    setDeletingAccount(true)
    const ts = new Date().toISOString()
    const { error } = await supabase
      .from('profiles')
      .update({ deleted_at: ts })
      .eq('id', user.id)

    if (error) {
      setDeletingAccount(false)
      window.alert(
        error.message.includes('deleted_at')
          ? 'Soft delete isn’t configured yet — add `deleted_at` (timestamptz) to `profiles` in Supabase, or try again.'
          : error.message,
      )
      return
    }

    await signOut()
  }

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
  }

  if (authLoading) {
    return <LoadingSpinner />
  }

  if (!user) {
    return null
  }

  const showUpgrade = !isPaid
  const showUsageLimits = !isPaid

  return (
    <div className="min-h-screen w-full bg-base px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Account</h1>
            <p className="mt-1 text-sm text-text-muted">
              Manage profile, usage, and sign-in.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-sm font-medium text-blue-accent underline-offset-2 hover:underline"
            >
              Home
            </Link>
            <Link
              to="/dashboard"
              className="text-sm font-medium text-blue-accent underline-offset-2 hover:underline"
            >
              Dashboard
            </Link>
          </div>
        </div>

        <section
          aria-labelledby="profile-heading"
          className="rounded-2xl border border-border-subtle bg-surface p-6 md:p-8"
        >
          <h2
            id="profile-heading"
            className="text-lg font-semibold text-white"
          >
            Profile
          </h2>

          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="shrink-0 self-start">
              <AvatarBlock
                key={avatarUrl ?? 'no-avatar'}
                url={avatarUrl}
                initials={initials}
              />
            </div>

            <div className="min-w-0 flex-1 space-y-5">
              <ProfileField label="Full name">
                {!isEditingName ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-base font-medium text-[#E2E8F0]">
                      {fullNameShown || '—'}
                    </p>
                    <button
                      type="button"
                      onClick={startEditName}
                      className="text-sm font-medium text-blue-accent underline-offset-2 hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className="w-full rounded-lg border border-border-subtle bg-base px-3 py-2 text-sm text-[#E2E8F0] outline-none ring-blue-accent/40 focus:border-blue-accent focus:ring-2"
                      aria-label="Full name"
                    />
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => saveFullName()}
                        disabled={nameSaving}
                        className="rounded-lg bg-blue-accent px-3 py-2 text-xs font-semibold text-[#0c1118] disabled:opacity-50"
                      >
                        {nameSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditName}
                        disabled={nameSaving}
                        className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-muted hover:text-[#E2E8F0] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {nameError ? (
                  <p className="mt-2 text-xs text-red-signal">{nameError}</p>
                ) : null}
              </ProfileField>

              <ProfileField label="Email">
                <p className="truncate text-[15px] text-[#E2E8F0] opacity-90">
                  {displayEmail || '—'}
                </p>
              </ProfileField>

              <ProfileField label="Member since">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[15px] text-[#E2E8F0]">{memberSince}</p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${isPaid ? 'bg-green-signal/15 text-green-signal ring-1 ring-green-signal/40' : 'bg-white/10 text-text-muted ring-1 ring-border-subtle'}`}
                    title={profile?.plan ? `plan: ${profile.plan}` : 'Plan'}
                  >
                    {isPaid ? 'PRO' : 'FREE'}
                  </span>
                </div>
              </ProfileField>
            </div>
          </div>
        </section>

        {showUsageLimits ? (
          <section
            aria-labelledby="usage-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-6 md:p-8"
          >
            <h2
              id="usage-heading"
              className="text-lg font-semibold text-white"
            >
              Usage this month
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Limits apply while you&apos;re on Free. Counters will sync when
              usage tracking is live.
            </p>
            <div className="mt-5 divide-y divide-border-subtle">
              <div className="py-4 first:pt-0 last:pb-0">
                <UsageBar
                  label="Watchlist"
                  current={usage.watchlistCount}
                  max={USAGE_LIMITS.watchlistStocks}
                />
              </div>
              <div className="py-4 first:pt-0 last:pb-0">
                <UsageBar
                  label="Portfolio"
                  current={usage.portfolioCount}
                  max={USAGE_LIMITS.portfolioHoldings}
                />
              </div>
              <div className="py-4 first:pt-0 last:pb-0">
                <UsageBar
                  label="Downloads this month"
                  current={usage.downloadsThisMonth}
                  max={USAGE_LIMITS.downloadsMonthly}
                />
              </div>
            </div>
          </section>
        ) : null}

        {showUpgrade ? (
          <section
            aria-labelledby="upgrade-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-6 md:p-8"
          >
            <h2
              id="upgrade-heading"
              className="text-lg font-semibold text-white"
            >
              Upgrade to Pro
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              Pro isn&apos;t available yet — here&apos;s what we&apos;re
              planning to include.
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[#E2E8F0]/90">
              <li>Unlimited stock views, watchlist, and portfolio size</li>
              <li>Higher export &amp; download limits</li>
              <li>Priority data refresh and advanced screeners</li>
              <li>Richer Telegram bot alerts and portfolio digests</li>
            </ul>
            <div className="mt-5 max-w-md">
              <button
                type="button"
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-border-subtle bg-base py-3 text-sm font-semibold text-text-muted"
              >
                Upgrade to Pro — Coming Soon
              </button>
              <p className="mt-3 text-xs text-text-muted">
                Free forever until announced.
              </p>
            </div>
          </section>
        ) : null}

        <section
          aria-labelledby="telegram-heading"
          className="rounded-2xl border border-border-subtle bg-surface p-6 md:p-8"
        >
          <h2
            id="telegram-heading"
            className="text-lg font-semibold text-white"
          >
            Telegram
          </h2>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-[#E2E8F0]/90">
            Connect to{' '}
            <span className="font-medium text-white">StockIQ Bot</span> on
            Telegram to get concise price moves, digest summaries, and
            optional reminders for your tickers once notifications are wired
            up.
          </p>
          <a
            href="https://t.me/StockIQBot"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-w-[240px] items-center justify-center rounded-lg bg-[#229ED9] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Open Telegram Bot
          </a>
        </section>

        <section className="rounded-2xl border border-border-subtle bg-surface p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Session</h2>
          <p className="mt-1 text-sm text-text-muted">
            Sign out on this device or permanently remove your account.
          </p>
          <div className="mt-5 flex max-w-md flex-col gap-3">
            <button
              type="button"
              onClick={() => handleSignOut()}
              disabled={signingOut || deletingAccount}
              className="rounded-lg border border-border-subtle bg-base px-4 py-3 text-sm font-semibold text-[#E2E8F0] transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            <button
              type="button"
              disabled={signingOut || deletingAccount}
              onClick={handleSoftDelete}
              className="rounded-lg border border-border-subtle px-4 py-3 text-sm font-medium text-text-muted transition hover:text-[#E2E8F0] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingAccount ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
