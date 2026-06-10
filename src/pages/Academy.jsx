import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAcademy } from '../hooks/useAcademy'
import { useAuth } from '../context'

import Icon from '../components/ui/Icon'
const LANGS = [
  { code: 'en', label: 'EN', full: 'English' },
  { code: 'hi', label: 'हि', full: 'हिंदी' },
  { code: 'ml', label: 'മ', full: 'മലയാളം' },
  { code: 'ta', label: 'த', full: 'தமிழ்' },
]

// WHY: Each module that unlocks a feature gets
// a callout badge on its card so the user sees
// the reward, not just the time cost. Keep keys
// in sync with REQUIRED_BY_LEVEL in useAcademy.
const UNLOCK_BADGES = {
  core_foundation: null, // first module, no badge
  volume_rules: {
    label: '🔓 Unlocks Screener',
    color: 'var(--accent)',
    bg: 'var(--accent-dim)',
    border: 'var(--accent-border)',
  },
  stage2_advancing: null,
  relative_strength_selection: {
    label: '⚡ Unlocks SwingX',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.1)',
    border: 'rgba(251,191,36,0.3)',
  },
  shortterm_50day: {
    label: '🏆 Completes Academy',
    color: 'var(--info)',
    bg: 'var(--info-dim)',
    border: 'var(--info-dim)',
  },
}

// ── Module 9 — BYOK Gemini explainer ────────────────────────────────
// Display-only module rendered INLINE in the modules list — no quiz,
// no navigation to /learn/<id>. Detected by mod.id ===
// BYOK_MODULE_KEY and rendered as an expanded rich card instead of
// the standard tile. Body + comparison + safety copy live here as
// constants because the live academy_modules table doesn't have a
// content jsonb column, and useAcademy.js doesn't fetch lesson rows
// for the index view — adding either of those would have meant
// touching files outside the spec'd scope.
//
// Sample comparison responses (`withoutSample` / `withSample`) are
// kept in English across every language because the COMPARISON itself
// is the lesson — what a Gemini answer looks like with vs without
// PineX context. The localised wrappers around it (header labels,
// body prose, safety callout) carry the language.
const BYOK_MODULE_KEY = 'byok_gemini_explainer'

const BYOK_CONTENT = {
  en: {
    body:
`Gemini is smart. But it doesn't know what happened to your stock today.

When you ask a stock question to the regular Gemini app without connecting PineX, it gives you a textbook answer — general information about the company. It cannot tell you today's market situation, this week's delivery spike, or whether the stock is currently in Stage 2.

But when you connect your API key to PineX, Gemini gets live data from PineX — today's stage, RSI value, delivery percentage, volume changes. Gemini then explains these hard numbers to you in plain language. Same intelligence, but a completely different and useful answer.

The most important thing: your API key is stored only on your phone or device. PineX cannot see it. And Google's free tier comfortably handles your daily research without spending a single rupee.`,
    withoutLabel: 'Without API Key',
    withLabel:    'With API Key on PineX',
    safety:
      'Your API key stays only on your device. PineX never sees it.',
  },
  ml: {
    body:
`Gemini മിടുക്കനാണ്. പക്ഷേ, ഇന്ന് നിങ്ങളുടെ സ്റ്റോക്കിന് എന്ത് സംഭവിച്ചു എന്ന് അതിനറിയില്ല.

നിങ്ങൾ ഒരു സ്റ്റോക്കിനെക്കുറിച്ച് പൊതുവായ Gemini ആപ്പിനോട് ചോദിച്ചാൽ, അത് നിങ്ങൾക്ക് ഒരു ടെക്സ്റ്റ് ബുക്ക് മറുപടിയാവും നൽകുക—ആ കമ്പനിയെക്കുറിച്ചുള്ള പൊതുവായ വിവരങ്ങൾ മാത്രം. എന്നാൽ ഇന്നത്തെ വിപണിയിലെ കാര്യങ്ങളോ, ഈ ആഴ്ചയിലെ ഡെലിവറി സ്പൈക്കോ (Delivery Spike), അല്ലെങ്കിൽ ആ സ്റ്റോക്ക് ഇപ്പോൾ സ്റ്റേജ് 2-ൽ (Stage 2) ആണോ എന്നോ അതിന് കൃത്യമായി പറയാൻ കഴിയില്ല.

എന്നാൽ നിങ്ങളുടെ API കീ PineX-ലേക്ക് കണക്ട് ചെയ്യുമ്പോൾ, Gemini-ക്ക് PineX-ൽ നിന്നുള്ള ലൈവ് ഡാറ്റ ലഭ്യമാകുന്നു—അതായത് ഇന്നത്തെ സ്റ്റേജ്, ആർ.എസ്.ഐ വാല്യൂ (RSI Value), ഡെലിവറി ശതമാനം, വോളിയം വ്യത്യാസങ്ങൾ എന്നിവ. ഈ കഠിനമായ അക്കങ്ങളെ ലളിതമായ മലയാളത്തിൽ Gemini നിങ്ങൾക്ക് വിവരിച്ചു തരുന്നു. ഒരേ ബുദ്ധിശക്തി, പക്ഷേ തികച്ചും വ്യത്യസ്തവും ഉപയോഗപ്രദവുമായ മറുപടി!

ഏറ്റവും സുരക്ഷിതമായ കാര്യം: നിങ്ങളുടെ API കീ നിങ്ങളുടെ ഫോണിൽ/ഡിവൈസിൽ മാത്രമേ സൂക്ഷിക്കപ്പെടുകയുള്ളൂ. PineX-ന് അത് കാണാൻ കഴിയില്ല. കൂടാതെ, ഗൂഗിളിന്റെ സൗജന്യ ടയർ (Free Tier) വഴി നിങ്ങളുടെ ദിവസേനയുള്ള റിസേർച്ച് ഒരു രൂപ പോലും ചെലവില്ലാതെ സുഖമായി നടത്താം.`,
    withoutLabel: 'API Key ഇല്ലാതെ',
    withLabel:    'PineX-ൽ API Key ചേർത്തു',
    safety:
      'നിങ്ങളുടെ API Key നിങ്ങളുടെ ഡിവൈസിൽ മാത്രമേ സൂക്ഷിക്കുകയുള്ളൂ. PineX അത് ഒരിക്കലും കാണില്ല.',
  },
  hi: {
    body:
`Gemini बहुत समझदार है, लेकिन आज आपके स्टॉक में क्या हलचल हुई, उसे नहीं पता।

जब आप PineX को कनेक्ट किए बिना सीधे Gemini ऐप से किसी स्टॉक के बारे में पूछते हैं, तो वह आपको केवल किताबी ज्ञान देता है—कंपनी के बारे में सामान्य बातें जो पुरानी हो सकती हैं। उसे आज के मार्केट का हाल, इस हफ्ते के डिलीवरी स्पाइक (Delivery Spike), या स्टॉक अभी स्टेज 2 (Stage 2) में है या नहीं, इसकी कोई लाइव जानकारी नहीं होती।

लेकिन जैसे ही आप अपनी API Key को PineX से जोड़ते हैं, Gemini को सीधे हमारी लाइव मार्केट डेटा की फीड मिलती है—जैसे आज का स्टेज, RSI वैल्यू, डिलीवरी प्रतिशत और वॉल्यूम का व्यवहार। फिर Gemini उसी डेटा को बिल्कुल आसान भाषा में समझाता है। दिमाग वही है, लेकिन जवाब पूरी तरह बदल जाता है।

सबसे अच्छी बात? आपकी API Key पूरी तरह से सुरक्षित है और केवल आपके डिवाइस पर रहती है, PineX इसे कभी नहीं देख सकता। और Google का फ्री टियर (Free Tier) आपके रोज़ाना के रिसर्च को बिना किसी खर्च के आराम से संभाल लेता है।`,
    withoutLabel: 'API Key के बिना',
    withLabel:    'PineX पर API Key के साथ',
    safety:
      'आपकी API Key केवल आपके डिवाइस पर रहती है। PineX इसे कभी नहीं देखता।',
  },
  ta: {
    body:
`Gemini மிகவும் புத்திசாலிதான், ஆனால் இன்று உங்கள் பங்கிற்கு (Stock) என்ன நடந்தது என்பது அதற்குத் தெரியாது.

PineX உடன் இணைக்காமல் பொதுவான Gemini செயலியில் ஒரு பங்கைப்பற்றி நீங்கள் கேட்டால், அது உங்களுக்குப் புத்தகத்தில் உள்ள பொதுவான பதில்களை மட்டுமே தரும்—அந்த நிறுவனத்தைப் பற்றிய பொதுவான தகவல்கள் மட்டுமே இருக்கும். ஆனால் இன்றைய சந்தை நிலவரம், இந்த வார டெலிவரி ஸ்பைக் (Delivery Spike), அல்லது அந்தப் பங்கு இப்போது ஸ்டேஜ் 2-ல் (Stage 2) உள்ளதா என்பது அதற்குத் தெரியாது.

ஆனால் உங்கள் API கீயை PineX உடன் இணைக்கும்போது, Gemini-க்கு PineX-ன் நேரடித் தரவுகள் (Live Data) கிடைக்கின்றன—அதாவது இன்றைய ஸ்டேஜ், RSI மதிப்பு, டெலிவரி சதவீதம் மற்றும் வால்யூம் மாற்றம். இந்த எண்களை எளிமையான மொழியில் Gemini உங்களுக்குப் புரிய வைக்கிறது. அதே புத்திசாலி AI தான், ஆனால் முற்றிலும் மாறுபட்ட துல்லியமான பதில்!

மிக முக்கியமான விஷயம்: உங்கள் API கீ உங்கள் சாதனத்தில் (Device) மட்டுமே பாதுகாப்பாக இருக்கும், PineX அதை எப்போதும் பார்க்க முடியாது. மேலும், கூகுளின் இலவச சேவை (Free Tier) மூலமாகவே உங்கள் தினசரி ஆராய்ச்சியை எந்தக் கட்டணமும் இன்றி நீங்கள் தாராளமாகச் செய்து முடிக்கலாம்.`,
    withoutLabel: 'API Key இல்லாமல்',
    withLabel:    'PineX-ல் API Key உடன்',
    safety:
      'உங்கள் API Key உங்கள் சாதனத்தில் மட்டுமே இருக்கும். PineX அதை எப்போதும் பார்க்காது.',
  },
}

// Illustrative comparison samples — intentionally kept in English in
// every language. The comparison itself IS the lesson (what a Gemini
// answer looks like with vs without PineX context); the localised
// wrappers around it carry the language.
const BYOK_WITHOUT_SAMPLE =
  "Reliance Industries is a major Indian conglomerate with operations in oil & petrochemicals, telecom (Jio), and retail. Founded in 1966 by Dhirubhai Ambani. As one of India's largest companies by market capitalisation, it is part of the Nifty 50 index. Worth researching its diversified business segments before investing."
const BYOK_WITH_SAMPLE =
  "RELIANCE is currently in Stage 2 — close ₹2,912, above a rising 30-week MA (47 days in phase). RSI is 58 (healthy band). Delivery percentage spiked to 62% on 9-Jun, well above the 30-day average of 48% — that's accumulation showing up in the cash market. Sector breadth is 64% Stage 2. The technical picture aligns with the broad energy sector strength this week."

// ── BYOK module renderer (inline) ───────────────────────────────────
// Rendered in place of the standard navigable tile for the
// byok_gemini_explainer module. Display-only: no onClick navigation,
// no quiz block. Body splits on blank-line paragraph breaks.
function ByokModuleCard({ mod, lang, title }) {
  const localised = BYOK_CONTENT[lang] || BYOK_CONTENT.en
  const paragraphs = String(localised.body || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 20,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Header — module number badge + title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--accent)',
            flexShrink: 0,
          }}
          aria-label={`Module ${mod.sort_order || 9}`}
        >
          {mod.sort_order || 9}
        </div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>
      </div>

      {/* Body — paragraphs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {paragraphs.map((p, i) => (
          <p
            key={i}
            lang={lang}
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--text-secondary)',
            }}
          >
            {p}
          </p>
        ))}
      </div>

      {/* Comparison — two side-by-side cards (red without / green with) */}
      <div
        style={{
          marginTop: 18,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
        }}
      >
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.30)',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#F87171',
              marginBottom: 8,
            }}
          >
            ❌ {localised.withoutLabel}
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.65,
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
            }}
          >
            {BYOK_WITHOUT_SAMPLE}
          </div>
        </div>
        <div
          style={{
            background: 'rgba(0, 200, 5, 0.06)',
            border: '1px solid rgba(0, 200, 5, 0.30)',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#00C805',
              marginBottom: 8,
            }}
          >
            ✅ {localised.withLabel}
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.65,
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
            }}
          >
            {BYOK_WITH_SAMPLE}
          </div>
        </div>
      </div>

      {/* Safety callout — green left accent */}
      <div
        style={{
          marginTop: 16,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid #00C805',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}
        >
          🔒
        </span>
        <span
          lang={lang}
          style={{
            fontSize: 13,
            color: 'var(--text-primary)',
            lineHeight: 1.5,
          }}
        >
          {localised.safety}
        </span>
      </div>
    </div>
  )
}

export default function Academy() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const {
    modules,
    progress,
    hasScreenerAccess,
    hasSwingXAccess,
    loading,
  } = useAcademy()

  const [lang, setLang] = useState(
    localStorage.getItem('pinex_lang') || 'en'
  )

  const setLanguage = (l) => {
    setLang(l)
    localStorage.setItem('pinex_lang', l)
  }

  const getTitle = (mod) => {
    if (!mod) return ''
    return mod[`title_${lang}`] || mod.title_en || mod.title || ''
  }

  const completedCount = modules.filter((m) => progress[m.id]?.passed).length
  // WHY: Previously this added an `upcoming.length`
  // for phantom "Coming soon" cards that have
  // since been published. That made the progress
  // bar denominator larger than the real module
  // count. Use the live module list only.
  const totalModules = modules.length

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
            <Icon name="arrow-left" style={{ fontSize: 16 }} />
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
              {lang === 'en' && 'Learn the PineX method'}
              {lang === 'hi' && 'PineX पद्धति सीखें'}
              {lang === 'ml' && 'PineX രീതി പഠിക്കുക'}
              {lang === 'ta' && 'PineX முறையை கற்கவும்'}
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

        {/* Three-level access progress — compact horizontal pill row
            instead of three stacked full-width rows. Cleaner at a
            glance: each tier's unlock state is visible without the
            user having to scan three lines of text. */}
        {user && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { label: 'Screener',    has: hasScreenerAccess, hint: 'Modules 1-2', icon: '📊' },
              { label: 'SwingX',      has: hasSwingXAccess,   hint: 'Modules 1-4', icon: '⚡' },
              { label: 'Certificate', has: (profile?.academy_score || 0) > 0, hint: 'Final exam', icon: '🏆' },
            ].map((item, i) => (
              <div
                key={i}
                title={item.has ? `${item.label} unlocked` : `Locked — ${item.hint}`}
                style={{
                  flex: '1 1 100px',
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 10px', borderRadius: 10,
                  background: item.has ? 'rgba(0,200,5,0.08)' : 'var(--bg-elevated)',
                  border: `1px solid ${item.has ? 'rgba(0,200,5,0.25)' : 'var(--border)'}`,
                }}
              >
                <span style={{ fontSize: 14, flexShrink: 0 }}>
                  {item.has ? '✅' : '🔒'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: item.has ? '#00C805' : 'var(--text-primary)', lineHeight: 1.2 }}>
                    {item.icon} {item.label}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-hint)', lineHeight: 1.3, marginTop: 1 }}>
                    {item.has ? 'Unlocked' : item.hint}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modules — wrapped in a max-width container so the page
          looks centered on wide desktops instead of stretched
          edge-to-edge. Mobile is unaffected (padding only). */}
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '16px' }}>
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
        <>
        {/* ── Section: Core Curriculum ──────────────────── */}
        <SectionHeader
          icon="ti-list-numbers"
          title={
            lang === 'en' ? 'Core Curriculum'
              : lang === 'hi' ? 'मुख्य पाठ्यक्रम'
              : lang === 'ml' ? 'പ്രധാന പാഠ്യപദ്ധതി'
              : 'முக்கிய பாடத்திட்டம்'
          }
          subtitle={`${modules.length} ${modules.length === 1 ? 'module' : 'modules'} · sequential · unlocks features`}
        />
        <div className="academy-modules-grid">
        {modules.map((mod) => {
            const passed = progress[mod.id]?.passed
            const score = progress[mod.id]?.best_score
            const attempts = progress[mod.id]?.attempts || 0
            const title = getTitle(mod)

            // Module 9 — BYOK explainer renders inline (body +
            // comparison + safety callout) instead of the standard
            // navigable tile. Display-only: no /learn/<id> routing,
            // no quiz block, no progress tracking. The has_quiz=false
            // contract from the spec is enforced by total_questions=0
            // in the DB row + this branch skipping the quiz entirely.
            if (mod.id === BYOK_MODULE_KEY) {
              return (
                <ByokModuleCard
                  key={mod.id}
                  mod={mod}
                  lang={lang}
                  title={title}
                />
              )
            }

            return (
              <div
                key={mod.id}
                onClick={() => navigate(`/learn/${mod.id}?lang=${lang}`)}
                className="academy-module-card"
                style={{
                  background: passed
                    ? 'linear-gradient(135deg, rgba(0,200,5,0.08) 0%, var(--bg-surface) 100%)'
                    : 'var(--bg-surface)',
                  border: passed
                    ? '1px solid rgba(0,200,5,0.3)'
                    : '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '16px',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s, transform 0.15s',
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

                    {/* Unlock badge — shown on modules
                        that unlock a feature so the
                        user sees the reward, not just
                        the time cost. */}
                    {UNLOCK_BADGES[mod.id] && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          marginTop: 4,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: UNLOCK_BADGES[mod.id].bg,
                          border: `1px solid ${UNLOCK_BADGES[mod.id].border}`,
                          fontSize: 10,
                          fontWeight: 700,
                          color: UNLOCK_BADGES[mod.id].color,
                        }}
                      >
                        {UNLOCK_BADGES[mod.id].label}
                      </div>
                    )}
                  </div>

                  <Icon name="chevron-right" style={{
                      fontSize: 18,
                      color: 'var(--text-hint)',
                      flexShrink: 0,
                    }} />
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
          })}
        </div>

        {/* ── Section: Special Topics ──────────────────────
            Standalone interactive modules — not part of the unlock
            sequence. Grouped so users see they're optional deep-dives,
            and laid out in a 1/2/3-column grid for desktop. */}
        <SectionHeader
          icon="ti-sparkles"
          title={
            lang === 'en' ? 'Special Topics'
              : lang === 'hi' ? 'विशेष विषय'
              : lang === 'ml' ? 'പ്രത്യേക വിഷയങ്ങൾ'
              : 'சிறப்பு தலைப்புகள்'
          }
          subtitle="Interactive deep-dives · optional"
          marginTop={28}
        />
        <div className="academy-specials-grid">

        {/* When to Sell */}
        <div
          onClick={() => navigate('/learn/when-to-sell')}
          className="academy-special-card"
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, var(--bg-surface) 100%)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 14,
            padding: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            position: 'relative',
            transition: 'border-color 0.15s, transform 0.15s',
          }}
        >
          <div
            style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.35)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, flexShrink: 0,
            }}
          >
            🚪
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)' }}>
                Special Topic
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                Interactive simulator + quiz
              </span>
            </div>
            <h3 style={{ margin: '6px 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              When to Sell a Stock
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Stage-Analysis exit rules — watch Stage 2 → 3 → 4 unfold on a live chart, play with a trailing stop-loss slider, then take a 3-question quiz.
            </p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0, alignSelf: 'center' }} />
        </div>

        {/* Risk Management — live position-sizing calculator + quiz. */}
        <div
          onClick={() => navigate('/learn/risk-management')}
          className="academy-special-card"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.10) 0%, var(--bg-surface) 100%)',
            border: '1px solid rgba(16,185,129,0.35)',
            borderRadius: 14,
            padding: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            position: 'relative',
            transition: 'border-color 0.15s, transform 0.15s',
          }}
        >
          <div
            style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(16,185,129,0.15)',
              border: '1px solid rgba(16,185,129,0.35)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, flexShrink: 0,
            }}
          >
            🛡
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#10B981', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
                Special Topic
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                Position-size calculator + quiz
              </span>
            </div>
            <h3 style={{ margin: '6px 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              Risk Management — Protecting Your Capital
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              The 2% portfolio-risk rule and the position-sizing formula — enter your capital, risk %, buy and stop prices, and see exactly how many shares to buy.
            </p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0, alignSelf: 'center' }} />
        </div>

        {/* Sector Rotation — 4 market environments × 3 sector minis. */}
        <div
          onClick={() => navigate('/learn/sector-rotation')}
          className="academy-special-card"
          style={{
            background: 'linear-gradient(135deg, rgba(96,165,250,0.10) 0%, var(--bg-surface) 100%)',
            border: '1px solid rgba(96,165,250,0.35)',
            borderRadius: 14,
            padding: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            position: 'relative',
            transition: 'border-color 0.15s, transform 0.15s',
          }}
        >
          <div
            style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(96,165,250,0.15)',
              border: '1px solid rgba(96,165,250,0.35)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, flexShrink: 0,
            }}
          >
            🔄
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#60A5FA', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)' }}>
                Special Topic
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                Rotation simulator + quiz
              </span>
            </div>
            <h3 style={{ margin: '6px 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              Sector Rotation — Following the Smart Money
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Click any of four market environments and watch Banking, Auto and Pharma re-stage in real time. Learn which sectors lead in bulls, top out late, and become safe havens in crashes.
            </p>
          </div>
          <Icon name="chevron-right" style={{ fontSize: 18, color: 'var(--text-hint)', flexShrink: 0, alignSelf: 'center' }} />
        </div>

        </div>{/* /academy-specials-grid */}
        </>
        )}

        {/* Certificate preview */}
        {hasScreenerAccess && progress['core_foundation']?.passed && (
          <div
            onClick={() => navigate('/certificate')}
            style={{
              marginTop: 28,
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

      {/* Responsive grid breakpoints + card hover micro-interactions.
          - Core modules: stack on phones, 2-up from 720px.
          - Special topics: stack on phones, 2-up from 600px, 3-up from 1024px.
          - Cards lift slightly on hover (desktop) so they feel tactile. */}
      <style>{`
        .academy-modules-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 12px;
        }
        .academy-specials-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 12px;
          margin-top: 12px;
        }
        @media (min-width: 600px) {
          .academy-specials-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        }
        @media (min-width: 720px) {
          .academy-modules-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        }
        @media (min-width: 1024px) {
          .academy-specials-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (hover: hover) {
          .academy-module-card:hover,
          .academy-special-card:hover {
            border-color: var(--accent) !important;
            transform: translateY(-2px);
          }
        }
      `}</style>
    </div>
  )
}

// ── Small inline section header — keeps the file self-contained ──
function SectionHeader({ icon, title, subtitle, marginTop = 0 }) {
  return (
    <div style={{ marginTop, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
      {icon && (
        <div
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <i className={`ti ${icon}`} style={{ fontSize: 14, color: 'var(--text-muted)' }} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
          {title}
        </p>
        {subtitle && (
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-hint)', letterSpacing: '0.02em' }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
