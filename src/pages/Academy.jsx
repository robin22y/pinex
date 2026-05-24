import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAcademy } from '../hooks/useAcademy'
import { useAuth } from '../context'

const LANGS = [
  { code: 'en', label: 'EN', full: 'English' },
  { code: 'hi', label: 'हि', full: 'हिंदी' },
  { code: 'ml', label: 'മ', full: 'മലയാളം' },
  { code: 'ta', label: 'த', full: 'தமிழ்' },
]

export default function Academy() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { modules, progress, hasScreenerAccess, loading } = useAcademy()

  const [lang, setLang] = useState(
    localStorage.getItem('pinex_lang') || 'en'
  )

  const setLanguage = (l) => {
    setLang(l)
    localStorage.setItem('pinex_lang', l)
  }

  // Upcoming modules — hardcoded preview list
  const upcoming = [
    {
      title: 'The 30-Week Moving Average',
      title_hi: '30-सप्ताह मूविंग एवरेज',
      title_ml: '30-ആഴ്ച മൂവിംഗ് ആവറേജ്',
      title_ta: '30-வார நகரும் சராசரி',
      icon: '📈',
      color: '#60A5FA',
    },
    {
      title: 'Volume & Delivery',
      title_hi: 'वॉल्यूम और डिलीवरी',
      title_ml: 'ട്രേഡിംഗ് അളവും ഡെലിവറിയും',
      title_ta: 'வர்த்தக அளவு மற்றும் டெலிவரி',
      icon: '📦',
      color: '#A78BFA',
    },
    {
      title: 'Relative Strength',
      title_hi: 'सापेक्ष शक्ति',
      title_ml: 'ആപേക്ഷിക ശക്തി',
      title_ta: 'ஒப்பீட்டு வலிமை',
      icon: '💪',
      color: '#F59E0B',
    },
    {
      title: 'Sector & Market Strength',
      title_hi: 'सेक्टर और बाजार की मजबूती',
      title_ml: 'സെക്ടറും വിപണി ശക്തിയും',
      title_ta: 'துறை மற்றும் சந்தை வலிமை',
      icon: '🏗️',
      color: '#10B981',
    },
    {
      title: 'Reading SwingX',
      title_hi: 'SwingX पढ़ना',
      title_ml: 'SwingX വായിക്കുക',
      title_ta: 'SwingX படிக்கவும்',
      icon: '⚡',
      color: '#00C805',
    },
    {
      title: 'Building a Watchlist',
      title_hi: 'वॉचलिस्ट बनाना',
      title_ml: 'വാച്ച്‌ലിസ്റ്റ് നിർമ്മിക്കുക',
      title_ta: 'கண்காணிப்புப் பட்டியல்',
      icon: '📋',
      color: '#EC4899',
    },
  ]

  const getTitle = (mod) => {
    if (!mod) return ''
    return mod[`title_${lang}`] || mod.title_en || mod.title || ''
  }

  const getUpcomingTitle = (mod) => {
    return mod[`title_${lang}`] || mod.title
  }

  const completedCount = modules.filter((m) => progress[m.id]?.passed).length
  const totalModules = modules.length + upcoming.length

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        paddingBottom: 80,
      }}
    >
      {/* Hero header — theme-aware so it matches sepia/dark/light */}
      <div
        style={{
          background:
            'linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-primary) 100%)',
          borderBottom: '1px solid var(--border)',
          padding: '24px 16px 20px',
        }}
      >
        {/* Back + Lang */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 13,
              padding: 0,
            }}
          >
            <i className="ti ti-arrow-left" style={{ fontSize: 16 }} />
          </button>

          {/* Language toggle */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-elevated)',
              borderRadius: 20,
              padding: 2,
              gap: 2,
            }}
          >
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                title={l.full}
                style={{
                  padding: '4px 10px',
                  borderRadius: 16,
                  border: 'none',
                  background: lang === l.code ? 'var(--accent)' : 'transparent',
                  color: lang === l.code ? '#000' : 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'rgba(0,200,5,0.15)',
              border: '1px solid rgba(0,200,5,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
            }}
          >
            🎓
          </div>
          <div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
              }}
            >
              PineX Academy
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {lang === 'en' && 'Learn the Weinstein method'}
              {lang === 'hi' && 'वेनस्टीन पद्धति सीखें'}
              {lang === 'ml' && 'വെൻസ്റ്റൈൻ രീതി പഠിക്കുക'}
              {lang === 'ta' && 'Weinstein முறையை கற்கவும்'}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {modules.length > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              <span>
                {completedCount} of {totalModules} modules
              </span>
              <span style={{ color: completedCount > 0 ? 'var(--positive)' : 'var(--text-muted)' }}>
                {Math.round((completedCount / totalModules) * 100)}%
              </span>
            </div>
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
                  width: `${(completedCount / totalModules) * 100}%`,
                  background: '#00C805',
                  borderRadius: 3,
                  transition: 'width 0.5s',
                }}
              />
            </div>
          </div>
        )}

        {/* Access status */}
        {user && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 14px',
              borderRadius: 10,
              background: hasScreenerAccess
                ? 'rgba(0,200,5,0.1)'
                : 'rgba(251,191,36,0.1)',
              border: `1px solid ${
                hasScreenerAccess
                  ? 'rgba(0,200,5,0.25)'
                  : 'rgba(251,191,36,0.25)'
              }`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: hasScreenerAccess ? '#00C805' : '#FBBF24',
            }}
          >
            <span style={{ fontSize: 14 }}>
              {hasScreenerAccess ? '🔓' : '🔒'}
            </span>
            <div>
              {hasScreenerAccess
                ? profile?.academy_grandfathered
                  ? lang === 'en'
                    ? 'Full access. Complete modules to deepen your knowledge.'
                    : lang === 'hi'
                    ? 'पूरी पहुंच। ज्ञान गहरा करने के लिए modules पूरे करें।'
                    : lang === 'ml'
                    ? 'പൂർണ്ണ ആക്‌സസ്. അറിവ് ആഴത്തിലാക്കാൻ modules പൂർത്തിയാക്കുക.'
                    : 'முழு அணுகல். அறிவை ஆழப்படுத்த modules முடிக்கவும்.'
                  : lang === 'en'
                  ? 'Screener unlocked! You completed the academy.'
                  : lang === 'hi'
                  ? 'Screener unlock हो गया! आपने academy पूरी की।'
                  : lang === 'ml'
                  ? 'Screener unlock ആയി! നിങ്ങൾ academy പൂർത്തിയാക്കി.'
                  : 'Screener திறக்கப்பட்டது! Academy முடித்தீர்கள்.'
                : lang === 'en'
                ? 'Pass Module 1 to unlock the screener'
                : lang === 'hi'
                ? 'Screener unlock करने के लिए Module 1 पास करें'
                : lang === 'ml'
                ? 'Screener unlock ചെയ്യാൻ Module 1 പാസ് ആകുക'
                : 'Screener திறக்க Module 1 தேர்ச்சி பெறவும்'}
            </div>
          </div>
        )}
      </div>

      {/* Modules */}
      <div style={{ padding: '16px' }}>
        {loading ? (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              color: 'var(--text-muted)',
            }}
          >
            Loading...
          </div>
        ) : modules.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 16px',
              color: 'var(--text-muted)',
              background: 'var(--bg-surface)',
              border: '1px dashed var(--border)',
              borderRadius: 12,
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {lang === 'en' && 'Modules are being prepared. Check back soon.'}
            {lang === 'hi' && 'Modules जल्द ही उपलब्ध होंगे।'}
            {lang === 'ml' && 'Modules ഉടൻ ലഭ്യമാകും.'}
            {lang === 'ta' && 'Modules விரைவில் வரும்.'}
          </div>
        ) : (
          modules.map((mod) => {
            const passed = progress[mod.id]?.passed
            const score = progress[mod.id]?.best_score
            const attempts = progress[mod.id]?.attempts || 0
            const title = getTitle(mod)

            return (
              <div
                key={mod.id}
                onClick={() => navigate(`/learn/${mod.id}?lang=${lang}`)}
                style={{
                  background: passed
                    ? 'linear-gradient(135deg, rgba(0,200,5,0.08) 0%, var(--bg-surface) 100%)'
                    : 'var(--bg-surface)',
                  border: passed
                    ? '1px solid rgba(0,200,5,0.3)'
                    : '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '16px',
                  marginBottom: 12,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Decorative circle */}
                <div
                  style={{
                    position: 'absolute',
                    right: -20,
                    top: -20,
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: passed
                      ? 'rgba(0,200,5,0.06)'
                      : 'rgba(255,255,255,0.02)',
                    pointerEvents: 'none',
                  }}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {/* Icon */}
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 14,
                      background: passed
                        ? 'rgba(0,200,5,0.15)'
                        : 'var(--bg-elevated)',
                      border: passed
                        ? '1px solid rgba(0,200,5,0.3)'
                        : '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: passed ? 22 : 24,
                      flexShrink: 0,
                    }}
                  >
                    {passed ? '✅' : mod.icon}
                  </div>

                  {/* Text */}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {title}
                      </span>
                      {passed && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: 'rgba(0,200,5,0.15)',
                            color: '#00C805',
                            fontWeight: 700,
                            border: '1px solid rgba(0,200,5,0.3)',
                          }}
                        >
                          {score}/{mod.total_questions} ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        display: 'flex',
                        gap: 10,
                      }}
                    >
                      {mod.duration && <span>⏱ {mod.duration}</span>}
                      {attempts > 0 && !passed && (
                        <span style={{ color: '#FBBF24' }}>
                          {attempts} attempt{attempts > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <i
                    className="ti ti-chevron-right"
                    style={{
                      fontSize: 18,
                      color: 'var(--text-hint)',
                      flexShrink: 0,
                    }}
                  />
                </div>

                {/* Progress indicator */}
                {!passed && attempts > 0 && mod.total_questions ? (
                  <div
                    style={{
                      marginTop: 10,
                      height: 3,
                      background: 'var(--border)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${
                          ((progress[mod.id]?.last_score || 0) /
                            mod.total_questions) *
                          100
                        }%`,
                        background: '#FBBF24',
                        borderRadius: 2,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )
          })
        )}

        {/* Coming soon section */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: '20px 0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span>
            {lang === 'en' && 'Coming soon'}
            {lang === 'hi' && 'जल्द आ रहा है'}
            {lang === 'ml' && 'ഉടൻ വരുന്നു'}
            {lang === 'ta' && 'விரைவில் வருகிறது'}
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {upcoming.map((mod, i) => (
          <div
            key={i}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '14px 16px',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              opacity: 0.45,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: mod.color + '15',
                border: `1px solid ${mod.color}25`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              {mod.icon}
            </div>
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                }}
              >
                {getUpcomingTitle(mod)}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-hint)',
                  marginTop: 2,
                }}
              >
                {lang === 'en' && 'Coming soon'}
                {lang === 'hi' && 'जल्द आ रहा है'}
                {lang === 'ml' && 'ഉടൻ വരുന്നു'}
                {lang === 'ta' && 'விரைவில் வருகிறது'}
              </div>
            </div>
          </div>
        ))}

        {/* Certificate preview */}
        {hasScreenerAccess && progress['stage_basics']?.passed && (
          <div
            onClick={() => navigate('/certificate')}
            style={{
              marginTop: 20,
              background:
                'linear-gradient(135deg, rgba(0,200,5,0.12) 0%, rgba(96,165,250,0.08) 100%)',
              border: '1px solid rgba(0,200,5,0.3)',
              borderRadius: 14,
              padding: '18px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 4,
              }}
            >
              {lang === 'en' && 'View your certificate'}
              {lang === 'hi' && 'अपना certificate देखें'}
              {lang === 'ml' && 'നിങ്ങളുടെ certificate കാണുക'}
              {lang === 'ta' && 'உங்கள் certificate பார்க்கவும்'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {lang === 'en' && 'Share your achievement'}
              {lang === 'hi' && 'अपनी उपलब्धि share करें'}
              {lang === 'ml' && 'നിങ്ങളുടെ നേട്ടം share ചെയ്യുക'}
              {lang === 'ta' && 'உங்கள் சாதனையை share செய்யுங்கள்'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
