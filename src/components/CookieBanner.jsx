import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const COOKIE_KEY = 'pinex_cookies_accepted'

export default function CookieBanner() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(COOKIE_KEY)) setVisible(true)
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
        background: '#0B0F18',
        border: '1px solid #1E2530',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        maxWidth: 580, width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        pointerEvents: 'all',
      }}>
        <i className="ti ti-cookie" style={{ fontSize: 20, color: '#64748B', flexShrink: 0 }} />

        <p style={{ margin: 0, fontSize: 13, color: '#94A3B8', lineHeight: 1.5, flex: 1 }}>
          We use cookies for analytics and to improve your experience.{' '}
          <button
            type="button"
            onClick={() => navigate('/privacy')}
            style={{ background: 'none', border: 'none', color: '#38BDF8', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
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
