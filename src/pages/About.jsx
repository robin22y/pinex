import { useNavigate } from 'react-router-dom'

const C = {
  bg: '#05070A', surface: '#0B0F18', card: '#111620',
  border: '#1E2530', text: '#E2E8F0', muted: '#64748B',
  faint: '#3D4F63', blue: '#60A5FA', green: '#34D399',
}

export default function About() {
  const navigate = useNavigate()
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* Back */}
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
          ← Back
        </button>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: C.blue }}>P</span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
              Pine<span style={{ color: C.blue }}>X</span>
            </p>
            <p style={{ margin: 0, fontSize: 11, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Market Intelligence</p>
          </div>
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: '0 0 8px', letterSpacing: '-0.02em' }}>About Us</h1>
        <p style={{ fontSize: 15, color: C.muted, margin: '0 0 36px', lineHeight: 1.6 }}>
          Built for Indian market participants who want an edge grounded in methodology, not noise.
        </p>

        <Section title="Our Approach">
          <p>PineX is built around the <strong style={{ color: C.text }}>Stan Weinstein Stage Analysis</strong> framework — one of the most battle-tested trend-following methodologies in market history — adapted specifically for the Indian equity markets (BSE &amp; NSE).</p>
          <p>Weinstein's original work, published in <em>Secrets for Profiting in Bull and Bear Markets</em>, identified four distinct stages that every stock cycles through: basing, advancing, topping, and declining. PineX applies this lens to every stock on BSE and NSE, enriched with India-specific signals.</p>
        </Section>

        <Section title="What We've Adapted for India">
          <ul>
            <li><strong style={{ color: C.text }}>Delivery percentage signals</strong> — A uniquely Indian data point from exchange settlement data that distinguishes genuine accumulation from speculative volume. High-delivery rallies carry more institutional conviction.</li>
            <li><strong style={{ color: C.text }}>Promoter holding trends</strong> — Promoter stake changes are a significant leading indicator in the Indian context. Rising promoter confidence combined with Stage 2 conditions is a high-conviction setup.</li>
            <li><strong style={{ color: C.text }}>FII / DII flow context</strong> — Foreign and domestic institutional flows interact differently with Indian market cycles than in developed markets. We factor this into our breadth and stage analysis.</li>
            <li><strong style={{ color: C.text }}>30-week moving average as the primary trend filter</strong> — Consistent with Weinstein, we use the 30WMA as the key line between bull and bear phases, calibrated to Indian index behaviour.</li>
            <li><strong style={{ color: C.text }}>RS Rating</strong> — A relative strength ranking that measures how a stock is performing against the broader NSE universe over rolling periods.</li>
          </ul>
        </Section>

        <Section title="Our Philosophy">
          <p>We believe most retail participants lose money not because of bad stock-picking instincts, but because they buy in the wrong stage. A good business bought in Stage 3 or Stage 4 is a bad trade. PineX is designed to help you identify <em>when</em> to act, not just <em>what</em> to act on.</p>
          <p>We do not predict. We observe, classify, and present. The goal is to put the right information in front of you at the right moment — and get out of your way.</p>
        </Section>

        <Section title="Data Sources">
          <p>PineX aggregates data from BSE (Bombay Stock Exchange) and NSE (National Stock Exchange) including price history, delivery volumes, shareholding patterns, and quarterly financials. All data is sourced from public exchange disclosures and regulatory filings.</p>
        </Section>

        <Section title="Demo Mode">
          <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 14, color: C.blue, fontWeight: 600 }}>PineX is currently in demo mode.</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.6 }}>Features, data coverage, and signals are being actively developed. Some data may be incomplete or delayed. Do not make investment decisions based solely on this platform.</p>
          </div>
        </Section>

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 40, paddingTop: 24, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/privacy')} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 13, cursor: 'pointer', padding: 0 }}>Privacy Policy</button>
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
      <div style={{ fontSize: 14, color: '#94A3B8', lineHeight: 1.75 }}>
        {children}
      </div>
    </div>
  )
}
