// ── DisclaimerStrip ─────────────────────────────────────────────────────────
// Fixed one-line legal strip shown on the mobile app shell, sitting directly
// ABOVE the bottom navigation bar (nav height = 60px + safe-area inset).
// Visual only — pointer-events are disabled so it never intercepts taps.
// z-index 9998 keeps it just below the BottomNav (9999) so the two never
// fight. Desktop relies on the per-page footer disclaimers + sidebar, so this
// mobile-only strip uses `md:hidden`.

import { Link } from 'react-router-dom'

export default function DisclaimerStrip() {
  return (
    <div
      className="disclaimer-strip md:hidden"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'calc(60px + env(safe-area-inset-bottom))',
        zIndex: 9998,
        background: 'rgba(0,0,0,0.85)',
        padding: '4px 12px',
        fontSize: 10,
        color: '#888888',
        textAlign: 'center',
        lineHeight: 1.3,
        pointerEvents: 'none',
      }}
    >
      EOD data only · Not investment advice · Not SEBI registered · Your decisions ·{' '}
      <Link
        to="/methodology"
        style={{ color: '#9aa4b2', textDecoration: 'underline', pointerEvents: 'auto' }}
      >
        How we calculate →
      </Link>
    </div>
  )
}
