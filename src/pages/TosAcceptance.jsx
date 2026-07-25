import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TosAcceptance({ user, onAccepted }) {
  const [loading, setLoading] = useState(false)

  const handleAccept = async () => {
    setLoading(true)
    await supabase
      .from('profiles')
      .update({
        tos_accepted: true,
        tos_accepted_at: new Date().toISOString(),
      })
      .eq('id', user.id)
    setLoading(false)
    onAccepted()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 440, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 32 }}>

        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Before you continue
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
          PineX provides technical analysis data for educational purposes. Please confirm you understand:
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
          {[
            'All data is end-of-day (EOD)',
            'Nothing on PineX is investment advice',
            'PineX is not SEBI registered',
            'Data is for educational purposes only',
            'I will not redistribute this data',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: 'var(--positive)', fontSize: 14, marginTop: 1, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleAccept}
          disabled={loading}
          style={{ width: '100%', padding: '13px', borderRadius: 8, border: 'none', background: 'var(--info)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Saving...' : 'I understand — continue'}
        </button>

        <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-disabled)', textAlign: 'center', lineHeight: 1.6 }}>
          By continuing you agree to our{' '}
          <a href="/terms" style={{ color: 'var(--info)', textDecoration: 'none' }}>Terms</a>
          {' '}and{' '}
          <a href="/privacy" style={{ color: 'var(--info)', textDecoration: 'none' }}>Privacy Policy</a>
        </div>
      </div>
    </div>
  )
}
