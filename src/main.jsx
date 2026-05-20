import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import './index.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './i18n'
import App from './App.jsx'

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
