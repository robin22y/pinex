import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Welcome screen shown after a user accepts an
// invite. The CTA hierarchy steers new users
// toward the 8-minute academy first — that's
// what actually unlocks the screener — while
// still allowing power users to skip ahead.
//
// LANGUAGE: en / hi / ml / ta. Selection is
// persisted to localStorage('pinex_lang') and
// shared across the rest of the app (Academy
// reader, lesson content, etc.).

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हि' },
  { code: 'ml', label: 'മ' },
  { code: 'ta', label: 'த' },
]

const T = {
  en: {
    title: 'Welcome to PineX',
    access_ready:
      'Your access is ready. PineX shows Weinstein Stage Analysis for 2,100+ NSE stocks.',
    academy_cta:
      'Complete the 8-minute academy to unlock the full screener',
    what_next: 'What to do next',
    steps: [
      {
        title: 'Start PineX Academy first',
        desc: 'Takes 8 minutes. Read the lessons to unlock the full screener and SwingX.',
        actionLabel: 'Start learning →',
      },
      {
        title: 'Search any NSE stock',
        desc: 'See its Weinstein stage, moving average position, and technical structure.',
      },
      {
        title: 'Check SwingX',
        desc: 'Stocks where all Stage 2 criteria align — unlocked after the academy.',
      },
      {
        title: 'Add stocks to your watchlist',
        desc: 'Track stage changes and price movement from your dashboard.',
      },
    ],
    start_academy: '🎓 Start PineX Academy →',
    explore_first: 'Explore first, learn later',
    disclaimer: 'Educational data only. Not investment advice.',
  },

  hi: {
    title: 'PineX में आपका स्वागत है',
    access_ready:
      'आपकी एक्सेस तैयार है। PineX 2,100+ NSE शेयरों के लिए Weinstein Stage Analysis दिखाता है।',
    academy_cta:
      'पूरा Screener unlock करने के लिए 8 मिनट की Academy पूरी करें',
    what_next: 'आगे क्या करें',
    steps: [
      {
        title: 'पहले PineX Academy शुरू करें',
        desc: 'सिर्फ 8 मिनट। Lessons पढ़ें और पूरा Screener और SwingX unlock करें।',
        actionLabel: 'सीखना शुरू करें →',
      },
      {
        title: 'कोई भी NSE शेयर खोजें',
        desc: 'उसका Weinstein Stage, Moving Average की स्थिति और Technical Structure देखें।',
      },
      {
        title: 'SwingX देखें',
        desc: 'वो शेयर जहाँ सभी Stage 2 शर्तें एक साथ पूरी होती हैं — Academy के बाद unlock होगा।',
      },
      {
        title: 'Watchlist में शेयर जोड़ें',
        desc: 'अपने Dashboard से Stage बदलाव और कीमत पर नज़र रखें।',
      },
    ],
    start_academy: '🎓 PineX Academy शुरू करें →',
    explore_first: 'पहले explore करें, बाद में सीखें',
    disclaimer: 'केवल शैक्षणिक उद्देश्यों के लिए। निवेश की सलाह नहीं।',
  },

  ml: {
    title: 'PineX-ലേക്ക് സ്വാഗതം',
    access_ready:
      'നിങ്ങളുടെ ആക്‌സസ് തയ്യാറാണ്. PineX 2,100-ലധികം NSE ഓഹരികൾക്കായി Weinstein Stage Analysis കാണിക്കുന്നു.',
    academy_cta:
      'പൂർണ്ണ Screener unlock ചെയ്യാൻ 8 മിനിറ്റ് Academy പൂർത്തിയാക്കുക',
    what_next: 'അടുത്തതായി എന്ത് ചെയ്യണം',
    steps: [
      {
        title: 'ആദ്യം PineX Academy തുടങ്ങുക',
        desc: '8 മിനിറ്റ് മതി. Lessons വായിച്ച് Screener ഉം SwingX ഉം unlock ചെയ്യൂ.',
        actionLabel: 'പഠനം തുടങ്ങുക →',
      },
      {
        title: 'ഏത് NSE ഓഹരിയും തിരയൂ',
        desc: 'Weinstein Stage, Moving Average സ്ഥാനം, Technical Structure എന്നിവ കാണൂ.',
      },
      {
        title: 'SwingX പരിശോധിക്കൂ',
        desc: 'Stage 2 മാനദണ്ഡങ്ങൾ എല്ലാം ഒത്തുചേരുന്ന ഓഹരികൾ — Academy ശേഷം unlock ആകും.',
      },
      {
        title: 'Watchlist-ൽ ഓഹരികൾ ചേർക്കൂ',
        desc: 'Dashboard-ൽ നിന്ന് Stage മാറ്റങ്ങളും വില നീക്കങ്ങളും നിരീക്ഷിക്കൂ.',
      },
    ],
    start_academy: '🎓 PineX Academy തുടങ്ങുക →',
    explore_first: 'ആദ്യം explore ചെയ്യൂ, പിന്നെ പഠിക്കാം',
    disclaimer: 'വിദ്യാഭ്യാസ ആവശ്യങ്ങൾക്ക് മാത്രം. നിക്ഷേപ ഉപദേശമല്ല.',
  },

  ta: {
    title: 'PineX-க்கு வரவேற்கிறோம்',
    access_ready:
      'உங்கள் அணுகல் தயாராக உள்ளது. PineX 2,100-க்கும் மேற்பட்ட NSE பங்குகளுக்கான Weinstein Stage Analysis காட்டுகிறது.',
    academy_cta:
      'முழு Screener-ஐ திறக்க 8 நிமிட Academy-ஐ முடிக்கவும்',
    what_next: 'அடுத்து என்ன செய்வது',
    steps: [
      {
        title: 'முதலில் PineX Academy தொடங்கவும்',
        desc: '8 நிமிடங்கள் மட்டுமே. Lessons படித்து Screener மற்றும் SwingX திறக்கவும்.',
        actionLabel: 'கற்கத் தொடங்கவும் →',
      },
      {
        title: 'எந்த NSE பங்கையும் தேடவும்',
        desc: 'Weinstein Stage, Moving Average நிலை மற்றும் Technical Structure பார்க்கவும்.',
      },
      {
        title: 'SwingX பார்க்கவும்',
        desc: 'அனைத்து Stage 2 நிபந்தனைகளும் ஒத்திசைந்த பங்குகள் — Academy பிறகு திறக்கும்.',
      },
      {
        title: 'Watchlist-ல் பங்குகள் சேர்க்கவும்',
        desc: 'Dashboard-ல் Stage மாற்றங்கள் மற்றும் விலை நகர்வுகளை கண்காணிக்கவும்.',
      },
    ],
    start_academy: '🎓 PineX Academy தொடங்கவும் →',
    explore_first: 'முதலில் explore செய்யுங்கள், பிறகு கற்கலாம்',
    disclaimer: 'கல்வி நோக்கங்களுக்கு மட்டுமே. முதலீட்டு ஆலோசனை அல்ல.',
  },
}

export default function Welcome() {
  const navigate = useNavigate()
  const [lang, setLang] = useState(
    () => localStorage.getItem('pinex_lang') || 'en',
  )

  const setLanguage = (l) => {
    setLang(l)
    try {
      localStorage.setItem('pinex_lang', l)
    } catch {
      // ignore — privacy mode / quota
    }
  }

  const t = T[lang] || T.en

  // WHY: step DISPLAY config (highlight, action,
  // color) stays inline because it depends on
  // navigation/route logic. TEXT content comes
  // from `t.steps[i]` so swapping language only
  // changes copy, not layout.
  const STEP_DISPLAY = [
    {
      highlight: true,
      action: () => navigate('/learn'),
    },
    { highlight: false },
    { highlight: false },
    { highlight: false },
  ]

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 400,
          width: '100%',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
        }}
      >
        {/* Language picker — top-right pill row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 16,
          }}
        >
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
                style={{
                  padding: '4px 10px',
                  borderRadius: 16,
                  border: 'none',
                  background:
                    lang === l.code ? 'var(--accent)' : 'transparent',
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

        <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>

        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}
        >
          {t.title}
        </div>

        <div
          style={{
            fontSize: 14,
            color: 'var(--text-muted)',
            lineHeight: 1.7,
            marginBottom: 8,
          }}
        >
          {t.access_ready}
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(0,200,5,0.08)',
            border: '1px solid rgba(0,200,5,0.2)',
            fontSize: 13,
            color: 'var(--accent)',
            fontWeight: 600,
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>🎓</span>
          {t.academy_cta}
        </div>

        <div
          style={{
            textAlign: 'left',
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 24,
          }}
        >
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
            {t.what_next}
          </div>

          {STEP_DISPLAY.map((step, i) => {
            const content = t.steps[i] || {}
            const num = String(i + 1)
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 12,
                  marginBottom: i < STEP_DISPLAY.length - 1 ? 14 : 0,
                  padding: step.highlight ? '12px 14px' : '0',
                  borderRadius: step.highlight ? 10 : 0,
                  background: step.highlight
                    ? 'rgba(0,200,5,0.08)'
                    : 'transparent',
                  border: step.highlight
                    ? '1px solid rgba(0,200,5,0.2)'
                    : 'none',
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: step.highlight
                      ? 'var(--accent)'
                      : 'var(--bg-elevated)',
                    border: step.highlight
                      ? 'none'
                      : '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 800,
                    color: step.highlight ? '#000' : 'var(--text-muted)',
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {num}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: step.highlight ? 700 : 600,
                      color: step.highlight
                        ? 'var(--accent)'
                        : 'var(--text-primary)',
                      marginBottom: 2,
                    }}
                  >
                    {content.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      lineHeight: 1.5,
                    }}
                  >
                    {content.desc}
                  </div>
                  {content.actionLabel && step.action && (
                    <button
                      onClick={step.action}
                      style={{
                        marginTop: 8,
                        padding: '6px 14px',
                        borderRadius: 6,
                        border: 'none',
                        background: 'var(--accent)',
                        color: '#000',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {content.actionLabel}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Primary CTA — sends them to the academy. */}
        <button
          onClick={() => navigate('/learn')}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent)',
            color: '#000',
            fontSize: 15,
            fontWeight: 800,
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          {t.start_academy}
        </button>

        {/* Secondary — old "Go to PineX" behaviour. */}
        <button
          onClick={() => navigate('/')}
          style={{
            width: '100%',
            padding: '11px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {t.explore_first}
        </button>

        <div
          style={{
            marginTop: 12,
            fontSize: 10,
            color: 'var(--text-disabled)',
          }}
        >
          {t.disclaimer}
        </div>
      </div>
    </div>
  )
}
