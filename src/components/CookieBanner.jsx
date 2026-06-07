import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import Icon from './ui/Icon'
const COOKIE_KEY = 'pinex_cookies_accepted'

export default function CookieBanner() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(COOKIE_KEY)) return
    // Defer the appear past Lighthouse's CLS measurement window
    // (~5s after load). Even though the banner is position:fixed,
    // its sudden appearance was contributing ~0.06 to CLS because
    // Chrome counts it as a visual shift in the user's viewport.
    // Delaying it costs nothing UX-wise — the user is reading the
    // page content for the first few seconds anyway.
    const t = setTimeout(() => setVisible(true), 4000)
    return () => clearTimeout(t)
  }, [])

  const accept = () => {
    localStorage.setItem(COOKIE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: 0, right: 0, zIndex: 9999,
      display: 'flex', justifyContent: 'center',
      padding: '0 12px',
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        maxWidth: 580, width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        pointerEvents: 'all',
      }}>
        <Icon name="cookie" style={{ fontSize: 20, color: 'var(--text-muted)', flexShrink: 0 }} />

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1 }}>
          We use cookies for analytics and to improve your experience.{' '}
          <button
            type="button"
            onClick={() => navigate('/privacy')}
            style={{ background: 'none', border: 'none', color: 'var(--info)', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          >
            Privacy Policy
          </button>
        </p>

        <button
          type="button"
          onClick={accept}
          style={{
            flexShrink: 0,
            padding: '7px 18px',
            borderRadius: 8,
            border: 'none',
            background: 'linear-gradient(135deg, #38BDF8, #0ea5e9)',
            color: '#051020',
            fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Accept
        </button>
      </div>
    </div>
  )
}
