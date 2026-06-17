/**
 * Footer — persistent product disclaimer.
 *
 * Sits at the bottom of every in-shell page (mounted from
 * RootLayout in App.jsx). One short paragraph, fixed copy. The
 * existing <DisclaimerStrip /> floats above the bottom nav with
 * a "How we calculate →" CTA; this footer is the standing
 * product-framing line below.
 *
 * Copy is the rework spec verbatim — do not edit without explicit
 * sign-off; it scopes legal expectations across the entire app.
 */
import { C } from '../../styles/tokens'

const DISCLAIMER =
  'This tool shows how similar market conditions have behaved historically. ' +
  'It does not evaluate, rank, or recommend any investment opportunity.'

export default function Footer() {
  return (
    <footer
      style={{
        marginTop: 32,
        padding: '14px 18px',
        borderTop: `1px solid ${C.border}`,
        textAlign: 'center',
        color: C.textFaint || C.textMuted,
        fontSize: 11,
        lineHeight: 1.6,
        fontStyle: 'italic',
        background: 'transparent',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {DISCLAIMER}
      </div>
    </footer>
  )
}
