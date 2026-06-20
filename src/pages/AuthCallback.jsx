/**
 * AuthCallback — landing page Supabase redirects to after OAuth / email
 * confirm. Reads the session that Supabase parsed from the URL hash,
 * and forwards to /home on success or /login?error=auth_failed on miss.
 *
 * Why a dedicated page (vs. landing on /dashboard which used to work):
 *   Supabase Dashboard's redirect-URL allowlist is the safest place
 *   to enumerate exact callback paths. A single, well-known
 *   /auth/callback URL is easier to lock down in the dashboard than
 *   "any in-app route". The page itself is intentionally tiny.
 *
 * Important: supabase-js handles the OAuth code/hash exchange
 * automatically as soon as the supabase client mounts. We just wait
 * for the session to materialize. detectSessionInUrl is on by default
 * in supabase-js v2.
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    // Warm the Home chunk in parallel with session resolution. Home is a
    // lazy route (App.jsx) and is the success destination, so without
    // this hint React Router fetches the Home chunk only AFTER navigate
    // fires — adding one more sequential round-trip to the post-login
    // path. Firing-and-forgetting import() puts the chunk in flight now;
    // it's typically cached well before getSession resolves.
    import('./Home').catch(() => {})

    let cancelled = false
    ;(async () => {
      // First check whatever the client already loaded.
      let { data: { session } } = await supabase.auth.getSession()

      // If the hash carries an access_token but the session hasn't
      // materialised yet (race on the initial mount), wait one tick
      // for SIGNED_IN before giving up. supabase-js parses the URL hash
      // synchronously on client init so by the time React mounts this
      // page the session is normally already set — the race only fires
      // in edge cases. 2 s is a generous hard cap (was 4 s, which felt
      // like a hang on the happy path when anything below caused a
      // brief delay).
      if (!session && typeof window !== 'undefined' && /access_token=/.test(window.location.hash)) {
        await new Promise((resolve) => {
          const sub = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN') {
              sub.data.subscription.unsubscribe()
              resolve()
            }
          })
          setTimeout(() => {
            sub.data.subscription.unsubscribe()
            resolve()
          }, 2000)
        })
        const r = await supabase.auth.getSession()
        session = r.data.session
      }

      if (cancelled) return
      if (session) navigate('/home', { replace: true })
      else navigate('/login?error=auth_failed', { replace: true })
    })()
    return () => { cancelled = true }
  }, [navigate])

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontSize: 14,
      letterSpacing: '0.01em',
    }}>
      Signing you in…
    </div>
  )
}
