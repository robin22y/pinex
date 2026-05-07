import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAuth } from '../context'
import { signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'

const USAGE_LIMITS = {
  stockViewsDaily: 10,
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
      className="h-16 w-16 shrink-0 rounded-full border border-border-subtle object-cover"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-base text-lg font-bold text-[#E2E8F0]">
      {initials}
    </div>
  )
}

export default function Account() {
  const { user, profile, loading: authLoading, isPaid } = useAuth()

  const [usage] = useState({
    stockViewsToday: 0,
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
    <div className="min-h-screen bg-base px-4 py-10">
      <div className="mx-auto max-w-xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xl font-bold text-blue-accent">Account</p>
            <p className="mt-1 text-sm text-text-muted">
              Manage profile, usage, and sign-in.
            </p>
          </div>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-blue-accent underline-offset-2 hover:underline"
          >
            Dashboard
          </Link>
        </div>

        <section
          aria-labelledby="profile-heading"
          className="rounded-2xl border border-border-subtle bg-surface p-6"
        >
          <h2
            id="profile-heading"
            className="text-lg font-semibold text-white"
          >
            Profile
          </h2>

          <div className="mt-5 flex gap-5">
            <AvatarBlock
              key={avatarUrl ?? 'no-avatar'}
              url={avatarUrl}
              initials={initials}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Full name
                </p>
                {!isEditingName ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
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
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className="w-full rounded-lg border border-border-subtle bg-base px-3 py-2 text-sm text-[#E2E8F0] outline-none ring-blue-accent/40 focus:border-blue-accent focus:ring-2"
                      aria-label="Full name"
                    />
                    <div className="flex gap-2">
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
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Email
                </p>
                <p className="mt-1 truncate text-[15px] text-[#E2E8F0] opacity-90">
                  {displayEmail || '—'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Member since
                  </p>
                  <p className="mt-1 text-[15px] text-[#E2E8F0]">
                    {memberSince}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${isPaid ? 'bg-green-signal/15 text-green-signal ring-1 ring-green-signal/40' : 'bg-white/10 text-text-muted ring-1 ring-border-subtle'}`}
                  title={profile?.plan ? `plan: ${profile.plan}` : 'Plan'}
                >
                  {isPaid ? 'PRO' : 'FREE'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {showUsageLimits ? (
          <section
            aria-labelledby="usage-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-6"
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
            <div className="mt-5 space-y-5">
              <UsageBar
                label="Stock views today"
                current={usage.stockViewsToday}
                max={USAGE_LIMITS.stockViewsDaily}
              />
              <UsageBar
                label="Watchlist"
                current={usage.watchlistCount}
                max={USAGE_LIMITS.watchlistStocks}
              />
              <UsageBar
                label="Portfolio"
                current={usage.portfolioCount}
                max={USAGE_LIMITS.portfolioHoldings}
              />
              <UsageBar
                label="Downloads this month"
                current={usage.downloadsThisMonth}
                max={USAGE_LIMITS.downloadsMonthly}
              />
            </div>
          </section>
        ) : null}

        {showUpgrade ? (
          <section
            aria-labelledby="upgrade-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-6"
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
            <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-[#E2E8F0]/90">
              <li>Unlimited stock views, watchlist, and portfolio size</li>
              <li>Higher export &amp; download limits</li>
              <li>Priority data refresh and advanced screeners</li>
              <li>Richer Telegram bot alerts and portfolio digests</li>
            </ul>
            <button
              type="button"
              disabled
              className="mt-5 w-full cursor-not-allowed rounded-lg border border-border-subtle bg-base py-3 text-sm font-semibold text-text-muted"
            >
              Upgrade to Pro — Coming Soon
            </button>
            <p className="mt-3 text-center text-xs text-text-muted">
              Free forever until announced.
            </p>
          </section>
        ) : null}

        <section
          aria-labelledby="telegram-heading"
          className="rounded-2xl border border-border-subtle bg-surface p-6"
        >
          <h2
            id="telegram-heading"
            className="text-lg font-semibold text-white"
          >
            Telegram
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#E2E8F0]/90">
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
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-[#229ED9] py-3 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Open Telegram Bot
          </a>
        </section>

        <div className="rounded-2xl border border-red-signal/30 bg-red-signal/[0.06] p-6">
          <button
            type="button"
            onClick={() => handleSignOut()}
            disabled={signingOut || deletingAccount}
            className="w-full rounded-lg border border-red-signal bg-red-signal/[0.12] py-3 text-[15px] font-semibold text-red-signal transition hover:bg-red-signal/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>

          <div className="mt-6 text-center">
            <button
              type="button"
              disabled={signingOut || deletingAccount}
              onClick={handleSoftDelete}
              className="text-xs text-text-muted underline-offset-2 hover:text-[#94A3B8] hover:underline disabled:cursor-not-allowed disabled:no-underline"
            >
              {deletingAccount ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
