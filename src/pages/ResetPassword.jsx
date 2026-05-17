import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { updatePassword } from '../lib/auth'

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg
        className="h-5 w-5 text-text-muted"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    )
  }
  return (
    <svg
      className="h-5 w-5 text-text-muted"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
      />
    </svg>
  )
}

export default function ResetPassword() {
  const navigate = useNavigate()
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    let recoverySeen = false

    let timeoutId = undefined

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return
        if (event === 'PASSWORD_RECOVERY' && session) {
          recoverySeen = true
          if (timeoutId !== undefined) window.clearTimeout(timeoutId)
          setRecoveryReady(true)
          setChecking(false)
        }
      },
    )

    timeoutId = window.setTimeout(() => {
      if (!mounted || recoverySeen) return
      setRecoveryReady(false)
      setChecking(false)
    }, 10000)

    return () => {
      mounted = false
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')

    if (password.length < 8 || confirmPassword.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }

    setSubmitLoading(true)
    const { error } = await updatePassword(password)
    setSubmitLoading(false)
    if (error) {
      setFormError(error.message)
      return
    }

    sessionStorage.setItem('stockiq_toast', 'Password updated')
    navigate('/dashboard', { replace: true })
  }

  const inputClass =
    'w-full rounded-lg border border-border-subtle bg-base px-3.5 py-2.5 text-sm text-[#E2E8F0] placeholder:text-text-muted outline-none ring-blue-accent/40 focus:border-blue-accent focus:ring-2'

  return (
    <>
      <Helmet>
        <title>Reset Password — PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
    <div className="min-h-screen bg-base px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-[420px] flex-col justify-center">
        <div className="w-full rounded-2xl border border-border-subtle bg-surface p-8">
          <p className="text-center text-[20px] font-bold text-blue-accent">
            PineX
          </p>
          <h1 className="mt-2 text-center text-2xl font-bold text-white">
            Set new password
          </h1>

          {checking ? (
            <p className="mt-8 text-center text-sm text-text-muted">
              Verifying your reset link…
            </p>
          ) : !recoveryReady ? (
            <div className="mt-8 space-y-4 text-center text-sm">
              <p className="text-text-muted">
                This reset link is invalid or has expired.
              </p>
              <Link
                to="/forgot-password"
                className="font-medium text-blue-accent underline-offset-2 hover:underline"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
              <div className="relative">
                <label htmlFor="reset-password" className="sr-only">
                  New password
                </label>
                <input
                  id="reset-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  className={`${inputClass} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-text-muted hover:bg-white/5 hover:text-[#E2E8F0]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
              <div>
                <label htmlFor="reset-confirm" className="sr-only">
                  Confirm new password
                </label>
                <input
                  id="reset-confirm"
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className={inputClass}
                />
              </div>
              {formError ? (
                <p
                  className="text-sm text-red-signal"
                  role="alert"
                  aria-live="polite"
                >
                  {formError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={submitLoading}
                className="w-full rounded-lg bg-blue-accent py-3 text-[15px] font-semibold text-[#0c1118] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitLoading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
