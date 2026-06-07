import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAcademy } from '../hooks/useAcademy'
import StageChart from '../components/academy/StageChart'

// Languages supported by every module in the DB-driven academy.
// Display labels are in-language so each option is recognisable
// regardless of the user's current display language.
const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'ta', label: 'தமிழ்' },
]

// Compact label used in the closed state of the picker — keeps the
// sticky header narrow on mobile.
const LANG_SHORT = { en: 'EN', hi: 'हि', ml: 'മ', ta: 'த' }

export default function ModuleLesson() {
  const { moduleId } = useParams()
  const [params, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // Language is mutable: initial value comes from ?lang= -> localStorage
  // -> 'en'. The in-course switcher updates both state and localStorage
  // so a) the current page re-renders in the new language and b) the
  // choice persists across modules + sessions. The URL ?lang= param is
  // also synced via setSearchParams(..., { replace: true }) so deep-
  // linking + back/forward keeps the right language without polluting
  // the history stack.
  const [lang, setLang] = useState(
    () => params.get('lang') || localStorage.getItem('pinex_lang') || 'en',
  )

  function changeLang(next) {
    if (!next || next === lang) return
    setLang(next)
    try { localStorage.setItem('pinex_lang', next) } catch {}
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('lang', next)
      return p
    }, { replace: true })
  }

  const { saveProgress, saveLessonProgress, progress } = useAcademy()

  const [module, setModule] = useState(null)
  const [lessons, setLessons] = useState([])
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentLesson, setCurrentLesson] = useState(0)
  // WHY: A single state machine drives all
  // three sub-screens (lesson reader → quiz →
  // pass/fail result). The renderer below picks
  // the right block at the top of return().
  // Keeping it in one component (vs. nested
  // routes) means saveProgress can dispatch
  // straight to 'result' without a navigation
  // round-trip that would lose quiz state.
  const [mode, setMode] = useState('lesson') // 'lesson' | 'quiz' | 'result'
  const [quizState, setQuizState] = useState({
    current: 0,
    selected: null,
    answered: false,
    score: 0,
  })
  const [quizResult, setQuizResult] = useState(null)

  useEffect(() => {
    loadContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId])

  const loadContent = async () => {
    setLoading(true)
    try {
      const [modRes, lessonRes, qRes] = await Promise.all([
        supabase
          .from('academy_modules')
          .select('*')
          .eq('id', moduleId)
          .single(),
        supabase
          .from('academy_lessons')
          .select('*')
          .eq('module_id', moduleId)
          .eq('is_published', true)
          .order('sort_order'),
        supabase
          .from('academy_questions')
          .select('*')
          .eq('module_id', moduleId)
          .eq('is_published', true)
          .order('sort_order'),
      ])

      setModule(modRes.data || null)
      setLessons(lessonRes.data || [])
      setQuestions(qRes.data || [])
    } catch {
      setModule(null)
    }
    setLoading(false)
  }

  const getText = (obj, field) => {
    if (!obj) return ''
    return obj[`${field}_${lang}`] || obj[`${field}_en`] || ''
  }

  const getOption = (q, num) => getText(q, `option${num}`)

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        Loading...
      </div>
    )
  }

  if (!module) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40 }}>🤔</div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
          Module not found
        </div>
        <button
          onClick={() => navigate('/learn')}
          style={{
            marginTop: 8,
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent)',
            color: '#000',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Back to Academy
        </button>
      </div>
    )
  }

  // ─── QUIZ MODE ────────────────────────────────────────────────────────────
  if (mode === 'quiz') {
    const q = questions[quizState.current]
    if (!q) {
      return (
        <div
          style={{
            minHeight: '100vh',
            background: 'var(--bg-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
        >
          No quiz questions yet.
        </div>
      )
    }
    const isAnswered = quizState.answered
    const isCorrect = quizState.selected === q.correct_option
    const isLast = quizState.current === questions.length - 1

    return (
      // WHY: height: 100dvh (not minHeight: 100vh)
      // caps the wrapper exactly to the viewport so
      // the middle flex section actually scrolls
      // instead of pushing the sticky bottom button
      // off-screen behind the mobile BottomNav.
      // 100dvh tracks the live viewport (URL bar
      // collapse on iOS) — 100vh would over-shoot.
      <div
        style={{
          height: '100dvh',
          width: '100%',
          maxWidth: 600,
          boxSizing: 'border-box',
          background: 'var(--bg-primary)',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Quiz header */}
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <button
            onClick={() => {
              setMode('lesson')
              setQuizState({
                current: 0,
                selected: null,
                answered: false,
                score: 0,
              })
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <i className="ti ti-x" style={{ fontSize: 18 }} />
          </button>
          <div style={{ flex: 1 }}>
            <div
              style={{
                height: 6,
                background: 'var(--border)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(quizState.current / questions.length) * 100}%`,
                  background: '#00C805',
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#00C805',
              fontFamily: 'var(--font-mono)',
              minWidth: 40,
              textAlign: 'right',
            }}
          >
            {quizState.score}/{questions.length}
          </div>
          <LangPicker lang={lang} onChange={changeLang} />
        </div>

        {/* Question */}
        <div style={{ flex: 1, padding: '24px 16px', overflowY: 'auto' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            {lang === 'en' &&
              `Question ${quizState.current + 1} of ${questions.length}`}
            {lang === 'hi' &&
              `प्रश्न ${quizState.current + 1} / ${questions.length}`}
            {lang === 'ml' &&
              `ചോദ്യം ${quizState.current + 1} / ${questions.length}`}
            {lang === 'ta' &&
              `கேள்வி ${quizState.current + 1} / ${questions.length}`}
          </div>

          <div
            style={{
              fontSize: 19,
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.45,
              marginBottom: 24,
            }}
          >
            {getText(q, 'question')}
          </div>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map((num) => {
              const optText = getOption(q, num)
              const isSelected = quizState.selected === num
              const isCorrectOpt = num === q.correct_option

              let bg = 'var(--bg-elevated)'
              let border = '1px solid var(--border)'
              let color = 'var(--text-primary)'

              if (isAnswered) {
                if (isCorrectOpt) {
                  bg = 'rgba(0,200,5,0.12)'
                  border = '2px solid #00C805'
                  color = '#00C805'
                } else if (isSelected) {
                  bg = 'rgba(255,59,48,0.1)'
                  border = '2px solid #FF3B30'
                  color = '#FF3B30'
                }
              } else if (isSelected) {
                bg = 'rgba(96,165,250,0.1)'
                border = '2px solid #60A5FA'
                color = '#60A5FA'
              }

              return (
                <button
                  key={num}
                  onClick={() => {
                    if (isAnswered) return
                    const correct = num === q.correct_option
                    setQuizState((s) => ({
                      ...s,
                      selected: num,
                      answered: true,
                      score: s.score + (correct ? 1 : 0),
                    }))
                  }}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 10,
                    border,
                    background: bg,
                    color,
                    fontSize: 14,
                    fontWeight: isAnswered && isCorrectOpt ? 700 : 500,
                    cursor: isAnswered ? 'default' : 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.15s',
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: isAnswered
                        ? isCorrectOpt
                          ? '#00C805'
                          : isSelected
                          ? '#FF3B30'
                          : 'var(--border)'
                        : isSelected
                        ? '#60A5FA'
                        : 'var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#fff',
                      flexShrink: 0,
                      transition: 'background 0.15s',
                    }}
                  >
                    {isAnswered
                      ? isCorrectOpt
                        ? '✓'
                        : isSelected
                        ? '✗'
                        : ['A', 'B', 'C', 'D'][num - 1]
                      : ['A', 'B', 'C', 'D'][num - 1]}
                  </span>
                  {optText}
                </button>
              )
            })}
          </div>

          {/* Explanation after answer */}
          {isAnswered && (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 10,
                background: isCorrect
                  ? 'rgba(0,200,5,0.08)'
                  : 'rgba(255,59,48,0.08)',
                border: `1px solid ${
                  isCorrect ? 'rgba(0,200,5,0.2)' : 'rgba(255,59,48,0.2)'
                }`,
                marginTop: 16,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: isCorrect ? '#00C805' : '#FF3B30',
                  marginBottom: 4,
                }}
              >
                {isCorrect
                  ? lang === 'en'
                    ? '✓ Correct!'
                    : lang === 'hi'
                    ? '✓ सही!'
                    : lang === 'ml'
                    ? '✓ ശരി!'
                    : '✓ சரி!'
                  : lang === 'en'
                  ? '✗ Not quite'
                  : lang === 'hi'
                  ? '✗ सही नहीं'
                  : lang === 'ml'
                  ? '✗ ശരിയല്ല'
                  : '✗ சரியில்லை'}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  lineHeight: 1.6,
                }}
              >
                {getText(q, 'explanation')}
              </div>
            </div>
          )}
        </div>

        {/* Next button */}
        {isAnswered && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)',
            }}
          >
            <button
              onClick={() => {
                if (isLast) {
                  const finalScore = quizState.score
                  const passed = finalScore >= (module.pass_mark || 0)
                  setQuizResult({ score: finalScore, passed })
                  setMode('result')
                  saveProgress(moduleId, finalScore, passed, questions.length)
                } else {
                  setQuizState((s) => ({
                    ...s,
                    current: s.current + 1,
                    selected: null,
                    answered: false,
                  }))
                }
              }}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 10,
                border: 'none',
                background: '#00C805',
                color: '#000',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isLast
                ? lang === 'en'
                  ? 'See results →'
                  : lang === 'hi'
                  ? 'परिणाम देखें →'
                  : lang === 'ml'
                  ? 'ഫലം കാണുക →'
                  : 'முடிவு காணவும் →'
                : lang === 'en'
                ? 'Next question →'
                : lang === 'hi'
                ? 'अगला प्रश्न →'
                : lang === 'ml'
                ? 'അടുത്ത ചോദ്യം →'
                : 'அடுத்த கேள்வி →'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── RESULT MODE ──────────────────────────────────────────────────────────
  if (mode === 'result' && quizResult) {
    const { score, passed } = quizResult
    const pct = questions.length
      ? Math.round((score / questions.length) * 100)
      : 0

    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            width: '100%',
            background: 'var(--bg-surface)',
            border: `1px solid ${
              passed ? 'rgba(0,200,5,0.3)' : 'var(--border)'
            }`,
            borderRadius: 20,
            padding: 28,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 64, marginBottom: 16, lineHeight: 1 }}>
            {passed ? '🎉' : '📚'}
          </div>

          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: passed ? '#00C805' : 'var(--text-primary)',
              marginBottom: 6,
              letterSpacing: '-0.02em',
            }}
          >
            {passed
              ? lang === 'en'
                ? 'Module Complete!'
                : lang === 'hi'
                ? 'Module पूरा!'
                : lang === 'ml'
                ? 'Module പൂർത്തിയായി!'
                : 'Module முடிந்தது!'
              : lang === 'en'
              ? 'Almost there!'
              : lang === 'hi'
              ? 'लगभग पहुंच गए!'
              : lang === 'ml'
              ? 'ഏതാണ്ട് എത്തി!'
              : 'கிட்டத்தட்ட வந்தீர்கள்!'}
          </div>

          {/* Score circle */}
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: '50%',
              background: passed ? 'rgba(0,200,5,0.12)' : 'var(--bg-elevated)',
              border: `3px solid ${passed ? '#00C805' : 'var(--border)'}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '20px auto',
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: passed ? '#00C805' : 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                lineHeight: 1,
              }}
            >
              {score}/{questions.length}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {pct}%
            </div>
          </div>

          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              lineHeight: 1.6,
              marginBottom: 24,
              padding: '0 8px',
            }}
          >
            {passed
              ? lang === 'en'
                ? `You scored ${score} out of ${questions.length}. Great understanding of ${
                    module[`title_${lang}`] || module.title_en
                  }!`
                : lang === 'hi'
                ? `आपने ${questions.length} में से ${score} सही किए। बहुत अच्छा!`
                : lang === 'ml'
                ? `${questions.length}-ൽ ${score} ശരി. മികച്ച പ്രകടനം!`
                : `${questions.length}-ல் ${score} சரி. சிறப்பான செயல்திறன்!`
              : lang === 'en'
              ? `You need ${module.pass_mark} correct to pass. You got ${score}. Review the lessons and try again.`
              : lang === 'hi'
              ? `Pass होने के लिए ${module.pass_mark} सही चाहिए। आपको ${score} मिले। Lessons review करके फिर try करें।`
              : lang === 'ml'
              ? `Pass ആകാൻ ${module.pass_mark} ശരി വേണം. ${score} കിട്ടി. Lessons review ചെയ്ത് വീണ്ടും try ചെയ്യുക.`
              : `Pass ஆக ${module.pass_mark} சரி வேண்டும். ${score} கிடைத்தது. Lessons பார்த்து மீண்டும் முயற்சிக்கவும்.`}
          </div>

          {/* Actions */}
          {passed ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => navigate('/learn')}
                style={{
                  padding: '13px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#00C805',
                  color: '#000',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {lang === 'en' && '← Back to Academy'}
                {lang === 'hi' && '← Academy पर वापस'}
                {lang === 'ml' && '← Academy-ലേക്ക് തിരിച്ച്'}
                {lang === 'ta' && '← Academy-க்கு திரும்பு'}
              </button>
              <button
                onClick={() => navigate('/certificate')}
                style={{
                  padding: '12px',
                  borderRadius: 10,
                  border: '1px solid rgba(0,200,5,0.3)',
                  background: 'rgba(0,200,5,0.08)',
                  color: '#00C805',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🏆{' '}
                {lang === 'en' && 'View certificate'}
                {lang === 'hi' && 'Certificate देखें'}
                {lang === 'ml' && 'Certificate കാണുക'}
                {lang === 'ta' && 'Certificate பார்க்கவும்'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => {
                  setMode('quiz')
                  setQuizState({
                    current: 0,
                    selected: null,
                    answered: false,
                    score: 0,
                  })
                  setQuizResult(null)
                }}
                style={{
                  padding: '13px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#00C805',
                  color: '#000',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {lang === 'en' && 'Try again →'}
                {lang === 'hi' && 'फिर try करें →'}
                {lang === 'ml' && 'വീണ്ടും try ചെയ്യുക →'}
                {lang === 'ta' && 'மீண்டும் முயற்சிக்கவும் →'}
              </button>
              <button
                onClick={() => {
                  setMode('lesson')
                  setCurrentLesson(0)
                }}
                style={{
                  padding: '12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {lang === 'en' && 'Review lessons'}
                {lang === 'hi' && 'Lessons review करें'}
                {lang === 'ml' && 'Lessons review ചെയ്യുക'}
                {lang === 'ta' && 'Lessons பார்க்கவும்'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── LESSON MODE (default) ────────────────────────────────────────────────
  const lesson = lessons[currentLesson]
  const isLastLesson = currentLesson === lessons.length - 1
  // eslint-disable-next-line no-unused-vars
  const alreadyPassed = progress[moduleId]?.passed

  return (
    <div
      style={{
        height: '100dvh',
        width: '100%',
        maxWidth: 600,
        boxSizing: 'border-box',
        overflowX: 'hidden',
        background: 'var(--bg-primary)',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Sticky header */}
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => navigate('/learn')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            flexShrink: 0,
          }}
        >
          <i className="ti ti-arrow-left" style={{ fontSize: 18 }} />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {module[`title_${lang}`] || module.title_en}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
            {lang === 'en' &&
              `Lesson ${currentLesson + 1} of ${lessons.length || 0}`}
            {lang === 'hi' &&
              `Lesson ${currentLesson + 1} / ${lessons.length || 0}`}
            {lang === 'ml' &&
              `Lesson ${currentLesson + 1} / ${lessons.length || 0}`}
            {lang === 'ta' &&
              `Lesson ${currentLesson + 1} / ${lessons.length || 0}`}
          </div>
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {lessons.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentLesson(i)}
              style={{
                width: i === currentLesson ? 20 : 8,
                height: 8,
                borderRadius: 4,
                border: 'none',
                background:
                  i < currentLesson
                    ? '#00C805'
                    : i === currentLesson
                    ? '#00C805'
                    : 'var(--border)',
                cursor: 'pointer',
                padding: 0,
                transition: 'width 0.2s',
              }}
            />
          ))}
        </div>

        <LangPicker lang={lang} onChange={changeLang} />
      </div>

      {/* Lesson content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 0' }}>
        {/* Lesson number badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 20,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 12,
          }}
        >
          {lang === 'en' && `Lesson ${currentLesson + 1}`}
          {lang === 'hi' && `पाठ ${currentLesson + 1}`}
          {lang === 'ml' && `പാഠം ${currentLesson + 1}`}
          {lang === 'ta' && `பாடம் ${currentLesson + 1}`}
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
            marginBottom: 16,
            letterSpacing: '-0.02em',
          }}
        >
          {lesson?.title || ''}
        </h1>

        {/* Content */}
        <div
          style={{
            fontSize: 15,
            color: 'var(--text-secondary)',
            lineHeight: 1.85,
            whiteSpace: 'pre-line',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            marginBottom: 20,
          }}
        >
          {lesson ? lesson[`content_${lang}`] || lesson.content_en || '' : ''}
        </div>

        {/* Visual — Chart */}
        {lesson?.visual_type === 'chart' && lesson?.visual_chart_type && (
          <div style={{ marginBottom: 20 }}>
            <StageChart type={lesson.visual_chart_type} height={200} />
            {lesson[`visual_caption_${lang}`] && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  marginTop: 8,
                  fontStyle: 'italic',
                }}
              >
                {lesson[`visual_caption_${lang}`] || lesson.visual_caption_en}
              </div>
            )}
          </div>
        )}

        {/* Visual — Image */}
        {lesson?.visual_type === 'image' && lesson?.visual_image_url && (
          <div style={{ marginBottom: 20 }}>
            <img
              src={lesson.visual_image_url}
              alt="Chart example"
              style={{
                width: '100%',
                borderRadius: 12,
                border: '1px solid var(--border)',
              }}
            />
            {lesson[`visual_caption_${lang}`] && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  marginTop: 8,
                  fontStyle: 'italic',
                }}
              >
                {lesson[`visual_caption_${lang}`]}
              </div>
            )}
          </div>
        )}

        {/* Image placeholder when visual_type is image but no URL yet */}
        {lesson?.visual_type === 'image' && !lesson?.visual_image_url && (
          <div
            style={{
              marginBottom: 20,
              padding: '32px 20px',
              background: 'var(--bg-elevated)',
              border: '2px dashed var(--border)',
              borderRadius: 12,
              textAlign: 'center',
            }}
          >
            <i
              className="ti ti-photo"
              style={{
                fontSize: 32,
                color: 'var(--text-hint)',
                display: 'block',
                marginBottom: 8,
              }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>
              Chart image — admin upload pending
            </div>
          </div>
        )}

        {/* Key points highlight */}
        {lesson && (
          <KeyPoints
            content={lesson[`content_${lang}`] || lesson.content_en || ''}
            lang={lang}
          />
        )}

        <div style={{ height: 80 }} />
      </div>

      {/* Bottom nav */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          display: 'flex',
          gap: 10,
          position: 'sticky',
          bottom: 0,
        }}
      >
        {currentLesson > 0 && (
          <button
            onClick={() => setCurrentLesson((l) => l - 1)}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ←{' '}
            {lang === 'en'
              ? 'Back'
              : lang === 'hi'
              ? 'वापस'
              : lang === 'ml'
              ? 'തിരിച്ച്'
              : 'பின்னால்'}
          </button>
        )}

        <button
          onClick={() => {
            if (isLastLesson) {
              // Mark lessons as complete BEFORE
              // showing the quiz. Screener unlock
              // is keyed off lessons_completed
              // (not quiz pass), so the user gets
              // access the moment they finish
              // reading — regardless of whether
              // they pass the quiz.
              saveLessonProgress(moduleId)
              setMode('quiz')
            } else {
              setCurrentLesson((l) => l + 1)
            }
          }}
          style={{
            flex: 2,
            padding: '12px',
            borderRadius: 10,
            border: 'none',
            background: isLastLesson ? '#00C805' : 'var(--bg-elevated)',
            color: isLastLesson ? '#000' : 'var(--text-primary)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {isLastLesson
            ? lang === 'en'
              ? '📝 Take Quiz →'
              : lang === 'hi'
              ? '📝 Quiz लें →'
              : lang === 'ml'
              ? '📝 Quiz എടുക്കുക →'
              : '📝 Quiz எடுக்கவும் →'
            : lang === 'en'
            ? 'Next →'
            : lang === 'hi'
            ? 'अगला →'
            : lang === 'ml'
            ? 'അടുത്തത് →'
            : 'அடுத்து →'}
        </button>
      </div>
    </div>
  )
}

// ── LangPicker ─────────────────────────────────────────────────────────
// Compact in-course language switcher mounted in the sticky header for
// both lesson reader and quiz. Uses a native <select> so the OS-native
// picker UI handles the popover (great mobile UX, zero a11y effort).
// Closed-state label is the 2-character native script glyph (EN / हि /
// മ / த) to keep the header narrow; the option list shows the full
// in-language name so the picker is self-describing in every script.
function LangPicker({ lang, onChange }) {
  return (
    <div style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute',
        left: 7, top: '50%', transform: 'translateY(-50%)',
        fontSize: 11, pointerEvents: 'none',
        color: 'var(--text-muted)',
      }} aria-hidden>🌐</span>
      <select
        value={lang}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Change lesson language"
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '4px 20px 4px 26px',
          fontSize: 11, fontWeight: 700,
          color: 'var(--text-primary)',
          cursor: 'pointer', outline: 'none',
          letterSpacing: '0.04em',
        }}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {LANG_SHORT[l.code]} · {l.label}
          </option>
        ))}
      </select>
      <span style={{
        position: 'absolute',
        right: 6, top: '50%', transform: 'translateY(-50%)',
        fontSize: 9, pointerEvents: 'none',
        color: 'var(--text-muted)',
      }} aria-hidden>▾</span>
    </div>
  )
}

// Extract arrow-point lines as highlighted key points
function KeyPoints({ content, lang }) {
  const lines = (content || '').split('\n')
  const points = lines.filter((l) => l.trim().startsWith('→'))

  if (!points.length) return null

  return (
    <div
      style={{
        background: 'rgba(0,200,5,0.06)',
        border: '1px solid rgba(0,200,5,0.2)',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#00C805',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 10,
        }}
      >
        {lang === 'en' && 'Key points'}
        {lang === 'hi' && 'मुख्य बिंदु'}
        {lang === 'ml' && 'പ്രധാന കാര്യങ്ങൾ'}
        {lang === 'ta' && 'முக்கிய புள்ளிகள்'}
      </div>
      {points.map((p, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: i < points.length - 1 ? 8 : 0,
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              color: '#00C805',
              fontWeight: 700,
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            →
          </span>
          {p.trim().replace('→', '').trim()}
        </div>
      ))}
    </div>
  )
}
