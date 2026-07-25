import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { validateInviteCode } from '../lib/invites'
import { supabase } from '../lib/supabase'

export default function InviteAccept() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [inviter, setInviter] = useState(null)
  const [validating, setValidating] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [form, setForm] = useState({ name: '', email: '' })
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    validateInviteCode(code).then(({ valid, inviter }) => {
      if (valid) {
        setInviter(inviter)
      } else {
        setInvalid(true)
      }
      setValidating(false)
    })
  }, [code])

  const handleJoin = async () => {
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

    try {
      const { error: invErr } = await supabase
        .from('invites')
        .insert({
          inviter_id: inviter.id,
          inviter_code: code,
          invitee_email: form.email.trim().toLowerCase(),
          invitee_name: form.name.trim(),
          status: 'pending',
        })

      if (invErr && invErr.code !== '23505') throw invErr

      await supabase
        .from('profiles')
        .update({ invite_credits: Math.max(0, inviter.invite_credits - 1) })
        .eq('id', inviter.id)

      const res = await fetch('/.netlify/functions/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          name: form.name.trim(),
          inviteCode: code,
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed')

      setStatus('success')
    } catch (err) {
      setErrorMsg(err.message || 'Something went wrong')
      setStatus('error')
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontSize: 13, outline: 'none',
  }

  const labelStyle = {
    fontSize: 11, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    display: 'block', marginBottom: 6,
  }

  if (validating) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        Validating invite...
      </div>
    )
  }

  if (invalid) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 48 }}>❌</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginTop: 16, marginBottom: 8 }}>
            Invalid invite link
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
            This link may have expired or has no credits remaining.
          </div>
          <button
            onClick={() => navigate('/')}
            style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13 }}
          >
            Join waitlist instead →
          </button>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginTop: 16, marginBottom: 8 }}>
            Check your email
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            We've sent an invite to{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{form.email}</strong>.
            <br />
            Click the link in the email to activate your account.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Invited by */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
            You've been invited by
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
            {inviter?.full_name || 'a PineX member'}
          </div>
          <div style={{ marginTop: 12, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Pine<span style={{ color: 'var(--accent)' }}>X</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Stage Analysis · 2,100+ NSE stocks
          </div>
        </div>

        {/* Form */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
            Create your account
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

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Email address</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="rahul@example.com"
              style={inputStyle}
            />
          </div>

          {errorMsg && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--negative-dim)', color: 'var(--negative)', fontSize: 12 }}>
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={status === 'loading'}
            style={{
              width: '100%', padding: 12, borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: '#000',
              fontSize: 14, fontWeight: 700,
              cursor: status === 'loading' ? 'wait' : 'pointer',
              opacity: status === 'loading' ? 0.7 : 1,
            }}
          >
            {status === 'loading' ? 'Setting up...' : 'Join PineX →'}
          </button>

          <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-disabled)', textAlign: 'center' }}>
            By joining you agree to our Terms. Educational data only. Not investment advice.
          </div>
        </div>
      </div>
    </div>
  )
}
