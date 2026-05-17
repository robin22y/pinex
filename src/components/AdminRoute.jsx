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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
      <form onSubmit={submit} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '2rem', width: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>Local dev — admin access</p>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, margin: 0 }}>Enter admin password</h2>
        <input
          autoFocus
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          placeholder="Password"
          style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 14, padding: '8px 12px', outline: 'none' }}
        />
        {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" style={{ background: '#3b82f6', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: '9px 0' }}>
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
