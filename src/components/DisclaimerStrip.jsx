// ── DisclaimerStrip ─────────────────────────────────────────────────────────
// Always-visible SEBI / NSE legal disclaimer — shown on every app-shell page
// (Home, Screener, SwingX, Lab, Dashboard, etc.) on BOTH mobile and desktop.
//
// Why it lives in normal document flow (not position:fixed): scrolling past
// the last row of a sector list / watchlist should reveal the disclaimer
// rather than have it permanently cover the Run / Export buttons. The
// `marginBottom` rule in index.css clears the fixed BottomNav on mobile and
// resets to 0 on desktop where the BottomNav is hidden.
//
// Dismissibility: sessionStorage so the bar disappears for the rest of the
// browser tab session, then re-appears on the next visit. This satisfies
// the "users see the SEBI/NSE compliance copy at least once per session"
// requirement without nagging them on every nav.

import { useState } from 'react'
import { Link } from 'react-router-dom'

const DISMISS_KEY = 'pinex_disclaimer_dismissed_v1'

export default function DisclaimerStrip() {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' }
    catch { return false }
  })

  if (dismissed) return null

  const handleDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch {}
    setDismissed(true)
  }

  return (
    <div
      className="disclaimer-strip"
      style={{
        background: 'var(--bg-primary)',   // #0B0E11
        borderTop: '1px solid var(--border)', // #1E2530
        padding: '10px 14px 12px',
        position: 'relative',
      }}
    >
      {/* Dismiss button — sessionStorage-gated so it stays gone for
          this browser session and re-appears next session. */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss disclaimer"
        style={{
          position: 'absolute',
          top: 6,
          right: 8,
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',  // #64748B
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          padding: 4,
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>

      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
          paddingRight: 20, // breathing room for the × on narrow viewports
          fontSize: 10.5,
          lineHeight: 1.5,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        {/* Beta-warning line — the most actionable disclaimer goes first
            with a subtle amber tint so it doesn't blend into the wall of
            muted grey. */}
        <div style={{ color: '#FBBF24', fontWeight: 600, marginBottom: 4 }}>
          ⚠ Beta version — data may be inaccurate. Always verify on NSE/BSE before acting.
        </div>

        <div>
          For educational and informational purposes only. Not investment advice. PineX is not a SEBI registered investment advisor.
        </div>

        <div style={{ marginTop: 3 }}>
          All data is sourced from public sources — verify independently before making any investment decisions.
        </div>

        <div style={{ marginTop: 3 }}>
          Stock market investments are subject to market risks. Read all scheme related documents carefully.
        </div>

        <div style={{ marginTop: 5 }}>
          <Link
            to="/methodology"
            style={{ color: '#9aa4b2', textDecoration: 'underline' }}
          >
            How we calculate →
          </Link>
        </div>
      </div>
    </div>
  )
}
