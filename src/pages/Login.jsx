import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithEmail, signInWithGoogle } from '../lib/auth'
import PineXMark from '../components/PineXMark'

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

const FEATURES = [
  { icon: 'ti-chart-bar', label: 'RS Score ranking across 1500+ stocks' },
  { icon: 'ti-truck-delivery', label: 'Delivery % signals & 30-day trends' },
  { icon: 'ti-brain', label: 'AI pulse â€” bullish / bearish / neutral' },
  { icon: 'ti-layers-intersect', label: 'Stage-based breakout detection' },
]

export default function Login() {
  const navigate = useNavigate()
  // ?hint=existing is set by:
  //   • Register.jsx when Supabase rejects an "already registered"
  //     signup attempt
  //   • Landing.jsx when the waitlist form catches an email that
  //     already has a profile row
  //   • StockDetail's "Add to Watchlist" button when called by a
  //     logged-out user
  // We greet the visitor with a friendly "Welcome back" banner
  // instead of dumping them on a blank login page.
  const [searchParams] = useSearchParams()
  const isExisting = searchParams.get('hint') === 'existing'
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
    if (error) setFormError(error.message)
  }

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setFormError('')
    setEmailLoading(true)
    const { error } = await signInWithEmail(email.trim(), password)
    setEmailLoading(false)
    if (error) { setFormError(error.message); return }
    navigate('/dashboard', { replace: true })
  }

  const busy = googleLoading || emailLoading

  return (
    <>
      <Helmet>
        <title>Sign In — PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex' }}>

      {/* â”€â”€ Left brand panel (desktop only) â”€â”€ */}
      <div className="auth-left-panel" style={{
        width: 480, flexShrink: 0,
        flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
        borderRight: '1px solid var(--border)',
      }}>
        {/* Glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 60% 50% at 20% 60%, var(--info-dim) 0%, transparent 70%)',
        }} />
        {/* Dot grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', padding: '48px 48px 40px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'var(--info)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="ti ti-activity" style={{ fontSize: 20, color: 'var(--bg-primary)' }} />
            </div>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}><PineXMark /></span>
          </div>

          {/* Hero copy */}
          <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--info)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }}>
              Institutional edge
            </p>
            <h2 style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2, margin: '0 0 16px', letterSpacing: '-0.02em' }}>
              Smart analysis for<br />Indian markets
            </h2>
            <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 40px', lineHeight: 1.6 }}>
              Everything you need to find high-quality breakout candidates before the crowd.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {FEATURES.map(f => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                    background: 'var(--info-dim)', border: '1px solid var(--info-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <i className={`ti ${f.icon}`} style={{ fontSize: 17, color: 'var(--info)' }} />
                  </div>
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-disabled)', margin: 0 }}>
            Â© 2025 PineX Â· For educational purposes only
          </p>
        </div>
      </div>

      {/* â”€â”€ Right form panel â”€â”€ */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Mobile logo */}
          <div className="auth-mobile-logo" style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: 'var(--info)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <i className="ti ti-activity" style={{ fontSize: 18, color: 'var(--bg-primary)' }} />
              </div>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}><PineXMark /></span>
            </div>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
              Welcome back
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
              Sign in to your account
            </p>
          </div>

          {/* "You already have an account" hint — fired by any
              caller that detected the visitor is an existing
              user (registration retry, waitlist re-submit, etc.). */}
          {isExisting && (
            <div
              role="status"
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(0,200,5,0.08)',
                border: '1px solid rgba(0,200,5,0.2)',
                fontSize: 13,
                color: 'var(--text-primary)',
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2, color: '#00C805' }}>
                Welcome back 👋
              </div>
              You already have a PineX account. Sign in below with your email
              and password — or use Google if that&apos;s how you registered.
            </div>
          )}

          {/* Google */}
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={busy}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 10, padding: '12px 0',
              background: '#fff', border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 600, color: '#111827',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              boxShadow: '0 1px 3px rgba(0,0,0,0.15), 0 6px 20px rgba(0,0,0,0.20)',
              transition: 'opacity 0.15s, box-shadow 0.15s',
              marginBottom: 24,
            }}
          >
            <GoogleLogo />
            {googleLoading ? 'Redirectingâ€¦' : 'Continue with Google'}
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-hint)', letterSpacing: '0.05em' }}>OR</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleEmailSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Email */}
            <div style={{ position: 'relative' }}>
              <i className="ti ti-mail" style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: 16, color: 'var(--text-hint)', pointerEvents: 'none',
              }} />
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 14px 12px 40px',
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 10, fontSize: 14, color: 'var(--text-primary)',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--info)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
              />
            </div>

            {/* Password */}
            <div style={{ position: 'relative' }}>
              <i className="ti ti-lock" style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: 16, color: 'var(--text-hint)', pointerEvents: 'none',
              }} />
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 44px 12px 40px',
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 10, fontSize: 14, color: 'var(--text-primary)',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--info)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-hint)', padding: 4, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'}`} style={{ fontSize: 17 }} />
              </button>
            </div>

            {formError && (
              <div style={{
                padding: '10px 14px', background: 'var(--negative-dim)',
                border: '1px solid var(--negative-dim)', borderRadius: 8,
                fontSize: 13, color: 'var(--negative-soft)',
              }} role="alert">
                {formError}
              </div>
            )}

            {/* Forgot password */}
            <div style={{ textAlign: 'right', marginTop: -6 }}>
              <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--info)', textDecoration: 'none' }}>
                Forgot password?
              </Link>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              style={{
                width: '100%', padding: '13px 0',
                background: busy ? 'var(--info-dim)' : 'var(--info)',
                border: 'none', borderRadius: 10,
                fontSize: 15, fontWeight: 700, color: 'var(--bg-primary)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
                transition: 'opacity 0.15s',
                letterSpacing: '-0.01em',
              }}
            >
              {emailLoading ? 'Signing inâ€¦' : 'Sign in'}
            </button>
          </form>

          {/* Sign up link — open access now; routes straight to
              /register. Previous copy was "Request access" → "/"
              from the invite-only era, which now bounces to /home
              and leaves users with no path to create an account. */}
          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 0 }}>
            Don't have an account?{' '}
            <Link to="/register" style={{ color: 'var(--info)', fontWeight: 600, textDecoration: 'none' }}>
              Create account
            </Link>
          </p>
        </div>
      </div>

      <style>{`
        .auth-left-panel { display: none; }
        .auth-mobile-logo { display: block; }
        @media (min-width: 1024px) {
          .auth-left-panel { display: flex; }
          .auth-mobile-logo { display: none; }
        }
      `}</style>
    </div>
    </>
  )
}
