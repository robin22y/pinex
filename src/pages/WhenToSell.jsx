// ── When to Sell a Stock — interactive learning module ────────────────────
// Self-contained educational page on Stage-Analysis exits. Two-column
// layout: an interactive Stage simulator + Action Center on the left, a
// 3-question quiz on the right. Built on Recharts (already vendored) and
// the project's Tabler icon set so it adds no new dependencies.
//
// Editorial posture: this teaches the Stage-Analysis EXIT FRAMEWORK as
// neutral education. The Action Center's directive verbs ("SELL 50%") are
// the framework's prescriptions in an interactive demo, not personal
// advice on any specific holding. A disclaimer is shown on the page.

import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'

// ── Synthetic stage data ────────────────────────────────────────────────
// 30 weekly bars per stage. Smooth, illustrative — not real stock data.
function chartData(stage) {
  const points = []
  for (let i = 0; i < 30; i++) {
    let price, ma
    if (stage === 'stage2') {
      ma = 95 + i * 1.2                                       // rising 95 → 131
      price = ma + 6 + Math.sin(i * 0.7) * 3 + i * 0.45       // above + climbing
    } else if (stage === 'stage3') {
      ma = 140 + Math.sin(i * 0.25) * 0.4                     // flat ~140
      price = 140 + Math.sin(i * 0.9) * 8 + Math.cos(i * 1.3) * 5  // chop
    } else {
      ma = 145 - i * 1.0                                      // declining 145 → 116
      price = ma - 4 - i * 0.6 - Math.sin(i * 0.6) * 2        // below + falling
    }
    points.push({
      week: i + 1,
      price: Math.round(price * 100) / 100,
      ma: Math.round(ma * 100) / 100,
    })
  }
  return points
}

const STAGES = [
  { id: 'stage2', label: 'Stage 2 · Uptrend', maColor: '#10B981' /* emerald */ },
  { id: 'stage3', label: 'Stage 3 · Market Top', maColor: '#F59E0B' /* amber */ },
  { id: 'stage4', label: 'Stage 4 · Downtrend Breakdown', maColor: '#EF4444' /* red */ },
]

// ── Action Center logic ────────────────────────────────────────────────
function getAction(stage, dropPct) {
  if (stage === 'stage4' || dropPct >= 8) {
    return {
      level: 'red',
      icon: 'ti-alert-octagon-filled',
      title: 'EMERGENCY: SELL EVERYTHING',
      desc:
        dropPct >= 8 && stage !== 'stage4'
          ? `Your trailing stop-loss has triggered (${dropPct}% drop). Stage analysis says exit immediately to preserve capital.`
          : 'Stage 4 breakdown detected — price below a falling 30W MA. The framework says exit completely.',
      tag: 'Stop-loss triggered OR Stage 4 disaster',
    }
  }
  if (stage === 'stage3') {
    return {
      level: 'amber',
      icon: 'ti-alert-triangle',
      title: 'ACTION REQUIRED: SELL 50%',
      desc: 'Momentum is flattening — the 30W MA is going sideways and price is no longer making higher highs. Stage analysis suggests booking half your gains here.',
      tag: 'Stage 3 — book partial profit',
    }
  }
  return {
    level: 'green',
    icon: 'ti-lock-open',
    title: 'STATUS: SAFE HOLD',
    desc: 'Stage 2 uptrend intact — price above a rising 30W MA, no stop-loss breach. Let your profits run.',
    tag: 'Stage 2 — uptrend healthy',
  }
}

// ── Quiz ───────────────────────────────────────────────────────────────
const QUESTIONS = [
  {
    q: 'When a stock’s price moves sideways for weeks and the 30-week MA loses its upward slope, what Weinstein stage is it in?',
    options: ['Stage 1 (Basing)', 'Stage 2 (Uptrend)', 'Stage 3 (Top)', 'Stage 4 (Downtrend)'],
    correct: 2,
    hint: 'A flat MA after a long advance, with price chopping in a range, is the classic Stage 3 (topping) signature.',
  },
  {
    q: 'In Stage Analysis, what does the framework say when price closes below a flat or declining 30-week MA on heavy volume?',
    options: ['Buy more', 'Hold and wait', 'Sell half', 'Sell all remaining shares'],
    correct: 3,
    hint: 'A close below a flat/declining 30W MA on volume is the canonical Stage-4 entry — the framework prescribes exiting completely.',
  },
  {
    q: 'For a short-term trader, at what loss below the buying price does Weinstein’s framework suggest a hard exit?',
    options: ['2–3%', '5%', '7–8%', '15%'],
    correct: 2,
    hint: 'A 7–8% trailing stop is the textbook short-term cap so a single bad trade can’t derail the account.',
  },
]

// ── Page ───────────────────────────────────────────────────────────────
export default function WhenToSell() {
  const navigate = useNavigate()
  const [stage, setStage] = useState('stage2')
  const [dropPct, setDropPct] = useState(0)
  const [qIdx, setQIdx] = useState(0)
  const [selected, setSelected] = useState(null)
  const [score, setScore] = useState(0)
  const [answered, setAnswered] = useState([])
  const data = useMemo(() => chartData(stage), [stage])
  const stageMeta = STAGES.find((s) => s.id === stage) || STAGES[0]
  const action = getAction(stage, dropPct)

  const q = QUESTIONS[qIdx]
  const done = qIdx >= QUESTIONS.length

  const handleAnswer = (i) => {
    if (selected != null) return
    setSelected(i)
    const isCorrect = i === q.correct
    setAnswered([...answered, isCorrect])
    if (isCorrect) setScore((s) => s + 1)
  }
  const next = () => {
    setSelected(null)
    setQIdx((i) => i + 1)
  }
  const restart = () => {
    setQIdx(0); setSelected(null); setScore(0); setAnswered([])
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '20px 16px 80px', color: 'var(--text-primary)' }}>
      <Helmet><title>When to Sell a Stock | PineX Learn</title></Helmet>

      {/* Header */}
      <header style={{ maxWidth: 1180, margin: '0 auto 24px' }}>
        <button onClick={() => navigate('/learn')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i className="ti ti-arrow-left" /> Back to Learn
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>
          When to Sell a Stock
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 760 }}>
          Buying well is half the work — keeping the gains is the other half. This module walks through the Stage&nbsp;2&nbsp;→&nbsp;3&nbsp;→&nbsp;4 exit rules with an interactive simulator and a short quiz.
        </p>
      </header>

      <section style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 20, gridAutoRows: 'min-content' }} className="when-to-sell-grid">
        {/* ── LEFT: Simulator ────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardLabel>Interactive simulator</CardLabel>
            <h2 style={{ margin: '4px 0 12px', fontSize: 18, fontWeight: 700 }}>Walk through the three stages</h2>

            {/* Stage selector */}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Pick a market stage</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', fontSize: 14, fontWeight: 600,
                marginBottom: 16,
              }}
            >
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>

            {/* Chart */}
            <div style={{ width: '100%', height: 260, background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 8px 8px', border: '1px solid var(--border)' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} label={{ value: 'Week', position: 'insideBottomRight', offset: -2, fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={36} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-muted)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                  <Line type="monotone" dataKey="price" name="Price" stroke="#60A5FA" strokeWidth={2.4} dot={false} isAnimationActive />
                  <Line type="monotone" dataKey="ma" name="30W MA" stroke={stageMeta.maColor} strokeWidth={2.4} dot={false} isAnimationActive />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Trailing stop-loss slider */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Trailing stop-loss drop</label>
                <span style={{ fontSize: 13, fontWeight: 700, color: dropPct >= 8 ? '#EF4444' : 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>−{dropPct}%</span>
              </div>
              <input
                type="range"
                min="0" max="20" step="1"
                value={dropPct}
                onChange={(e) => setDropPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: dropPct >= 8 ? '#EF4444' : '#10B981' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-hint)', marginTop: 4 }}>
                <span>0% (no drop)</span><span>8% trigger</span><span>20%</span>
              </div>
            </div>
          </Card>

          {/* Action Center */}
          <ActionCenter action={action} />
        </div>

        {/* ── RIGHT: Quiz ────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardLabel>Knowledge check</CardLabel>
            {/* Progress bar */}
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
                      <button
                        key={i}
                        onClick={() => handleAnswer(i)}
                        disabled={reveal}
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
                      {selected === q.correct ? 'Correct' : 'Not quite'}
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{q.hint}</p>
                    <button onClick={next} style={{ marginTop: 10, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      {qIdx + 1 === QUESTIONS.length ? 'See result →' : 'Next question →'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 6 }}>{score === QUESTIONS.length ? '🏆' : score >= 2 ? '👍' : '📚'}</div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>You scored {score} / {QUESTIONS.length}</h3>
                <p style={{ margin: '6px 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                  {score === QUESTIONS.length ? 'You’ve got the exit framework down. Save your capital.' : 'Review the simulator above and try again — these three rules are the whole framework.'}
                </p>
                <button onClick={restart} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <i className="ti ti-refresh" style={{ marginRight: 6 }} /> Try again
                </button>
              </div>
            )}
          </Card>

          {/* Summary table */}
          <Card>
            <CardLabel>Quick reference</CardLabel>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Situation</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Stage</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Framework action</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Price above rising 30W MA', 'Stage 2 (Uptrend)', 'HOLD'],
                  ['Sideways chop, 30W MA flat', 'Stage 3 (Top)', 'SELL 50% (book partial)'],
                  ['Breaks below flat / declining MA', 'Entering Stage 4', 'SELL 100% (exit)'],
                  ['Price drops 7–8% from your entry', 'Any', 'TRAILING STOP triggers'],
                ].map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>{r[0]}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>{r[1]}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* Disclaimer */}
      <footer style={{ maxWidth: 1180, margin: '24px auto 0', padding: '14px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
        Educational module on the Stage-Analysis exit framework. Examples are illustrative — not personal investment advice on any specific holding.
        Data only · Not a research report · Not SEBI registered.
      </footer>

      {/* Two-column layout from md breakpoint up */}
      <style>{`
        @media (min-width: 900px) {
          .when-to-sell-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>
    </main>
  )
}

// ── Tiny presentational helpers (kept local so the file is self-contained) ──
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
function ActionCenter({ action }) {
  const palette = {
    green: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.35)', color: '#10B981' },
    amber: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.40)', color: '#F59E0B' },
    red:   { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.45)',  color: '#EF4444' },
  }[action.level]
  return (
    <div
      style={{
        background: palette.bg, border: `1.5px solid ${palette.border}`, borderRadius: 14,
        padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 14,
        animation: action.level === 'red' ? 'pinex-pulse 1.4s ease-in-out infinite' : 'none',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: palette.color, color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <i className={'ti ' + action.icon} style={{ fontSize: 22 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: palette.color, letterSpacing: '0.08em' }}>
          {action.tag}
        </p>
        <h3 style={{ margin: '4px 0 6px', fontSize: 16, fontWeight: 800, color: palette.color }}>
          {action.title}
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{action.desc}</p>
      </div>
      <style>{`@keyframes pinex-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); } }`}</style>
    </div>
  )
}
