import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import './index.css'
// Tabler icon webfont removed (was 829 KB woff2 blocking LCP). Replaced
// with lucide-react SVG icons via <Icon name="..." />; see components/ui/Icon.jsx.
import './i18n'
import App from './App.jsx'
import { startPosthog } from './lib/posthog'

// ── Production console warning — anti-social-engineering nudge ─────────
// A common scam pattern targets retail-trading platforms: an attacker
// claiming to be "PineX support" tells a user to paste a snippet into
// DevTools. The snippet then siphons their auth token or runs a
// supabase.from('profiles').update({ plan: 'paid' }) attempt.
//
// Server-side RLS + column-level REVOKEs (security_protect_user_fields.sql
// + security_restrict_points_transactions_insert.sql) already block the
// actual exploits — this banner is the discoverable warning that tells
// the user they're being attacked BEFORE they paste. Dev builds skip it
// so the console stays usable during local work.
if (typeof window !== 'undefined' && import.meta.env.PROD) {
  // Wrapped in setTimeout so the banner sits at the BOTTOM of the
  // console — visible the moment a user opens DevTools, not buried
  // under React's lifecycle noise.
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.log(
      '%c⚠️ Stop!',
      'color: #F59E0B; font-size: 48px; font-weight: bold;',
    )
    // eslint-disable-next-line no-console
    console.log(
      '%cThis console is for developers.\n\n' +
      'If someone told you to run commands here — that is a social ' +
      'engineering attack. PineX data is protected by server-side ' +
      'security that cannot be bypassed from this console.\n\n' +
      'Real PineX support will NEVER ask you to run code here.',
      'color: #E2E8F0; font-size: 14px; line-height: 1.6;',
    )
  }, 100)
}

// PWA service worker is managed by vite-plugin-pwa (autoUpdate)

// Lazy chunk failed to load after a new deploy — old hashed filenames are gone.
// Route-level dynamic imports often fail as `unhandledrejection` rather than a
// plain window `error`, so we listen to all three surfaces and reload once to
// pick up the fresh index.html + new chunk URLs.
function isChunkLoadFailure(message) {
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('Unable to preload CSS') ||
    message.includes('Loading chunk') ||
    message.includes('ChunkLoadError') ||
    message.includes('Failed to fetch dynamically')
  )
}

function reloadForChunkFailure() {
  const reloaded = sessionStorage.getItem('chunk_reload')
  if (reloaded) return
  sessionStorage.setItem('chunk_reload', '1')
  window.location.reload()
}

window.addEventListener('error', (e) => {
  const msg = String(e?.message || '')
  if (isChunkLoadFailure(msg)) reloadForChunkFailure()
}, true)

window.addEventListener('unhandledrejection', (e) => {
  const reason = e?.reason
  const msg = String(reason?.message || reason || '')
  if (isChunkLoadFailure(msg)) reloadForChunkFailure()
})

window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault?.()
  reloadForChunkFailure()
})

// Back-forward cache restore — instant for short Back/Forward jumps
// (the whole point of bfcache), only force a reload when the page sat
// hidden long enough for the Supabase session to potentially have
// expired. Previously this was unconditional, which re-downloaded the
// full bundle on every Back/Forward and made in-session navigation feel
// much slower than it should.
let pageHiddenAt = null
window.addEventListener('pagehide', () => {
  pageHiddenAt = Date.now()
})
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return
  const STALE_AFTER_MS = 30 * 60 * 1000
  if (pageHiddenAt && Date.now() - pageHiddenAt > STALE_AFTER_MS) {
    window.location.reload()
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>,
)

// Analytics SDK loads AFTER first paint so it doesn't compete with the
// app for parse time. PostHog auto-captures the initial pageview once
// init resolves, so we still get a pageview for this load — just not
// blocking the render. Falls back to setTimeout on browsers without
// requestIdleCallback (older Safari).
const schedulePosthog = window.requestIdleCallback ||
  ((cb) => setTimeout(cb, 200))
schedulePosthog(() => {
  startPosthog()
})
