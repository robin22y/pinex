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
  blueBg: 'rgba(56,189,248,0.07)',
}

const ADAPT_ITEMS = [
  {
    title: 'Delivery Percentage Signals',
    body: 'A uniquely Indian data point from exchange settlement data that distinguishes genuine accumulation from speculative volume. High-delivery rallies carry more institutional conviction.',
  },
  {
    title: 'Promoter Holding Trends',
    body: 'Promoter stake changes are a significant leading indicator in the Indian context. Rising promoter confidence combined with Stage 2 conditions is a high-conviction setup.',
  },
  {
    title: 'FII / DII Flow Context',
    body: 'Foreign and domestic institutional flows interact differently with Indian market cycles than in developed markets. We factor this into our breadth and stage analysis.',
  },
  {
    title: '30-Week Moving Average',
    body: 'Consistent with Weinstein, we use the 30WMA as the key line between bull and bear phases, calibrated to Indian index behaviour.',
  },
  {
    title: 'RS Rating',
    body: 'A relative strength ranking that measures how a stock is performing against the broader NSE universe over rolling periods.',
  },
]

function Para({ text }) {
  return text.split('\n\n').map((para, i) => (
    <p key={i} style={{ margin: '0 0 14px', color: C.muted, fontSize: 15, lineHeight: 1.75 }}>
      {para}
    </p>
  ))
}

export default function About() {
  const navigate = useNavigate()

  return (
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
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>About</span>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 60px' }}>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, #38BDF8 0%, #0ea5e9 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <i className="ti ti-activity" style={{ fontSize: 24, color: '#051020' }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>PineX</p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Market Intelligence</p>
          </div>
        </div>

        {/* About */}
        <Section title="About Us" blue>
          <p style={{ margin: 0, fontSize: 16, color: C.text, lineHeight: 1.7, fontWeight: 500 }}>
            Built for Indian market participants who want an edge grounded in methodology, not noise.
          </p>
        </Section>

        {/* Approach */}
        <Section title="Our Approach">
          <Para text={`PineX is built around the Stan Weinstein Stage Analysis framework — one of the most battle-tested trend-following methodologies in market history — adapted specifically for the Indian equity markets (BSE & NSE).\n\nWeinstein's original work, published in Secrets for Profiting in Bull and Bear Markets, identified four distinct stages that every stock cycles through: basing, advancing, topping, and declining. PineX applies this lens to every stock on BSE and NSE, enriched with India-specific signals.`} />
        </Section>

        {/* Adapted for India */}
        <Section title="What We've Adapted for India">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {ADAPT_ITEMS.map((item, i) => (
              <div key={i} style={{
                padding: '16px 18px',
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
              }}>
                <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: C.blue }}>{item.title}</p>
                <p style={{ margin: 0, fontSize: 14, color: C.muted, lineHeight: 1.7 }}>{item.body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Philosophy */}
        <Section title="Our Philosophy">
          <Para text={`We believe most retail participants lose money not because of bad stock-picking instincts, but because they buy in the wrong stage. A good business bought in Stage 3 or Stage 4 is a bad trade. PineX is designed to help you identify when to act, not just what to act on.\n\nWe do not predict. We observe, classify, and present. The goal is to put the right information in front of you at the right moment — and get out of your way.`} />
        </Section>

        {/* Data */}
        <Section title="Data Sources" last>
          <p style={{ margin: 0, fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
            PineX aggregates data from BSE (Bombay Stock Exchange) and NSE (National Stock Exchange) including price history, delivery volumes, shareholding patterns, and quarterly financials. All data is sourced from public exchange disclosures and regulatory filings.
          </p>
        </Section>

        {/* Learn CTA */}
        <div style={{
          marginTop: 40, padding: '24px 20px',
          background: 'rgba(56,189,248,0.05)',
          border: '1px solid rgba(56,189,248,0.15)',
          borderRadius: 14, textAlign: 'center',
        }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, color: C.blue, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Explore the platform
          </p>
          <button
            type="button"
            onClick={() => navigate('/learn')}
            style={{
              marginTop: 12, padding: '11px 24px',
              background: 'linear-gradient(135deg, #38BDF8, #0ea5e9)',
              border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 700, color: '#051020',
              cursor: 'pointer', letterSpacing: '-0.01em',
            }}
          >
            See how PineX works →
          </button>
        </div>

        <p style={{ fontSize: 12, color: C.faint, marginTop: 24, textAlign: 'center' }}>
          © 2025 PineX · For educational purposes only
        </p>
      </div>
    </div>
  )
}

function Section({ title, children, blue, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {blue && (
          <div style={{ width: 3, height: 20, borderRadius: 2, background: C.blue, flexShrink: 0 }} />
        )}
        <h2 style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          color: blue ? C.blue : C.text,
          letterSpacing: blue ? '0.06em' : '0.02em',
          textTransform: 'uppercase',
        }}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  )
}
