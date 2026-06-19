/**
 * Footer — persistent product disclaimer + nav links row.
 *
 * Sits at the bottom of every in-shell page (mounted from
 * RootLayout in App.jsx). Copy is product-legal text supplied
 * verbatim — do not paraphrase or shorten without re-confirming
 * with the operator: the same wording is referenced across the
 * disclaimer page, the Telegram broadcast footer, and the
 * WelcomeModal informed-consent block.
 */
import { Link } from 'react-router-dom'
import { C } from '../../styles/tokens'

export default function Footer() {
  return (
    <footer
      style={{
        marginTop: 32,
        padding: '20px 18px 24px',
        borderTop: `1px solid ${C.border}`,
        textAlign: 'center',
        color: C.textFaint || C.textMuted,
        fontSize: 12,
        lineHeight: 1.7,
        background: 'transparent',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <p style={{ margin: 0 }}>
          PineX displays historical market behaviour and data patterns. It does not provide investment advice, recommendations, or buy/sell signals.
        </p>
        <p style={{ margin: '10px 0 0' }}>
          Always independently verify all data at nseindia.com before making any financial decision.
        </p>
        <p style={{ margin: '10px 0 0' }}>
          Consult a SEBI-registered investment adviser for personalised guidance.
        </p>
        <p style={{ margin: '10px 0 0' }}>
          PineX is not a SEBI-registered Investment Adviser.
        </p>

        {/* Footer links row */}
        <nav
          aria-label="Footer links"
          style={{
            marginTop: 16,
            fontSize: 12,
            color: C.textMuted,
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link to="/about" style={{ color: 'inherit', textDecoration: 'none' }}>About</Link>
          <span aria-hidden="true">·</span>
          <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>Terms</Link>
          <span aria-hidden="true">·</span>
          <Link to="/disclaimer" style={{ color: 'inherit', textDecoration: 'none' }}>Disclaimer</Link>
        </nav>
      </div>
    </footer>
  )
}
