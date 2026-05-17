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
    title: 'Information We Collect',
    body: 'When you create an account, we collect your name, email address, and authentication credentials. We also collect usage data such as pages visited, features used, and watchlist activity to improve the platform.',
  },
  {
    title: 'How We Use Your Information',
    body: 'We use your information to provide and improve PineX, send important account-related notifications, and personalise your experience. We do not sell your personal data to third parties.',
  },
  {
    title: 'Data Storage',
    body: 'Your data is stored securely using Supabase, a managed database platform with encryption at rest and in transit. We retain account data for as long as your account is active.',
  },
  {
    title: 'Cookies and Analytics',
    body: 'PineX may use cookies and anonymised analytics to understand how users interact with the platform. No personally identifiable information is shared with analytics providers.',
  },
  {
    title: 'Third-Party Services',
    body: 'We use trusted third-party services (authentication, database, hosting) that process data on our behalf under strict confidentiality agreements. These services do not use your data for their own purposes.',
  },
  {
    title: 'Your Rights',
    body: 'You may request access to, correction of, or deletion of your personal data at any time by contacting us. Account deletion removes all personally identifiable information within 30 days.',
  },
  {
    title: 'Security',
    body: 'We implement industry-standard security practices including encrypted connections (HTTPS), hashed passwords, and access controls. However, no system is completely secure — use a strong, unique password.',
  },
  {
    title: 'Changes to This Policy',
    body: 'We may update this Privacy Policy from time to time. We will notify you of material changes via email or an in-app notice.',
  },
  {
    title: 'Contact',
    body: 'For privacy-related questions or requests, contact us at support@pinex.in.',
  },
]

export default function Privacy() {
  const navigate = useNavigate()

  return (
    <>
      <Helmet>
        <title>Privacy Policy — PineX</title>
        <meta name="description" content="How PineX collects, uses and protects your data on our stock market intelligence platform." />
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
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>Privacy Policy</span>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 60px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
          Privacy Policy
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
