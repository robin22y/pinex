// ── Sector Rotation Simulator — interactive learning module ───────────────
// Self-contained educational page on smart-money sector rotation across the
// four canonical market environments (Early Bull, Late Bull, Early Bear,
// Crisis). Left column: 4-button environment matrix + 3 sector cards whose
// stage badge AND mini-chart shape change with the selected environment.
// Right column: 2-question quiz. Sibling to WhenToSell.jsx and
// RiskManagement.jsx — same Card / CardLabel pattern, same Tabler icons,
// no new dependencies.
//
// Editorial posture: this teaches a FRAMEWORK (Stage Analysis applied to
// sectors). The sector shapes shown are pedagogical archetypes drawn from
// the textbook playbook — they are NOT predictions for any current sector
// or stock. Standard disclaimer at the bottom of the page.

import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  ReferenceLine,
} from 'recharts'

// ─────────────────────────────────────────────────────────────────────────
// TRANSLATION-FRIENDLY STRINGS
// All user-visible text lives here so a translator can swap to Hindi /
// Malayalam / Tamil by replacing this object.
// ─────────────────────────────────────────────────────────────────────────
const STRINGS = {
  back: 'Back to Learn',
  pageTitle: 'Sector Rotation — Following the Smart Money',
  pageIntro:
    'Big money does not stay in one sector forever. It rotates between sectors depending on the market environment — favouring cyclicals in early bulls, defensives in crashes. Read the framework below, then play with the live simulator.',

  // ── Section 1: WHY rotation happens ───────────────────────
  whyTitle: '1. Why does sector rotation happen?',
  whyLead:
    'The stock market always tries to look 6 to 9 months ahead of the real economy. Because of this, different sectors shine at different times.',
  growthRush: {
    title: 'The Growth Rush',
    body:
      'When the economy is booming, sectors like Banking, Automobiles and Real Estate grow very fast. Everyone wants to take loans and buy things.',
    icon: '🚀',
    color: '#10B981',
  },
  safetyShield: {
    title: 'The Safety Shield',
    body:
      'When the economy slows or hits a crisis, big money runs away from risky stocks and hides in defensive sectors like FMCG (daily essentials) and Pharma (healthcare). People stop buying cars in a crisis, but they never stop buying medicine or soap.',
    icon: '🛡',
    color: '#60A5FA',
  },

  // ── Section 2: HOW to catch the rotation ──────────────────
  howTitle: '2. Using Stage Analysis to catch the rotation',
  howLead:
    'Instead of guessing where the big money is going, look at the charts of the sector indices (Nifty Bank, Nifty IT, Nifty FMCG, etc.) and run the same Stage Analysis you would on a single stock.',
  steps: [
    {
      title: 'Find the sector in Stage 1',
      sub: 'The watchlist step.',
      body:
        'Look for an entire sector index that has been falling for months but is now moving sideways. The 30-week moving average for the sector becomes flat. Selling pressure has stopped — the sector is basing.',
    },
    {
      title: 'Wait for the sector breakout',
      sub: 'The confirmation step.',
      body:
        'Wait for the sector index to cross sharply above its 30-week moving average on high volume. The sector has officially entered Stage 2 (uptrend). Smart money has arrived.',
    },
    {
      title: 'Buy the strongest leader stock',
      sub: 'The execution step.',
      body:
        'Do not buy weak companies in that sector. Find the top one or two leading stocks in the industry that are themselves breaking out into Stage 2. Concentrate your capital there.',
    },
  ],

  // ── Section 3: The simple playbook table ──────────────────
  playbookTitle: 'The sector playbook — at a glance',
  playbookHeaders: ['Market condition', 'Winning sector type', 'Top Indian examples'],
  playbookRows: [
    {
      cond: 'Bull market (growth era)',
      type: 'Cyclical · High-growth',
      examples: 'Banking, Auto, Infrastructure, Realty',
      tone: 'bull',
    },
    {
      cond: 'Bear market (uncertain era)',
      type: 'Defensive · Safe haven',
      examples: 'FMCG, Pharma, Information Technology',
      tone: 'bear',
    },
  ],

  cycle: {
    label: 'Rotation cycle engine',
    heading: 'Pick a market environment',
    sub: 'The three sectors below re-draw their stage and trend instantly.',
  },

  envs: {
    earlyBull: {
      title: 'Early Bull Market',
      desc: 'Index just turned up. Rate cuts in the air. Risk appetite returning.',
      icon: '🌅',
    },
    lateBull: {
      title: 'Late Bull Market',
      desc: 'Index extended. Sentiment euphoric. Volume thinning at the top.',
      icon: '🚀',
    },
    earlyBear: {
      title: 'Early Bear Market',
      desc: 'Index broke its 30W MA. Leaders cracking. Volume on declines.',
      icon: '🌫',
    },
    crisis: {
      title: 'Crisis / Crash',
      desc: 'Indices in free-fall. Panic across cyclicals. Defensives bid.',
      icon: '⛈',
    },
  },

  sectors: {
    banking: 'Banking & Finance',
    auto: 'Automobiles',
    pharma: 'Pharma & Healthcare',
  },

  stageBadges: {
    2: { label: 'STAGE 2: BUY / HOLD', color: '#10B981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.45)' },
    1: { label: 'STAGE 1: BASING — WATCH', color: '#60A5FA', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.4)' },
    3: { label: 'STAGE 3: TOPPING — REDUCE', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.45)' },
    4: { label: 'STAGE 4: AVOID / SELL', color: '#EF4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.45)' },
  },

  // Per-stage one-liner shown under the badge so the user understands WHY
  // that sector is in that stage in this environment.
  sectorCommentary: {
    banking: {
      earlyBull: 'Rate cuts → credit demand revives. First sector to break out.',
      lateBull:  'Rally extended. Distribution at highs. Sideways topping.',
      earlyBear: 'NPAs rising. Breaking 30W MA on volume. Stage-4 setup.',
      crisis:    'Credit risk explodes. Heavy distribution. Avoid completely.',
    },
    auto: {
      earlyBull: 'Demand still soft, building a base. Watch for breakout later.',
      lateBull:  'Cyclical demand at its peak. Trend up on declining volume.',
      earlyBear: 'Inventory piling. Topping pattern. Reduce on rallies.',
      crisis:    'Discretionary demand collapses. Stage-4 free-fall. Stay away.',
    },
    pharma: {
      earlyBull: 'Defensives sold for cyclicals. Topping under MA.',
      lateBull:  'Money rotated out completely. Stage-4 underperformer.',
      earlyBear: 'Bottoming begins as money seeks safety. Stage-1 base forms.',
      crisis:    'Classic safe haven. Breaking out on volume. Smart-money bid.',
    },
  },

  insightTitle: 'What the chart is telling you',
  insights: {
    earlyBull: 'Smart money is rotating INTO cyclicals (banking, then auto). Defensives like pharma get sold to fund the move.',
    lateBull:  'Late-cycle cyclicals (auto, capital goods) get the last hurrah while leaders top out. Defensives are being abandoned.',
    earlyBear: 'Cyclicals roll over first. Defensives quietly build bases — that is where the next rotation will start.',
    crisis:    'Pure flight to safety. Banking and auto get crushed; pharma, FMCG and consumer staples become the only green sectors.',
  },

  quiz: {
    label: 'Knowledge check',
    correct: 'Correct',
    notQuite: 'Not quite',
    next: 'Next question →',
    seeResult: 'See result →',
    tryAgain: 'Try again',
    perfect: 'You now read rotation like a pro. Watch which sectors lead, not just the index.',
    good: 'Solid start — play with the environment buttons on the left once more to lock it in.',
    weak: 'Re-read the cycle. The single most useful idea: in a crash, defensives are the only sectors with green tickers.',
  },

  legend: {
    label: 'Rotation cheat sheet',
    headers: ['Environment', 'Smart-money sectors', 'Sectors to avoid'],
    rows: [
      ['Early Bull',  'Banking, Realty, Metals',   'Pharma, FMCG'],
      ['Late Bull',   'Auto, Capital Goods, IT',   'Defensives lag'],
      ['Early Bear',  'Pharma (basing), Consumer', 'Banking, Realty top'],
      ['Crisis',      'Pharma, FMCG, Utilities',   'Banking, Auto, Metals'],
    ],
  },

  disclaimer:
    'Educational module on the sector-rotation framework. The sector shapes shown are pedagogical archetypes from the textbook playbook — they are NOT predictions or recommendations for any current sector or stock. Data only · Not a research report · Not SEBI registered.',
}

// All 2 questions from the spec — kept in a separate array so a translator
// can pair them with the STRINGS object above.
const QUESTIONS = [
  {
    q: 'The stock market index is crashing hard because of global bad news. Which sector index is most likely to hold its ground or enter a strong Stage 2 trend?',
    options: [
      'Automobiles (luxury cars)',
      'Pharma & Healthcare (medicines)',
      'Real Estate (new buildings)',
    ],
    correct: 1,
    hint:
      'During bad market times, defensive sectors protect capital. People always need healthcare, which makes it a safe place for institutional funds to hide.',
  },
  {
    q: 'You notice that the Nifty IT sector index has just crossed above its flat 30-week moving average with very high volume. What does this tell you?',
    options: [
      'The IT sector is crashing.',
      'Big institutional money is actively rotating into IT stocks.',
      'You should wait for 3 years before buying.',
    ],
    correct: 1,
    hint:
      'A high-volume breakout over the 30-week MA is the classic signature of smart money starting a new Stage 2 trend in that sector.',
  },
]

// ─────────────────────────────────────────────────────────────────────────
// CHART DATA — pedagogical archetypes per (sector × environment)
// Each array represents 30 weeks of mini-chart prices. Numbers are
// pure illustration: the SHAPE matters, not the absolute price.
// ─────────────────────────────────────────────────────────────────────────
function basingShape(base = 100, noise = 1.5) {
  // Stage 1 — sideways base under flat MA.
  return Array.from({ length: 30 }, (_, i) => ({
    x: i,
    y: base + Math.sin(i / 2) * noise + (Math.random() - 0.5) * noise * 0.6,
  }))
}
function advancingShape(start = 100, slope = 1.6) {
  // Stage 2 — clean uptrend.
  return Array.from({ length: 30 }, (_, i) => ({
    x: i,
    y: start + i * slope * 0.9 + Math.sin(i / 3) * 1.8,
  }))
}
function toppingShape(start = 145) {
  // Stage 3 — choppy sideways at the top.
  return Array.from({ length: 30 }, (_, i) => ({
    x: i,
    y: start + Math.sin(i / 1.6) * 3 + (Math.random() - 0.5) * 1.4,
  }))
}
function decliningShape(start = 140, slope = 2.4) {
  // Stage 4 — clean downtrend.
  return Array.from({ length: 30 }, (_, i) => ({
    x: i,
    y: start - i * slope * 0.9 + Math.sin(i / 3) * 1.5,
  }))
}
function breakoutShape(base = 100) {
  // Stage 2 BREAKOUT — flat then sharp leg up around week 18.
  return Array.from({ length: 30 }, (_, i) => ({
    x: i,
    y:
      i < 16
        ? base + Math.sin(i / 2) * 1.5
        : base + (i - 16) * 2.4,
  }))
}
function crashShape(start = 130) {
  // Stage 4 CRASH — straight-down with acceleration.
  return Array.from({ length: 30 }, (_, i) => ({
    x: i,
    y: start - i * 2.0 - Math.pow(Math.max(0, i - 15), 1.4) * 0.8,
  }))
}

// (sector, env) → { stage, data, ma }
// `ma` is the flat 30-week MA reference line for the chart.
const SCENARIOS = {
  banking: {
    earlyBull: { stage: 2, data: breakoutShape(100),  ma: 102 },
    lateBull:  { stage: 3, data: toppingShape(150),   ma: 148 },
    earlyBear: { stage: 4, data: decliningShape(150), ma: 140 },
    crisis:    { stage: 4, data: crashShape(140),     ma: 130, severe: true },
  },
  auto: {
    earlyBull: { stage: 1, data: basingShape(95),     ma: 95  },
    lateBull:  { stage: 2, data: advancingShape(100), ma: 105 },
    earlyBear: { stage: 3, data: toppingShape(140),   ma: 138 },
    crisis:    { stage: 4, data: crashShape(135),     ma: 125, severe: true },
  },
  pharma: {
    earlyBull: { stage: 3, data: toppingShape(140),   ma: 140 },
    lateBull:  { stage: 4, data: decliningShape(140), ma: 130 },
    earlyBear: { stage: 1, data: basingShape(110),    ma: 110 },
    crisis:    { stage: 2, data: breakoutShape(110),  ma: 112 },
  },
}

const ENV_ORDER = ['earlyBull', 'lateBull', 'earlyBear', 'crisis']
const SECTOR_ORDER = ['banking', 'auto', 'pharma']

// ─────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────
export default function SectorRotation() {
  const navigate = useNavigate()
  const [env, setEnv] = useState('earlyBull')

  // Quiz state.
  const [qIdx, setQIdx] = useState(0)
  const [selected, setSelected] = useState(null)
  const [score, setScore] = useState(0)
  const q = QUESTIONS[qIdx]
  const done = qIdx >= QUESTIONS.length
  const handleAnswer = (i) => {
    if (selected != null) return
    setSelected(i)
    if (i === q.correct) setScore((s) => s + 1)
  }
  const next = () => { setSelected(null); setQIdx((i) => i + 1) }
  const restart = () => { setQIdx(0); setSelected(null); setScore(0) }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '20px 16px 80px', color: 'var(--text-primary)' }}>
      <Helmet><title>Sector Rotation | PineX Learn</title></Helmet>

      {/* Header */}
      <header style={{ maxWidth: 1180, margin: '0 auto 24px' }}>
        <button onClick={() => navigate('/learn')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i className="ti ti-arrow-left" /> {STRINGS.back}
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{STRINGS.pageTitle}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 760 }}>{STRINGS.pageIntro}</p>
      </header>

      {/* ── FOUNDATIONS — the textbook content the simulator brings to life ── */}
      <section style={{ maxWidth: 1180, margin: '0 auto 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* WHY card */}
        <Card>
          <CardLabel>Foundation</CardLabel>
          <h2 style={{ margin: '4px 0 6px', fontSize: 18, fontWeight: 700 }}>{STRINGS.whyTitle}</h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {STRINGS.whyLead}
          </p>
          <div className="why-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
            {[STRINGS.growthRush, STRINGS.safetyShield].map((p) => (
              <div
                key={p.title}
                style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${hexA(p.color, 0.10)} 0%, var(--bg-elevated) 100%)`,
                  border: `1px solid ${hexA(p.color, 0.35)}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{p.icon}</span>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: p.color }}>{p.title}</h3>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{p.body}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* HOW card — 3-step playbook */}
        <Card>
          <CardLabel>Method</CardLabel>
          <h2 style={{ margin: '4px 0 6px', fontSize: 18, fontWeight: 700 }}>{STRINGS.howTitle}</h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {STRINGS.howLead}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STRINGS.steps.map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: 'rgba(96,165,250,0.15)',
                    border: '1px solid rgba(96,165,250,0.4)',
                    color: '#60A5FA',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 14, flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{s.title}</h3>
                  <p style={{ margin: '2px 0 4px', fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{s.sub}</p>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Quick playbook table */}
        <Card>
          <CardLabel>Quick summary</CardLabel>
          <h2 style={{ margin: '4px 0 10px', fontSize: 16, fontWeight: 700 }}>{STRINGS.playbookTitle}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {STRINGS.playbookHeaders.map((h) => (
                    <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STRINGS.playbookRows.map((r) => {
                  const color = r.tone === 'bull' ? '#10B981' : '#60A5FA'
                  return (
                    <tr key={r.cond}>
                      <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--border)', fontWeight: 700, color, whiteSpace: 'nowrap' }}>{r.cond}</td>
                      <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--border)' }}>{r.type}</td>
                      <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{r.examples}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Hand-off line to the simulator */}
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
          ↓ Now play with the live simulator — click any market environment to watch the same three sectors transform.
        </p>
      </section>

      <section
        className="sector-grid"
        style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 20, gridAutoRows: 'min-content' }}
      >
        {/* ── LEFT: Cycle engine + sectors ──────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardLabel>{STRINGS.cycle.label}</CardLabel>
            <h2 style={{ margin: '4px 0 4px', fontSize: 18, fontWeight: 700 }}>{STRINGS.cycle.heading}</h2>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)' }}>{STRINGS.cycle.sub}</p>

            {/* Environment button matrix — 2x2 on phones, 4-up wide. */}
            <div className="env-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
              {ENV_ORDER.map((key) => {
                const e = STRINGS.envs[key]
                const active = env === key
                // Each env gets its own subtle accent so the active state
                // feels meaningful, not generic.
                const accent = key === 'earlyBull' ? '#10B981'
                  : key === 'lateBull' ? '#F59E0B'
                  : key === 'earlyBear' ? '#94A3B8'
                  : '#EF4444'
                return (
                  <button
                    key={key}
                    onClick={() => setEnv(key)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: `1px solid ${active ? accent : 'var(--border)'}`,
                      background: active
                        ? `linear-gradient(135deg, ${hexA(accent, 0.18)} 0%, var(--bg-elevated) 100%)`
                        : 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{e.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? accent : 'var(--text-primary)' }}>{e.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{e.desc}</span>
                  </button>
                )
              })}
            </div>

            {/* Insight panel — explains WHAT is happening at this stage. */}
            <div
              style={{
                marginTop: 14,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
              }}
            >
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {STRINGS.insightTitle}
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55 }}>
                {STRINGS.insights[env]}
              </p>
            </div>
          </Card>

          {/* Three sector cards — each redraws on env change. */}
          {SECTOR_ORDER.map((sec) => (
            <SectorCard
              key={sec}
              sectorKey={sec}
              env={env}
            />
          ))}
        </div>

        {/* ── RIGHT: Quiz + cheat sheet ─────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardLabel>{STRINGS.quiz.label}</CardLabel>
            <div style={{ margin: '8px 0 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>{done ? 'Complete' : `Question ${qIdx + 1} of ${QUESTIONS.length}`}</span>
                <span>Score: {score}/{QUESTIONS.length}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${((done ? QUESTIONS.length : qIdx) / QUESTIONS.length) * 100}%`, height: '100%', background: '#10B981', transition: 'width 0.3s' }} />
              </div>
            </div>

            {!done ? (
              <>
                <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>{q.q}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {q.options.map((opt, i) => {
                    const isPicked = selected === i
                    const isCorrect = i === q.correct
                    const reveal = selected != null
                    let bg = 'var(--bg-elevated)', border = 'var(--border)', color = 'var(--text-primary)'
                    if (reveal && isCorrect) { bg = 'rgba(16,185,129,0.12)'; border = '#10B981'; color = '#10B981' }
                    else if (reveal && isPicked && !isCorrect) { bg = 'rgba(239,68,68,0.12)'; border = '#EF4444'; color = '#EF4444' }
                    return (
                      <button key={i} onClick={() => handleAnswer(i)} disabled={reveal}
                        style={{
                          textAlign: 'left', padding: '12px 14px', borderRadius: 10,
                          background: bg, border: `1px solid ${border}`, color,
                          fontSize: 14, fontWeight: 500, cursor: reveal ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.15s',
                        }}
                      >
                        <span style={{ width: 22, height: 22, borderRadius: '50%', background: reveal && isCorrect ? '#10B981' : (reveal && isPicked ? '#EF4444' : 'var(--border)'), color: reveal ? '#fff' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700 }}>
                          {reveal && isCorrect ? <i className="ti ti-check" /> : reveal && isPicked ? <i className="ti ti-x" /> : String.fromCharCode(65 + i)}
                        </span>
                        <span style={{ flex: 1 }}>{opt}</span>
                      </button>
                    )
                  })}
                </div>

                {selected != null && (
                  <div style={{
                    marginTop: 14, padding: '12px 14px', borderRadius: 10,
                    background: selected === q.correct ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${selected === q.correct ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  }}>
                    <p style={{ margin: 0, fontSize: 13, color: selected === q.correct ? '#10B981' : '#EF4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className={selected === q.correct ? 'ti ti-circle-check' : 'ti ti-circle-x'} />
                      {selected === q.correct ? STRINGS.quiz.correct : STRINGS.quiz.notQuite}
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{q.hint}</p>
                    <button onClick={next} style={{ marginTop: 10, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      {qIdx + 1 === QUESTIONS.length ? STRINGS.quiz.seeResult : STRINGS.quiz.next}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 6 }}>{score === QUESTIONS.length ? '🔄' : score >= 1 ? '👍' : '📚'}</div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>You scored {score} / {QUESTIONS.length}</h3>
                <p style={{ margin: '6px 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                  {score === QUESTIONS.length ? STRINGS.quiz.perfect : score >= 1 ? STRINGS.quiz.good : STRINGS.quiz.weak}
                </p>
                <button onClick={restart} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <i className="ti ti-refresh" style={{ marginRight: 6 }} /> {STRINGS.quiz.tryAgain}
                </button>
              </div>
            )}
          </Card>

          {/* Cheat sheet */}
          <Card>
            <CardLabel>{STRINGS.legend.label}</CardLabel>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {STRINGS.legend.headers.map((h) => (
                      <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STRINGS.legend.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', fontWeight: 700, whiteSpace: 'nowrap' }}>{r[0]}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: '#10B981' }}>{r[1]}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: '#EF4444' }}>{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </section>

      {/* Disclaimer */}
      <footer style={{ maxWidth: 1180, margin: '24px auto 0', padding: '14px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
        {STRINGS.disclaimer}
      </footer>

      {/* Responsive grid breakpoints.
          - Page level: stack at <900px, two columns above.
          - Env button matrix: 2x2 on phones, 4-wide from ~520px.
       */}
      <style>{`
        @media (min-width: 520px) {
          .env-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
          .why-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; }
        }
        @media (min-width: 900px) {
          .sector-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>
    </main>
  )
}

// ── SectorCard — the heart of the simulator ──────────────────────────────
function SectorCard({ sectorKey, env }) {
  const scenario = SCENARIOS[sectorKey][env]
  const stageMeta = STRINGS.stageBadges[scenario.stage]
  const sectorName = STRINGS.sectors[sectorKey]
  const commentary = STRINGS.sectorCommentary[sectorKey][env]

  // In a Crisis-Stage-4 case we paint the card with a deep crimson backdrop
  // to make the "free-fall" feel visceral. This is set by `severe: true`
  // on the SCENARIOS map.
  const isCrash = scenario.severe === true

  // Line colour mirrors the stage colour so the chart and badge agree.
  const lineColor = stageMeta.color

  return (
    <div
      style={{
        background: isCrash
          ? 'linear-gradient(135deg, rgba(127,29,29,0.35) 0%, var(--bg-surface) 100%)'
          : 'var(--bg-surface)',
        border: `1px solid ${isCrash ? 'rgba(239,68,68,0.45)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: '14px 16px',
        transition: 'all 0.25s',
      }}
    >
      {/* Header row: sector name + stage badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{sectorName}</h3>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            padding: '4px 10px',
            borderRadius: 999,
            color: stageMeta.color,
            background: stageMeta.bg,
            border: `1px solid ${stageMeta.border}`,
            whiteSpace: 'nowrap',
          }}
        >
          {stageMeta.label}
        </span>
      </div>

      {/* Mini chart — pure pedagogical shape, no axes. */}
      <div style={{ width: '100%', height: 90, marginTop: 10 }}>
        <ResponsiveContainer>
          <LineChart data={scenario.data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            <YAxis hide domain={['dataMin - 3', 'dataMax + 3']} />
            <ReferenceLine
              y={scenario.ma}
              stroke="var(--text-hint)"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke={lineColor}
              strokeWidth={2.2}
              dot={false}
              isAnimationActive={true}
              animationDuration={350}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart legend hint */}
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-hint)', marginTop: 2 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 2, background: lineColor }} /> Price
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--text-hint)' }} /> 30W MA
        </span>
      </div>

      {/* Per-stage commentary */}
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {commentary}
      </p>
    </div>
  )
}

// ── Small presentational helpers (kept local for self-containment) ───────
function Card({ children }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
      {children}
    </div>
  )
}
function CardLabel({ children }) {
  return (
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {children}
    </p>
  )
}

// Tiny hex→rgba helper so the active-button gradient can re-use the accent
// hue at a low alpha without hard-coding rgba strings four times.
function hexA(hex, a) {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}
