// ── TelegramConnectCard ────────────────────────────────────────────────────
// Soft nudge to link Telegram for faster watchlist alerts. Caller decides
// WHEN to render this — the component decides WHETHER (returns null if the
// user has already linked, or has dismissed it this session).
//
// Triggers wired by callers:
//   • Home.jsx       — below MorningBrief when watchlist_changed > 0
//   • StockDetail    — below the criteria score on first stock visit per
//                      session (sessionStorage flag pinex_tg_nudge_shown)
//
// Internal state machine:
//   - linked unknown (loading)        → render null (silent — no flicker)
//   - linked (chat_id present)        → render null forever
//   - dismissed this session          → render null
//   - clicked Connect                 → swap button → inline "open the bot" help
//   - default                         → render the card

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'
import { C } from '../styles/tokens'

const SESSION_DISMISS_KEY = 'pinex_tg_card_dismissed'
const BOT_DEEPLINK = 'https://t.me/PineXBot?start=link'

export default function TelegramConnectCard() {
  const { user } = useAuth()
  // linked: null = unknown, true = already linked (hide), false = not yet
  const [linked, setLinked] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1' }
    catch { return false }
  })
  // After clicking Connect we replace the button with an inline help line.
  const [opened, setOpened] = useState(false)

  // ── On-mount lookup: is telegram already linked? ────────────────
  useEffect(() => {
    if (!user) {
      setLinked(true) // anonymous → treat as linked so we never render
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('telegram_chat_id')
          .eq('id', user.id)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          // Silent fail — don't show the card if we can't read auth state.
          console.warn('[TelegramConnectCard] profile read failed:', error.message)
          setLinked(true)
          return
        }
        setLinked(Boolean(data?.telegram_chat_id))
      } catch (e) {
        if (!cancelled) {
          console.warn('[TelegramConnectCard] profile read threw:', e)
          setLinked(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [user])

  // ── Bail-outs ───────────────────────────────────────────────────
  if (!user) return null
  if (linked === null) return null   // still loading — no flicker
  if (linked) return null            // already linked
  if (dismissed) return null         // dismissed this session

  // ── Handlers ────────────────────────────────────────────────────
  const handleConnect = () => {
    // window.open with _blank — opens the bot deeplink in a new tab.
    // noopener/noreferrer keeps the new tab from holding a window
    // handle back to the SPA (defence-in-depth).
    window.open(BOT_DEEPLINK, '_blank', 'noopener,noreferrer')
    setOpened(true)
  }

  const handleDismiss = () => {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1') } catch {}
    setDismissed(true)
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
      aria-label="Connect Telegram for faster alerts"
    >
      {/* Two-line copy — top of card, no icon (keeps it minimal per spec). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.45 }}>
          You would have known this
        </div>
        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.45 }}>
          3 hours earlier on Telegram.
        </div>
      </div>

      {/* Action zone — either the button OR the post-click help line.
          We swap rather than stack so the card height doesn't grow on
          click (keeps the soft-nudge feel; no triumphal post-click
          banner). */}
      {!opened ? (
        <button
          type="button"
          onClick={handleConnect}
          style={{
            alignSelf: 'flex-start',
            background: C.blueBg,
            color: C.blue,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Connect in 30 seconds
        </button>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: C.textMuted,
            lineHeight: 1.55,
          }}
          role="status"
          aria-live="polite"
        >
          Open the bot and send <strong style={{ color: C.text, fontWeight: 600 }}>/link</strong> to connect your account.
        </div>
      )}

      {/* Dismiss link — sessionStorage, re-appears next session per spec. */}
      <button
        type="button"
        onClick={handleDismiss}
        style={{
          alignSelf: 'flex-start',
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          color: C.textMuted,
          fontSize: 11,
          cursor: 'pointer',
          fontFamily: 'inherit',
          // Underline-on-hover keeps it discoverable without
          // competing with the primary button.
          textDecoration: 'none',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
      >
        or continue without
      </button>
    </div>
  )
}
