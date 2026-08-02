/**
 * ThemeToggle.jsx
 *
 * Switches between dark and sepia-dim modes.
 *
 * First visit follows the OS (prefers-color-scheme); after that the
 * user's own choice is remembered. See the bootstrap in index.html —
 * it resolves the theme before first paint and this component reads
 * the result off <html data-theme>.
 * Add to the topbar of Home.jsx and other pages.
 *
 * Usage:
 *   import ThemeToggle from './ThemeToggle'
 *   <ThemeToggle />
 *
 * The toggle reads/writes to localStorage
 * so theme persists across sessions.
 *
 * For FOUC prevention, add this to
 * index.html <head> BEFORE the CSS link:
 *
 *   <script>
 *     (function() {
 *       try {
 *         var t = localStorage
 *           .getItem('pinex-theme')
 *         if (t === 'sepia')
 *           document.documentElement
 *             .setAttribute('data-theme','sepia')
 *       } catch(e) {}
 *     })()
 *   </script>
 */

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'pinex-theme'

/**
 * Put the resolved theme on <html>. Single writer, so the attribute and
 * the React state can never disagree about what "sepia" means.
 */
function applyThemeAttribute(theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'sepia') root.setAttribute('data-theme', 'sepia')
  else root.removeAttribute('data-theme')
}

export default function ThemeToggle() {
  // Seed from the attribute the index.html bootstrap already resolved,
  // NOT from localStorage. The bootstrap knows about the OS preference;
  // localStorage on its own does not, and reading it here re-introduced
  // the sepia default one render after the bootstrap had correctly
  // chosen dark.
  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return 'sepia'
    return document.documentElement.getAttribute('data-theme') === 'sepia'
      ? 'sepia'
      : 'dark'
  })

  // Sync with document attribute. Deliberately does NOT write
  // localStorage — that would stamp the OS-derived default as an
  // explicit choice on first paint and permanently stop the app
  // following the device. Only `toggle` persists.
  useEffect(() => {
    applyThemeAttribute(theme)
  }, [theme])

  // Follow the OS while the user has expressed no preference of their
  // own. Once they touch the toggle, this stops applying.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onOSChange = () => {
      let stored = null
      try { stored = localStorage.getItem(STORAGE_KEY) } catch { /* ignore */ }
      if (stored === 'dark' || stored === 'sepia') return
      setTheme(mq.matches ? 'dark' : 'sepia')
    }
    mq.addEventListener?.('change', onOSChange)
    return () => mq.removeEventListener?.('change', onOSChange)
  }, [])

  // Stay in sync when another surface toggles the theme (Account and
  // Dashboard each host their own switch).
  //
  // This listener is why `toggle` has to write the attribute itself.
  // The event dispatch is synchronous, so it runs BEFORE React has
  // flushed the state update and before the [theme] effect above has
  // touched the DOM. If the attribute were still stale at that moment,
  // this handler would read the OLD value and setTheme back to it —
  // React batches both updates, the later one wins, and the toggle
  // silently reverts. That is exactly what happened: localStorage
  // flipped to 'dark' while data-theme stayed 'sepia', so the button
  // looked dead.
  useEffect(() => {
    const handleExternalChange = () => {
      const current = document.documentElement.getAttribute('data-theme')
      setTheme(current === 'sepia' ? 'sepia' : 'dark')
    }
    window.addEventListener('pinex-theme-change', handleExternalChange)
    return () => window.removeEventListener('pinex-theme-change', handleExternalChange)
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'sepia' : 'dark'

    // ORDER IS LOAD-BEARING — see the note on handleExternalChange.
    // The attribute must be on the document BEFORE the event fires,
    // because every listener (including this component's own) resolves
    // the new theme by reading it back off the DOM.
    applyThemeAttribute(next)
    setTheme(next)

    // An explicit click is the only thing that persists a choice, and
    // the only thing that stops the OS listener above.
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    // Account and Dashboard host their own toggles and listen for this.
    try { window.dispatchEvent(new Event('pinex-theme-change')) } catch { /* ignore */ }
  }

  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      title={isDark
        ? 'Switch to Sepia-Dim mode'
        : 'Switch to Dark mode'}
      aria-label={isDark
        ? 'Switch to Sepia-Dim mode'
        : 'Switch to Dark mode'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 20,
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
        flexShrink: 0,
        transition: 'var(--transition-fast)',
        userSelect: 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor
          = 'var(--border-hover)'
        e.currentTarget.style.color
          = 'var(--text-secondary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor
          = 'var(--border)'
        e.currentTarget.style.color
          = 'var(--text-muted)'
      }}
    >
      {/* Icon */}
      <span style={{fontSize: 13}}>
        {isDark ? '☀️' : '🌙'}
      </span>

      {/* Label — hide on small screens */}
      <span className="hidden md:inline">
        {isDark ? 'Sepia' : 'Dark'}
      </span>

      {/* Toggle pill */}
      <div style={{
        width: 28,
        height: 16,
        borderRadius: 8,
        background: isDark
          ? 'var(--border-strong)'
          : 'var(--accent)',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute',
          top: 2,
          left: isDark ? 2 : 14,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        }}/>
      </div>
    </button>
  )
}
