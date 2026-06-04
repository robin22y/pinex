// ── TelegramSubscribePrompt ────────────────────────────────────────────────
// Modal popup nudging signed-in users (who haven't linked Telegram) to
// connect with one tap. Recurs on every fresh session until they either:
//   (a) successfully link via /account or this popup → telegram_chat_id
//       gets set → the prompt never renders again, OR
//   (b) sessionStorage dismiss key is set → quiet for this tab session.
//
// One-tap connect flow:
//   1. User clicks "Connect now" in this popup.
//   2. Frontend INSERTs a one-time token into telegram_link_tokens
//      (tied to auth.uid() via RLS policy from create_telegram_link_
//      tokens.sql).
//   3. Frontend opens t.me/pinex_Alerts_bot?start=<token> in a new tab.
//   4. User taps Start in Telegram. Bot's cmd_start reads the token,
//      writes telegram_chat_id, marks token used.
//   5. They refresh PineX → telegram_chat_id is set → no more popup.
//
// We do NOT auto-dismiss after the bot opens; the user may not finish
// the flow and we'd hide a CTA they still need. Their next page load
// re-renders the popup. If they DO finish, the chat_id check on
// re-render is what hides it.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'
import { C } from '../styles/tokens'
import { TELEGRAM_BOT_USERNAME } from '../lib/siteMeta'

const DISMISS_KEY = 'pinex_tg_popup_dismissed_v1'

// Random token generator — uses crypto.randomUUID() everywhere modern.
// Fallback to Math.random() for ancient browsers (the token is only
// used once and bot-side validated; collision risk is the same as a
// UUIDv4 effectively).
function generateToken() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '')
    }
  } catch {}
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

export default function TelegramSubscribePrompt() {
  const { user, loading: authLoading } = useAuth()
  // linked: null=unknown, true=already linked, false=needs popup
  const [linked, setLinked] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' }
    catch { return false }
  })
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [opened, setOpened] = useState(false)

  // ── Profile check on mount ──────────────────────────────────────
  useEffect(() => {
    if (authLoading || !user) {
      setLinked(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error: e } = await supabase
          .from('profiles')
          .select('telegram_chat_id')
          .eq('id', user.id)
          .maybeSingle()
        if (cancelled) return
        if (e) {
          // RLS / network — fail closed: don't render the popup.
          setLinked(true)
          return
        }
        setLinked(Boolean(data?.telegram_chat_id))
      } catch {
        if (!cancelled) setLinked(true)
      }
    })()
    return () => { cancelled = true }
  }, [user, authLoading])

  // ── Connect handler ─────────────────────────────────────────────
  const handleConnect = async () => {
    if (!user?.id || opening) return
    setError('')
    setOpening(true)
    const token = generateToken()
    try {
      const { error: insertErr } = await supabase
        .from('telegram_link_tokens')
        .insert({ token, user_id: user.id })
      if (insertErr) {
        setError('Could not generate link. Try again.')
        setOpening(false)
        return
      }
      const url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(token)}`
      // window.open in a click handler — Safari iOS friendly.
      window.open(url, '_blank', 'noopener,noreferrer')
      setOpened(true)
    } catch {
      setError('Could not generate link. Try again.')
    } finally {
      setOpening(false)
    }
  }

  // ── Dismiss handler ─────────────────────────────────────────────
  const handleDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch {}
    setDismissed(true)
  }

  // ── Bail-outs (silent) ──────────────────────────────────────────
  if (!user) return null
  if (authLoading) return null
  if (linked === null) return null   // still loading → no flicker
  if (linked) return null            // already connected
  if (dismissed) return null         // dismissed this session

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop — click to dismiss (less aggressive than always-blocking) */}
      <div
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          zIndex: 950,
        }}
      />

      {/* Modal — centered on desktop, bottom-sheet on small screens */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Subscribe to Telegram alerts"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 951,
          background: C.surfaceCard,
          borderRadius: '16px 16px 0 0',
          border: `1px solid ${C.border}`,
          borderBottom: 'none',
          padding: '22px 22px 32px',
          maxWidth: 480,
          margin: '0 auto',
          color: C.text,
          paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* × dismiss */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Maybe later"
          style={{
            position: 'absolute',
            top: 12,
            right: 14,
            background: 'none',
            border: 'none',
            color: C.textMuted,
            cursor: 'pointer',
            fontSize: 22,
            lineHeight: 1,
            padding: 6,
          }}
        >×</button>

        {/* Handle bar */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: C.border,
            margin: '0 auto 18px',
          }}
        />

        {/* Icon */}
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(56,189,248,0.10)',
            border: '1px solid rgba(56,189,248,0.25)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="ti ti-brand-telegram" style={{ fontSize: 26, color: C.blue }} />
          </div>
        </div>

        {/* Title */}
        <div style={{
          fontSize: 18, fontWeight: 700, color: C.text,
          textAlign: 'center', marginBottom: 8, letterSpacing: '-0.01em',
        }}>
          Get a DM when your stocks move
        </div>

        {/* Description */}
        <div style={{
          fontSize: 13, color: C.textMuted, textAlign: 'center',
          lineHeight: 1.6, marginBottom: 22, padding: '0 6px',
        }}>
          Only when something changes in your watchlist. No daily noise.
        </div>

        {/* Primary CTA — toggles to confirmation after click */}
        {!opened ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={opening}
            style={{
              width: '100%', padding: '13px',
              borderRadius: 10, border: 'none',
              background: opening ? C.surfaceCard : C.blue,
              color: opening ? C.textMuted : '#000',
              fontSize: 14, fontWeight: 700,
              cursor: opening ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', gap: 8,
            }}
          >
            <i className="ti ti-brand-telegram" style={{ fontSize: 16 }} />
            {opening ? 'Opening…' : 'Connect in one tap'}
          </button>
        ) : (
          <div style={{
            fontSize: 12, color: C.textMuted, lineHeight: 1.6,
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 0,
          }}>
            <strong style={{ color: C.text }}>Tap Start</strong> in the Telegram tab
            that just opened. You'll be connected automatically — then refresh
            this page.
          </div>
        )}

        {error && (
          <p style={{
            fontSize: 11, color: C.red, textAlign: 'center',
            margin: '10px 0 0',
          }}>{error}</p>
        )}

        {/* Maybe-later link */}
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            display: 'block', margin: '16px auto 0',
            background: 'none', border: 'none', padding: 0,
            color: C.textMuted, fontSize: 12, cursor: 'pointer',
            textDecoration: 'none',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
        >
          Maybe later
        </button>
      </div>
    </>
  )
}
