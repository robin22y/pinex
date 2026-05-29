// ── DisclaimerStrip ─────────────────────────────────────────────────────────
// Mobile-only one-line legal strip. It sits in normal document flow at the
// very bottom of the page (NOT pinned over content), so scrolling to the end
// reveals it — this keeps it from covering the Run button, theme toggle, etc.
// `marginBottom` clears the fixed BottomNav (60px + safe-area inset). Desktop
// relies on the per-page footer disclaimers + sidebar, so this strip is
// hidden there via the `.disclaimer-strip` rule in index.css (md:hidden is
// unreliable in this project).

import { Link } from 'react-router-dom'

export default function DisclaimerStrip() {
  return (
    <div
      className="disclaimer-strip md:hidden"
      style={{
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        padding: '10px 14px',
        marginBottom: 'calc(60px + env(safe-area-inset-bottom))',
        fontSize: 10,
        color: '#888888',
        textAlign: 'center',
        lineHeight: 1.4,
      }}
    >
      EOD data only · Not investment advice · Not SEBI registered · Your decisions ·{' '}
      <Link
        to="/methodology"
        style={{ color: '#9aa4b2', textDecoration: 'underline' }}
      >
        How we calculate →
      </Link>
    </div>
  )
}
