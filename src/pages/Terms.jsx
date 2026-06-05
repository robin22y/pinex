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

// Terms of Use — refreshed June 2026 ahead of paid-tier launch.
// Substantive additions:
//   • "Paid Subscription Terms" placeholder section (no price stated — see
//     /pricing — but the contractual frame is in place so we can flip prices
//     on without re-litigating the document)
//   • Refund Policy (7-day cooling-off + pro-rata refunds for service outages)
//   • Cancellation Process (self-serve from /account, effective end of cycle)
//   • Governing law / dispute resolution clause
const SECTIONS = [
  {
    title: 'Acceptance of Terms',
    body: 'By accessing or using PineX (the "Service"), you agree to be bound by these Terms of Use. If you do not agree, please do not use the platform. These Terms form a legally binding agreement between you and PineX (the "Service Provider"). You must be at least 18 years of age to use PineX.',
  },
  {
    title: 'Not Financial Advice',
    body: 'PineX provides market data, technical analysis tools, and educational content for informational purposes only. Nothing on this platform constitutes financial, investment, tax or trading advice, a research report, a recommendation, or an offer to buy or sell any security. PineX is NOT registered with SEBI as a Research Analyst or Investment Adviser. Always consult a SEBI-registered financial adviser before making any investment decision.',
  },
  {
    title: 'No Guarantees',
    body: 'Past performance of any stock or methodology does not guarantee future results. Market analysis, stage classifications, criteria scores, RS ratings, and SwingX setups are automated screening tools — not predictions. You are solely responsible for your own investment decisions and for any losses you may incur.',
  },
  {
    title: 'Data Accuracy',
    body: 'We strive to provide accurate end-of-day data sourced from public NSE and BSE disclosures. However, PineX makes no warranty about the completeness, accuracy, or timeliness of any information displayed on the platform. Always verify any data point on the official NSE / BSE website before acting on it. PineX may display a "beta" disclaimer where data integrity is being actively monitored.',
  },
  {
    title: 'Account Responsibility',
    body: 'You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. Notify us immediately at robin@pinex.in of any unauthorised use. Sharing your account is not permitted on paid tiers.',
  },
  {
    title: 'Prohibited Use',
    body: 'You may not (a) scrape, crawl, or systematically harvest data from PineX; (b) reverse-engineer the platform, its scoring formulas, or its filters; (c) re-distribute PineX data commercially or to a third party; (d) use PineX in any manner that violates Indian law (including SEBI regulations on unregistered advisory) or international law; (e) attempt to gain unauthorised access to other users\' data or to administrative endpoints; (f) misrepresent any PineX output as personal investment advice from PineX.',
  },
  {
    title: 'Paid Subscription Terms',
    body: 'PineX is currently free to use. Paid subscription tiers ("PineX Pro") are being prepared — see /pricing. When paid tiers launch, the following will apply: (a) subscriptions auto-renew at the end of each billing cycle until cancelled; (b) fees are charged in British Pounds Sterling (GBP / £) and are exclusive of applicable VAT; (c) pricing displayed at the time of purchase is what you pay for that cycle — we will give 30 days\' notice of any price change for existing subscribers; (d) access to paid features ends at the conclusion of the billing cycle in which you cancel.',
  },
  {
    title: 'Refund Policy',
    body: 'When paid tiers launch, the following refund terms will apply, consistent with the UK Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013: (a) 14-day cooling-off — if you cancel within 14 calendar days of your FIRST subscription payment, you may request a full refund by writing to robin@pinex.in. Note: if you actively use a paid feature during the cooling-off period, you acknowledge that you may forfeit (or pro-rata reduce) this right for digital content already supplied at your request; (b) pro-rata refund for service outages — if PineX is unavailable for more than 48 consecutive hours within a billing cycle due to our infrastructure, we will refund a pro-rata share of that cycle\'s fee on request; (c) we do not refund subsequent renewal payments outside the cooling-off window. Refunds are processed to the original payment instrument within 14 working days.',
  },
  {
    title: 'Cancellation Process',
    body: 'You may cancel a paid subscription at any time from your /account page or by writing to robin@pinex.in. Cancellation takes effect at the end of the current billing cycle — you retain access to paid features until then. Cancellation does NOT trigger a refund of the current cycle unless the 14-day cooling-off window applies (see Refund Policy). Account deletion (separate from subscription cancellation) is governed by the Privacy Policy — see the right-to-erasure entry under UK GDPR Article 17 and DPDPA Section 12.',
  },
  {
    title: 'Service Availability',
    body: 'PineX is provided "as is" and "as available". We do not guarantee uninterrupted access — scheduled maintenance, third-party outages (Supabase, Netlify, NSE archives), or force-majeure events may temporarily disrupt the Service. We will use reasonable efforts to notify you of planned maintenance and to restore service promptly.',
  },
  {
    title: 'Intellectual Property',
    body: 'All PineX content — formulas, narratives, screener templates, code, design, and branding — is owned by PineX and is protected by UK, Indian, and international copyright law (including the UK Copyright, Designs and Patents Act 1988). You may view and interact with the content for personal, non-commercial use. You may not re-publish, syndicate, or build a competing product from PineX content without prior written permission.',
  },
  {
    title: 'Modifications',
    body: 'We reserve the right to modify these Terms at any time. Material changes will be notified via in-app banner or email at least 14 days before they take effect. Continued use of the platform after a change takes effect constitutes acceptance of the revised Terms. The "Last updated" date at the top of this page reflects the most recent revision.',
  },
  {
    title: 'Limitation of Liability',
    body: 'To the maximum extent permitted by law, PineX, its founders, employees and processors shall not be liable for any indirect, incidental, special, consequential or punitive damages, or for any loss of profits, revenues, data or use, arising out of or in connection with your use of the Service. PineX\'s total aggregate liability to you in any 12-month period shall not exceed the subscription fees you have paid to PineX in that period (or GBP £10 if you have not paid any fees).',
  },
  {
    title: 'Governing Law and Disputes',
    body: 'These Terms are governed by the laws of England and Wales. Any dispute arising out of or in connection with the Service will be subject to the exclusive jurisdiction of the courts of England and Wales (London). The parties shall first attempt to resolve any dispute by good-faith discussion within 30 days before initiating any legal proceedings. Nothing in this clause limits any mandatory consumer rights you may have under the law of your country of residence.',
  },
  {
    title: 'Contact',
    body: 'For any questions regarding these Terms, write to support@pinex.in. For privacy-related questions, write to robin@pinex.in (Data Fiduciary contact under DPDPA).',
  },
]

export default function Terms() {
  const navigate = useNavigate()

  return (
    <>
      <Helmet>
        <title>Terms of Service — PineX</title>
        <meta name="description" content="PineX terms of service — including paid subscription, refund, and cancellation terms for our Indian stock market intelligence platform." />
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
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>Terms of Use</span>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 60px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
          Terms of Use
        </h1>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>Last updated: June 2026</p>
        <p style={{ margin: '0 0 36px', fontSize: 12, color: C.faint, fontStyle: 'italic', lineHeight: 1.6 }}>
          Governed by the laws of England and Wales. Includes paid subscription, refund, and cancellation terms that take effect when PineX Pro launches.
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
