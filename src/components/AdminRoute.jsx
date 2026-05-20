import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { LoadingSpinner } from './LoadingSpinner'
import { isAdmin } from '../lib/isAdmin'

const SESSION_KEY = 'admin_local_auth'
const DEV_PASSWORD = import.meta.env.VITE_ADMIN_LOCAL_PASSWORD

function LocalAdminGate({ children }) {
  const stored = sessionStorage.getItem(SESSION_KEY)
  const [unlocked, setUnlocked] = useState(stored === DEV_PASSWORD)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  if (unlocked) return children

  function submit(e) {
    e.preventDefault()
    if (input === DEV_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, DEV_PASSWORD)
      setUnlocked(true)
    } else {
      setError('Wrong password.')
      setInput('')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <form onSubmit={submit} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: '2rem', width: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>Local dev — admin access</p>
        <h2 style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, margin: 0 }}>Enter admin password</h2>
        <input
          autoFocus
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          placeholder="Password"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, padding: '8px 12px', outline: 'none' }}
        />
        {error && <p style={{ color: 'var(--negative)', fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" style={{ background: 'var(--info)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: '9px 0' }}>
          Unlock
        </button>
      </form>
    </div>
  )
}

export function AdminRoute({ children }) {
  const { loading, user } = useAuth()

  if (loading) return <LoadingSpinner />

  if (isAdmin(user)) return children

  // Dev-only fallback: password gate (never reached in production without the env var)
  if (import.meta.env.DEV && DEV_PASSWORD) {
    return <LocalAdminGate>{children}</LocalAdminGate>
  }

  return <Navigate to="/" replace />
}
