// ByokExplainer — Academy Module 9 ("Why connect your Gemini API
// key?") rendered as a rich display-only block. Shared by TWO routes:
//
//   1. /learn (Academy.jsx) — inline in the Core Curriculum grid in
//      place of the standard navigable tile.
//   2. /learn/byok_gemini_explainer (ModuleLesson.jsx) — the lesson
//      reader special-cases this module id and renders this component
//      full-page instead of the lesson/quiz state machine. Without
//      that special case the reader showed "Lesson 1 of 0" over an
//      empty body (the module deliberately has no academy_lessons
//      rows — its content lives here in JSX), which is exactly the
//      blank screen users hit in production when anything deep-links
//      to the lesson route.
//
// Body + comparison + safety copy live as constants because the live
// academy_modules table has no content jsonb column, and useAcademy
// doesn't fetch lesson rows for the index view.
//
// Sample comparison responses are kept in English across every
// language because the COMPARISON itself is the lesson — what a
// Gemini answer looks like with vs without PineX context. The
// localised wrappers (header labels, body prose, safety callout)
// carry the language.

export const BYOK_MODULE_KEY = 'byok_gemini_explainer'

// Localised titles — fallback for surfaces that don't have the
// academy_modules row in hand (e.g. the lesson-route special case
// before its module fetch resolves). Keep in sync with the
// title_<lang> columns seeded by
// scripts/sql/insert_module_byok_explainer.sql.
export const BYOK_TITLES = {
  en: 'Why connect your Gemini API key?',
  hi: 'अपनी Gemini API Key क्यों जोड़ें?',
  ml: 'നിങ്ങളുടെ Gemini API Key എന്തിന് connect ചെയ്യണം?',
  ta: 'உங்கள் Gemini API Key ஏன் இணைக்க வேண்டும்?',
}

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

// Illustrative comparison samples — see header comment for why these
// stay English in every language.
const BYOK_WITHOUT_SAMPLE =
  "Reliance Industries is a major Indian conglomerate with operations in oil & petrochemicals, telecom (Jio), and retail. Founded in 1966 by Dhirubhai Ambani. As one of India's largest companies by market capitalisation, it is part of the Nifty 50 index. Worth researching its diversified business segments before investing."
const BYOK_WITH_SAMPLE =
  "RELIANCE is currently in Stage 2 — close ₹2,912, above a rising 30-week MA (47 days in phase). RSI is 58 (healthy band). Delivery percentage spiked to 62% on 9-Jun, well above the 30-day average of 48% — that's accumulation showing up in the cash market. Sector breadth is 64% Stage 2. The technical picture aligns with the broad energy sector strength this week."

export default function ByokExplainer({ lang = 'en', title, moduleNumber = 9 }) {
  const localised = BYOK_CONTENT[lang] || BYOK_CONTENT.en
  const shownTitle = title || BYOK_TITLES[lang] || BYOK_TITLES.en
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
          aria-label={`Module ${moduleNumber}`}
        >
          {moduleNumber}
        </div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
          }}
        >
          {shownTitle}
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
