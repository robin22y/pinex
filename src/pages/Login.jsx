import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmail, signInWithGoogle } from '../lib/auth'

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
    <div style={{ minHeight: '100vh', background: '#080C14', display: 'flex' }}>

      {/* â”€â”€ Left brand panel (desktop only) â”€â”€ */}
      <div className="auth-left-panel" style={{
        width: 480, flexShrink: 0,
        flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
        borderRight: '1px solid #1E293B',
      }}>
        {/* Glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 60% 50% at 20% 60%, rgba(56,189,248,0.10) 0%, transparent 70%)',
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
              background: 'linear-gradient(135deg, #38BDF8 0%, #0ea5e9 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="ti ti-activity" style={{ fontSize: 20, color: '#06101c' }} />
            </div>
            <span style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>PineX</span>
          </div>

          {/* Hero copy */}
          <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#38BDF8', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }}>
              Institutional edge
            </p>
            <h2 style={{ fontSize: 34, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.2, margin: '0 0 16px', letterSpacing: '-0.02em' }}>
              Smart analysis for<br />Indian markets
            </h2>
            <p style={{ fontSize: 15, color: '#64748B', margin: '0 0 40px', lineHeight: 1.6 }}>
              Everything you need to find high-quality breakout candidates before the crowd.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {FEATURES.map(f => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                    background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <i className={`ti ${f.icon}`} style={{ fontSize: 17, color: '#38BDF8' }} />
                  </div>
                  <span style={{ fontSize: 14, color: '#94A3B8', lineHeight: 1.4 }}>{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 12, color: '#334155', margin: 0 }}>
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
                background: 'linear-gradient(135deg, #38BDF8 0%, #0ea5e9 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <i className="ti ti-activity" style={{ fontSize: 18, color: '#06101c' }} />
              </div>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>PineX</span>
            </div>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
              Welcome back
            </h1>
            <p style={{ fontSize: 14, color: '#64748B', margin: 0 }}>
              Sign in to your account
            </p>
          </div>

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
            <div style={{ flex: 1, height: 1, background: '#1E293B' }} />
            <span style={{ fontSize: 12, color: '#475569', letterSpacing: '0.05em' }}>OR</span>
            <div style={{ flex: 1, height: 1, background: '#1E293B' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleEmailSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Email */}
            <div style={{ position: 'relative' }}>
              <i className="ti ti-mail" style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: 16, color: '#475569', pointerEvents: 'none',
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
                  background: '#0D1525', border: '1px solid #1E293B',
                  borderRadius: 10, fontSize: 14, color: '#E2E8F0',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = '#38BDF8' }}
                onBlur={e => { e.target.style.borderColor = '#1E293B' }}
              />
            </div>

            {/* Password */}
            <div style={{ position: 'relative' }}>
              <i className="ti ti-lock" style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: 16, color: '#475569', pointerEvents: 'none',
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
                  background: '#0D1525', border: '1px solid #1E293B',
                  borderRadius: 10, fontSize: 14, color: '#E2E8F0',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = '#38BDF8' }}
                onBlur={e => { e.target.style.borderColor = '#1E293B' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#475569', padding: 4, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'}`} style={{ fontSize: 17 }} />
              </button>
            </div>

            {formError && (
              <div style={{
                padding: '10px 14px', background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8,
                fontSize: 13, color: '#F87171',
              }} role="alert">
                {formError}
              </div>
            )}

            {/* Forgot password */}
            <div style={{ textAlign: 'right', marginTop: -6 }}>
              <Link to="/forgot-password" style={{ fontSize: 13, color: '#38BDF8', textDecoration: 'none' }}>
                Forgot password?
              </Link>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              style={{
                width: '100%', padding: '13px 0',
                background: busy ? '#1e3a52' : 'linear-gradient(135deg, #38BDF8 0%, #0ea5e9 100%)',
                border: 'none', borderRadius: 10,
                fontSize: 15, fontWeight: 700, color: '#051020',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
                transition: 'opacity 0.15s',
                letterSpacing: '-0.01em',
              }}
            >
              {emailLoading ? 'Signing inâ€¦' : 'Sign in'}
            </button>
          </form>

          {/* Sign up link */}
          <p style={{ textAlign: 'center', fontSize: 14, color: '#64748B', marginTop: 24, marginBottom: 0 }}>
            Don't have an account?{' '}
            <Link to="/register" style={{ color: '#38BDF8', fontWeight: 600, textDecoration: 'none' }}>
              Create one free
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
