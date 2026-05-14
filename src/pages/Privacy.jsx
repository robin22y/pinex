import { useNavigate } from 'react-router-dom'

const C = {
  bg: '#05070A', surface: '#0B0F18', border: '#1E2530',
  text: '#E2E8F0', muted: '#64748B', blue: '#60A5FA',
}

export default function Privacy() {
  const navigate = useNavigate()
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 80px' }}>

        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', marginBottom: 28, padding: 0 }}>
          ← Back
        </button>

        <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: '0 0 6px', letterSpacing: '-0.02em' }}>Privacy Policy</h1>
        <p style={{ fontSize: 13, color: C.muted, margin: '0 0 36px' }}>Last updated: May 2026</p>

        <Section title="1. Information We Collect">
          <p>When you create an account, we collect your email address and optionally your name. We do not collect payment card information, Aadhaar numbers, PAN, or any other government-issued identity documents.</p>
          <p>We automatically collect anonymised usage data including pages visited, filters applied, and session duration. This data is used solely to improve the platform and is never sold to third parties.</p>
        </Section>

        <Section title="2. How We Use Your Information">
          <ul>
            <li>To provide and maintain your account and watchlist</li>
            <li>To send transactional emails (password reset, account notices)</li>
            <li>To improve platform features based on aggregated, anonymised usage patterns</li>
            <li>To comply with applicable Indian laws and regulations</li>
          </ul>
          <p>We do not use your data to send unsolicited marketing emails without your explicit consent.</p>
        </Section>

        <Section title="3. Data Storage and Security">
          <p>Your data is stored on secured cloud infrastructure. We use industry-standard encryption (TLS) for data in transit and apply access controls to limit who can view personal information internally.</p>
          <p>Watchlists and portfolio data you save are associated with your account and stored securely. You may delete your account and associated data at any time by contacting us.</p>
        </Section>

        <Section title="4. Third-Party Services">
          <p>PineX uses the following third-party services to operate:</p>
          <ul>
            <li><strong style={{ color: C.text }}>Supabase</strong> — database and authentication infrastructure</li>
            <li><strong style={{ color: C.text }}>Google OAuth</strong> — optional sign-in via Google (subject to Google's Privacy Policy)</li>
          </ul>
          <p>We do not sell, trade, or transfer your personal information to any other third parties.</p>
        </Section>

        <Section title="5. Market Data">
          <p>Price data, delivery volumes, shareholding patterns, and financial results displayed on PineX are sourced from BSE (Bombay Stock Exchange) and NSE (National Stock Exchange) public disclosures. This data is informational only and subject to exchange terms.</p>
        </Section>

        <Section title="6. Cookies">
          <p>We use session cookies necessary for authentication. We do not use advertising or tracking cookies. You may disable cookies in your browser but this will prevent you from staying logged in.</p>
        </Section>

        <Section title="7. Your Rights">
          <p>You have the right to access, correct, or delete the personal data we hold about you. To exercise these rights, contact us. We will respond within 30 days.</p>
        </Section>

        <Section title="8. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. We will notify registered users of material changes via email. Continued use of PineX after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="9. Contact">
          <p>For privacy-related queries, please reach out through the platform's support channel or the contact details provided at registration.</p>
        </Section>

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 40, paddingTop: 24, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/about')} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 13, cursor: 'pointer', padding: 0 }}>About Us</button>
          <button onClick={() => navigate('/terms')} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 13, cursor: 'pointer', padding: 0 }}>Terms of Use</button>
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
