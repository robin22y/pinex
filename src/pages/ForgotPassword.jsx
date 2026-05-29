import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { sendPasswordReset } from '../lib/auth'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')
    setLoading(true)
    const { error } = await sendPasswordReset(email.trim())
    setLoading(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setSuccess(true)
  }

  const inputClass =
    'w-full rounded-lg border border-border-subtle bg-base px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-text-muted outline-none ring-blue-accent/40 focus:border-blue-accent focus:ring-2'

  return (
    <>
      <Helmet>
        <title>Forgot Password — PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
    <div className="min-h-screen bg-base px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-[420px] flex-col justify-center">
        <div className="w-full rounded-2xl border border-border-subtle bg-surface p-8">
          <p className="text-center text-[20px] font-bold text-blue-accent">
            PineX
          </p>
          <h1 className="mt-2 text-center text-2xl font-bold text-white">
            Forgot password
          </h1>
          <p className="mt-2 text-center text-sm text-text-muted">
            Enter your email and we&apos;ll send you a reset link.
          </p>

          {success ? (
            <p
              className="mt-8 rounded-lg border border-border-subtle bg-base px-4 py-3 text-center text-sm text-[var(--text-primary)]"
              role="status"
            >
              Reset link sent. Check your email.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
              <div>
                <label htmlFor="forgot-email" className="sr-only">
                  Email
                </label>
                <input
                  id="forgot-email"
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
                disabled={loading}
                className="w-full rounded-lg bg-blue-accent py-3 text-[15px] font-semibold text-[var(--bg-primary)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm">
            <Link
              to="/login"
              className="font-medium text-blue-accent underline-offset-2 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
