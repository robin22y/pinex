import { useNavigate } from 'react-router-dom'

const C = {
  bg: '#05070A', surface: '#0B0F18', border: '#1E2530',
  text: '#E2E8F0', muted: '#64748B', blue: '#60A5FA',
  amber: '#FBBF24', red: '#F87171',
}

export default function Terms() {
  const navigate = useNavigate()
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 80px' }}>

        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', marginBottom: 28, padding: 0 }}>
          ← Back
        </button>

        <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: '0 0 6px', letterSpacing: '-0.02em' }}>Terms of Use</h1>
        <p style={{ fontSize: 13, color: C.muted, margin: '0 0 36px' }}>Last updated: May 2026</p>

        {/* Demo notice */}
        <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '14px 16px', marginBottom: 32 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.amber }}>Demo Mode Notice</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>
            PineX is currently operating in <strong style={{ color: C.amber }}>demo mode</strong>. Data, signals, and features are under active development and may be incomplete, delayed, or inaccurate. Nothing on this platform constitutes investment advice. You must consult a SEBI-registered investment advisor before making any investment decision.
          </p>
        </div>

        <Section title="1. Acceptance of Terms">
          <p>By accessing or using PineX ("the Platform"), you agree to be bound by these Terms of Use. If you do not agree, you must not use the Platform. These terms apply to all visitors, registered users, and any other persons who access the Platform.</p>
        </Section>

        <Section title="2. Nature of the Platform — Not Investment Advice">
          <div style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.red, fontWeight: 600 }}>Important Disclaimer</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>
              PineX is a <strong style={{ color: C.text }}>financial data and analysis platform</strong>, not a SEBI-registered investment advisor, broker, or research analyst. All content, screener results, signals, stage classifications, delivery data, shareholding analysis, and any other information provided on this Platform is strictly for <strong style={{ color: C.text }}>informational and educational purposes only</strong>.
            </p>
          </div>
          <p>Nothing on PineX constitutes:</p>
          <ul>
            <li>Investment advice or a recommendation to buy, sell, or hold any security</li>
            <li>Research reports as defined under SEBI (Research Analysts) Regulations, 2014</li>
            <li>Portfolio management services</li>
            <li>Investment advisory services under SEBI (Investment Advisers) Regulations, 2013</li>
          </ul>
          <p><strong style={{ color: C.text }}>You must consult a SEBI-registered investment advisor or registered research analyst before making any investment decision.</strong> Past performance of any stock, sector, or indicator does not guarantee future results.</p>
        </Section>

        <Section title="3. Conflict of Interest Disclosure">
          <p>In the interest of full transparency, users should be aware that:</p>
          <ul>
            <li>The operators and contributors of PineX <strong style={{ color: C.text }}>may hold long or short positions</strong> in securities that appear in screener results, signals, or any other output of this Platform at any given time.</li>
            <li>No disclosure will be made on a per-security or per-screen basis. The screener methodology is systematic and does not reflect the personal portfolio decisions of the operators.</li>
            <li>PineX does not receive commissions, referral fees, or any compensation from any broker, company, or exchange in connection with the display of any security on this Platform.</li>
          </ul>
          <p>Users are advised to conduct their own independent due diligence and not rely solely on any Platform output when making decisions.</p>
        </Section>

        <Section title="4. SEBI Compliance">
          <p>PineX acknowledges and operates in accordance with the regulatory framework established by the Securities and Exchange Board of India (SEBI). The Platform:</p>
          <ul>
            <li>Does not hold any SEBI registration as an Investment Adviser, Research Analyst, or Broker</li>
            <li>Does not provide personalised investment recommendations</li>
            <li>Does not execute trades or hold client funds</li>
            <li>Displays only publicly available exchange data from BSE and NSE</li>
          </ul>
          <p>If you believe any content on this Platform violates SEBI regulations, please contact us immediately.</p>
        </Section>

        <Section title="5. BSE and NSE Data — Accuracy and Cross-Verification">
          <p>Market data displayed on PineX — including price quotes, delivery volumes, index levels, and corporate actions — is sourced from Bombay Stock Exchange (BSE) and National Stock Exchange (NSE) public data feeds and official disclosures.</p>
          <p>This data is provided for informational purposes only. BSE and NSE are the authoritative sources for all official market data. PineX makes no warranty regarding the accuracy, timeliness, or completeness of exchange data displayed on the Platform.</p>
          <ul>
            <li>Data may be delayed by 15 minutes or more</li>
            <li>Historical data is subject to exchange corrections and revisions</li>
            <li>Corporate action adjustments (splits, bonuses, dividends) are applied on a best-effort basis</li>
            <li>Financial data (revenue, PAT, margins) is sourced from company filings and may contain errors introduced during data processing</li>
          </ul>
          <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 8, padding: '12px 14px', marginTop: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#60A5FA', fontWeight: 600 }}>Cross-Verification Recommended</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>
              Financial data is prone to data-entry errors, API transmission errors, and processing glitches. <strong style={{ color: C.text }}>Users are strongly encouraged to cross-check all prices, volumes, financial figures, and shareholding data with the official exchange websites — <a href="https://www.nseindia.com" target="_blank" rel="noopener noreferrer" style={{ color: '#60A5FA' }}>nseindia.com</a> and <a href="https://www.bseindia.com" target="_blank" rel="noopener noreferrer" style={{ color: '#60A5FA' }}>bseindia.com</a> — before taking any action.</strong>
            </p>
          </div>
        </Section>

        <Section title="6. Data Source Scope — Demo and Testing Use Only">
          <p>During the current demo phase, PineX aggregates publicly available exchange data (Bhavcopy files, exchange delivery data, and public regulatory filings). This data is used solely for non-commercial demonstration and testing purposes.</p>
          <p><strong style={{ color: C.text }}>This Platform does not commercially redistribute raw exchange data.</strong> Commercial redistribution of BSE/NSE Bhavcopy data or any licensed exchange data feed requires a separate commercial agreement with an authorised data vendor. PineX does not hold, and does not represent that it holds, any such commercial data redistribution licence.</p>
          <p>If and when PineX transitions from demo to a commercial service, appropriate data vendor agreements and SEBI-compliant arrangements will be established prior to launch.</p>
        </Section>

        <Section title="7. Demo Mode — Limitations of Liability">
          <p>PineX is currently in <strong style={{ color: C.text }}>demo mode</strong>. This means:</p>
          <ul>
            <li>Features may be incomplete, experimental, or subject to change without notice</li>
            <li>Signals and screener outputs have not been independently audited or back-tested for performance</li>
            <li>Stage classifications are algorithmic interpretations and may differ from manual analysis</li>
            <li>Data coverage may not include all listed securities on BSE/NSE</li>
          </ul>
          <p>To the maximum extent permitted by law, PineX and its operators shall not be liable for any loss, damage, or missed opportunity arising from reliance on information provided during the demo period.</p>
        </Section>

        <Section title="8. User Responsibilities">
          <ul>
            <li>You are solely responsible for all investment decisions you make</li>
            <li>You must independently verify all data before acting on it, including cross-referencing with official exchange sources</li>
            <li>You must not use the Platform for any unlawful purpose</li>
            <li>You must not attempt to scrape, copy, or redistribute Platform data commercially</li>
            <li>You must keep your account credentials confidential</li>
          </ul>
        </Section>

        <Section title="9. Intellectual Property">
          <p>The PineX brand, design, methodology documentation, and software are the intellectual property of the Platform operators. Stage analysis methodology is adapted from publicly documented frameworks and is not claimed as proprietary. Market data remains the property of the respective exchanges.</p>
        </Section>

        <Section title="10. Modifications and Termination">
          <p>We reserve the right to modify these Terms at any time. Continued use of the Platform after changes constitutes acceptance.</p>
          <p>We may suspend or terminate access to the Platform at any time, with or without notice, particularly during the demo phase. <strong style={{ color: C.text }}>In the event of termination or shutdown during the demo phase:</strong></p>
          <ul>
            <li>No compensation of any kind will be provided to users for loss of access</li>
            <li>No guarantee of data export or account data retrieval is made — users should maintain their own records of any watchlists or portfolio entries they wish to preserve</li>
            <li>Any paid features or subscriptions (if introduced) will be handled separately under refund terms communicated at the time of purchase</li>
          </ul>
        </Section>

        <Section title="11. Governing Law">
          <p>These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts in India. If any provision of these Terms is found to be unenforceable, the remaining provisions shall continue in full force.</p>
        </Section>

        <Section title="12. Contact">
          <p>For questions regarding these Terms, please contact us through the Platform's support channel.</p>
        </Section>

        <div style={{ background: 'rgba(96,165,250,0.04)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 10, padding: '14px 16px', marginTop: 8, marginBottom: 32 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#94A3B8', lineHeight: 1.7 }}>
            <strong style={{ color: C.text }}>Summary:</strong> PineX shows you data and analysis tools for Indian equities. We are not SEBI-registered advisors. Our operators may hold positions in displayed securities. We are in demo mode — data may have errors, always cross-check with NSE/BSE directly. If we shut down during demo, no compensation or data export is guaranteed. Never invest based on any single source. Always consult a qualified financial advisor.
          </p>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 24, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/about')} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 13, cursor: 'pointer', padding: 0 }}>About Us</button>
          <button onClick={() => navigate('/privacy')} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 13, cursor: 'pointer', padding: 0 }}>Privacy Policy</button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#E2E8F0', margin: '0 0 12px', paddingBottom: 8, borderBottom: '1px solid #1E2530' }}>{title}</h2>
      <div style={{ fontSize: 14, color: '#94A3B8', lineHeight: 1.75 }}>{children}</div>
    </div>
  )
}
