/**
 * /help — Comprehensive how-to-read guide.
 *
 * Five fixed sections, copy verbatim from the rework spec:
 *   1. What is PineX
 *   2. How to read cycle stages
 *   3. How to read market breadth
 *   4. How to read historical conditions
 *   5. How to read SwingX
 *
 * Reading model:
 *   - Desktop (≥ 768 px): all sections rendered open. Summary
 *     chevrons hidden; the page reads as one long article.
 *   - Mobile (< 768 px): each section is a collapsible <details>
 *     element starting open. User can tap to collapse.
 *
 * Anchor links at the top of the page jump to each section
 * (#what-is-pinex etc.).
 *
 * Pure markup + PineX colour tokens via the C object. No new
 * components, no chart libraries, no animations. Monospace blocks
 * for the inline distribution example.
 */
import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { C, FONTS } from '../styles/tokens'

const SECTIONS = [
  { id: 'what-is-pinex',         title: '1. What is PineX' },
  { id: 'cycle-stages',          title: '2. How to read cycle stages' },
  { id: 'market-breadth',        title: '3. How to read market breadth' },
  { id: 'historical-conditions', title: '4. How to read historical conditions' },
  { id: 'swingx',                title: '5. How to read SwingX' },
]

// useMediaQuery — read once at mount + listen for viewport
// changes. Used to flip <details> from "collapsible on mobile" to
// "always open on desktop".
function useIsDesktop(breakpoint = 768) {
  const get = () => typeof window !== 'undefined'
    && window.matchMedia(`(min-width: ${breakpoint}px)`).matches
  const [v, setV] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const fn = (e) => setV(e.matches)
    mql.addEventListener?.('change', fn)
    return () => mql.removeEventListener?.('change', fn)
  }, [breakpoint])
  return v
}

export default function Help() {
  const isDesktop = useIsDesktop(768)

  return (
    <>
      <Helmet>
        <title>How to read PineX · Help</title>
      </Helmet>

      <div style={page}>
        <header style={headerWrap}>
          <h1 style={pageTitle}>How to read PineX</h1>
          <p style={pageLede}>
            A short guide to the five things that show up on most
            PineX pages. No jargon, no formulas — just the read.
          </p>

          {/* ── Table of contents — anchor links ─────────────── */}
          <nav aria-label="Sections" style={tocWrap}>
            {SECTIONS.map((s, i) => (
              <a key={s.id} href={`#${s.id}`} style={tocLink}>
                {s.title}
                {i < SECTIONS.length - 1 && <span style={tocSep}>·</span>}
              </a>
            ))}
          </nav>
        </header>

        <Section id="what-is-pinex" title="1. What is PineX" isDesktop={isDesktop}>
          <P>
            PineX is a market behaviour exploration platform for
            Indian equities.
          </P>
          <P>
            It shows you how the market has behaved under similar
            conditions in the past.
          </P>
          <P>
            It does <strong>NOT</strong> tell you what to buy or
            sell. It does <strong>NOT</strong> predict future
            prices. It shows you historical context — you draw
            your own conclusions.
          </P>
        </Section>

        <Section id="cycle-stages" title="2. How to read cycle stages" isDesktop={isDesktop}>
          <P>
            Every NSE stock is classified daily into one of four
            stages:
          </P>

          <StageHeader>STAGE 1 — BASING</StageHeader>
          <P>
            Stock is moving sideways after a decline. Sellers are
            exhausted. Buyers not yet active.
          </P>
          <Observe>
            What to observe: Is volume contracting? Is price
            stabilising above 30W MA?
          </Observe>

          <StageHeader>STAGE 2 — ADVANCING</StageHeader>
          <P>
            Stock is in an uptrend above 30W MA. Volume confirming
            the move. Relative strength positive vs Nifty.
          </P>
          <Observe>
            What to observe: How long has it been in Stage 2?
            Is RS strengthening or fading?
          </Observe>

          <StageHeader>STAGE 3 — TOPPING</StageHeader>
          <P>
            Uptrend weakening. Price still high but momentum
            fading.
          </P>
          <Observe>
            What to observe: Is volume declining on up days?
            Is RS turning negative?
          </Observe>

          <StageHeader>STAGE 4 — DECLINING</StageHeader>
          <P>
            Stock below 30W MA. Downtrend active.
          </P>
          <Observe>
            What to observe: Is volume expanding on down days?
            Any Stage 1 signs yet?
          </Observe>

          <StageHeader>SUBSTAGES (2A-, 2A, 2A+, 2B-, 2B, 2B+)</StageHeader>
          <P>
            <strong>Early stage (2A-)</strong> = just entered Stage 2.
            <br />
            <strong>Mature stage (2B+)</strong> = well established
            but later in the cycle.
          </P>
        </Section>

        <Section id="market-breadth" title="3. How to read market breadth" isDesktop={isDesktop}>
          <StageHeader>% STOCKS ABOVE 30W MA</StageHeader>
          <P>
            The most important breadth indicator. Shows what
            percentage of all 2,125 NSE stocks are in uptrends.
          </P>
          <ul style={list}>
            <li><strong>Above 60%</strong> &nbsp;= broad market strength</li>
            <li><strong>40–60%</strong> &nbsp;&nbsp;&nbsp;&nbsp;= mixed conditions</li>
            <li><strong>Below 40%</strong> &nbsp;= broad market weakness</li>
          </ul>

          <Callout label="Key insight">
            When Nifty is rising but this % is falling — that is a
            divergence worth watching. Fewer stocks are
            participating in the index move.
          </Callout>

          <StageHeader>AD LINE (Advance-Decline)</StageHeader>
          <P>
            Counts advancing stocks minus declining stocks —
            cumulative.
          </P>
          <ul style={list}>
            <li><strong>Rising AD line</strong> = broad participation</li>
            <li><strong>Falling AD line</strong> = narrowing market</li>
          </ul>

          <StageHeader>NEW 52W HIGHS vs LOWS</StageHeader>
          <ul style={list}>
            <li>More new highs than lows = healthy market</li>
            <li>More new lows than highs = deteriorating conditions</li>
          </ul>
        </Section>

        <Section id="historical-conditions" title="4. How to read historical conditions" isDesktop={isDesktop}>
          <P>
            When you see a distribution like this:
          </P>
          {/* Inline monospace example — copy verbatim from spec. */}
          <pre style={monoBlock}>
{`After 30 days in similar conditions:
+20%+      ████ 18%
+10-20%    █████ 32%
0-10%      ████ 24%
0 to -10%  ████ 20%
-10%+      ██ 6%`}
          </pre>

          <StageHeader>HOW TO READ IT</StageHeader>
          <P>
            This shows what <strong>ACTUALLY HAPPENED</strong> in
            the past — not what will happen.
          </P>

          <StageHeader>Sample size matters</StageHeader>
          <ul style={list}>
            <li><strong>Less than 30 instances</strong> = too few, treat with caution</li>
            <li><strong>30–100 instances</strong> = moderate confidence</li>
            <li><strong>100+ instances</strong> = more reliable pattern</li>
          </ul>

          <StageHeader>The range matters more than the median</StageHeader>
          <P>
            If range is <strong>−22% to +38%</strong> — outcomes
            were highly variable. That tells you: this condition
            does <strong>NOT</strong> produce consistent results.
          </P>

          <StageHeader>What NOT to do</StageHeader>
          <P>
            Do not use this to decide to buy or sell. Use it to
            understand the range of possible outcomes under
            similar conditions.
          </P>
        </Section>

        <Section id="swingx" title="5. How to read SwingX" isDesktop={isDesktop}>
          <P>
            SwingX shows stocks currently in active Stage 2 cycle
            conditions with volume and RS confirmation.
          </P>

          <StageHeader>WARNING LEVELS</StageHeader>
          <ul style={list}>
            <li><strong>None</strong> = conditions holding</li>
            <li><strong>New entry grace</strong> = recently entered, still within grace period</li>
            <li><strong>Watch</strong> = one or more conditions weakening</li>
          </ul>

          <StageHeader>SUBSTAGE PROGRESSION</StageHeader>
          <pre style={monoBlock}>
{`2A- → 2A → 2A+ → 2B- → 2B → 2B+
Early → Maturing → Late cycle`}
          </pre>

          <StageHeader>HOW TO USE</StageHeader>
          <P>
            SwingX is <strong>NOT</strong> a buy list. It shows
            which stocks are currently exhibiting active cycle
            conditions.
          </P>
          <P>Use it to:</P>
          <ul style={list}>
            <li>Understand market participation</li>
            <li>See which sectors are strongest</li>
            <li>Track whether conditions are strengthening or weakening</li>
          </ul>
        </Section>

        <footer style={footerWrap}>
          <p style={footerCopy}>
            PineX shows how market conditions have behaved
            historically. It does not provide investment advice,
            recommendations, or predictions. All data is
            end-of-day. Past conditions do not guarantee future
            outcomes.
          </p>
        </footer>
      </div>
    </>
  )
}

// ── Section primitive ───────────────────────────────────────
//
// On desktop the whole section is rendered as a plain <section>
// (always open, no chrome). On mobile it's a collapsible
// <details> starting open — tap the heading to collapse.

function Section({ id, title, isDesktop, children }) {
  if (isDesktop) {
    return (
      <section id={id} style={sectionDesktop}>
        <SectionRule />
        <h2 style={sectionTitle}>{title}</h2>
        <div style={sectionBody}>{children}</div>
      </section>
    )
  }
  return (
    <details id={id} open style={sectionMobile}>
      <summary style={summaryStyle}>{title}</summary>
      <div style={sectionBody}>{children}</div>
    </details>
  )
}

function P({ children }) {
  return <p style={paraStyle}>{children}</p>
}

function StageHeader({ children }) {
  return <h3 style={stageHeaderStyle}>{children}</h3>
}

function Observe({ children }) {
  return <p style={observeStyle}>{children}</p>
}

function Callout({ label, children }) {
  return (
    <div style={calloutWrap}>
      <div style={calloutLabel}>{label}</div>
      <div style={calloutBody}>{children}</div>
    </div>
  )
}

function SectionRule() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: C.border,
        marginBottom: 18,
      }}
    />
  )
}

// ── Inline styles — typography-first, flat, no shadows ─────

const page = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '24px 18px 64px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: C.text,
  lineHeight: 1.65,
}

const headerWrap = { marginBottom: 24 }

const pageTitle = {
  margin: '0 0 6px',
  fontSize: 26,
  fontWeight: 800,
  color: C.text,
  letterSpacing: '-0.02em',
  lineHeight: 1.2,
}

const pageLede = {
  margin: 0,
  fontSize: 14,
  color: C.textMuted,
  lineHeight: 1.55,
}

const tocWrap = {
  marginTop: 16,
  padding: '12px 14px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  alignItems: 'center',
  fontSize: 12,
}

const tocLink = {
  color: C.amber,
  textDecoration: 'none',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
}

const tocSep = {
  margin: '0 8px',
  color: C.border,
  fontWeight: 400,
}

const sectionDesktop = {
  scrollMarginTop: 16,
  marginTop: 32,
}

const sectionMobile = {
  scrollMarginTop: 16,
  marginTop: 16,
  background: C.surface,
  border: `1px solid ${C.border}`,
  padding: '14px 16px',
}

const sectionTitle = {
  margin: '0 0 14px',
  fontSize: 20,
  fontWeight: 800,
  color: C.text,
  letterSpacing: '-0.01em',
}

const summaryStyle = {
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 800,
  color: C.text,
  listStyle: 'none',
  padding: '4px 0',
}

const sectionBody = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const paraStyle = {
  margin: '4px 0',
  fontSize: 14,
  color: C.text,
  lineHeight: 1.65,
}

const stageHeaderStyle = {
  margin: '14px 0 4px',
  fontFamily: FONTS.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: C.textMuted,
}

const observeStyle = {
  margin: '0 0 4px',
  fontSize: 13,
  color: C.textMuted,
  fontStyle: 'italic',
  lineHeight: 1.55,
}

const list = {
  margin: '4px 0 8px',
  padding: '0 0 0 18px',
  fontSize: 14,
  color: C.text,
  lineHeight: 1.7,
}

const calloutWrap = {
  margin: '10px 0',
  padding: '10px 12px',
  background: C.surface2,
  border: `1px solid ${C.border}`,
}

const calloutLabel = {
  fontFamily: FONTS.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: C.amber,
  marginBottom: 4,
}

const calloutBody = {
  fontSize: 13,
  color: C.text,
  lineHeight: 1.55,
}

const monoBlock = {
  margin: '8px 0',
  padding: '12px 14px',
  background: C.surface2,
  border: `1px solid ${C.border}`,
  fontFamily: FONTS.mono,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: C.text,
  whiteSpace: 'pre',
  overflowX: 'auto',
}

const footerWrap = {
  marginTop: 40,
  paddingTop: 16,
  borderTop: `1px solid ${C.border}`,
}

const footerCopy = {
  margin: 0,
  fontSize: 11,
  fontStyle: 'italic',
  color: C.textFaint,
  textAlign: 'center',
  lineHeight: 1.6,
}
