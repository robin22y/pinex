import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'

const C = {
  bg: 'var(--bg-primary)',
  surface: 'var(--bg-surface)',
  card: 'var(--bg-elevated)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  faint: 'var(--border-strong)',
  blue: 'var(--info)',
}

// Privacy policy — refreshed June 2026 for dual-jurisdiction compliance
// ahead of paid-tier launch:
//   • UK GDPR + Data Protection Act 2018 (primary — paid-billing entity
//     and material UK user base)
//   • India's Digital Personal Data Protection Act 2023 (DPDPA) — for
//     Indian users / Indian stock-data scope
// Substantive additions over the prior India-only draft:
//   • Named Data Controller (UK GDPR Art. 4(7)) / Data Fiduciary
//     (DPDPA s.2(i)) → robin@pinex.in. ICO registration pending.
//   • Rights mapped to BOTH UK GDPR Art. 15-22 AND DPDPA s.11-14
//   • Supervisory authorities: ICO (UK) and Data Protection Board (India)
//   • Lawful bases under UK GDPR Art. 6 alongside DPDPA Section 7
//   • Right to lodge a complaint with the ICO at ico.org.uk
//   • International transfer safeguards (UK IDTA + Indian SCCs equivalent)
//   • Explicit data-retention periods and 72-hour breach-notification SLA
//   • No-children-under-18 policy (DPDPA s.9 + UK age-of-consent 13 for
//     information-society services — but we restrict to 18 product-wide)
const SECTIONS = [
  {
    title: 'Information We Collect',
    body: 'When you create an account, we collect your name, email address, and authentication credentials. We also collect usage data such as pages visited, features used, watchlist activity, and (if you opt in) your Telegram chat ID for alerts. We do not collect payment information until paid tiers launch — at which point a separate payment-data notice will be published before any transaction. Payment processing, when it begins, will be handled by an FCA-authorised payment processor and PineX will receive only tokenised transaction metadata, not card details.',
  },
  {
    title: 'How We Use Your Information',
    body: 'We use your information to provide and improve PineX, send important account-related notifications, and personalise your experience (watchlist, language preference, completed academy modules). We do not sell your personal data to any third party. We do not use your personal data for automated decision-making that has legal or similarly significant effects on you (UK GDPR Article 22).',
  },
  {
    title: 'Legal Basis for Processing',
    body: 'Under UK GDPR Article 6 we process your personal data on the basis of: (a) your consent (Art. 6(1)(a)) given at sign-up via the Terms acceptance checkbox; (b) performance of a contract (Art. 6(1)(b)) — providing the Service you signed up for; and (c) legitimate interests (Art. 6(1)(f)) — for security, fraud prevention, and product improvement. Under India\'s DPDPA we rely on the equivalent grounds in Section 6 (consent) and the legitimate uses in Section 7. You may withdraw consent at any time — see "Your Rights" below.',
  },
  {
    title: 'Data Storage and International Transfers',
    body: 'Your data is stored on Supabase, a managed Postgres platform with encryption at rest (AES-256) and in transit (TLS 1.2+). Supabase infrastructure is hosted in regions including the United Kingdom, the European Union, and the United States. International transfers outside the UK are protected by appropriate safeguards — the UK International Data Transfer Agreement (IDTA) or the UK Addendum to the EU Standard Contractual Clauses. For users in India, equivalent contractual safeguards apply under DPDPA Section 16. By using PineX you acknowledge these transfers as necessary to operate the service.',
  },
  {
    title: 'Data Retention',
    body: 'We keep your data only for as long as it serves the purpose it was collected for. Indicative retention periods: account profile — duration of account + 90 days after deletion request; watchlist & usage analytics — 24 months from last activity; security logs (sign-in attempts, IP) — 12 months; Telegram chat-ID link tokens — 7 days unused, deleted on first use; one-time emails (e.g. invites) — operational logs purged after 60 days. Aggregated, non-identifying analytics may be retained indefinitely.',
  },
  {
    title: 'Cookies and Analytics',
    body: 'PineX uses a single first-party cookie banner consent record (localStorage flag) and may use anonymised analytics to understand how users interact with the platform. No personally identifiable information is shared with analytics providers. We do not use third-party advertising cookies or cross-site trackers. UK ePrivacy / PECR rules apply — non-essential cookies are loaded only after you accept the cookie banner.',
  },
  {
    title: 'Third-Party Processors',
    body: 'We use the following processors who act on our behalf under written data-processing agreements as required by UK GDPR Article 28: Supabase (authentication, database hosting), Netlify (front-end hosting + serverless functions), Google (optional Google sign-in only), Telegram (delivery of opt-in alerts only). None of these processors are permitted to use your data for their own purposes. NSE, BSE and yfinance are public market-data sources — they receive no personal data from PineX.',
  },
  {
    title: 'No Children Under 18',
    body: 'PineX is not directed to, and we do not knowingly collect personal data from, anyone under the age of 18 years. The UK Age Appropriate Design Code and DPDPA Section 9 both require additional protections for children\'s data — rather than build a verifiable-parental-consent flow, we restrict the service to adults entirely. If you believe a child has provided us personal data, write to robin@pinex.in and we will delete it without delay.',
  },
  {
    title: 'Your Rights',
    body: 'Under UK GDPR Articles 15–22 and DPDPA Sections 11–14 you may at any time: (a) request a copy of the personal data we hold about you (right of access / DSAR — UK GDPR Art. 15); (b) request correction of inaccurate data (right to rectification — Art. 16); (c) request erasure of your data (right to erasure / "right to be forgotten" — Art. 17); (d) restrict or object to processing (Art. 18, 21); (e) receive your data in a portable format (Art. 20); (f) withdraw consent previously given (Art. 7(3) / DPDPA s.6(4)); (g) nominate another individual to exercise these rights on your behalf in the event of your death or incapacity (DPDPA s.14). To exercise any right, write to robin@pinex.in. We will respond within 30 days (DPDPA) — and within one month under UK GDPR Article 12(3), extendable by a further two months for complex requests with notice to you.',
  },
  {
    title: 'Data Controller / Data Fiduciary Contact',
    body: 'PineX is the Data Controller (UK GDPR) / Data Fiduciary (DPDPA) in respect of your personal data. The single point of contact for any privacy-related question, complaint, or rights request is: Robin (Founder) — robin@pinex.in. General support: support@pinex.in. We aim to acknowledge complaints within 5 working days and resolve them within 30 days. ICO (UK) registration is in progress — once issued, the registration number will be published here.',
  },
  {
    title: 'Right to Complain to a Supervisory Authority',
    body: 'If you are not satisfied with our handling of your personal data, you have the right to lodge a complaint with a supervisory authority. UK users may complain to the Information Commissioner\'s Office (ICO) at ico.org.uk or by writing to ICO, Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF. Indian users may escalate to the Data Protection Board of India (DPB). Filing a complaint with us first is encouraged but not required.',
  },
  {
    title: 'Security and Breach Notification',
    body: 'We implement standard security practices including encrypted connections (HTTPS / TLS 1.2+), hashed passwords, role-based access controls, row-level-security policies on every personal-data table, and time-limited service credentials. However, no internet-facing system is completely secure — please use a strong, unique password and notify us at robin@pinex.in immediately of any suspected compromise of your account. In the event of a personal-data breach that poses a risk to your rights, we will notify the ICO within 72 hours of becoming aware (UK GDPR Article 33) and the Indian Data Protection Board (DPDPA Section 8(6)), and notify affected individuals without undue delay where the risk is high.',
  },
  {
    title: 'Changes to This Policy',
    body: 'We may update this Privacy Policy from time to time. Material changes will be notified via in-app banner or email at least 14 days before they take effect. The "Last updated" date at the top of this page always reflects the most recent revision.',
  },
  {
    title: 'Contact',
    body: 'Data Controller / Data Fiduciary: robin@pinex.in · General support: support@pinex.in. UK supervisory authority: Information Commissioner\'s Office — ico.org.uk · India supervisory authority: Data Protection Board of India.',
  },
]

export default function Privacy() {
  const navigate = useNavigate()

  return (
    <>
      <Helmet>
        <title>Privacy Policy — PineX</title>
        <meta name="description" content="How PineX collects, uses and protects your data — UK GDPR, Data Protection Act 2018, and India DPDPA compliant privacy policy." />
      </Helmet>
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: C.bg, borderBottom: '1px solid var(--border)',
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
        <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>Last updated: June 2026</p>
        <p style={{ margin: '0 0 36px', fontSize: 12, color: C.faint, fontStyle: 'italic', lineHeight: 1.6 }}>
          Compliant with the UK GDPR, the Data Protection Act 2018 (UK), and India&rsquo;s Digital Personal Data Protection Act 2023 (DPDPA).
        </p>

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
          © 2026 PineX · For educational purposes only
        </p>
      </div>
    </div>
    </>
  )
}
