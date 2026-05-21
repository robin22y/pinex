import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'

// ─── Content ────────────────────────────────────────────────────────────────

const STAGES = [
  { label: 'Stage 1', color: C.textMuted, bg: 'rgba(148,158,171,0.12)', border: 'rgba(148,158,171,0.25)' },
  { label: 'Stage 2', color: C.green,     bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)'  },
  { label: 'Stage 3', color: C.amber,     bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.30)'  },
  { label: 'Stage 4', color: C.red,       bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.30)' },
]

const LESSONS = [
  {
    id: 'intro',
    icon: '🌱',
    title: 'Every stock has a life cycle',
    body: [
      'Think of a stock like a mango tree.',
      'First the tree just sits there — no fruit. Then it slowly starts to grow. Then it blooms and gives the best mangoes. Then it gets tired and the fruit starts to fall.',
      'Stocks do the same thing. They go through 4 stages, one after the other — every single time.',
      'Learning these 4 stages is the most important thing you can do as an investor. Everything else flows from here.',
    ],
  },
  {
    id: 'stage1',
    icon: '😴',
    stageIdx: 0,
    title: 'Stage 1 — Sleeping',
    body: [
      'The stock price is going nowhere. Up a little, down a little, no real direction. It looks boring.',
      'Think of a coconut tree in the dry season — it is alive, but it is not flowering yet.',
      'Investors who have been holding this stock for a long time are slowly selling and getting out. New investors are slowly buying. The two sides are balanced — that is why the price is flat.',
    ],
    rule: '⛔  Do not buy here. Boring is not safe — it is just waiting.',
  },
  {
    id: 'stage2',
    icon: '🚀',
    stageIdx: 1,
    title: 'Stage 2 — Rising',
    body: [
      'The stock starts climbing steadily. It makes a new high, pulls back a little, then makes another new high. This is what a healthy rising stock looks like.',
      'The coconut tree is now in full bloom — it is the best time to climb up and pick the coconuts.',
      'More people are noticing the stock. Big fund houses are buying. This buying pressure pushes the price higher week after week.',
    ],
    rule: '✅  This is the best time to buy. PineX focuses on these stocks.',
  },
  {
    id: 'stage3',
    icon: '😓',
    stageIdx: 2,
    title: 'Stage 3 — Tired',
    body: [
      'The stock has been rising for a while. Now it starts making big swings — up one week, down the next. The coconuts are still there but the tree is getting shaky.',
      'The big fund houses who bought early are now quietly selling their shares. But new buyers, who heard about the stock from friends, are still buying.',
      'This tug-of-war causes those big swings you see.',
    ],
    rule: '⚠️  Think about exiting. Stage 3 often turns into Stage 4.',
  },
  {
    id: 'stage4',
    icon: '📉',
    stageIdx: 3,
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
    id: 'summary',
    icon: '🗺️',
    title: 'The Simple Rule',
    body: [
      'You do not need to predict the future. You just need to identify which stage a stock is in right now.',
    ],
    stages: true,
    rule: '📌  Buy in Stage 2. Start thinking of exit in Stage 3. Never chase Stage 4.',
  },
  {
    id: 'quiz-intro',
    icon: '🧠',
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

const COMING_SOON = [
  { num: 2, title: 'How to Read a Stock Chart',  desc: 'Support, resistance, and moving averages — in plain English.' },
  { num: 3, title: 'Volume — The Hidden Signal',  desc: 'Why volume tells you what price cannot.' },
  { num: 4, title: 'How PineX Ranks Stocks',      desc: 'Understanding the RS score and Stage filters.' },
  { num: 5, title: 'Your First Trade Plan',        desc: 'Entry, stop-loss, and target — a simple framework.' },
]

const TOTAL_STEPS = LESSONS.length + QUIZ.length  // 9

// ─── Sub-components ──────────────────────────────────────────────────────────

function StageBadge({ idx }) {
  const s = STAGES[idx]
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 700,
      padding: '3px 8px', borderRadius: 5,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      letterSpacing: '0.04em',
    }}>
      {s.label}
    </span>
  )
}

function StageStrip() {
  const labels = ['Sleeping', 'Rising', 'Tired',  'Falling']
  const rules  = ['Wait',     'Buy ✅', 'Exit?',  'Avoid']
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, margin: '16px 0' }}>
      {STAGES.map((s, i) => (
        <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.label}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, lineHeight: 1.4 }}>{labels[i]}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{rules[i]}</div>
        </div>
      ))}
    </div>
  )
}

function LessonCard({ lesson, onNext, isLast }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 44, marginBottom: 12, lineHeight: 1 }}>{lesson.icon}</div>

        {lesson.stageIdx != null && (
          <div style={{ marginBottom: 10 }}><StageBadge idx={lesson.stageIdx} /></div>
        )}

        <h2 style={{ fontSize: 22, fontWeight: 800, color: C.textHeading, margin: '0 0 16px', lineHeight: 1.25 }}>
          {lesson.title}
        </h2>

        {lesson.body.map((para, i) => (
          <p key={i} style={{ fontSize: 15, color: C.text, lineHeight: 1.7, margin: '0 0 12px' }}>{para}</p>
        ))}

        {lesson.stages && <StageStrip />}

        {lesson.tip && (
          <div style={{ background: C.blueBg, border: `1px solid ${C.blue}22`, borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
            <span style={{ fontSize: 13, color: C.blue }}>💡 {lesson.tip}</span>
          </div>
        )}

        {lesson.rule && (
          <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginTop: 16, fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>
            {lesson.rule}
          </div>
        )}
      </div>

      <button onClick={onNext} style={{ marginTop: 24, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
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

        <p style={{ fontSize: 16, fontWeight: 600, color: C.textHeading, lineHeight: 1.6, margin: '0 0 20px' }}>
          {q.question}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {q.options.map((opt, i) => {
            let bg = C.surface2, border = C.border, color = C.text
            if (picked !== null) {
              if (i === q.correct)   { bg = C.greenBg; border = C.greenBorder; color = C.green }
              else if (i === picked) { bg = C.redBg;   border = C.redBorder;   color = C.red   }
            }
            const letterColor = picked === null ? C.blue
              : (i === q.correct ? C.green : (i === picked ? C.red : C.textMuted))
            return (
              <button
                key={i}
                onClick={() => picked === null && setPicked(i)}
                style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'left', cursor: picked === null ? 'pointer' : 'default', color, fontSize: 14, fontWeight: 500, lineHeight: 1.4, transition: 'all 0.15s' }}
              >
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

function CompletionScreen({ onHome }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ textAlign: 'center', padding: '20px 0 24px' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: C.textHeading, margin: '0 0 8px' }}>Module 1 Done!</h2>
          <p style={{ fontSize: 15, color: C.textMuted, margin: '0 0 4px' }}>The Weinstein 4-Stage Method</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 20, padding: '5px 14px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>✓ Completed</span>
          </div>
        </div>

        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 14, color: C.text, lineHeight: 1.7, margin: 0 }}>
            You now know the most important framework for stock investing. Every time you look at a stock, ask yourself: <strong style={{ color: C.textHeading }}>which stage is it in?</strong>
          </p>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Coming Next</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {COMING_SOON.map(m => (
            <div key={m.num} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: 0.6 }}>
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>
                {m.num}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 2 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: C.textFaint }}>{m.desc}</div>
                <div style={{ fontSize: 11, color: C.blue, marginTop: 4, fontWeight: 600 }}>Coming Soon</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onHome} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
        Go Home
      </button>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Learn() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const isDone = step >= TOTAL_STEPS
  const progress = isDone ? 1 : step / TOTAL_STEPS
  const handleNext = () => setStep(s => s + 1)

  const currentLesson  = step < LESSONS.length ? LESSONS[step] : null
  const currentQuizIdx = step >= LESSONS.length && step < TOTAL_STEPS ? step - LESSONS.length : null

  return (
    <>
      <Helmet>
        <title>Learn — Weinstein 4-Stage Method | PineX</title>
        <meta name="description" content="Learn the Weinstein 4-stage stock market method in simple English. Tap-through lessons with real analogies." />
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
              Module 1 · Weinstein Stages
              {!isDone && <span style={{ marginLeft: 8, color: C.blue }}>{step + 1} / {TOTAL_STEPS}</span>}
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, background: C.blue, width: `${progress * 100}%`, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        </div>

        {/* Card body */}
        <div style={{ flex: 1, padding: '20px 16px 24px', display: 'flex', flexDirection: 'column', maxWidth: 480, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {isDone ? (
            <CompletionScreen onHome={() => navigate('/')} />
          ) : currentLesson ? (
            <LessonCard lesson={currentLesson} onNext={handleNext} isLast={step === LESSONS.length - 1} />
          ) : currentQuizIdx !== null ? (
            <QuizCard q={QUIZ[currentQuizIdx]} qNum={currentQuizIdx + 1} total={QUIZ.length} onNext={handleNext} isLast={currentQuizIdx === QUIZ.length - 1} />
          ) : null}
        </div>

        {/* Module strip footer */}
        {!isDone && (
          <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, padding: '12px 16px', background: C.surface }}>
            <div style={{ fontSize: 11, color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Modules</div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {[{ num: 1, title: 'Weinstein Stages', active: true }, ...COMING_SOON.map(m => ({ num: m.num, title: m.title, active: false }))].map(m => (
                <div key={m.num} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: m.active ? C.blueBg : 'transparent', border: `1px solid ${m.active ? C.blue : C.border}` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: m.active ? C.blue : C.textFaint }}>{m.num}</span>
                  <span style={{ fontSize: 11, color: m.active ? C.blue : C.textFaint, whiteSpace: 'nowrap' }}>{m.title}</span>
                  {!m.active && <span style={{ fontSize: 10, color: C.textFaint }}>· Soon</span>}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </>
  )
}
