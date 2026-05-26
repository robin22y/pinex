import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/**
 * Unsubscribe — token-based opt-out page reached from the
 * "Unsubscribe" link in every re-engagement email.
 *
 * The email puts a per-user token on the link; this page reads it
 * and flips profiles.email_notifications to false. The user never
 * needs to log in — by design, since they may have forgotten their
 * password and we don't want to add friction to an opt-out.
 */
export default function Unsubscribe() {
  const [params] = useSearchParams()
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setStatus('invalid')
      return
    }
    let cancelled = false

    supabase
      .from('profiles')
      .update({ email_notifications: false })
      .eq('unsubscribe_token', token)
      .select('id')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('[unsubscribe] update failed:', error)
          setStatus('error')
          return
        }
        // No matching row → invalid token. Update with no match
        // returns an empty array, not an error.
        if (!data || data.length === 0) {
          setStatus('invalid')
          return
        }
        setStatus('done')
      })

    return () => { cancelled = true }
  }, [params])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0B0E11',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        {status === 'loading' && (
          <div style={{ color: '#475569', fontSize: 14 }}>
            Processing…
          </div>
        )}

        {status === 'done' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16, color: '#00C805' }} aria-hidden="true">
              ✓
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#E2E8F0',
                marginBottom: 8,
              }}
            >
              Unsubscribed
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#475569',
                lineHeight: 1.6,
                marginBottom: 24,
              }}
            >
              You will no longer receive market update emails from
              PineX. You can re-enable them anytime from your
              profile settings.
            </div>
            <a
              href="/"
              style={{
                color: '#00C805',
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              Back to PineX →
            </a>
          </>
        )}

        {status === 'invalid' && (
          <div style={{ color: '#FF3B30', fontSize: 14 }}>
            Invalid or expired unsubscribe link.
          </div>
        )}

        {status === 'error' && (
          <div style={{ color: '#FBBF24', fontSize: 14, lineHeight: 1.6 }}>
            Something went wrong on our end. Please try the link
            again in a few minutes, or contact{' '}
            <a href="mailto:support@pinex.in" style={{ color: '#00C805' }}>
              support@pinex.in
            </a>
            .
          </div>
        )}
      </div>
    </div>
  )
}
