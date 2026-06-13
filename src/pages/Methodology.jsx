import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import PineXMark from '../components/PineXMark'

import Icon from '../components/ui/Icon'
// ── /methodology ────────────────────────────────────────────────────────────
// Fully public "white box" page. No login, no data fetching — static content.
// Documents the exact mathematical formula behind every criterion so PineX is
// demonstrably an algorithmic calculator, not subjective research.
const C = {
  bg: 'var(--bg-primary)',
  card: 'var(--bg-elevated)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  faint: 'var(--border-strong)',
  blue: '#38BDF8',
}

const CRITERIA = [
  {
    n: 1,
    title: 'Price above 30W Trend Line',
    formula: 'Close price  >  30-week moving average\n\n30W MA = average of the closing prices\n         over the last 30 weekly closes',
    pass: 'Current close > 30W MA value',
    fail: 'Current close ≤ 30W MA value',
  },
  {
    n: 2,
    title: 'Trend Line Slope: Rising',
    formula: '30W MA today  >  30W MA 4 weeks ago',
    pass: 'Current 30W MA > 30W MA from 4 weeks prior',
    fail: 'Current 30W MA ≤ 30W MA from 4 weeks prior',
  },
  {
    n: 3,
    title: 'Relative Strength vs Nifty 500',
    formula: 'RS = (stock price change % over N days)\n   − (Nifty 500 price change % over\n      the same N days)',
    pass: 'RS > 0%  (stock outperforming the index)',
    fail: 'RS ≤ 0%  (stock underperforming the index)',
  },
  {
    n: 4,
    title: 'OBV Direction: Rising',
    formula: 'OBV = cumulative sum of:\n  close > prev close → add volume\n  close < prev close → subtract volume\n  close = prev close → add 0\n\nOBV slope = 10-day linear-regression\n            slope of OBV',
    pass: 'OBV slope is positive',
    fail: 'OBV slope is flat or negative',
  },
  {
    n: 5,
    title: 'Volume vs 30D Average',
    formula: 'Volume ratio = today’s volume\n             ÷ 30-day average volume',
    pass: 'Volume ratio > 1.0 (above average)',
    fail: 'Volume ratio ≤ 1.0',
  },
  {
    n: 6,
    title: 'Extension from Trend Line',
    formula: 'Extension % = ((Close − 30W MA)\n             ÷ 30W MA) × 100',
    pass: 'Extension % < 15% (within 15% of trend line)',
    fail: 'Extension % ≥ 15% (extended beyond 15%)',
  },
]

const SWINGX = [
  { key: 'condition_stage2', desc: 'Price above a rising 30W MA with OBV rising' },
  { key: 'condition_delivery_above_avg', desc: 'Delivery volume above its 30-day average' },
  { key: 'condition_near_ma50', desc: 'Price within 3% of the 50-day moving average — abs(close − ma50) ÷ ma50 < 0.03' },
  { key: 'condition_rsi_healthy', desc: 'RSI between 40 and 65 — 40 ≤ RSI ≤ 65' },
  { key: 'condition_volume_contracting', desc: 'Recent volume below the 30-day average — a quiet pullback' },
]

function Formula({ children }) {
  return (
    <pre
      style={{
        margin: '8px 0 0',
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 12,
        color: C.text,
        whiteSpace: 'pre-wrap',
        lineHeight: 1.6,
        overflowX: 'auto',
      }}
    >
      {children}
    </pre>
  )
}

function PassFail({ pass, fail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--positive)' }}>✓ Pass: {pass}</span>
      <span style={{ fontSize: 12, color: C.muted }}>✗ Fail: {fail}</span>
    </div>
  )
}

function Section({ title, children, blue, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {blue && <div style={{ width: 3, height: 20, borderRadius: 2, background: C.blue, flexShrink: 0 }} />}
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: blue ? C.blue : C.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  )
}

export default function Methodology() {
  const navigate = useNavigate()

  return (
    <>
      <Helmet>
        <title>How PineX Calculates Criteria | PineX Methodology</title>
        <meta
          name="description"
          content="The exact mathematical formula behind every PineX criterion. PineX is a transparent calculator applied to end-of-day NSE data — not research or advice."
        />
      </Helmet>
      <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 40, background: C.bg, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', height: 52, gap: 10 }}>
          <button type="button" onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
            <Icon name="arrow-left" style={{ fontSize: 20 }} />
          </button>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>How we calculate</span>
        </div>

        <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 96px' }}>
          {/* Opening statement — strongest framing of what PineX IS and
              ISN'T. Sets the tone before the user reaches any criterion
              detail. Per the final language audit: this is the single
              line we want every visitor to land on at /methodology. */}
          <div style={{
            marginBottom: 28,
            padding: '18px 20px',
            background: C.card,
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${C.blue}`,
            borderRadius: 10,
          }}>
            <p style={{ margin: 0, fontSize: 16, color: C.text, lineHeight: 1.65, fontWeight: 600 }}>
              <PineXMark /> does not tell you what to do. It shows you what the data
              shows in similar conditions.
            </p>
            <p style={{ margin: '10px 0 0', fontSize: 14, color: C.muted, lineHeight: 1.65 }}>
              Every classification on this platform is a mathematical
              data output — not a recommendation or prediction.
            </p>
          </div>

          <div style={{ marginBottom: 28 }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
              How <PineXMark /> Calculates Criteria
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
              Every score on PineX is automated maths applied to end-of-day data. The exact formulas are below — anyone can verify them.
            </p>
          </div>

          {/* 1 — What PineX is */}
          <Section title="What PineX Is" blue>
            <p style={{ margin: '0 0 12px', fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
              PineX is a data tool that applies mathematical filters to end-of-day NSE stock data. All criteria shown on PineX are the result of mathematical calculations applied to publicly available price, volume, and relative-strength data.
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
              No human analyst is involved in generating any score or result. All outputs are automated calculations.
            </p>
            <p style={{ margin: 0, fontSize: 15, color: C.text, lineHeight: 1.75, fontWeight: 600 }}>
              PineX is not a research analyst. PineX does not provide investment advice.
            </p>
          </Section>

          {/* 2 — The six criteria */}
          <Section title="The Six Criteria">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {CRITERIA.map((c) => (
                <div key={c.n} style={{ padding: '16px 18px', background: C.card, border: '1px solid var(--border)', borderRadius: 12 }}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.blue, letterSpacing: '0.08em' }}>CRITERION {c.n}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, color: C.text }}>{c.title}</p>
                  <Formula>{c.formula}</Formula>
                  <PassFail pass={c.pass} fail={c.fail} />
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: C.faint, fontStyle: 'italic' }}>
                    This is a mathematical comparison. No judgment is applied.
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* 3 — The score */}
          <Section title="The Criteria Score">
            <p style={{ margin: '0 0 8px', fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
              Score = the count of criteria currently passing. Minimum 0/6, maximum 6/6.
            </p>
            <p style={{ margin: 0, fontSize: 15, color: C.text, lineHeight: 1.75, fontWeight: 600 }}>
              The score is a count. It is not a rating. It is not a recommendation. What the score means for your own analysis is your decision.
            </p>
          </Section>

          {/* 4 — SwingX */}
          <Section title="SwingX Filter">
            <p style={{ margin: '0 0 12px', fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
              SwingX is a pre-built filter that checks five specific criteria simultaneously. A stock appears in SwingX results only when all five conditions are true. This is a mathematical filter — not a recommendation.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SWINGX.map((s, i) => (
                <div key={s.key} style={{ padding: '12px 14px', background: C.card, border: '1px solid var(--border)', borderRadius: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{i + 1}. {s.key}</p>
                  <p style={{ margin: '3px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 5 — Data sources */}
          <Section title="Data Sources">
            <p style={{ margin: '0 0 8px', fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
              All data is end-of-day (EOD) only — updated once per day after market close. No real-time or intraday data.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, color: C.muted, fontSize: 14, lineHeight: 1.9 }}>
              <li>Price data — NSE official EOD data</li>
              <li>Delivery data — NSE official delivery reports</li>
              <li>Index data — Nifty 500 for RS calculations</li>
            </ul>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: C.faint, lineHeight: 1.7 }}>
              PineX does not guarantee the accuracy of data obtained from third-party sources.
            </p>
          </Section>

          {/* 6 — Legal */}
          <Section title="Legal Statement" last>
            <div style={{ padding: '16px 18px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: C.muted, lineHeight: 1.75 }}>
                PineX is a financial data and education platform. PineX is <strong style={{ color: C.text }}>NOT</strong> registered with SEBI as a Research Analyst or Investment Adviser.
              </p>
              <p style={{ margin: '0 0 6px', fontSize: 14, color: C.muted, lineHeight: 1.75 }}>
                Nothing on PineX constitutes:
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: C.muted, fontSize: 14, lineHeight: 1.8 }}>
                <li>Investment advice</li>
                <li>A research report</li>
                <li>A recommendation to buy, sell, or hold any security</li>
                <li>A trading call</li>
                <li>A price target</li>
              </ul>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: C.muted, lineHeight: 1.75 }}>
                All criteria and scores are automated mathematical calculations. No human analyst reviews or generates any output.
              </p>
              <p style={{ margin: 0, fontSize: 14, color: C.text, lineHeight: 1.75, fontWeight: 600 }}>
                Users are solely responsible for their own investment decisions. Consult a SEBI-registered adviser before making any financial decision. Past patterns do not predict future price behaviour.
              </p>
            </div>
          </Section>
        </div>
      </div>
    </>
  )
}
