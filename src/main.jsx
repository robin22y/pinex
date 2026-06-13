import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import posthog from 'posthog-js'
import './index.css'
// Tabler icon webfont removed (was 829 KB woff2 blocking LCP). Replaced
// with lucide-react SVG icons via <Icon name="..." />; see components/ui/Icon.jsx.
import './i18n'
import App from './App.jsx'

// PostHog (EU region) — only initialised when VITE_POSTHOG_KEY is set so
// dev / preview deploys without the key are a clean no-op. person_profiles
// 'identified_only' keeps anonymous traffic out of person tables (GDPR
// friendlier + cheaper). Identify happens in AuthContext on session
// resolve; reset on logout.
if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: 'https://eu.i.posthog.com',
    // Snapshot-pinned defaults — locks the SDK's default behaviours to
    // the May 2026 release so future posthog-js updates can't change
    // capture semantics under us. Recommended by PostHog's setup wizard.
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  })
}

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
// Reload once to pick up the new index.html and fresh chunk URLs.
window.addEventListener('error', (e) => {
  const msg = e?.message || ''
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Unable to preload CSS')
  ) {
    const reloaded = sessionStorage.getItem('chunk_reload')
    if (!reloaded) {
      sessionStorage.setItem('chunk_reload', '1')
      window.location.reload()
    }
  }
}, true)

// Page restored from back-forward cache — session may be stale, force reload.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>,
)
