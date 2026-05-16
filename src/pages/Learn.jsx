import { useNavigate } from 'react-router-dom'

/* ── Design tokens ─────────────────────────────────────────── */
const C = {
  bg: '#05070A', surface: '#0B0F18', card: '#0F141F',
  border: '#1E2530', text: '#E2E8F0', muted: '#64748B',
  faint: '#2D3748', sky: '#38BDF8', green: '#34D399',
  purple: '#A78BFA', amber: '#FBBF24', red: '#F87171',
  emerald: '#10B981', indigo: '#818CF8',
}

/* ── Tiny reusable atoms ───────────────────────────────────── */
function Chip({ children, color = C.sky }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
      textTransform: 'uppercase', padding: '3px 10px', borderRadius: 99,
      background: color + '18', color, border: `1px solid ${color}33`,
    }}>{children}</span>
  )
}

function SectionHead({ chip, chipColor, title, sub }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }}>
      {chip && <div style={{ marginBottom: 12 }}><Chip color={chipColor}>{chip}</Chip></div>}
      <h2 style={{
        fontSize: 'clamp(24px, 5vw, 38px)', fontWeight: 900,
        color: C.text, margin: '0 0 12px', letterSpacing: '-0.03em', lineHeight: 1.15,
      }}>{title}</h2>
      {sub && <p style={{ fontSize: 16, color: C.muted, margin: 0, lineHeight: 1.65, maxWidth: 560, marginInline: 'auto' }}>{sub}</p>}
    </div>
  )
}

/* ── Stage chart mockup ────────────────────────────────────── */
function StageChart() {
  const points = [
    [0,80],[8,78],[16,74],[24,76],[32,72],[40,68],[50,65],
    [60,67],[70,58],[80,50],[90,45],[100,42],[110,38],
    [120,34],[130,30],[140,28],[150,22],[160,18],[170,14],
    [180,16],[190,22],[200,28],[210,35],[220,38],[230,32],
    [240,26],[250,22],[260,16],[270,12],[280,8],[290,10],
    [300,6],
  ]
  const toSvg = ([x, y]) => `${x},${100 - y}`
  const poly = points.map(toSvg).join(' ')

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: C.card, border: `1px solid ${C.border}`, padding: '16px 16px 8px' }}>
      {/* Stage bands */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 6 }}>
        {[
          { label: 'Stage 1 · Base', color: C.muted, w: '25%' },
          { label: 'Stage 2 · Uptrend', color: C.green, w: '30%' },
          { label: 'Stage 3 · Top', color: C.amber, w: '20%' },
          { label: 'Stage 4 · Downtrend', color: C.red, w: '25%' },
        ].map((s, i) => (
          <div key={i} style={{ width: s.w, textAlign: 'center' }}>
            <div style={{ height: 3, background: s.color, borderRadius: 2, marginBottom: 4, opacity: 0.7 }} />
            <span style={{ fontSize: 9, color: s.color, fontWeight: 700, letterSpacing: '0.04em' }}>{s.label}</span>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 300 100" style={{ width: '100%', height: 120, display: 'block' }}>
        {/* Grid lines */}
        {[25, 50, 75].map(y => (
          <line key={y} x1="0" y1={100 - y} x2="300" y2={100 - y} stroke={C.border} strokeWidth="0.5" />
        ))}
        {/* MA line (smoother) */}
        <polyline
          points={points.map(([x, y]) => `${x},${100 - y + 8}`).join(' ')}
          fill="none" stroke={C.sky + '60'} strokeWidth="1.5" strokeDasharray="4 3"
        />
        {/* Price */}
        <polyline points={poly} fill="none" stroke={C.green} strokeWidth="2" strokeLinejoin="round" />
        {/* Stage 4 red */}
        <polyline
          points={points.slice(20).map(toSvg).join(' ')}
          fill="none" stroke={C.red} strokeWidth="2" strokeLinejoin="round"
        />
      </svg>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 16, height: 2, background: C.green, borderRadius: 1 }} />
          <span style={{ fontSize: 9, color: C.muted }}>Price</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 16, height: 1.5, background: C.sky + '80', borderRadius: 1, borderTop: `1px dashed ${C.sky}` }} />
          <span style={{ fontSize: 9, color: C.muted }}>30W MA</span>
        </div>
      </div>
    </div>
  )
}

/* ── MA visual ─────────────────────────────────────────────── */
function MAChart() {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 16px' }}>
      <svg viewBox="0 0 300 100" style={{ width: '100%', height: 110, display: 'block' }}>
        {/* Price bars */}
        {Array.from({ length: 40 }, (_, i) => {
          const x = i * 7.5 + 2
          const base = 30 + Math.sin(i / 3) * 15 + i * 0.8
          const h = 8 + Math.random() * 6
          const isGreen = i % 3 !== 0
          return <rect key={i} x={x} y={100 - base - h} width={5} height={h} fill={isGreen ? C.green + '80' : C.red + '80'} rx={1} />
        })}
        {/* 50 DMA */}
        <polyline
          points={Array.from({ length: 40 }, (_, i) => `${i * 7.5 + 4},${100 - (30 + i * 0.9 + Math.sin(i / 5) * 8)}`).join(' ')}
          fill="none" stroke={C.amber} strokeWidth="2" strokeLinejoin="round"
        />
        {/* 150 DMA */}
        <polyline
          points={Array.from({ length: 40 }, (_, i) => `${i * 7.5 + 4},${100 - (25 + i * 0.75 + Math.sin(i / 8) * 5)}`).join(' ')}
          fill="none" stroke={C.purple} strokeWidth="1.5" strokeLinejoin="round"
        />
        {/* 200 DMA */}
        <polyline
          points={Array.from({ length: 40 }, (_, i) => `${i * 7.5 + 4},${100 - (20 + i * 0.65 + Math.sin(i / 12) * 3)}`).join(' ')}
          fill="none" stroke={C.sky} strokeWidth="1.5" strokeLinejoin="round"
        />
      </svg>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        {[{ label: '50 DMA', color: C.amber }, { label: '150 DMA', color: C.purple }, { label: '200 DMA', color: C.sky }].map(m => (
          <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 18, height: 2.5, background: m.color, borderRadius: 1 }} />
            <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Delivery bar visual ───────────────────────────────────── */
function DeliveryViz() {
  const bars = [
    { label: 'Mon', del: 42, total: 100 },
    { label: 'Tue', del: 38, total: 100 },
    { label: 'Wed', del: 72, total: 100 },
    { label: 'Thu', del: 65, total: 100 },
    { label: 'Fri', del: 80, total: 100 },
  ]
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 16px' }}>
      <p style={{ fontSize: 11, color: C.muted, margin: '0 0 16px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Delivery % — Week view</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 80 }}>
        {bars.map((b, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: C.faint, position: 'relative', height: b.total + '%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ height: b.del + '%', background: b.del > 60 ? C.green : b.del > 45 ? C.amber : C.red, borderRadius: '4px 4px 0 0', transition: 'height 0.5s ease' }} />
            </div>
            <span style={{ fontSize: 9, color: C.muted }}>{b.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 6 }}>
        {[{ c: C.green, l: 'High (>60%) — Institutional accumulation' }, { c: C.amber, l: 'Normal (45–60%)' }, { c: C.red, l: 'Low (<45%) — Speculative' }].map(d => (
          <div key={d.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: d.c, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: C.muted }}>{d.l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── SwingX substage explainer ─────────────────────────────── */
const SwingXLearnSection = () => (
  <div style={{ marginBottom: 40 }}>
    <h2 style={{ fontSize: 20, fontWeight: 700, color: '#E2E8F0', marginBottom: 8 }}>
      Understanding SwingX Ratings
    </h2>

    <p style={{ fontSize: 14, color: '#94A3B8', lineHeight: 1.7, marginBottom: 20 }}>
      PineX uses Stan Weinstein's Stage Analysis framework. When a stock is in Stage 2 (uptrend
      phase), we further refine it into four substages to help you understand WHERE in the move
      the stock currently is.
    </p>

    {[
      {
        label: 'S2 A+',
        color: '#00C805',
        bg: 'rgba(0,200,5,.08)',
        border: 'rgba(0,200,5,.2)',
        title: 'Early Move — Confirmed',
        desc: 'Stock recently crossed above its 30-week moving average (within 15%). Institutional delivery is surging and the stock is outperforming the Nifty 50. This is the earliest and most favourable point in a Stage 2 move.',
        note: 'Historically the most favourable risk-reward zone in Stage 2.',
      },
      {
        label: 'S2 A-',
        color: '#86EFAC',
        bg: 'rgba(0,200,5,.04)',
        border: 'rgba(0,200,5,.15)',
        title: 'Early Move — Unconfirmed',
        desc: 'Stock is near its 30-week moving average but volume confirmation or relative strength vs Nifty is lacking. The move may be genuine but needs further evidence.',
        note: 'Watch for volume and RS to improve before drawing conclusions.',
      },
      {
        label: 'S2 B+',
        color: '#FBBF24',
        bg: 'rgba(251,191,36,.08)',
        border: 'rgba(251,191,36,.2)',
        title: 'Extended Move — Confirmed',
        desc: 'Stock has moved more than 15% above its 30-week moving average. The move is confirmed by institutional volume and strong relative strength. However the stock is extended and pullbacks to the MA are common.',
        note: 'Strong trend but consider waiting for a pullback toward the moving average.',
      },
      {
        label: 'S2 B-',
        color: '#F97316',
        bg: 'rgba(249,115,22,.08)',
        border: 'rgba(249,115,22,.2)',
        title: 'Extended Move — Unconfirmed',
        desc: 'Stock has moved far above its 30-week moving average without strong volume or relative strength support. The advance may be running on momentum alone.',
        note: 'Extended and unconfirmed — historically higher risk of reversal.',
      },
    ].map(s => (
      <div key={s.label} style={{
        background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10,
        padding: '16px 20px', marginBottom: 12, display: 'flex', gap: 16, alignItems: 'flex-start',
      }}>
        <span style={{
          fontSize: 12, fontWeight: 800, color: s.color, background: s.bg,
          border: `1px solid ${s.border}`, borderRadius: 5, padding: '3px 10px',
          flexShrink: 0, marginTop: 2, letterSpacing: '0.05em',
        }}>
          {s.label}
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0', marginBottom: 6 }}>
            {s.title}
          </div>
          <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, marginBottom: 8 }}>
            {s.desc}
          </div>
          <div style={{ fontSize: 11, color: s.color, fontStyle: 'italic' }}>
            {s.note}
          </div>
        </div>
      </div>
    ))}

    <div style={{ background: '#0F1217', border: '1px solid #1E2530', borderRadius: 10, padding: '16px 20px', marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        How it's calculated
      </div>
      {[
        {
          q: 'A or B?',
          a: 'Based on distance from the 30-week moving average. Within 15% = A (early). Beyond 15% = B (extended).',
        },
        {
          q: '+ or −?',
          a: 'Both conditions must be met: (1) Volume at least 2× the 20-week average — indicating institutional participation. (2) Stock outperforming Nifty 50 on a relative strength basis.',
        },
        {
          q: 'What is SwingX?',
          a: 'SwingX is our curated list of stocks showing S2 A+ or strong S2 signals — early-stage moves with institutional confirmation. Updated daily after market close.',
        },
      ].map((item, i, arr) => (
        <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < arr.length - 1 ? '1px solid #1E2530' : 'none' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0', marginBottom: 4 }}>{item.q}</div>
          <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>{item.a}</div>
        </div>
      ))}
    </div>

    <p style={{ fontSize: 11, color: '#475569', marginTop: 16, lineHeight: 1.6, fontStyle: 'italic' }}>
      All ratings are based on technical data only and are for educational and informational
      purposes. This is not investment advice. Past patterns do not guarantee future results.
      Please consult a SEBI-registered advisor before making investment decisions.
    </p>
  </div>
)

/* ── Main page ─────────────────────────────────────────────── */
export default function Learn() {
  const navigate = useNavigate()

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: '"DM Sans", system-ui, sans-serif' }}>

      {/* ══ HERO ══════════════════════════════════════════════ */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {/* Background blobs */}
        <div style={{ position: 'absolute', top: -80, left: '50%', transform: 'translateX(-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse, rgba(56,189,248,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, right: -80, width: 300, height: 300, background: 'radial-gradient(circle, rgba(167,139,250,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(48px,8vw,96px) 20px clamp(48px,6vw,72px)' }}>

          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 20 }}>
              <Chip color={C.sky}>The PineX Method</Chip>
            </div>
            <h1 style={{
              fontSize: 'clamp(32px, 7vw, 64px)', fontWeight: 900,
              letterSpacing: '-0.04em', lineHeight: 1.05, margin: '0 0 20px',
              background: 'linear-gradient(135deg, #E2E8F0 30%, #38BDF8 70%, #A78BFA 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Invest with clarity,<br />not guesswork.
            </h1>
            <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: C.muted, maxWidth: 560, margin: '0 auto 36px', lineHeight: 1.7 }}>
              PineX uses proven institutional methods — adapted from Stan Weinstein's stage analysis — to help you find stocks at the right time, with the right evidence.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/home')} style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #38BDF8, #818CF8)', color: '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer', letterSpacing: '-0.01em' }}>
                Explore Stocks →
              </button>
              <button onClick={() => document.getElementById('weinstein')?.scrollIntoView({ behavior: 'smooth' })} style={{ padding: '12px 24px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Learn the method
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Accent bar ── */}
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.sky}40, ${C.purple}40, transparent)` }} />

      {/* ══ QUICK STATS ══════════════════════════════════════ */}
      <div style={{ borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 24 }}>
          {[
            { n: '7 signals', l: 'Combined per stock', c: C.sky },
            { n: '4 stages', l: 'Weinstein framework', c: C.green },
            { n: '30W MA', l: 'Primary trend filter', c: C.purple },
            { n: 'Real data', l: 'NSE bhav copy daily', c: C.amber },
          ].map(s => (
            <div key={s.n} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 900, color: s.c, margin: '0 0 3px', letterSpacing: '-0.03em' }}>{s.n}</p>
              <p style={{ fontSize: 11, color: C.muted, margin: 0, fontWeight: 500 }}>{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 100px' }}>

        {/* ══ WEINSTEIN METHOD ════════════════════════════════ */}
        <section id="weinstein" style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Foundation"
            chipColor={C.sky}
            title="The Weinstein Stage Method"
            sub="Stan Weinstein — former editor of the Professional Tape Reader — discovered that every stock goes through 4 predictable stages. Buying in Stage 2 and selling before Stage 4 is the core of this system."
          />

          <StageChart />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 24 }}>
            {[
              {
                stage: '1', name: 'Basing', color: C.muted,
                icon: 'ti-minus',
                desc: 'Stock moves sideways after a downtrend. Volume dries up. Institutions quietly accumulate.',
                action: 'Watch — Not yet time to buy',
              },
              {
                stage: '2', name: 'Uptrend', color: C.green,
                icon: 'ti-trending-up',
                desc: 'Price breaks above the 30-week MA on rising volume. Stage 2 is the prime buying zone.',
                action: '✓ Buy zone — Best risk/reward',
              },
              {
                stage: '3', name: 'Top', color: C.amber,
                icon: 'ti-alert-triangle',
                desc: 'Stock stalls near highs. Volume spikes on down days. Distribution is happening.',
                action: '⚠ Reduce — Take partial profits',
              },
              {
                stage: '4', name: 'Downtrend', color: C.red,
                icon: 'ti-trending-down',
                desc: 'Price breaks below 30-week MA. Any rally is a selling opportunity.',
                action: '✗ Exit — Do not hold',
              },
            ].map(s => (
              <div key={s.stage} style={{ background: C.card, border: `1px solid ${s.color}30`, borderTop: `3px solid ${s.color}`, borderRadius: 12, padding: '18px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: s.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={`ti ${s.icon}`} style={{ fontSize: 14, color: s.color }} />
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 9, color: s.color, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Stage {s.stage}</p>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{s.name}</p>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 12px', lineHeight: 1.6 }}>{s.desc}</p>
                <div style={{ padding: '6px 10px', borderRadius: 6, background: s.color + '12', border: `1px solid ${s.color}25` }}>
                  <span style={{ fontSize: 11, color: s.color, fontWeight: 700 }}>{s.action}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.sky}`, borderRadius: 8, padding: '14px 16px', marginTop: 20 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.65 }}>
              <strong style={{ color: C.sky }}>Key insight:</strong> Most retail investors lose money because they buy during Stage 3 (when a stock looks exciting) and sell during Stage 4 (after a big loss). PineX shows you the stage of every stock so you never make that mistake.
            </p>
          </div>
        </section>

        {/* ══ SWINGX SUBSTAGES ════════════════════════════════ */}
        <section id="substages" style={{ paddingTop: 80 }}>
          <SwingXLearnSection />
        </section>

        {/* ══ MOVING AVERAGES ═════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Trend Filters"
            chipColor={C.amber}
            title="Moving Averages"
            sub="A moving average smooths out daily noise and shows you the real trend. Think of it as the stock's 'baseline velocity.'"
          />

          <MAChart />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 24 }}>
            {[
              {
                name: '50-Day MA', short: '50 DMA', color: C.amber, icon: 'ti-wave-sine',
                period: '~10 weeks of trading',
                use: 'Short-term trend. The first line institutions defend. A breach often signals weakness.',
                rule: 'Closing below 50 DMA = early warning to reduce position.',
              },
              {
                name: '150-Day MA', short: '150 DMA', color: C.purple, icon: 'ti-wave-sine',
                period: '~30 weeks of trading',
                use: 'Medium-term trend anchor. Price should stay above this in any healthy uptrend.',
                rule: 'Closing below 150 DMA = major trend concern.',
              },
              {
                name: '200-Day MA', short: '200 DMA', color: C.sky, icon: 'ti-wave-sine',
                period: '~40 weeks of trading',
                use: 'The gold standard of long-term trend. Mutual funds and FIIs use this as a benchmark.',
                rule: 'Golden cross (50 crosses above 200) = strong bull signal.',
              },
              {
                name: '30-Week MA', short: '30W MA', color: C.green, icon: 'ti-wave-sine',
                period: '~150 trading days',
                use: 'Weinstein\'s primary tool. Equivalent to ~150 DMA. This is the line that separates Stage 2 from Stage 4.',
                rule: 'Stage 2 starts when price closes above rising 30W MA.',
              },
            ].map(m => (
              <div key={m.name} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 16px' }}>
                <div style={{ display: 'flex', align: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>{m.name}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: C.muted }}>{m.period}</p>
                  </div>
                  <Chip color={m.color}>{m.short}</Chip>
                </div>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 10px', lineHeight: 1.6 }}>{m.use}</p>
                <div style={{ height: 1, background: C.border, margin: '10px 0' }} />
                <p style={{ fontSize: 11, color: m.color, margin: 0, fontWeight: 600, lineHeight: 1.5 }}>→ {m.rule}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ══ 50 DMA RULE ═════════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Sell Discipline"
            chipColor={C.red}
            title="Why the 50 DMA Matters Most"
            sub="The 50-day moving average is where institutional buyers step in — and where they step out."
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.green}30`, borderRadius: 14, padding: '24px 20px' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: C.green + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <i className="ti ti-trending-up" style={{ fontSize: 20, color: C.green }} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: C.green, margin: '0 0 10px' }}>Above 50 DMA</h3>
              <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.7 }}>
                Institutions are defending the price. The stock is in short-term uptrend mode. Every dip to the 50 DMA is a potential buying opportunity if the broader trend is Stage 2.
              </p>
              <ul style={{ fontSize: 12, color: C.muted, margin: '12px 0 0', paddingLeft: 16, lineHeight: 1.8 }}>
                <li>Hold your position</li>
                <li>Add on pullbacks to 50 DMA</li>
                <li>Momentum is on your side</li>
              </ul>
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.red}30`, borderRadius: 14, padding: '24px 20px' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: C.red + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <i className="ti ti-trending-down" style={{ fontSize: 20, color: C.red }} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: C.red, margin: '0 0 10px' }}>Below 50 DMA</h3>
              <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.7 }}>
                This is a warning signal. Institutions may be exiting. A stock that can't hold above its 50 DMA often continues lower. The risk/reward shifts against you immediately.
              </p>
              <ul style={{ fontSize: 12, color: C.muted, margin: '12px 0 0', paddingLeft: 16, lineHeight: 1.8 }}>
                <li>Reduce position size</li>
                <li>Do not average down</li>
                <li>Watch for Stage 4 confirmation</li>
              </ul>
            </div>
          </div>

          <div style={{ background: 'linear-gradient(135deg, rgba(248,113,113,0.06), rgba(251,191,36,0.04))', border: `1px solid ${C.red}25`, borderRadius: 12, padding: '20px', marginTop: 20 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.7 }}>
              <strong style={{ color: C.amber }}>The most common mistake:</strong> Investors hold a stock "because the fundamentals are good" even as it slides below all its moving averages. PineX flags this automatically. <em style={{ color: C.muted }}>Good companies can have terrible stock charts — don't confuse the two.</em>
            </p>
          </div>
        </section>

        {/* ══ DELIVERY VOLUME ═════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Smart Money Signal"
            chipColor={C.green}
            title="Delivery Volume"
            sub="Volume tells you how many shares traded. Delivery tells you how many people actually wanted to keep them."
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 16px' }}>
              <p style={{ fontSize: 12, color: C.muted, margin: '0 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Total Volume</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: '0 0 8px' }}>All trades — includes day traders who buy and sell the same day</p>
              <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>A high volume day could be purely speculative — nobody actually wants to hold the stock overnight.</p>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.green}30`, borderRadius: 12, padding: '20px 16px' }}>
              <p style={{ fontSize: 12, color: C.green, margin: '0 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Delivery Volume</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: '0 0 8px' }}>Shares delivered to demat accounts — real investors taking real positions</p>
              <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>High delivery % means strong conviction — institutions and long-term investors are accumulating.</p>
            </div>
          </div>

          <DeliveryViz />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
            {[
              { pct: '> 60%', label: 'High conviction', color: C.green, desc: 'Strong institutional interest. Look for breakouts.' },
              { pct: '45–60%', label: 'Normal activity', color: C.amber, desc: 'Balanced. Neutral signal on its own.' },
              { pct: '< 40%', label: 'Speculative', color: C.red, desc: 'Day-trader dominated. Be cautious of breakouts.' },
            ].map(d => (
              <div key={d.label} style={{ background: C.card, border: `1px solid ${d.color}25`, borderRadius: 10, padding: '14px 14px' }}>
                <p style={{ fontSize: 20, fontWeight: 900, color: d.color, margin: '0 0 2px', letterSpacing: '-0.02em' }}>{d.pct}</p>
                <p style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>{d.label}</p>
                <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>{d.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.green}`, borderRadius: 8, padding: '14px 16px', marginTop: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.65 }}>
              <strong style={{ color: C.green }}>PineX shows:</strong> Today's delivery %, 7-day average, 30-day average, and whether today's delivery is unusually high vs the 30D norm. A spike in delivery % on a breakout day is one of the strongest buy confirmations.
            </p>
          </div>
        </section>

        {/* ══ RS vs NIFTY ═════════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Relative Strength"
            chipColor={C.indigo}
            title="RS vs Nifty"
            sub="You don't want a stock that moves with the market — you want one that beats it."
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 20px' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: '0 0 12px' }}>What is it?</h3>
              <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.7 }}>
                RS (Relative Strength) measures how a stock's 1-year return compares to the Nifty 50 index. If Nifty gained 10% and your stock gained 25%, the RS is <strong style={{ color: C.green }}>+15%</strong> — it outperformed.
              </p>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 20px' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: '0 0 12px' }}>Why it matters</h3>
              <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.7 }}>
                Research by William O'Neil found that the best-performing stocks showed strong RS <em>before</em> their biggest moves. A stock outperforming in a weak market is showing hidden demand.
              </p>
            </div>
          </div>

          {/* RS visual */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px', marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {[
                { sym: 'STOCK A', rs: +32, desc: 'Leader — likely in Stage 2' },
                { sym: 'STOCK B', rs: +8, desc: 'In-line — average performer' },
                { sym: 'STOCK C', rs: -5, desc: 'Laggard — avoid or short' },
                { sym: 'STOCK D', rs: -18, desc: 'Weak — Stage 4 candidate' },
              ].map(s => (
                <div key={s.sym} style={{ textAlign: 'center', padding: '14px 10px', background: C.surface, borderRadius: 10, border: `1px solid ${s.rs > 0 ? C.green + '30' : C.red + '30'}` }}>
                  <p style={{ fontSize: 11, color: C.muted, margin: '0 0 4px', fontWeight: 700 }}>{s.sym}</p>
                  <p style={{ fontSize: 22, fontWeight: 900, color: s.rs > 15 ? C.green : s.rs > 0 ? C.amber : C.red, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                    {s.rs > 0 ? '+' : ''}{s.rs}%
                  </p>
                  <p style={{ fontSize: 10, color: C.muted, margin: 0 }}>{s.desc}</p>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: C.faint, margin: '12px 0 0', textAlign: 'center' }}>Relative to Nifty 50 — 1 year return</p>
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.indigo}`, borderRadius: 8, padding: '14px 16px', marginTop: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.65 }}>
              <strong style={{ color: C.indigo }}>PineX rule:</strong> Only consider stocks with positive RS (ideally &gt;+10%). If the stock can't beat the index, why take the stock-specific risk?
            </p>
          </div>
        </section>

        {/* ══ RSI ═════════════════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Momentum"
            chipColor={C.amber}
            title="RSI — Relative Strength Index"
            sub="RSI tells you whether a stock is gaining or losing momentum. It's a speedometer, not a price target."
          />

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 20px', marginBottom: 20 }}>
            {/* RSI bar */}
            <div style={{ position: 'relative', marginBottom: 24 }}>
              <div style={{ height: 10, borderRadius: 99, background: `linear-gradient(90deg, ${C.red}, ${C.amber} 30%, ${C.amber} 50%, ${C.green} 70%, ${C.red})`, marginBottom: 8 }} />
              {[
                { x: '0%', label: '0', color: C.red },
                { x: '30%', label: '30\nOversold', color: C.amber },
                { x: '50%', label: '50', color: C.muted },
                { x: '70%', label: '70\nOverbought', color: C.amber },
                { x: '100%', label: '100', color: C.red },
              ].map(t => (
                <span key={t.label} style={{ position: 'absolute', left: t.x, transform: 'translateX(-50%)', fontSize: 9, color: t.color, fontWeight: 700, textAlign: 'center', top: 14, whiteSpace: 'pre' }}>{t.label}</span>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 28 }}>
              {[
                { range: 'Below 30', label: 'Oversold', color: C.sky, desc: 'Stock may have fallen too fast. Potential bounce zone — but confirm the overall trend before buying.' },
                { range: '40 – 60', label: 'Neutral', color: C.muted, desc: 'Normal range for healthy stocks in an uptrend. RSI often "resets" to 40–50 during Stage 2 pullbacks.' },
                { range: 'Above 70', label: 'Overbought', color: C.amber, desc: 'Strong momentum, but extended. In a powerful Stage 2 stock, RSI can stay above 70 for weeks — don\'t sell early.' },
              ].map(r => (
                <div key={r.range} style={{ padding: '14px', background: C.surface, borderRadius: 10, border: `1px solid ${r.color}25` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{r.range}</span>
                    <Chip color={r.color}>{r.label}</Chip>
                  </div>
                  <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>{r.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.amber}`, borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.65 }}>
              <strong style={{ color: C.amber }}>PineX uses RSI as a filter, not a signal.</strong> We flag stocks where RSI is healthy (45–70) inside a Stage 2 uptrend. Buying oversold RSI in a Stage 4 downtrend is one of the most dangerous mistakes in trading.
            </p>
          </div>
        </section>

        {/* ══ SHAREHOLDING ════════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Ownership Intelligence"
            chipColor={C.purple}
            title="Shareholding Pattern"
            sub="Who owns the stock is as important as what the stock does. Follow the smart money."
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            {[
              {
                name: 'Promoter', color: C.purple, icon: 'ti-building-skyscraper',
                good: 'Rising promoter holding = confidence in the business',
                bad: 'Falling promoter or high pledge = serious warning',
                tip: 'Promoter pledge above 20% is a red flag — forced selling risk.',
              },
              {
                name: 'FII', color: C.sky, icon: 'ti-world',
                good: 'Rising FII = foreign institutional confidence',
                bad: 'FII exiting = risk-off signal for the stock',
                tip: 'FII often lead price discovery. Watch their trend over 4 quarters.',
              },
              {
                name: 'DII', color: C.green, icon: 'ti-home',
                good: 'Rising DII = domestic mutual funds accumulating',
                bad: 'DII often buys on dips — useful for finding support zones',
                tip: 'DII + FII both rising = strongest ownership signal.',
              },
              {
                name: 'Public', color: C.amber, icon: 'ti-users',
                good: 'Some public float is healthy for liquidity',
                bad: 'Rising public % with falling promoter/FII = distribution',
                tip: 'Stock getting "retail-heavy" often coincides with a Stage 3 top.',
              },
            ].map(s => (
              <div key={s.name} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: s.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={`ti ${s.icon}`} style={{ fontSize: 16, color: s.color }} />
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{s.name}</span>
                </div>
                <p style={{ fontSize: 11, color: C.green, margin: '0 0 4px', fontWeight: 600 }}>↑ {s.good}</p>
                <p style={{ fontSize: 11, color: C.red, margin: '0 0 10px', fontWeight: 600 }}>↓ {s.bad}</p>
                <div style={{ height: 1, background: C.border, margin: '10px 0' }} />
                <p style={{ fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.5 }}>💡 {s.tip}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ══ SECTOR IMPORTANCE ═══════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Sector Analysis"
            chipColor={C.emerald}
            title="Why Sector Matters in Stock Picking"
            sub="A great stock in a bad sector rarely wins. A good stock in a hot sector can become a multi-bagger."
          />

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 20px', marginBottom: 20 }}>
            <p style={{ fontSize: 14, color: C.text, margin: '0 0 20px', lineHeight: 1.7 }}>
              Studies by William O'Neil showed that <strong style={{ color: C.emerald }}>over 50% of a stock's move is driven by the sector it belongs to.</strong> If the sector is weak, even the strongest company will struggle.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {[
                { label: 'Sector leads', icon: 'ti-chart-bar', desc: 'Strong sector = wind at your back. Stocks in leading sectors break out more reliably.', color: C.green },
                { label: 'Sector lags', icon: 'ti-chart-bar-off', desc: 'Weak sector = headwind. Even quality stocks face more resistance.', color: C.red },
                { label: 'Stage 2 stocks in top sectors', icon: 'ti-rocket', desc: 'The best setups are Stage 2 breakouts in the top-performing Nifty sectors.', color: C.sky },
              ].map(s => (
                <div key={s.label} style={{ padding: '14px', background: C.surface, borderRadius: 10, border: `1px solid ${s.color}25` }}>
                  <i className={`ti ${s.icon}`} style={{ fontSize: 18, color: s.color, display: 'block', marginBottom: 8 }} />
                  <p style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: '0 0 6px' }}>{s.label}</p>
                  <p style={{ fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.6 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.emerald}`, borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.65 }}>
              <strong style={{ color: C.emerald }}>PineX shows:</strong> All Nifty sector indices with 1D/1W/1M/3M performance. Use the Sector Performance tab on the home screen to identify which sectors have momentum before picking individual stocks.
            </p>
          </div>
        </section>

        {/* ══ UPTREND / DOWNTREND ═════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Market Direction"
            chipColor={C.sky}
            title="Uptrend vs Downtrend"
            sub="The simplest rule in investing: never swim against the current."
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {[
              {
                name: 'Uptrend', color: C.green, icon: 'ti-trending-up',
                rules: [
                  'Price makes higher highs and higher lows',
                  'Price is above 30W / 150 DMA',
                  '30W MA is sloping upward',
                  'Volume expands on up days',
                ],
                action: 'Buy breakouts, add on dips to MA, let winners run',
              },
              {
                name: 'Downtrend', color: C.red, icon: 'ti-trending-down',
                rules: [
                  'Price makes lower highs and lower lows',
                  'Price is below 30W / 150 DMA',
                  '30W MA is sloping downward',
                  'Volume expands on down days',
                ],
                action: 'Sell rallies, reduce exposure, preserve capital',
              },
            ].map(t => (
              <div key={t.name} style={{ background: C.card, border: `1px solid ${t.color}30`, borderRadius: 14, padding: '24px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: t.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={`ti ${t.icon}`} style={{ fontSize: 18, color: t.color }} />
                  </div>
                  <span style={{ fontSize: 18, fontWeight: 900, color: t.color }}>{t.name}</span>
                </div>
                <ul style={{ fontSize: 13, color: C.muted, margin: '0 0 16px', paddingLeft: 18, lineHeight: 1.85 }}>
                  {t.rules.map(r => <li key={r}>{r}</li>)}
                </ul>
                <div style={{ padding: '10px 14px', borderRadius: 8, background: t.color + '10', border: `1px solid ${t.color}25` }}>
                  <span style={{ fontSize: 12, color: t.color, fontWeight: 700 }}>Action: {t.action}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ SWINGX ══════════════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="SwingX"
            chipColor={C.green}
            title="What is SwingX?"
            sub="SwingX identifies stocks where all five technical conditions align simultaneously."
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { n: '1', label: 'Uptrend phase', desc: 'Stage 2 — price above rising 30W MA', color: C.green, icon: 'ti-trending-up' },
              { n: '2', label: 'Above key MAs', desc: 'Price above both 30W MA and 50D MA', color: C.sky, icon: 'ti-chart-line' },
              { n: '3', label: 'MA rising', desc: '30W moving average slope is positive', color: C.purple, icon: 'ti-arrow-up-right' },
              { n: '4', label: 'Delivery activity', desc: '30-day avg delivery above 40% with rising trend', color: C.amber, icon: 'ti-package' },
              { n: '5', label: 'Near entry zone', desc: 'Less than 15% extended from 30W MA', color: C.emerald, icon: 'ti-target' },
            ].map(s => (
              <div key={s.n} style={{ background: C.card, border: `1px solid ${s.color}30`, borderTop: `3px solid ${s.color}`, borderRadius: 12, padding: '16px 14px' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: s.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                  <i className={`ti ${s.icon}`} style={{ fontSize: 14, color: s.color }} />
                </div>
                <p style={{ margin: '0 0 4px', fontSize: 9, color: s.color, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Signal {s.n}</p>
                <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: C.text }}>{s.label}</p>
                <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.55 }}>{s.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.green}30`, borderLeft: `3px solid ${C.green}`, borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.65 }}>
              <strong style={{ color: C.green }}>⚡ SwingX</strong> stocks appear in the SwingX filter on the home screen. When all five signals align, the stock is in an optimal swing-trade setup — confirmed uptrend, institutional participation, and not over-extended. <em style={{ color: C.muted }}>Data is for educational purposes only. Not investment advice.</em>
            </p>
          </div>
        </section>

        {/* ══ HOW TO USE PINEX ════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <SectionHead
            chip="Getting Started"
            chipColor={C.sky}
            title="How to Use PineX"
            sub="A simple 5-step workflow for finding and tracking the best opportunities."
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              {
                step: '01', title: 'Check the Market Pulse', icon: 'ti-chart-bar',
                color: C.sky,
                desc: 'Every day, check the top bar: Nifty trend, VIX level, and Breadth. If breadth is below 40% and VIX is above 20, reduce new positions.',
                where: 'Home screen → market bar',
              },
              {
                step: '02', title: 'Identify hot sectors', icon: 'ti-layers-intersect',
                color: C.emerald,
                desc: 'Switch to Sector Performance tab. Find sectors with strong 1W and 1M returns. Only look for stocks within leading sectors.',
                where: 'Home → Sector Performance',
              },
              {
                step: '03', title: 'Screen for Stage 2 stocks', icon: 'ti-filter',
                color: C.purple,
                desc: 'Use the Screener to filter: Stage 2, Above 30W MA, positive RS vs Nifty, high delivery %. These are your candidates.',
                where: 'Screener page',
              },
              {
                step: '04', title: 'Analyse each candidate', icon: 'ti-zoom-in',
                color: C.amber,
                desc: 'Check the Delivery tab (7D/30D avg delivery), Ownership tab (is FII rising?), and Technicals. Look for all signals aligned.',
                where: 'Stock page → Delivery & Ownership tabs',
              },
              {
                step: '05', title: 'Add to watchlist and set alerts', icon: 'ti-bookmark',
                color: C.green,
                desc: 'Add to your watchlist. When a stock breaks out of a proper base on high delivery volume with rising FII, that\'s your signal.',
                where: 'Star icon on any stock page',
              },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 18px', alignItems: 'flex-start' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: s.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={`ti ${s.icon}`} style={{ fontSize: 20, color: s.color }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: s.color, fontWeight: 800, letterSpacing: '0.1em' }}>STEP {s.step}</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{s.title}</span>
                  </div>
                  <p style={{ fontSize: 13, color: C.muted, margin: '0 0 8px', lineHeight: 1.7 }}>{s.desc}</p>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: s.color, fontWeight: 600 }}>
                    <i className="ti ti-map-pin" style={{ fontSize: 12 }} /> {s.where}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ CTA ═════════════════════════════════════════════ */}
        <section style={{ paddingTop: 80 }}>
          <div style={{
            position: 'relative', borderRadius: 20, overflow: 'hidden',
            background: 'linear-gradient(135deg, #060D1A 0%, #0A1628 50%, #06101E 100%)',
            border: `1px solid ${C.border}`,
            padding: 'clamp(32px,6vw,56px) clamp(24px,4vw,48px)',
            textAlign: 'center',
          }}>
            {/* Background glows */}
            <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, background: 'radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -40, left: -40, width: 160, height: 160, background: 'radial-gradient(circle, rgba(167,139,250,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative' }}>
              <div style={{ marginBottom: 16 }}><Chip color={C.sky}>Start investing smarter</Chip></div>
              <h2 style={{
                fontSize: 'clamp(24px, 5vw, 40px)', fontWeight: 900,
                letterSpacing: '-0.03em', lineHeight: 1.1, margin: '0 0 16px',
                background: 'linear-gradient(135deg, #E2E8F0, #38BDF8)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                You now know the method.<br />Time to find your next stock.
              </h2>
              <p style={{ fontSize: 15, color: C.muted, margin: '0 auto 32px', maxWidth: 460, lineHeight: 1.65 }}>
                PineX applies every concept on this page — automatically — to every NSE-listed stock, every day.
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => navigate('/home')} style={{ padding: '13px 32px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #38BDF8, #818CF8)', color: '#000', fontWeight: 800, fontSize: 15, cursor: 'pointer', letterSpacing: '-0.01em' }}>
                  Explore the Screener →
                </button>
                <button onClick={() => navigate('/screener')} style={{ padding: '13px 24px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  View Screener
                </button>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
