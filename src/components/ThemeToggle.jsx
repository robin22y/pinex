/**
 * ThemeToggle.jsx
 *
 * Switches between dark and sepia-dim modes.
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

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    // Read from localStorage on init
    // Avoids flicker on mount.
    // Default flipped from 'dark' to 'sepia' — sepia is now the
    // first-time-visitor view. Existing users keep whatever they
    // already had in localStorage.
    try {
      return localStorage.getItem(STORAGE_KEY)
        || 'sepia'
    } catch {
      return 'sepia'
    }
  })

  // Sync with document attribute
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'sepia') {
      root.setAttribute('data-theme', 'sepia')
    } else {
      root.removeAttribute('data-theme')
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch { /* ignore */ }
  }, [theme])

  // Stay in sync when mobile bottom nav toggles theme
  useEffect(() => {
    const handleExternalChange = () => {
      const current = document.documentElement.getAttribute('data-theme')
      setTheme(current === 'sepia' ? 'sepia' : 'dark')
    }
    window.addEventListener('pinex-theme-change', handleExternalChange)
    return () => window.removeEventListener('pinex-theme-change', handleExternalChange)
  }, [])

  const toggle = () => {
    setTheme(t => t === 'dark'
      ? 'sepia' : 'dark')
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
