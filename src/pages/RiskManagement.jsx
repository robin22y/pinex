// ── Risk Management — interactive learning module ─────────────────────────
// Self-contained educational page on the 2% portfolio-risk rule and position
// sizing. Two-column layout: a live position-sizing calculator on the left,
// a 2-question quiz on the right. Sibling to WhenToSell.jsx — same Card /
// CardLabel pattern, same Tabler icons, no new dependencies.
//
// Editorial posture: this teaches a risk-management framework (the 2% rule
// and the position-sizing formula) as neutral education. The calculator
// outputs a number from a formula the user enters; it isn't a recommendation
// for any specific stock. Disclaimer is shown at the bottom of the page.

import { useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'

// ─────────────────────────────────────────────────────────────────────────
// TRANSLATION-FRIENDLY STRINGS
// All user-visible text lives here so a translator can swap to Hindi /
// Malayalam / Tamil by replacing this object. No strings should be added
// inline in the JSX below.
// ─────────────────────────────────────────────────────────────────────────
const STRINGS = {
  back: '← Back to Learn',
  pageTitle: 'Risk Management — Protecting Your Capital',
  pageIntro:
    'You don’t control the stock price, but you fully control how much money you’re willing to lose on a single trade. This module shows the 2% portfolio-risk rule and the exact position-sizing formula — live, with your numbers.',

  calc: {
    label: 'Position sizing calculator',
    heading: 'How many shares should you buy?',
    capital: 'Total trading capital',
    capitalHelp: 'Your seed money — the full balance in the trading account.',
    riskPct: 'Risk per trade',
    riskPctHelp:
      'The maximum % of your capital you accept losing on this one trade. The framework caps this at 2%.',
    buyPrice: 'Stock buying price',
    stopLoss: 'Stop-loss price',
    stopLossHelp: 'The price at which you accept the trade has failed and exit.',
    maxRisk: 'Maximum loss if stop-loss hits',
    riskPerShare: 'Risk per share',
    sharesOut: 'Number of shares to buy',
    deployedOut: 'Total capital deployed',
    deployedPct: '% of total capital',
    warning:
      '⚠ High risk per trade can deplete capital quickly. The framework recommends ≤ 2%.',
    invalidStop: 'Stop-loss must be below the buying price.',
    zeroBuy: 'Enter a buying price greater than zero.',
  },

  quiz: {
    label: 'Knowledge check',
    correct: 'Correct',
    notQuite: 'Not quite',
    next: 'Next question →',
    seeResult: 'See result →',
    tryAgain: 'Try again',
    perfect: 'You’ve internalised the framework. Capital protected.',
    good: 'Solid grasp — review the calculator on the left and try again to lock it in.',
    weak: 'Worth re-reading the rule. The 2% cap is the single most protective habit a retail trader can adopt.',
  },

  table: {
    label: 'Quick reference',
    headers: ['Term', 'Plain meaning', 'Why it matters'],
    rows: [
      ['Total capital', 'All money in your trading account', 'Your seed for compounding'],
      ['Max risk (2%)', 'Most you let yourself lose per trade', 'Stops one trade from wiping you out'],
      ['Stop-loss', 'Price where you accept the trade failed', 'Your emergency exit door'],
      ['Position size', 'Exact number of shares to buy', 'Controls speed of profit AND loss'],
    ],
  },

  disclaimer:
    'Educational module on a position-sizing framework. Examples are illustrative only — not personal investment advice on any specific stock. Data only · Not a research report · Not SEBI registered.',
}

const QUESTIONS = [
  {
    q: 'Your total trading capital is ₹50,000. By the 2% rule, what is the maximum money you should risk on a single trade?',
    options: ['₹5,000', '₹1,000', '₹2,000', '₹500'],
    correct: 1,
    hint: '2% of ₹50,000 = ₹1,000. If a trade reaches a loss of ₹1,000, you close it. No exceptions.',
  },
  {
    q: 'You buy a stock with no stop-loss price decided in advance. What are you actually doing?',
    options: ['Smart long-term investing', 'Gambling with your capital', 'Compounding', 'Diversifying'],
    correct: 1,
    hint:
      'Without a pre-decided exit, a single corporate scam, sector crash or macro shock can erase 50–80% of your capital before you act. A stop-loss converts an open-ended risk into a known one.',
  },
]

// ─────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────
export default function RiskManagement() {
  const navigate = useNavigate()

  // Calculator state — defaults match the worked example in the lesson.
  const [capital, setCapital] = useState(100000)   // ₹1,00,000
  const [riskPct, setRiskPct] = useState(2.0)      // 2 %
  const [buyPrice, setBuyPrice] = useState(100)
  const [stopLoss, setStopLoss] = useState(90)

  // Derived calculations (memoised — pure math, runs on any input change).
  const calc = useMemo(() => {
    const maxRisk = Math.max(0, capital * (riskPct / 100))
    const riskPerShare = Math.max(0, buyPrice - stopLoss)
    const validInputs = buyPrice > 0 && stopLoss > 0 && riskPerShare > 0
    const shares = validInputs ? Math.floor(maxRisk / riskPerShare) : 0
    const deployed = shares * buyPrice
    const deployedPct = capital > 0 ? (deployed / capital) * 100 : 0
    return { maxRisk, riskPerShare, validInputs, shares, deployed, deployedPct }
  }, [capital, riskPct, buyPrice, stopLoss])

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

  const fmtINR = (n) =>
    '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '20px 16px 80px', color: 'var(--text-primary)' }}>
      <Helmet><title>Risk Management | PineX Learn</title></Helmet>

      {/* Header */}
      <header style={{ maxWidth: 1180, margin: '0 auto 24px' }}>
        <button onClick={() => navigate('/learn')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i className="ti ti-arrow-left" /> {STRINGS.back.replace('← ', '')}
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{STRINGS.pageTitle}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 760 }}>{STRINGS.pageIntro}</p>
      </header>

      {/* ── FOUNDATIONS — the textbook content the calculator brings to life ── */}
      <section style={{ maxWidth: 1180, margin: '0 auto 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* WHY — capital protection is the whole game */}
        <Card>
          <CardLabel>Foundation</CardLabel>
          <h2 style={{ margin: '4px 0 6px', fontSize: 18, fontWeight: 700 }}>1. Why position sizing matters more than picking</h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            You cannot control whether a stock goes up or down. You CAN control how much money is at risk on any single trade. Master traders accept losses on more than half their trades and still compound capital because their average loss is tiny and their average win is large.
          </p>
          <div className="why-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
            {[
              { title: 'The 2% Rule', icon: '🛡', color: '#10B981',
                body: 'Never risk more than 2% of total capital on a single trade. With this cap, even 10 losing trades in a row only draws the account down by ~18% — fully recoverable. A trader risking 10% per trade is wiped out after 6 losses.' },
              { title: 'The Recovery Math', icon: '📉', color: '#EF4444',
                body: 'Losses are NOT symmetric. A 10% loss needs an 11% gain to break even. A 50% loss needs a 100% gain. A 90% loss needs a 900% gain. Small, capped losses recover. Large losses end careers.' },
            ].map((p) => (
              <div
                key={p.title}
                style={{
                  padding: '14px 16px', borderRadius: 12,
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

        {/* METHOD — the 3-step position sizing playbook */}
        <Card>
          <CardLabel>Method</CardLabel>
          <h2 style={{ margin: '4px 0 6px', fontSize: 18, fontWeight: 700 }}>2. The 3-step position sizing playbook</h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Run these three steps BEFORE entering any trade. The calculator on the next section does the arithmetic for you, but the discipline is in this sequence.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { title: 'Set your max risk',  sub: 'The capital question.',
                body: 'Decide the absolute rupee amount you are willing to lose on this one trade. With the 2% rule on a ₹1,00,000 account, that ceiling is ₹2,000. Write it down — this number does NOT change after you enter.' },
              { title: 'Pick the stop-loss BEFORE entry', sub: 'The exit question.',
                body: 'Before you buy a single share, decide the exact price at which you accept the trade has failed. Usually this is just below a recent support level or the 30-week MA. No stop-loss = no trade.' },
              { title: 'Calculate the share count', sub: 'The math question.',
                body: 'Shares = Max risk ÷ (Buy price − Stop-loss price). This formula is non-negotiable. If the math says 80 shares, you buy 80 — not 100 because you "feel good" about the stock.' },
            ].map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)',
                    color: '#10B981', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
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

        {/* SUMMARY — the recovery-math table */}
        <Card>
          <CardLabel>Quick summary</CardLabel>
          <h2 style={{ margin: '4px 0 4px', fontSize: 16, fontWeight: 700 }}>The recovery math — why caps matter</h2>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>How much your remaining capital must gain just to break even after a drawdown.</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Loss</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Gain needed to break even</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { loss: '−2%',  need: '+2%',   verdict: 'Negligible. The 2% rule lives here.',                     tone: '#10B981' },
                  { loss: '−10%', need: '+11%',  verdict: 'Still recoverable in a few good trades.',                  tone: '#10B981' },
                  { loss: '−25%', need: '+33%',  verdict: 'Painful. Months of careful work to recover.',               tone: '#F59E0B' },
                  { loss: '−50%', need: '+100%', verdict: 'Need to DOUBLE remaining capital just to get back.',        tone: '#EF4444' },
                  { loss: '−90%', need: '+900%', verdict: 'Effectively over. Almost no one comes back from this.',     tone: '#EF4444' },
                ].map((r) => (
                  <tr key={r.loss}>
                    <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--border)', fontWeight: 700, color: r.tone, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)' }}>{r.loss}</td>
                    <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--border)', fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)' }}>{r.need}</td>
                    <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{r.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
          ↓ Now use the live calculator — enter your own capital and watch the share count update instantly.
        </p>
      </section>

      <section
        className="risk-grid"
        style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 20, gridAutoRows: 'min-content' }}
      >
        {/* ── LEFT: Calculator ─────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardLabel>{STRINGS.calc.label}</CardLabel>
            <h2 style={{ margin: '4px 0 16px', fontSize: 18, fontWeight: 700 }}>{STRINGS.calc.heading}</h2>

            {/* Capital */}
            <Field label={STRINGS.calc.capital} value={fmtINR(capital)} help={STRINGS.calc.capitalHelp}>
              <input
                type="range"
                min="10000" max="1000000" step="10000"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <RangeLabels left="₹10,000" right="₹10,00,000" />
            </Field>

            {/* Risk % */}
            <Field
              label={STRINGS.calc.riskPct}
              value={`${riskPct.toFixed(1)}%`}
              valueColor={riskPct > 2.5 ? '#F59E0B' : undefined}
              help={STRINGS.calc.riskPctHelp}
            >
              <input
                type="range"
                min="0.5" max="5" step="0.1"
                value={riskPct}
                onChange={(e) => setRiskPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: riskPct > 2.5 ? '#F59E0B' : 'var(--accent)' }}
              />
              <RangeLabels left="0.5%" mid="2% framework cap" right="5%" />
              {riskPct > 2.5 && (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: '#F59E0B', fontWeight: 600 }}>
                  {STRINGS.calc.warning}
                </p>
              )}
            </Field>

            {/* Buy + Stop price inputs — stacked on narrow phones, side-by-side
                from ~420px (single-column 1fr collapses cleanly on 360-375px). */}
            <div className="risk-input-pair" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, marginTop: 14 }}>
              <NumberInput
                label={STRINGS.calc.buyPrice}
                value={buyPrice}
                min={0}
                step={0.05}
                onChange={setBuyPrice}
              />
              <NumberInput
                label={STRINGS.calc.stopLoss}
                value={stopLoss}
                min={0}
                step={0.05}
                onChange={setStopLoss}
                help={STRINGS.calc.stopLossHelp}
              />
            </div>

            {(!buyPrice || buyPrice <= 0) && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#EF4444' }}>{STRINGS.calc.zeroBuy}</p>
            )}
            {buyPrice > 0 && stopLoss >= buyPrice && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#EF4444' }}>{STRINGS.calc.invalidStop}</p>
            )}
          </Card>

          {/* Output panel — the big numbers */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.10) 0%, var(--bg-surface) 100%)',
              border: '1px solid rgba(16,185,129,0.35)',
              borderRadius: 14, padding: '20px 22px',
            }}
          >
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: '#10B981', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Result · live from your inputs
            </p>
            {/* Two big numbers — minmax(0, 1fr) forces equal columns even when
                one value is much longer than the other (without it, "₹1,00,000"
                grabs all the space and "1,000" gets squashed). Stacks on the
                smallest viewports for breathing room. */}
            <div className="risk-result-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, marginTop: 12 }}>
              <Big label={STRINGS.calc.sharesOut} value={calc.validInputs ? calc.shares.toLocaleString('en-IN') : '—'} accent="#10B981" />
              <Big label={STRINGS.calc.deployedOut} value={calc.validInputs ? fmtINR(calc.deployed) : '—'} sub={calc.validInputs ? `${calc.deployedPct.toFixed(1)}% of capital` : ''} />
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 16, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span><b style={{ color: 'var(--text-primary)' }}>{fmtINR(calc.maxRisk)}</b> &nbsp;{STRINGS.calc.maxRisk}</span>
              <span><b style={{ color: 'var(--text-primary)' }}>{fmtINR(calc.riskPerShare)}</b> &nbsp;{STRINGS.calc.riskPerShare}</span>
            </div>
          </div>

          {/* The formula, shown plainly */}
          <Card>
            <CardLabel>The formula</CardLabel>
            <pre style={{ margin: '10px 0 0', padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, lineHeight: 1.7, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
{`Max risk     = capital × risk %
risk/share   = buy price − stop-loss
shares       = max risk ÷ risk/share
deployed     = shares × buy price`}
            </pre>
          </Card>
        </div>

        {/* ── RIGHT: Quiz + reference ──────────────────────────── */}
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
                <div style={{ fontSize: 48, marginBottom: 6 }}>{score === QUESTIONS.length ? '🛡' : score >= 1 ? '👍' : '📚'}</div>
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

          {/* Quick reference table */}
          <Card>
            <CardLabel>{STRINGS.table.label}</CardLabel>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {STRINGS.table.headers.map((h) => (
                    <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STRINGS.table.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{r[0]}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>{r[1]}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* Disclaimer */}
      <footer style={{ maxWidth: 1180, margin: '24px auto 0', padding: '14px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
        {STRINGS.disclaimer}
      </footer>

      {/* Responsive grid breakpoints.
          - Page level: stack at <900px, two columns above.
          - Buy/stop input pair: stack at <420px, side-by-side above.
          - Big-number result pair: stack at <520px, side-by-side above.
          - Big-number font shrinks one notch <420px so ₹X,XX,XXX still fits.
       */}
      <style>{`
        .risk-big-value { font-size: 32px; }
        @media (max-width: 419px) {
          .risk-big-value { font-size: 26px; word-break: break-word; }
        }
        @media (min-width: 420px) {
          .risk-input-pair { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; }
        }
        @media (min-width: 520px) {
          .risk-result-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; }
          .why-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; }
        }
        @media (min-width: 900px) {
          .risk-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>
    </main>
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
function Field({ label, value, valueColor, help, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</label>
        <span style={{ fontSize: 14, fontWeight: 700, color: valueColor || 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>{value}</span>
      </div>
      {children}
      {help && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>{help}</p>}
    </div>
  )
}
function RangeLabels({ left, mid, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-hint)', marginTop: 4 }}>
      <span>{left}</span>
      {mid && <span>{mid}</span>}
      <span>{right}</span>
    </div>
  )
}
function NumberInput({ label, value, min = 0, step = 1, onChange, help }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</label>
      <div style={{ display: 'inline-flex', alignItems: 'center', width: '100%', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
        <span style={{ padding: '0 10px', fontSize: 13, color: 'var(--text-muted)' }}>₹</span>
        <input
          type="number"
          inputMode="decimal"
          min={min} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 8px 10px 0', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}
        />
      </div>
      {help && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>{help}</p>}
    </div>
  )
}
function Big({ label, value, sub, accent }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p className="risk-big-value" style={{ margin: '4px 0 0', fontWeight: 800, color: accent || 'var(--text-primary)', lineHeight: 1.05, fontFamily: 'var(--font-mono, monospace)', overflowWrap: 'anywhere' }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}
// Tiny hex→rgba helper so the Foundation panels can re-use accent hues
// at low alpha without hard-coding rgba strings.
function hexA(hex, a) {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}
