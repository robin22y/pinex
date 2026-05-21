import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'

// ─── SVG helpers ─────────────────────────────────────────────────────────────

const P = (arr) => arr.map(([x, y]) => `${x},${y}`).join(' ')

// ─── Module 1 charts ─────────────────────────────────────────────────────────

function JourneyChart({ big }) {
  const h = big ? 100 : 82
  const zones = [
    { x: 0,   w: 70,  color: C.textMuted, bg: 'rgba(148,158,171,0.07)', label: 'Stage 1' },
    { x: 70,  w: 95,  color: C.green,     bg: 'rgba(52,211,153,0.07)',  label: 'Stage 2' },
    { x: 165, w: 50,  color: C.amber,     bg: 'rgba(251,191,36,0.07)',  label: 'Stage 3' },
    { x: 215, w: 65,  color: C.red,       bg: 'rgba(248,113,113,0.07)', label: 'Stage 4' },
  ]
  const s1 = [[0,52],[12,49],[24,55],[36,50],[48,55],[60,51],[70,50]]
  const s2 = [[70,50],[84,46],[98,41],[111,36],[124,30],[137,24],[149,20],[159,17],[165,15]]
  const s3 = [[165,15],[173,24],[179,13],[188,27],[194,14],[203,28],[210,16],[215,22]]
  const s4 = [[215,22],[225,30],[232,26],[243,38],[252,45],[260,41],[270,54],[280,67]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox={`0 0 280 ${h}`} width="100%" style={{ display: 'block' }}>
        {zones.map((z, i) => <rect key={i} x={z.x} y={0} width={z.w} height={h} fill={z.bg} />)}
        {[70, 165, 215].map(x => <line key={x} x1={x} y1={0} x2={x} y2={h} stroke={C.border} strokeWidth="0.5" />)}
        {zones.map((z, i) => (
          <text key={i} x={z.x + z.w / 2} y={big ? 14 : 12} textAnchor="middle"
            fontSize={big ? 9 : 8} fontWeight="700" fill={z.color} fontFamily="system-ui,sans-serif">
            {z.label}
          </text>
        ))}
        <polyline points={P(s1)} fill="none" stroke={C.textMuted} strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s2)} fill="none" stroke={C.green}     strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s3)} fill="none" stroke={C.amber}     strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s4)} fill="none" stroke={C.red}       strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function Stage1Chart() {
  const p = [[0,40],[18,36],[32,43],[46,38],[60,44],[74,39],[88,43],[102,37],[116,43],[130,38],[144,44],[158,39],[172,43],[186,37],[200,43],[214,39],[228,44],[242,38],[256,43],[280,40]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 60" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1="40" x2="280" y2="40" stroke={C.border} strokeWidth="0.8" strokeDasharray="5,4" />
        <polyline points={P(p)} fill="none" stroke={C.textMuted} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="8" y="12" fontSize="8" fill={C.textMuted} fontFamily="system-ui,sans-serif" opacity="0.7">Price →</text>
      </svg>
    </div>
  )
}

function Stage2Chart() {
  const price = [[0,58],[22,54],[27,57],[48,49],[63,45],[68,48],[88,39],[104,34],[109,37],[130,27],[146,21],[151,25],[170,16],[186,11],[191,15],[210,8],[225,5],[256,3],[280,3]]
  const ma    = [[0,62],[50,56],[100,48],[150,34],[200,19],[250,8],[280,5]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 68" width="100%" style={{ display: 'block' }}>
        <polyline points={P(ma)} fill="none" stroke={C.green} strokeWidth="1.5" strokeDasharray="6,3" strokeLinejoin="round" opacity="0.4" />
        <polyline points={P(price)} fill="none" stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="268" y="22" textAnchor="end" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.65">30W MA ↗</text>
      </svg>
    </div>
  )
}

function Stage3Chart() {
  const p = [[0,35],[14,22],[24,12],[34,28],[44,18],[54,33],[64,19],[74,38],[84,23],[94,42],[104,26],[114,45],[124,30],[134,48],[144,33],[154,46],[164,29],[174,43],[184,26],[194,38],[204,23],[214,35],[224,23],[234,36],[244,24],[254,38],[264,27],[274,34],[280,37]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 60" width="100%" style={{ display: 'block' }}>
        <polyline points={P(p)} fill="none" stroke={C.amber} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function Stage4Chart() {
  const p = [[0,8],[16,12],[21,9],[37,17],[51,14],[63,22],[73,20],[88,27],[98,25],[113,32],[123,30],[138,38],[148,36],[163,43],[178,41],[188,48],[203,45],[218,52],[228,50],[243,57],[258,55],[271,62],[280,66]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 75" width="100%" style={{ display: 'block' }}>
        <polyline points={P(p)} fill="none" stroke={C.red} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="272" y1="56" x2="272" y2="70" stroke={C.red} strokeWidth="2" strokeLinecap="round" opacity="0.75" />
        <path d="M266,64 L272,72 L278,64" fill="none" stroke={C.red} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
      </svg>
    </div>
  )
}

// ─── Module 2 charts ─────────────────────────────────────────────────────────

function SupportChart() {
  const p = [[0,15],[45,62],[65,38],[105,62],[125,28],[165,62],[185,18],[280,14]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1="63" x2="280" y2="63" stroke={C.green} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.75" />
        <text x="8" y="75" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700" opacity="0.85">Support</text>
        <polyline points={P(p)} fill="none" stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function ResistanceChart() {
  const p = [[0,64],[45,20],[65,46],[105,20],[125,52],[165,20],[185,64],[280,65]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1="19" x2="280" y2="19" stroke={C.red} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.75" />
        <text x="272" y="14" textAnchor="end" fontSize="8" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700" opacity="0.85">Resistance</text>
        <polyline points={P(p)} fill="none" stroke={C.red} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function WhyLevelsChart() {
  const p = [[0,60],[40,17],[80,60],[120,17],[160,60],[200,17],[240,60],[280,60]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        <rect x="0" y="0"  width="280" height="18" fill="rgba(248,113,113,0.10)" />
        <rect x="0" y="62" width="280" height="18" fill="rgba(52,211,153,0.10)"  />
        <text x="140" y="12" textAnchor="middle" fontSize="8" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Sellers (Resistance)</text>
        <text x="140" y="74" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Buyers (Support)</text>
        <polyline points={P(p)} fill="none" stroke={C.textMuted} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function FlipChart() {
  const p = [[0,68],[40,58],[80,50],[110,40],[130,34],[145,28],[160,20],[175,12],[190,8],[205,14],[220,26],[232,32],[244,28],[262,18],[280,14]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        {/* old resistance (left of breakout) */}
        <line x1="0"   y1="32" x2="142" y2="32" stroke={C.red}   strokeWidth="1.5" strokeDasharray="5,3" opacity="0.75" />
        {/* new support (right of breakout) */}
        <line x1="142" y1="32" x2="280" y2="32" stroke={C.green} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.75" />
        {/* breakout marker */}
        <line x1="142" y1="0" x2="142" y2="80" stroke={C.border} strokeWidth="0.6" strokeDasharray="3,3" opacity="0.5" />
        <text x="8"   y="28" fontSize="8" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700" opacity="0.85">Resistance</text>
        <text x="272" y="28" textAnchor="end" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700" opacity="0.85">New Support</text>
        <polyline points={P(p)} fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function MABounceChart() {
  const ma    = [[0,72],[70,58],[140,44],[210,28],[280,12]]
  const price = [[0,66],[40,56],[80,48],[110,38],[125,43],[140,44],[155,39],[185,28],[225,18],[265,10],[280,7]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 78" width="100%" style={{ display: 'block' }}>
        <polyline points={P(ma)} fill="none" stroke={C.green} strokeWidth="1.5" strokeDasharray="6,3" strokeLinejoin="round" opacity="0.45" />
        <polyline points={P(price)} fill="none" stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="140" cy="44" r="4" fill="none" stroke={C.green} strokeWidth="1.5" opacity="0.85" />
        <text x="272" y="20" textAnchor="end" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.65">30W MA ↗</text>
      </svg>
    </div>
  )
}

function SRSummaryChart() {
  const p = [[0,60],[22,24],[42,60],[65,24],[85,60],[100,54],[118,44],[132,24],[145,16],[158,10],[170,6],[185,10],[200,18],[212,22],[222,20],[235,12],[280,8]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 75" width="100%" style={{ display: 'block' }}>
        {/* support line */}
        <line x1="0"   y1="62" x2="280" y2="62" stroke={C.green} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.7" />
        {/* resistance → new support */}
        <line x1="0"   y1="22" x2="132" y2="22" stroke={C.red}   strokeWidth="1.5" strokeDasharray="5,3" opacity="0.7" />
        <line x1="132" y1="22" x2="280" y2="22" stroke={C.green} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.7" />
        <text x="8"   y="58" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700" opacity="0.8">Support</text>
        <text x="8"   y="18" fontSize="8" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700" opacity="0.8">Resistance</text>
        <text x="272" y="18" textAnchor="end" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700" opacity="0.8">New Support</text>
        <polyline points={P(p)} fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// ─── Content data — Module 1 ─────────────────────────────────────────────────

const M1_STAGES = [
  { label: 'Stage 1', color: C.textMuted, bg: 'rgba(148,158,171,0.12)', border: 'rgba(148,158,171,0.25)' },
  { label: 'Stage 2', color: C.green,     bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)'  },
  { label: 'Stage 3', color: C.amber,     bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.30)'  },
  { label: 'Stage 4', color: C.red,       bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.30)' },
]

const LESSONS = [
  {
    id: 'intro', icon: '🌱',
    title: 'Every stock has a life cycle',
    body: [
      'Think of a stock like a mango tree.',
      'First the tree just sits there — no fruit. Then it slowly starts to grow. Then it blooms and gives the best mangoes. Then it gets tired and the fruit starts to fall.',
      'Stocks do the same thing. They go through 4 stages, one after the other — every single time.',
      'Learning these 4 stages is the most important thing you can do as an investor. Everything else flows from here.',
    ],
  },
  {
    id: 'stage1', icon: '😴', stageIdx: 0,
    title: 'Stage 1 — Sleeping',
    body: [
      'The stock price is going nowhere. Up a little, down a little, no real direction. It looks boring.',
      'Think of a coconut tree in the dry season — it is alive, but it is not flowering yet.',
      'Investors who have been holding this stock for a long time are slowly selling and getting out. New investors are slowly buying. The two sides are balanced — that is why the price is flat.',
    ],
    rule: '⛔  Do not buy here. Boring is not safe — it is just waiting.',
  },
  {
    id: 'stage2', icon: '🚀', stageIdx: 1,
    title: 'Stage 2 — Rising',
    body: [
      'The stock starts climbing steadily. It makes a new high, pulls back a little, then makes another new high. This is what a healthy rising stock looks like.',
      'The coconut tree is now in full bloom — it is the best time to climb up and pick the coconuts.',
      'More people are noticing the stock. Big fund houses are buying. This buying pressure pushes the price higher week after week.',
    ],
    rule: '✅  This is the best time to buy. PineX focuses on these stocks.',
  },
  {
    id: 'stage3', icon: '😓', stageIdx: 2,
    title: 'Stage 3 — Tired',
    body: [
      'The stock has been rising for a while. Now it starts making big swings — up one week, down the next. The coconuts are still there but the tree is getting shaky.',
      'The big fund houses who bought early are now quietly selling their shares. But new buyers, who heard about the stock from friends, are still buying.',
      'This tug-of-war causes those big swings you see.',
    ],
    rule: '⚠️  Think about exiting. Stage 3 often turns into Stage 4.',
  },
  {
    id: 'stage4', icon: '📉', stageIdx: 3,
    title: 'Stage 4 — Falling',
    body: [
      'The stock is now falling month after month. Everyone who wanted to sell has sold.',
      'Your friend says: "Bhai, look — it was ₹500, now it is ₹200. So cheap! Just buy it."',
      'This is the most dangerous trap in investing. Catching a falling knife looks easy but you will almost always cut your hand.',
      'A stock can fall from ₹200 to ₹50, and then to ₹10. "Cheap" does not mean safe.',
    ],
    rule: '🚫  Never buy just because it looks cheap. Wait for Stage 1 to finish.',
  },
  {
    id: 'summary', icon: '🗺️',
    title: 'The Simple Rule',
    body: ['You do not need to predict the future. You just need to identify which stage a stock is in right now.'],
    stageStrip: true,
    rule: '📌  Buy in Stage 2. Start thinking of exit in Stage 3. Never chase Stage 4.',
  },
  {
    id: 'quiz-intro', icon: '🧠',
    title: 'Quick Check — 2 Questions',
    body: [
      'Let us see if the stages make sense to you.',
      'There are just 2 questions. Each has 4 choices. You will see the answer and explanation right away.',
      'No scores, no pressure — just a quick check.',
    ],
    tip: 'Read each question slowly before picking.',
  },
]

const QUIZ = [
  {
    question: 'A stock has been falling steadily for 3 months. Your friend says: "It was ₹500, now it is ₹150 — so cheap, just buy it!" Which stage is this stock most likely in?',
    options: ['Stage 1 — Sleeping', 'Stage 2 — Rising', 'Stage 3 — Tired', 'Stage 4 — Falling'],
    correct: 3,
    explanation: 'A stock falling steadily for months is clearly in Stage 4. "Cheap" is a trap — Stage 4 stocks can keep falling much lower. Always wait for the stock to build a base (Stage 1) and then start rising (Stage 2) before buying.',
  },
  {
    question: 'A stock has been rising steadily for the past 2 months. Every week it makes a new high, pulls back a little, and then goes higher again. Which stage is this?',
    options: ['Stage 1 — Sleeping', 'Stage 2 — Rising', 'Stage 3 — Tired', 'Stage 4 — Falling'],
    correct: 1,
    explanation: 'Steady rising price with higher highs each week is textbook Stage 2. This is exactly what PineX looks for — healthy uptrends where you can buy with confidence.',
  },
]

// ─── Content data — Module 2 ─────────────────────────────────────────────────

const M2_LESSONS = [
  {
    id: 'm2-support', icon: '🏠',
    title: 'What is Support?',
    body: [
      'Think of a floor in your house. When a ball falls and hits the floor, it bounces back up.',
      'Support is a price level where a falling stock tends to stop falling and bounce back up. At this price, buyers keep showing up and buying the stock.',
      'Look at the chart. See how the price keeps falling to the same level and bouncing back each time? That level is called support.',
    ],
    rule: '📌  Support = a price floor. Buyers protect this level.',
  },
  {
    id: 'm2-resistance', icon: '🚧',
    title: 'What is Resistance?',
    body: [
      'Now think of the ceiling. When you throw a ball up, it hits the ceiling and falls back down.',
      'Resistance is a price level where a rising stock keeps getting stopped and pushed back down. At this price, sellers keep showing up and selling.',
      'See how the price keeps rising to the same level and falling back? That level is called resistance.',
    ],
    rule: '📌  Resistance = a price ceiling. Sellers push the stock back from here.',
  },
  {
    id: 'm2-why', icon: '🧠',
    title: 'Why do these levels form?',
    body: [
      'At support — many people bought the stock at that price before. When it falls back to that price, they buy again. This buying pushes the price back up.',
      'At resistance — many people are sitting on losses from buying at a high price. When the price rises back to where they bought, they sell just to "get out even". This selling pushes the price back down.',
      'These are not magic numbers. They are just places where a lot of people made decisions — and they tend to make the same decision again.',
    ],
    rule: '💡  Support and resistance are created by human psychology, not by the market itself.',
  },
  {
    id: 'm2-flip', icon: '🔄',
    title: 'The Flip Rule',
    body: [
      'Here is the most important concept in all of technical analysis.',
      'When a stock BREAKS above resistance with high volume — that old resistance becomes the new support.',
      'Think of it like breaking through the ceiling of one floor — now you are on the next floor up. That old ceiling is now your new floor.',
      'A breakout above resistance on high volume is a powerful buy signal. This is exactly what Stage 2 stocks have done.',
    ],
    rule: '🔑  Old resistance → New support after a breakout. This is the Flip Rule.',
  },
  {
    id: 'm2-pinex', icon: '📱',
    title: 'How to use this on PineX',
    body: [
      'On PineX, Stage 2 stocks have already broken above their resistance. That is why they are rising.',
      'The 30-week moving average (30W MA) acts like a moving support line. It rises along with the stock.',
      'When a stock pulls back and touches the 30W MA, then bounces back up — that is often a great time to buy. You are buying right at support.',
    ],
    rule: '✅  On PineX: 30W MA = moving support. Buy the bounce from the MA in Stage 2.',
  },
  {
    id: 'm2-summary', icon: '🗺️',
    title: 'Support & Resistance — Summary',
    body: ['You now understand two of the most powerful concepts in stock analysis.'],
    srStrip: true,
    rule: '📌  On PineX: find Stage 2 stocks that broke above resistance. The 30W MA is your moving support.',
  },
]

const M2_QUIZ = [
  {
    question: 'A stock keeps falling to ₹100 and bouncing back up every single time. What is ₹100 called in technical analysis?',
    options: ['Resistance level', 'Support level', 'Moving average', 'Stop-loss level'],
    correct: 1,
    explanation: '₹100 is the support level. Every time the stock falls to ₹100, buyers show up and push it back up. This is the classic definition of support — a price floor where demand is consistently strong.',
  },
  {
    question: 'A stock was struggling to cross ₹200 for several months. Then one day it breaks above ₹200 with very high volume. According to the Flip Rule, what does ₹200 become?',
    options: ['A new resistance level', 'An irrelevant level now', 'New support level', 'The stop-loss level'],
    correct: 2,
    explanation: 'After a high-volume breakout, old resistance becomes new support — the Flip Rule. ₹200, which was a ceiling, is now a floor. If the stock pulls back to ₹200 and bounces, that confirms the flip and is often a strong buying opportunity.',
  },
]

// ─── Shared constants ─────────────────────────────────────────────────────────

const COMING_SOON = [
  { num: 3, title: 'Volume — The Hidden Signal', desc: 'Why volume tells you what price cannot.' },
  { num: 4, title: 'How PineX Ranks Stocks',     desc: 'Understanding the RS score and Stage filters.' },
  { num: 5, title: 'Your First Trade Plan',       desc: 'Entry, stop-loss, and target — a simple framework.' },
]

// ─── Chart lookup ─────────────────────────────────────────────────────────────

function LessonChart({ id }) {
  if (id === 'intro')          return <JourneyChart />
  if (id === 'stage1')         return <Stage1Chart />
  if (id === 'stage2')         return <Stage2Chart />
  if (id === 'stage3')         return <Stage3Chart />
  if (id === 'stage4')         return <Stage4Chart />
  if (id === 'summary')        return <JourneyChart big />
  if (id === 'm2-support')     return <SupportChart />
  if (id === 'm2-resistance')  return <ResistanceChart />
  if (id === 'm2-why')         return <WhyLevelsChart />
  if (id === 'm2-flip')        return <FlipChart />
  if (id === 'm2-pinex')       return <MABounceChart />
  if (id === 'm2-summary')     return <SRSummaryChart />
  return null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageBadge({ idx }) {
  const s = M1_STAGES[idx]
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, color: s.color, background: s.bg, border: `1px solid ${s.border}`, letterSpacing: '0.04em' }}>
      {s.label}
    </span>
  )
}

function StageStrip() {
  const labels = ['Sleeping', 'Rising', 'Tired',  'Falling']
  const rules  = ['Wait',     'Buy ✅', 'Exit?',  'Avoid']
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, margin: '12px 0' }}>
      {M1_STAGES.map((s, i) => (
        <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.label}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, lineHeight: 1.4 }}>{labels[i]}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{rules[i]}</div>
        </div>
      ))}
    </div>
  )
}

function SRStrip() {
  const items = [
    { label: 'Support',    desc: 'Price floor',          action: 'Buy the bounce',   color: C.green,  bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)'  },
    { label: 'Resistance', desc: 'Price ceiling',        action: 'Expect rejection', color: C.red,    bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.30)' },
    { label: 'Breakout',   desc: 'Breaks resistance',    action: 'Strong buy signal',color: C.accent, bg: 'rgba(45,212,191,0.10)',  border: 'rgba(45,212,191,0.30)'  },
    { label: 'Flip Rule',  desc: 'Old ceiling = new floor', action: 'Confirms trend',color: C.blue,   bg: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.30)'  },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, margin: '12px 0' }}>
      {items.map((item, i) => (
        <div key={i} style={{ background: item.bg, border: `1px solid ${item.border}`, borderRadius: 10, padding: '10px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: item.color, marginBottom: 3 }}>{item.label}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4, lineHeight: 1.4 }}>{item.desc}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: item.color }}>{item.action}</div>
        </div>
      ))}
    </div>
  )
}

function LessonCard({ lesson, onNext, isLast }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 40, marginBottom: 10, lineHeight: 1 }}>{lesson.icon}</div>
        {lesson.stageIdx != null && <div style={{ marginBottom: 10 }}><StageBadge idx={lesson.stageIdx} /></div>}
        <h2 style={{ fontSize: 21, fontWeight: 800, color: C.textHeading, margin: '0 0 14px', lineHeight: 1.25 }}>
          {lesson.title}
        </h2>
        <LessonChart id={lesson.id} />
        {lesson.body.map((para, i) => (
          <p key={i} style={{ fontSize: 15, color: C.text, lineHeight: 1.7, margin: '0 0 12px' }}>{para}</p>
        ))}
        {lesson.stageStrip && <StageStrip />}
        {lesson.srStrip    && <SRStrip />}
        {lesson.tip && (
          <div style={{ background: C.blueBg, border: `1px solid ${C.blue}22`, borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
            <span style={{ fontSize: 13, color: C.blue }}>💡 {lesson.tip}</span>
          </div>
        )}
        {lesson.rule && (
          <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginTop: 14, fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>
            {lesson.rule}
          </div>
        )}
      </div>
      <button onClick={onNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
        {isLast ? 'Start Quiz →' : 'Next →'}
      </button>
    </div>
  )
}

function QuizCard({ q, qNum, total, onNext, isLast }) {
  const [picked, setPicked] = useState(null)
  const isCorrect = picked === q.correct
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Question {qNum} of {total}
        </div>
        <p style={{ fontSize: 16, fontWeight: 600, color: C.textHeading, lineHeight: 1.6, margin: '0 0 20px' }}>{q.question}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {q.options.map((opt, i) => {
            let bg = C.surface2, border = C.border, color = C.text
            if (picked !== null) {
              if (i === q.correct)   { bg = C.greenBg; border = C.greenBorder; color = C.green }
              else if (i === picked) { bg = C.redBg;   border = C.redBorder;   color = C.red   }
            }
            const letterColor = picked === null ? C.blue : (i === q.correct ? C.green : (i === picked ? C.red : C.textMuted))
            return (
              <button key={i} onClick={() => picked === null && setPicked(i)}
                style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'left', cursor: picked === null ? 'pointer' : 'default', color, fontSize: 14, fontWeight: 500, lineHeight: 1.4, transition: 'all 0.15s' }}>
                <span style={{ fontWeight: 700, marginRight: 8, color: letterColor }}>{String.fromCharCode(65 + i)}.</span>
                {opt}
              </button>
            )
          })}
        </div>
        {picked !== null && (
          <div style={{ background: isCorrect ? C.greenBg : C.redBg, border: `1px solid ${isCorrect ? C.greenBorder : C.redBorder}`, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: isCorrect ? C.green : C.red, marginBottom: 6 }}>
              {isCorrect ? '✅ Correct!' : '❌ Not quite — here is why:'}
            </div>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, margin: 0 }}>{q.explanation}</p>
          </div>
        )}
      </div>
      {picked !== null && (
        <button onClick={onNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
          {isLast ? 'See Results →' : 'Next Question →'}
        </button>
      )}
    </div>
  )
}

function CompletionScreen({ moduleNum, onStartNext, onHome }) {
  const isM1 = moduleNum === 1
  const modNames = { 1: 'The Weinstein 4-Stage Method', 2: 'Support & Resistance' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ textAlign: 'center', padding: '20px 0 24px' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: C.textHeading, margin: '0 0 8px' }}>Module {moduleNum} Done!</h2>
          <p style={{ fontSize: 15, color: C.textMuted, margin: '0 0 4px' }}>{modNames[moduleNum]}</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 20, padding: '5px 14px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>✓ Completed</span>
          </div>
        </div>

        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 14, color: C.text, lineHeight: 1.7, margin: 0 }}>
            {isM1
              ? <>You now know the most important framework for stock investing. Every time you look at a stock, ask yourself: <strong style={{ color: C.textHeading }}>which stage is it in?</strong></>
              : <>You can now identify support and resistance levels and understand the Flip Rule. These two concepts will help you find better entry points.</>
            }
          </p>
        </div>

        {isM1 ? (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Up Next</div>
            <div
              onClick={onStartNext}
              style={{ background: C.blueBg, border: `1px solid ${C.blue}44`, borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginBottom: 20 }}
            >
              <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, background: `${C.blue}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: C.blue }}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 2 }}>Support & Resistance</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>Price floors, ceilings, and the Flip Rule.</div>
              </div>
              <span style={{ fontSize: 14, color: C.blue }}>→</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Coming Later</div>
          </>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Coming Next</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {COMING_SOON.map(m => (
            <div key={m.num} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: 0.6 }}>
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>{m.num}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 2 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: C.textFaint }}>{m.desc}</div>
                <div style={{ fontSize: 11, color: C.blue, marginTop: 4, fontWeight: 600 }}>Coming Soon</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isM1 ? (
        <>
          <button onClick={onStartNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
            Start Module 2 →
          </button>
          <button onClick={onHome} style={{ marginTop: 10, width: '100%', padding: '12px', borderRadius: 12, border: `1px solid ${C.border}`, cursor: 'pointer', background: 'transparent', color: C.textMuted, fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
            Go Home
          </button>
        </>
      ) : (
        <button onClick={onHome} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
          Go Home
        </button>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Learn() {
  const navigate = useNavigate()
  const [activeModule, setActiveModule]   = useState(1)
  const [moduleSteps, setModuleSteps]     = useState({ 1: 0, 2: 0 })

  const lessons = activeModule === 1 ? LESSONS    : M2_LESSONS
  const quiz    = activeModule === 1 ? QUIZ       : M2_QUIZ
  const step    = moduleSteps[activeModule]
  const total   = lessons.length + quiz.length

  const isDone   = step >= total
  const progress = isDone ? 1 : step / total

  const handleNext       = () => setModuleSteps(s => ({ ...s, [activeModule]: s[activeModule] + 1 }))
  const handleSwitchMod  = (num) => setActiveModule(num)

  const currentLesson  = !isDone && step < lessons.length ? lessons[step] : null
  const currentQuizIdx = !isDone && step >= lessons.length ? step - lessons.length : null

  const modTitles = { 1: 'Weinstein Stages', 2: 'Support & Resistance' }

  return (
    <>
      <Helmet>
        <title>Learn — Stock Market Basics | PineX</title>
        <meta name="description" content="Learn the Weinstein 4-stage method and support & resistance in simple English. Tap-through lessons with real analogies." />
      </Helmet>

      <div style={{ minHeight: '100vh', background: C.base, display: 'flex', flexDirection: 'column' }}>

        {/* Header + progress bar */}
        <div style={{ flexShrink: 0, padding: '12px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => navigate('/')}
            aria-label="Go back"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', flexShrink: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>
              Module {activeModule} · {modTitles[activeModule]}
              {!isDone && <span style={{ marginLeft: 8, color: C.blue }}>{step + 1} / {total}</span>}
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, background: C.blue, width: `${progress * 100}%`, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        </div>

        {/* Card body */}
        <div style={{ flex: 1, padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', maxWidth: 480, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {isDone ? (
            <CompletionScreen moduleNum={activeModule} onStartNext={() => setActiveModule(2)} onHome={() => navigate('/')} />
          ) : currentLesson ? (
            <LessonCard lesson={currentLesson} onNext={handleNext} isLast={step === lessons.length - 1} />
          ) : currentQuizIdx !== null ? (
            <QuizCard q={quiz[currentQuizIdx]} qNum={currentQuizIdx + 1} total={quiz.length} onNext={handleNext} isLast={currentQuizIdx === quiz.length - 1} />
          ) : null}
        </div>

        {/* Module strip — always visible */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, padding: '12px 16px', background: C.surface }}>
          <div style={{ fontSize: 11, color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Modules</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {/* Module 1 — available */}
            <div
              onClick={() => handleSwitchMod(1)}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: activeModule === 1 ? C.blueBg : 'transparent', border: `1px solid ${activeModule === 1 ? C.blue : C.border}` }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: activeModule === 1 ? C.blue : C.textMuted }}>1</span>
              <span style={{ fontSize: 11, color: activeModule === 1 ? C.blue : C.textMuted, whiteSpace: 'nowrap' }}>Weinstein Stages</span>
            </div>
            {/* Module 2 — available */}
            <div
              onClick={() => handleSwitchMod(2)}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: activeModule === 2 ? C.blueBg : 'transparent', border: `1px solid ${activeModule === 2 ? C.blue : C.border}` }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: activeModule === 2 ? C.blue : C.textMuted }}>2</span>
              <span style={{ fontSize: 11, color: activeModule === 2 ? C.blue : C.textMuted, whiteSpace: 'nowrap' }}>Support & Resistance</span>
            </div>
            {/* Modules 3-5 — coming soon */}
            {COMING_SOON.map(m => (
              <div key={m.num} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint }}>{m.num}</span>
                <span style={{ fontSize: 11, color: C.textFaint, whiteSpace: 'nowrap' }}>{m.title}</span>
                <span style={{ fontSize: 10, color: C.textFaint }}>· Soon</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
