import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { submitWaitlist } from '../lib/waitlist'

export default function Landing() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const accessBlocked = searchParams.get('access') === 'blocked'
  const [form, setForm] = useState({ name: '', email: '', howHeard: '' })
  const [status, setStatus] = useState('idle') // idle|loading|success|error
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async () => {
    if (!form.name || !form.email) {
      setErrorMsg('Please enter your name and email')
      return
    }
    if (!form.email.includes('@')) {
      setErrorMsg('Please enter a valid email')
      return
    }
    setStatus('loading')
    setErrorMsg('')

    const { error } = await submitWaitlist({
      name: form.name,
      email: form.email,
      howHeard: form.howHeard,
    })

    if (error) {
      if (error.code === '23505') {
        setErrorMsg('This email is already on the list')
      } else {
        setErrorMsg('Something went wrong. Try again.')
      }
      setStatus('error')
    } else {
      setStatus('success')
    }
  }

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
  }

  const labelStyle = {
    fontSize: 11,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    display: 'block',
    marginBottom: 6,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          Pine<span style={{ color: 'var(--info)' }}>X</span>
        </div>
        <button
          onClick={() => navigate('/login')}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' }}
        >
          Sign in
        </button>
      </nav>

      {/* Hero */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', maxWidth: 520, margin: '0 auto', width: '100%' }}>

        {accessBlocked && (
          <div style={{ width: '100%', padding: '12px 16px', borderRadius: 10, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', color: 'var(--negative)', fontSize: 14, marginBottom: 20, textAlign: 'center' }}>
            Your Google account isn't on the invite list. Request access below.
          </div>
        )}

        {status === 'success' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              You're on the list
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7, maxWidth: 360, margin: '0 auto' }}>
              We'll email you when your access is ready. PineX is free during beta.
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
              Private Beta
            </div>

            <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center', lineHeight: 1.2, marginBottom: 12, letterSpacing: '-0.02em' }}>
              Most traders ignore stage.
              <br />
              <span style={{ color: 'var(--info)' }}>You won't.</span>
            </h1>

            <p style={{ fontSize: 15, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.65, marginBottom: 32, maxWidth: 400 }}>
              Stage Analysis for 2,100+ NSE stocks. Weinstein method. EOD data. Currently in private beta.
            </p>

            {/* Waitlist form */}
            <div style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
                Request early access
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Your name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Rahul Sharma"
                  style={inputStyle}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Email address</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="rahul@example.com"
                  style={inputStyle}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>How did you hear about us?</label>
                <select
                  value={form.howHeard}
                  onChange={e => setForm(f => ({ ...f, howHeard: e.target.value }))}
                  style={{ ...inputStyle, color: form.howHeard ? 'var(--text-primary)' : 'var(--text-hint)', cursor: 'pointer' }}
                >
                  <option value="">Select an option</option>
                  <option value="twitter">Twitter / X</option>
                  <option value="telegram">Telegram</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="friend">Friend / colleague</option>
                  <option value="youtube">YouTube</option>
                  <option value="google">Google search</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {errorMsg && (
                <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--negative-dim)', color: 'var(--negative)', fontSize: 12 }}>
                  {errorMsg}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={status === 'loading'}
                style={{ width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: 'var(--info)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: status === 'loading' ? 'wait' : 'pointer', opacity: status === 'loading' ? 0.7 : 1 }}
              >
                {status === 'loading' ? 'Submitting...' : 'Request early access →'}
              </button>

              <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11, color: 'var(--text-disabled)' }}>
                Already have access?{' '}
                <button
                  onClick={() => navigate('/login')}
                  style={{ background: 'none', border: 'none', color: 'var(--info)', cursor: 'pointer', fontSize: 11, padding: 0 }}
                >
                  Sign in
                </button>
              </div>
            </div>

            {/* Trust signals */}
            <div style={{ marginTop: 24, display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
              {['EOD data · NSE', 'Weinstein Stage Analysis', 'Not investment advice'].map(t => (
                <div key={t} style={{ fontSize: 11, color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: 'var(--info)' }}>·</span>
                  {t}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: 10, color: 'var(--text-disabled)' }}>
        Educational data only. Not investment advice. Not SEBI registered.
      </div>
    </div>
  )
}
