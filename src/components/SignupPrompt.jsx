// ── SignupPrompt ────────────────────────────────────────────────────────────
// Soft-gate signup prompt for anonymous visitors. Bottom-sheet modal that
// surfaces whenever a logged-out user tries an action that requires an
// account (search, click a stock row, click a sector tile, hit a protected
// route, etc.).
//
// Architecture: Context-based so any component in the tree can call
// `useSignupPrompt().requireAuth()` without prop-drilling. Returns:
//   - true  → user is logged in, caller can proceed
//   - false → user is anonymous, the prompt was opened, caller should bail
//
// Dismissal: × button closes the sheet for now. The next interaction (next
// click/search) re-opens it — i.e. "Dismissible with X but re-appears on
// next interaction attempt" per the spec.

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context'

const Ctx = createContext(null)

export function SignupPromptProvider({ children }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  // Whenever the user signs in, close any pending sheet — they don't need
  // the nudge any more.
  useEffect(() => {
    if (user) setOpen(false)
  }, [user])

  const requireAuth = useCallback(() => {
    if (user) return true
    setOpen(true)
    return false
  }, [user])

  const openPrompt = useCallback(() => {
    if (!user) setOpen(true)
  }, [user])

  const close = useCallback(() => setOpen(false), [])

  return (
    <Ctx.Provider value={{ requireAuth, open: openPrompt, close, isOpen: open }}>
      {children}
      {open && !user && <SignupModal onClose={close} />}
    </Ctx.Provider>
  )
}

// Safe to call when not wrapped in provider — returns a no-op shape so
// optional callers never crash (e.g. during SSR / story-book renders).
export function useSignupPrompt() {
  const ctx = useContext(Ctx)
  return ctx || {
    requireAuth: () => true,
    open: () => {},
    close: () => {},
    isOpen: false,
  }
}

// ─── Modal UI ───────────────────────────────────────────────────────────────

function SignupModal({ onClose }) {
  const { pathname, search } = useLocation()
  // Preserve where the user was when they signed up — Register reads
  // ?next from query string to redirect back after a successful signup.
  const nextPath = encodeURIComponent(pathname + (search || ''))
  const [mounted, setMounted] = useState(false)

  // Slide-up animation on mount (matches AcademyRequired's pattern).
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      {/* Backdrop — semi-opaque so the page underneath is dimmed but not
          fully hidden. Click anywhere outside the sheet to dismiss. */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          zIndex: 950,
        }}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign up to PineX"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 951,
          background: '#141820',
          borderRadius: '16px 16px 0 0',
          borderTop: '1px solid #1E2530',
          padding: '20px 20px 28px',
          transform: mounted ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.32s cubic-bezier(0.34, 1.4, 0.64, 1)',
          maxWidth: 480,
          margin: '0 auto',
          color: '#E2E8F0',
          // Safe-area inset for iOS home-bar
          paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
        }}
      >
        {/* × dismiss */}
        <button
          onClick={onClose}
          aria-label="Dismiss"
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            background: 'none',
            border: 'none',
            color: '#64748B',
            cursor: 'pointer',
            fontSize: 22,
            lineHeight: 1,
            padding: 6,
          }}
        >
          ×
        </button>

        {/* Handle bar */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: '#1E2530',
            margin: '0 auto 18px',
          }}
        />

        {/* Title */}
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#E2E8F0',
            textAlign: 'center',
            marginBottom: 10,
            letterSpacing: '-0.01em',
          }}
        >
          Create a free account
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 13,
            color: '#94A3B8',
            textAlign: 'center',
            lineHeight: 1.55,
            marginBottom: 22,
            padding: '0 6px',
          }}
        >
          Create a free account to access full screener, search, and stock details.
        </div>

        {/* Primary CTA */}
        <Link
          to={`/register${nextPath ? `?next=${nextPath}` : ''}`}
          style={{
            display: 'block',
            width: '100%',
            padding: '13px',
            borderRadius: 10,
            background: '#00C805',
            color: '#000000',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'center',
            textDecoration: 'none',
            marginBottom: 10,
            boxSizing: 'border-box',
          }}
        >
          Sign Up Free
        </Link>

        {/* Secondary CTA */}
        <Link
          to={`/login${nextPath ? `?next=${nextPath}` : ''}`}
          style={{
            display: 'block',
            width: '100%',
            padding: '12px',
            borderRadius: 10,
            background: 'transparent',
            color: '#94A3B8',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'center',
            textDecoration: 'none',
            border: '1px solid #1E2530',
            boxSizing: 'border-box',
          }}
        >
          Log In
        </Link>

        {/* Footnote — reassure free + no credit card */}
        <div
          style={{
            marginTop: 14,
            fontSize: 10.5,
            color: '#64748B',
            textAlign: 'center',
          }}
        >
          Free forever · No credit card · Educational use only
        </div>
      </div>
    </>
  )
}
