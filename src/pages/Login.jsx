import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmail, signInWithGoogle } from '../lib/auth'

function GoogleLogo({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

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

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)

  async function handleGoogleClick() {
    setFormError('')
    setGoogleLoading(true)
    const { error } = await signInWithGoogle()
    setGoogleLoading(false)
    if (error) {
      setFormError(error.message)
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setFormError('')
    setEmailLoading(true)
    const { error } = await signInWithEmail(email.trim(), password)
    setEmailLoading(false)
    if (error) {
      setFormError(error.message)
      return
    }
    navigate('/dashboard', { replace: true })
  }

  const inputClass =
    'w-full rounded-lg border border-border-subtle bg-base px-3.5 py-2.5 text-sm text-[#E2E8F0] placeholder:text-text-muted outline-none ring-blue-accent/40 focus:border-blue-accent focus:ring-2'

  return (
    <div className="min-h-screen bg-base px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-[420px] flex-col justify-center">
        <div className="w-full rounded-2xl border border-border-subtle bg-surface p-8">
          <p className="text-center text-[20px] font-bold text-blue-accent">
            PineX
          </p>
          <h1 className="mt-2 text-center text-2xl font-bold text-white">
            Welcome back
          </h1>

          <div className="mt-8">
            <button
              type="button"
              onClick={handleGoogleClick}
              disabled={googleLoading || emailLoading}
              className="flex w-full items-center justify-center gap-3 rounded-[10px] bg-white py-3.5 text-[15px] font-semibold text-[#0f172a] shadow-[0_1px_2px_rgba(0,0,0,0.12),0_4px_14px_rgba(0,0,0,0.18)] transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <GoogleLogo className="shrink-0" />
              {googleLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>
          </div>

          <div className="my-8 flex items-center gap-3">
            <div className="h-px flex-1 bg-border-subtle" />
            <span className="text-sm text-text-muted">or</span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-email" className="sr-only">
                Email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className={inputClass}
              />
            </div>
            <div className="relative">
              <label htmlFor="login-password" className="sr-only">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
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
              disabled={emailLoading || googleLoading}
              className="w-full rounded-lg bg-blue-accent py-3 text-[15px] font-semibold text-[#0c1118] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {emailLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-3 text-center text-sm">
            <Link
              to="/forgot-password"
              className="text-blue-accent underline-offset-2 hover:underline"
            >
              Forgot password?
            </Link>
            <p className="text-text-muted">
              New here?{' '}
              <Link
                to="/register"
                className="font-medium text-blue-accent underline-offset-2 hover:underline"
              >
                Create account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
