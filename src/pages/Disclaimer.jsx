/**
 * Disclaimer — /disclaimer.
 *
 * Page content is product-legal text supplied verbatim. Do not
 * paraphrase, summarise, or restyle the copy without re-confirming
 * with the operator: it scopes legal expectations across the entire
 * app and is referenced from Footer, WelcomeModal, Lab, StockDetail,
 * the SwingX banner, and the Telegram broadcast footer.
 *
 * Layout intent: dark theme, plain readable sections, mobile-first.
 * No icons, no fancy hero, no images. The page is read on a phone
 * after a user taps "Disclaimer" in the footer.
 */
import { Helmet } from 'react-helmet-async'

const PAGE = {
  minHeight:    '100vh',
  width:        '100%',
  padding:      '40px 20px 80px',
  background:   '#0F1217',
  color:        '#E2E8F0',
  fontFamily:   'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display:      'flex',
  flexDirection:'column',
  alignItems:   'center',
}

const WRAP = {
  width:    '100%',
  maxWidth: 720,
}

const H1 = {
  margin:        0,
  fontSize:      22,
  fontWeight:    700,
  letterSpacing: '0.04em',
  color:         '#E2E8F0',
  marginBottom:  18,
}

const H2 = {
  margin:        '28px 0 10px',
  fontSize:      13,
  fontWeight:    700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         '#94A3B8',
}

const P = {
  margin:     '0 0 14px',
  fontSize:   14,
  lineHeight: 1.65,
  color:      '#CBD5E1',
}

const UL = {
  margin:    '0 0 14px',
  paddingLeft: 20,
  fontSize:   14,
  lineHeight: 1.7,
  color:      '#CBD5E1',
}

const LI = { marginBottom: 4 }

const FOOTER_LINE = {
  marginTop:  32,
  fontSize:   12,
  color:      '#64748B',
  textAlign:  'center',
}

const ANCHOR = { color: '#FBBF24', textDecoration: 'none' }

export default function Disclaimer() {
  return (
    <>
      <Helmet>
        <title>Disclaimer — PineX</title>
        <meta name="robots" content="index, follow" />
      </Helmet>
      <main style={PAGE}>
        <div style={WRAP}>
          <h1 style={H1}>IMPORTANT DISCLAIMER</h1>

          {/* Section 1 — intro */}
          <p style={P}>
            PineX is an educational market data observation platform.
          </p>

          {/* Section 2 */}
          <h2 style={H2}>WHAT PINEX IS:</h2>
          <ul style={UL}>
            <li style={LI}>Historical market data analysis</li>
            <li style={LI}>Cycle stage classification</li>
            <li style={LI}>Educational insights into market behaviour</li>
          </ul>

          {/* Section 3 */}
          <h2 style={H2}>WHAT PINEX IS NOT:</h2>
          <ul style={UL}>
            <li style={LI}>A SEBI-registered Investment Adviser</li>
            <li style={LI}>A stock recommendation service</li>
            <li style={LI}>A trading signal provider</li>
            <li style={LI}>A portfolio management service</li>
          </ul>

          {/* Section 4 */}
          <h2 style={H2}>YOUR RESPONSIBILITIES:</h2>
          <ul style={UL}>
            <li style={LI}>Verify all data at nseindia.com</li>
            <li style={LI}>Consult a SEBI-registered adviser</li>
            <li style={LI}>Study company fundamentals</li>
            <li style={LI}>Make your own informed decisions</li>
            <li style={LI}>Never rely solely on a single data source</li>
          </ul>

          {/* Section 5 */}
          <h2 style={H2}>DATA ACCURACY:</h2>
          <ul style={UL}>
            <li style={LI}>All data is end-of-day (EOD)</li>
            <li style={LI}>Data may be delayed or inaccurate</li>
            <li style={LI}>Always cross-check with official NSE/BSE sources</li>
            <li style={LI}>PineX does not guarantee data accuracy</li>
          </ul>

          {/* Section 6 */}
          <h2 style={H2}>REGULATORY STATUS:</h2>
          <ul style={UL}>
            <li style={LI}>Operated by Robin Abraham</li>
            <li style={LI}>Not registered with SEBI as an Investment Adviser</li>
            <li style={LI}>Not registered with FCA (UK)</li>
            <li style={LI}>Provided strictly for educational purposes</li>
          </ul>

          {/* Section 7 */}
          <h2 style={H2}>OFFICIAL SOURCES:</h2>
          <ul style={UL}>
            <li style={LI}>
              NSE:{' '}
              <a style={ANCHOR} href="https://nseindia.com" target="_blank" rel="noreferrer noopener">
                nseindia.com
              </a>
            </li>
            <li style={LI}>
              BSE:{' '}
              <a style={ANCHOR} href="https://bseindia.com" target="_blank" rel="noreferrer noopener">
                bseindia.com
              </a>
            </li>
            <li style={LI}>
              SEBI:{' '}
              <a style={ANCHOR} href="https://sebi.gov.in" target="_blank" rel="noreferrer noopener">
                sebi.gov.in
              </a>
            </li>
          </ul>

          {/* Section 8 */}
          <h2 style={H2}>CONTACT:</h2>
          <p style={P}>
            <a style={ANCHOR} href="mailto:support@pinex.in">support@pinex.in</a>
          </p>

          {/* Footer line */}
          <div style={FOOTER_LINE}>
            Last updated: June 2026
          </div>
        </div>
      </main>
    </>
  )
}
