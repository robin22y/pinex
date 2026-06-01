import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import './index.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './i18n'
import App from './App.jsx'

// ── Defensive: kill any "ghost" service worker + Cache API entries ──
// PineX does not ship a service worker. But users may have one
// registered for our origin from an earlier build (or via a browser
// extension that auto-installs one). When a ghost SW exists, it can
// serve stale HTML/JS and the user thinks "the site is broken" —
// they end up clearing the entire site's cache manually.
//
// This block runs ONCE on every app load and:
//   1. Unregisters any service worker controlling our origin
//   2. Empties the Cache API entries it may have populated
//
// No-op when neither is present (the common case in 2026+).
if (typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => {
        if (regs.length > 0) {
          // eslint-disable-next-line no-console
          console.info(`[pinex] unregistering ${regs.length} stale service worker(s)`)
        }
        regs.forEach((r) => { try { r.unregister() } catch { /* ignore */ } })
      })
      .catch(() => { /* ignore */ })
  }
  if ('caches' in window) {
    caches.keys()
      .then((keys) => {
        keys.forEach((k) => { try { caches.delete(k) } catch { /* ignore */ } })
      })
      .catch(() => { /* ignore */ })
  }
}

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
