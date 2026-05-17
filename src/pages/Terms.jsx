import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'

const C = {
  bg: '#05070A',
  surface: '#0B0F18',
  card: '#111620',
  border: '#1E2530',
  text: '#E2E8F0',
  muted: '#64748B',
  faint: '#334155',
  blue: '#38BDF8',
}

const SECTIONS = [
  {
    title: 'Acceptance of Terms',
    body: 'By accessing or using PineX, you agree to be bound by these Terms of Use. If you do not agree, please do not use the platform.',
  },
  {
    title: 'Not Financial Advice',
    body: 'PineX provides market data, technical analysis tools, and educational content for informational purposes only. Nothing on this platform constitutes financial, investment, or trading advice. Always consult a qualified financial advisor before making investment decisions.',
  },
  {
    title: 'No Guarantees',
    body: 'Past performance of any stock or methodology does not guarantee future results. Market analysis, stage classifications, and RS ratings are analytical tools — not predictions. You are solely responsible for your own investment decisions.',
  },
  {
    title: 'Data Accuracy',
    body: 'While we strive to provide accurate and up-to-date data sourced from BSE and NSE disclosures, PineX makes no warranty about the completeness, accuracy, or timeliness of any information displayed on the platform.',
  },
  {
    title: 'Account Responsibility',
    body: 'You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. Notify us immediately of any unauthorised use.',
  },
  {
    title: 'Prohibited Use',
    body: 'You may not use PineX to scrape data, reverse-engineer the platform, distribute content commercially, or engage in any activity that violates applicable Indian or international law.',
  },
  {
    title: 'Modifications',
    body: 'We reserve the right to modify these terms at any time. Continued use of the platform after changes constitutes acceptance of the revised terms.',
  },
  {
    title: 'Contact',
    body: 'For any questions regarding these terms, contact us at support@pinex.in.',
  },
]

export default function Terms() {
  const navigate = useNavigate()

  return (
    <>
      <Helmet>
        <title>Terms of Service — PineX</title>
        <meta name="description" content="PineX terms of service for using our Indian stock market intelligence platform." />
      </Helmet>
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: C.bg, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 16px',
        height: 52, gap: 10,
      }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
        >
          <i className="ti ti-arrow-left" style={{ fontSize: 20 }} />
        </button>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>Terms of Use</span>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 60px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
          Terms of Use
        </h1>
        <p style={{ margin: '0 0 36px', fontSize: 13, color: C.muted }}>Last updated: January 2025</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {SECTIONS.map((s, i) => (
            <div key={i}>
              <h2 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '0.01em' }}>
                {i + 1}. {s.title}
              </h2>
              <p style={{ margin: 0, fontSize: 15, color: C.muted, lineHeight: 1.75 }}>{s.body}</p>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 12, color: C.faint, marginTop: 48, textAlign: 'center' }}>
          © 2025 PineX · For educational purposes only
        </p>
      </div>
    </div>
    </>
  )
}
