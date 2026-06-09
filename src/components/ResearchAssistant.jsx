import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { awardPoints } from '../lib/pointsAwarder'
import {
  askGemini,
  ensureKeyRegistered,
  getStoredGeminiKey,
  isBlockedQuestion,
  logResearchUsage,
  logTradingConsent,
  REFUSAL_TEXT,
  saveResearchNote,
} from '../lib/researchAssistant'
import { C } from '../styles/tokens'

// ── ResearchAssistant ───────────────────────────────────────────────────
// Seven-tile research menu on StockDetail. CRITICAL DESIGN PRINCIPLE:
//   Gemini is given the data UP FRONT. We never ask Gemini to fetch,
//   recall, or look anything up. Each category:
//     1. Fetches the relevant PineX rows from Supabase
//     2. Builds a data-rich prompt INCLUDING the fetched values
//     3. Asks Gemini to EXPLAIN that specific data in plain English
//
// Tiles that depend on tables we cannot read (financials, shareholding)
// are availability-checked on mount and greyed out when the row count
// is zero. Cycle Position, Trading Framework, Ask Anything and
// Valuation never grey out — they use props + the companies row which
// always exists on the stock's mount path.

// ── Shared system prompt — applied to every category via override ──────
const SYSTEM = `You are a plain English explainer for Indian retail traders using a cycle analysis platform called PineX.

RULES — NEVER BREAK THESE:
1. Only explain the data given to you. Never say "I don't have data."
   If a value is missing, say what is missing and explain the rest.
2. Plain simple English. Short sentences. Flowing prose, NOT numbered
   lists or bullet points. No markdown.
3. Never give buy/sell advice. Never give price targets.
   Never give specific stop-loss prices.
4. Always end with exactly this line:
   "Not investment advice. Consult a SEBI registered adviser."
5. If multiple data fields are null, say "Some data is not available
   in PineX for this stock" and explain what IS available.
6. Indian context always. Mention Indian market norms where relevant.

WORD BUDGET — CRITICAL:
Keep every response under 120 words. This is a hard limit.
If you cannot cover everything in 120 words — cover the most
important points and stop cleanly. NEVER end mid-sentence.
ALWAYS end at a complete sentence followed by the disclaimer line.
A short complete answer is better than a long truncated one.

OPENING STYLE:
Never start with a preamble. Never repeat the question back.
Start with the actual answer immediately.
Example GOOD: "ENTERO is trading at a P/E of 42..."
Example BAD:  "Here is what the PineX data shows about ENTERO..."
Just dive in. Plain output. No headings, no asterisks, no bullets.`

const TRADING_EXTRA = `
TRADING FRAMEWORK SPECIFIC RULES:
The user has explicitly consented to receive educational reference content
about cycle-analysis trading methodology. Explain methodology concepts only.
NEVER give a specific price, NEVER give Rs. amounts for stop loss or target,
ONLY explain methodology in general terms using percentages and the data
provided as context.`

// ── Permissive system prompt — used ONLY for Ask Anything (freetext) ────
// Allows Gemini to draw on its general knowledge (CEO names, business
// model, history, products, etc.) — the things a researcher actually
// asks. PineX context is still attached as anchor data, and the SEBI
// guardrails still hold.
const FREETEXT_SYSTEM = `You are a research assistant for Indian retail traders using PineX.

For questions about market data, cycle analysis, financials, and
technical analysis: use the PineX context provided.

For general company questions (management, business model, products,
history, CEO, etc.): use your general knowledge. These are research
questions — answer them helpfully.

Always:
- Plain English. Short sentences. Flowing prose, not numbered lists or
  bullets. No markdown (no asterisks, no headings).
- Never give buy/sell advice. Never give price targets.
- Never give specific stop-loss prices.
- End with exactly: "Not investment advice. Consult a SEBI registered adviser."

WORD BUDGET:
Keep under 200 words. NEVER end mid-sentence. ALWAYS end at a complete
sentence followed by the disclaimer. A short complete answer beats a
long truncated one.

OPENING STYLE:
Never start with a preamble. Never repeat the question back.
Start with the actual answer immediately.`

// ── stripMarkdown ──────────────────────────────────────────────────────
// Gemini will return **bold**, *italic*, ## headings, - bullets, 1./2.
// numbered lists regardless of system-prompt instructions. The response
// panel renders prose serif — markdown asterisks show literally. Strip
// before display.
function stripMarkdown(text) {
  if (!text) return text
  return String(text)
    // **bold** -> bold
    .replace(/\*\*(.*?)\*\*/g, '$1')
    // *italic* -> italic
    .replace(/\*(.*?)\*/g, '$1')
    // ## heading -> heading (strip the hash + space)
    .replace(/^#{1,6}\s+/gm, '')
    // - bullet -> • bullet (gives prose a soft list marker)
    .replace(/^[-*]\s+/gm, '• ')
    // 1. numbered -> drop the "1. " prefix entirely
    .replace(/^\d+\.\s+/gm, '')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Category definitions ────────────────────────────────────────────────
// Each tile entry carries an availability check that runs at mount.
// availability = 'always' | 'needsValuation' | 'needsFinancials' | 'needsShareholding'
const CATEGORIES = [
  { key: 'company_overview', emoji: '🏢', title: 'Company Overview',      desc: 'Detailed profile + cycle context',   availability: 'always' },
  { key: 'valuation',    emoji: '📊', title: 'Valuation Metrics',     desc: 'P/E, P/B, Market Cap, D/E',          availability: 'needsValuation' },
  { key: 'growth',       emoji: '📈', title: 'Growth & Momentum',     desc: 'Revenue trend, EPS, PEG, P/S',       availability: 'needsFinancials' },
  { key: 'shareholding', emoji: '👥', title: 'Shareholding Pattern',  desc: 'Promoter, FII, DII trends',          availability: 'needsShareholding' },
  { key: 'quarterly',    emoji: '📋', title: 'Quarterly Results',     desc: 'Revenue, PAT, margins analysis',     availability: 'needsFinancials' },
  { key: 'cycle',        emoji: '🔄', title: 'Cycle Position Deep Dive', desc: 'What this phase means in depth', availability: 'always' },
  { key: 'trading',      emoji: '🎯', title: 'Trading Framework',     desc: 'Reference ranges, methodology',      availability: 'always', isTrading: true },
  { key: 'freetext',     emoji: '✍️', title: 'Ask Anything',          desc: 'Your own question',                  availability: 'always' },
  { key: 'compare',      emoji: '⚖️', title: 'Compare With Another Stock', desc: 'Compare cycle positions',       availability: 'always' },
]

// ── Language options for the post-response translation row ──────────────
// Each language carries the literal Gemini instruction used when the
// user taps that pill. Keeping the instructions inline (rather than
// hard-coding a generic "translate to <lang>" string) lets each prompt
// be tuned: company names / numbers / stock symbols stay in English
// while section headings + body translate to natural target-language
// prose.
const LANGUAGE_OPTIONS = [
  {
    code: 'ml',
    label: 'മലയാളം',
    name: 'Malayalam',
    translatePrompt:
      'Translate the complete analysis above to Malayalam. ' +
      'Keep all section headings translated to Malayalam. ' +
      'Keep all company names, brand names, numbers, and stock symbols ' +
      'in English. Translate everything else to natural Malayalam.',
  },
  {
    code: 'hi',
    label: 'हिंदी',
    name: 'Hindi',
    translatePrompt:
      'Translate the complete analysis above to Hindi. ' +
      'Keep all section headings in Hindi. ' +
      'Keep company names, brand names, numbers, symbols in English. ' +
      'Translate everything else to natural Hindi.',
  },
  {
    code: 'ta',
    label: 'தமிழ்',
    name: 'Tamil',
    translatePrompt:
      'Translate the complete analysis above to Tamil. ' +
      'Keep all section headings in Tamil. ' +
      'Keep company names, brand names, numbers, symbols in English. ' +
      'Translate everything else to natural Tamil.',
  },
]

// ── Component ───────────────────────────────────────────────────────────
export default function ResearchAssistant({
  symbol,
  companyName,
  phase,
  criteriaScore,
  daysInPhase,
  sector,
  sectorBreadth,
  narrative,
  pctFromMA,
  userId,
}) {
  const hasKey = Boolean(getStoredGeminiKey())

  // Retroactive registration backfill — for users with a key from
  // before the logKeySaved telemetry shipped. Fires once per browser.
  useEffect(() => {
    if (userId && hasKey) ensureKeyRegistered(userId).catch(() => {})
  }, [userId, hasKey])

  // Availability + cached fundamentals fetched once on mount.
  //   availability.valuation    bool (companies row has pe_ratio OR market_cap)
  //   availability.financials   bool (financials count > 0 for this company_id)
  //   availability.shareholding bool (shareholding count > 0 for this company_id)
  //   companiesRow              { id, market_cap, pe_ratio, pb_ratio, de_ratio,
  //                               current_ratio, roe, roce }  (or partial)
  //   companyId                 uuid string (from companies.id)
  const [availability, setAvailability] = useState({
    valuation: false, financials: false, shareholding: false,
    loaded: false,
  })
  const [companiesRow, setCompaniesRow] = useState(null)
  const [companyId,    setCompanyId]    = useState(null)

  const [selectedCategory, setSelectedCategory] = useState(null)
  const [response,        setResponse]         = useState('')
  const [loading,         setLoading]          = useState(false)
  const [error,           setError]            = useState('')
  const [refused,         setRefused]          = useState(false)
  const [missingMsg,      setMissingMsg]       = useState('')
  const [showConsent,     setShowConsent]      = useState(false)
  const [freeInput,       setFreeInput]        = useState('')
  // Original user prompt that triggered the first response — preserved
  // so the follow-up handler can prepend it as the first user-turn in
  // the conversation history. Without this, Gemini sees a follow-up
  // like "who is the CEO?" with only the prior MODEL turn for context
  // and the answer drifts off-topic (the symptom you reported).
  const [originalPrompt, setOriginalPrompt] = useState('')

  // Follow-up state — preserves the per-category convo.
  const [followInput,   setFollowInput]   = useState('')
  const [followBusy,    setFollowBusy]    = useState(false)
  const [followHistory, setFollowHistory] = useState([])

  // ── Save-to-notes state ────────────────────────────────────────────────
  // savedKeys   — Set of noteKey strings that have been persisted this
  //               session. Used to hide the save button after a successful
  //               save so the user can't duplicate-insert.
  // recentlySavedKey — single noteKey that flashes the "✅ Saved" message;
  //               cleared 2 seconds after save per spec.
  // savingKey   — noteKey currently mid-INSERT (spinner state).
  //
  // noteKey schema:
  //   `main:${category}`     for the initial response of a category
  //   `follow:${i}:${cat}`   for the i-th follow-up answer
  //   `compare:${other}`     for the compare-stocks response
  // Resets when selectedCategory changes (closePanel + new tile click).
  const [savedKeys,         setSavedKeys]         = useState(() => new Set())
  const [recentlySavedKey,  setRecentlySavedKey]  = useState(null)
  const [savingKey,         setSavingKey]         = useState(null)

  // ── Compare-stock state ────────────────────────────────────────────────
  // 8th tile takes a second symbol then runs a comparison prompt against
  // both stocks' PineX data. The 2nd stock's row is fetched lazily on
  // submit — we don't pre-load anything until the user types a symbol.
  const [compareSymbolInput, setCompareSymbolInput] = useState('')
  const [compareTargetSymbol, setCompareTargetSymbol] = useState(null) // set after a successful run, used as the displayed "other" symbol on the save record

  // ── Criteria-change pulse state (Feature 5) ────────────────────────────
  // True when criteria_changes has a row for THIS symbol dated today.
  // Drives the amber pulse + "Changed today" badge on the Cycle tile so
  // the most-relevant card stands out when there's actually news.
  const [criteriaChangedToday, setCriteriaChangedToday] = useState(false)

  // ── Translation state ──────────────────────────────────────────────────
  // The post-response language row shows English + Malayalam / Hindi /
  // Tamil. Switching to a non-English pill kicks off a fresh Gemini call
  // that asks for a faithful translation of the response; the result
  // lands in translatedResponse and the renderer swaps it in until the
  // user clicks back to English or opens a new category.
  //
  // Reset on category change (the runCategory + openCategory paths
  // already setResponse('') — translation state is reset alongside).
  const [selectedLang,       setSelectedLang]       = useState('en')
  const [translatedResponse, setTranslatedResponse] = useState(null)
  const [translating,        setTranslating]        = useState(false)

  // Reset translation state whenever the user moves to a different
  // category. Cheaper than threading these three setters through every
  // category-reset code path (runCategory / runCompare / openCategory /
  // closePanel).
  useEffect(() => {
    setSelectedLang('en')
    setTranslatedResponse(null)
    setTranslating(false)
  }, [selectedCategory])

  // handleTranslate — fire-and-forget Gemini call that translates the
  // currently-displayed response into the picked language. The English
  // pill is a no-op: tapping "English" just resets the displayed text
  // back to the original. Failures fall back to English with no toast
  // (translation is a nice-to-have; the original answer is still
  // visible behind the language row).
  async function handleTranslate(lang) {
    if (!response) return
    if (selectedLang === lang.code) return
    if (lang.code === 'en') {
      setSelectedLang('en')
      setTranslatedResponse(null)
      return
    }
    setSelectedLang(lang.code)
    setTranslating(true)
    try {
      // Strip the English overflow footer ("...\n\n(Response was long
      // — ask a follow-up for more detail)") before sending to the
      // translator — otherwise the model dutifully translates it and
      // burns translation tokens on a UI string the renderer will
      // re-append anyway.
      const sourceText = response.replace(
        /\.{3,}\s*\n+\s*\(Response was long[^)]*\)\s*$/i,
        '',
      ).trim()

      // Reuse askGemini so the model + key + quota plumbing stays in
      // one place. The translation system prompt is intentionally
      // minimal — the actual translation instruction lives in
      // lang.translatePrompt (concatenated with the response below
      // as the user turn). maxOutputTokens 4000 (not 1500) because
      // Indic scripts tokenise ~3× denser than English: a 500-word
      // English source can balloon to 3000+ tokens in Malayalam /
      // Hindi / Tamil. At 1500 the translation was being cut off
      // mid-sentence — the same MAX_TOKENS failure the English call
      // had at 1500, just one step downstream.
      const { text, finishReason } = await askGemini(
        `${lang.translatePrompt}\n\n---\n\n${sourceText}`,
        { symbol, companyName, phase, sector, narrative: null },
        {
          systemPromptOverride:
            'You are a precise translator. Preserve formatting and section headings as instructed in the user message.',
          maxOutputTokens: 4000,
          temperature: 0.3,
          topP: 0.9,
          // Stream translation into setTranslatedResponse so the user
          // sees the target-language text fill in word-by-word instead
          // of staring at the source for the full ~3-6 s translation
          // budget.
          onChunk: (partial) => setTranslatedResponse(stripMarkdown(partial)),
        },
      )
      let translated = stripMarkdown(text)
      // Defensive: if Gemini STILL hits MAX_TOKENS at 4 k (rare —
      // would need a very long source), trim any trailing partial
      // sentence so the user doesn't see a broken-mid-word tail.
      if (finishReason === 'MAX_TOKENS') {
        const lastFullStop = Math.max(
          translated.lastIndexOf('.'),
          translated.lastIndexOf('।'),  // Devanagari / Bengali
          translated.lastIndexOf('|'),
        )
        if (lastFullStop > 0) translated = translated.slice(0, lastFullStop + 1)
      }
      setTranslatedResponse(translated)
      // Log the translation event — admin analytics for which target
      // languages users actually pick. Fire-and-forget; ignores failure.
      try {
        supabase
          .from('usage_events')
          .insert({
            event_type: 'research_translation_requested',
            user_id: userId || null,
            metadata: {
              symbol,
              category: selectedCategory,
              target_language: lang.code,
              provider: 'gemini',
            },
          })
          .then(() => {})
          .catch(() => {})
      } catch { /* telemetry never blocks UX */ }
    } catch {
      // Network / quota / SAFETY error → back out to English silently.
      setSelectedLang('en')
      setTranslatedResponse(null)
    } finally {
      setTranslating(false)
    }
  }

  // ── Availability check on mount ──────────────────────────────────────
  useEffect(() => {
    if (!hasKey || !symbol) return
    let cancelled = false
    ;(async () => {
      try {
        // We need (a) the company_id for downstream joins (financials,
        // shareholding) and (b) the fundamentals for the Valuation
        // Metrics category. Both used to come from companies; the
        // 15-field fundamentals set now lives in the weekly-refreshed
        // key_metrics table (populated by scripts/fetch_fundamentals.py).
        //
        // Two reads in parallel: companies → just id, key_metrics →
        // every fundamentals column we render. We merge them into the
        // companiesRow shape the buildPrompt('valuation') branch still
        // expects so no downstream prompt code has to change.
        let row = null
        try {
          const [coRes, kmRes] = await Promise.all([
            supabase
              .from('companies')
              .select('id')
              .eq('symbol', symbol)
              .limit(1)
              .maybeSingle(),
            supabase
              .from('key_metrics')
              .select('market_cap,pe_ratio,pb_ratio,de_ratio,current_ratio,roe,roce,ev_ebitda,eps_ttm,revenue_ttm,pat_ttm,dividend_yield,face_value,book_value')
              .eq('symbol', symbol)
              .limit(1)
              .maybeSingle(),
          ])
          const coData = coRes?.data || null
          const kmData = kmRes?.data || null
          // Backwards-compat: the prompt builder reads pe_ratio,
          // pb_ratio, de_ratio, current_ratio, roe, roce, market_cap
          // from row directly. New TTM fields (eps_ttm, revenue_ttm,
          // pat_ttm) get merged in too so future prompts can pick
          // them up without another schema migration.
          row = { ...(coData || {}), ...(kmData || {}) }
        } catch (e) {
          // key_metrics may not exist yet on first deploy. Fall back
          // to companies-only — the page still works, valuation just
          // surfaces a "not in PineX" message.
          try {
            const { data } = await supabase
              .from('companies')
              .select('id')
              .eq('symbol', symbol)
              .limit(1)
              .maybeSingle()
            row = data || null
          } catch {
            row = null
          }
        }
        if (cancelled) return

        const cid = row?.id || null
        setCompaniesRow(row)
        setCompanyId(cid)

        const hasValuation = Boolean(
          row && (row.pe_ratio != null || row.market_cap != null
            || row.pb_ratio != null || row.de_ratio != null),
        )

        // Financials + shareholding existence via HEAD count.
        let hasFinancials = false
        let hasShareholding = false
        if (cid) {
          try {
            const { count: fc } = await supabase
              .from('financials')
              .select('*', { count: 'exact', head: true })
              .eq('company_id', cid)
            hasFinancials = (fc || 0) > 0
          } catch { /* table missing entirely */ }
          try {
            const { count: sc } = await supabase
              .from('shareholding')
              .select('*', { count: 'exact', head: true })
              .eq('company_id', cid)
            hasShareholding = (sc || 0) > 0
          } catch { /* table missing entirely */ }
        }
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.log('[Research] Availability:', {
          symbol, cid,
          valuation: hasValuation,
          financials: hasFinancials,
          shareholding: hasShareholding,
        })
        setAvailability({
          valuation: hasValuation,
          financials: hasFinancials,
          shareholding: hasShareholding,
          loaded: true,
        })

        // Criteria-change pulse — query criteria_changes for this symbol
        // and today's trading_date. If a row exists, the Cycle Position
        // tile gets the amber pulse + "Changed today" badge so the user's
        // eye lands on the right tile when something actually moved.
        //
        // criteria_changes is an optional table (the data pipeline writes
        // to it conditionally). Missing-table errors are caught silently
        // — no pulse is the correct fallback, never block the UI.
        try {
          const today = new Date().toISOString().split('T')[0]
          const { data: change } = await supabase
            .from('criteria_changes')
            .select('trading_date')
            .eq('symbol', symbol)
            .eq('trading_date', today)
            .limit(1)
            .maybeSingle()
          if (!cancelled && change) setCriteriaChangedToday(true)
        } catch {
          // Table absent or row absent — leave pulse off.
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Research] Availability check failed:', e)
        if (!cancelled) setAvailability({ valuation: false, financials: false, shareholding: false, loaded: true })
      }
    })()
    return () => { cancelled = true }
  }, [hasKey, symbol])

  // ── Render: no key teaser ────────────────────────────────────────────
  if (!hasKey) {
    return <NoKeyTeaser />
  }

  // ── Tile click router ────────────────────────────────────────────────
  function isAvailable(cat) {
    if (cat.availability === 'always') return true
    if (cat.availability === 'needsValuation')    return availability.valuation
    if (cat.availability === 'needsFinancials')   return availability.financials
    if (cat.availability === 'needsShareholding') return availability.shareholding
    return false
  }

  function handleTileClick(cat) {
    if (!isAvailable(cat)) return
    if (cat.key === 'trading') {
      setShowConsent(true)
      return
    }
    // 'compare' shows an input first (collect target symbol), THEN runs.
    // 'freetext' is similar but its input is wired into runCategory which
    // already gates on userQuestion — compare goes through runCompare
    // because the prompt shape and Supabase fetch are different.
    if (cat.key === 'compare') {
      setSelectedCategory('compare')
      setResponse('')
      setError('')
      setRefused(false)
      setMissingMsg('')
      setFollowHistory([])
      setCompareSymbolInput('')
      setCompareTargetSymbol(null)
      // Reset per-category save state so previous saves don't carry over.
      setSavedKeys(new Set())
      setRecentlySavedKey(null)
      return
    }
    runCategory(cat.key)
  }

  // ── runCompare ─────────────────────────────────────────────────────────
  // Fetch the target stock from mv_home_stocks + swing_conditions, build
  // a comparison prompt against the current stock (props), and stream the
  // result into the same response panel runCategory uses. Keeps the
  // existing privacy + telemetry path — askGemini is the same client-side
  // call to Google with the user's key; logResearchUsage records a
  // contextType='compare' usage event with no question/answer text.
  async function runCompare() {
    const target = String(compareSymbolInput || '').trim().toUpperCase()
    if (!target) return
    if (target === String(symbol || '').toUpperCase()) {
      setError(`That's the same stock — pick a different symbol to compare.`)
      return
    }

    setSelectedCategory('compare')
    setResponse('')
    setError('')
    setRefused(false)
    setMissingMsg('')
    setFollowHistory([])
    setLoading(true)
    setCompareTargetSymbol(target)

    try {
      // Fetch the target's PineX snapshot. mv_home_stocks carries phase
      // (stage), sector, name, and the moving averages we need for the
      // "vs trend" % calc. swing_conditions holds the criteria-met count
      // — best-effort; absent rows fall back to "n/a" in the prompt.
      const { data: row } = await supabase
        .from('mv_home_stocks')
        .select('symbol,name,sector,stage,close,ma30w,rs_vs_nifty,weinstein_substage,high_conviction')
        .eq('symbol', target)
        .limit(1)
        .maybeSingle()

      if (!row) {
        setError(`Could not find ${target} in PineX. Check the symbol and try again.`)
        setLoading(false)
        return
      }

      // criteria_score (out of 5) — best effort, ok if missing
      let score2 = null
      try {
        const { data: sw } = await supabase
          .from('swing_conditions')
          .select('conditions_met,trading_date')
          .eq('symbol', target)
          .order('trading_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (sw && sw.conditions_met != null) score2 = sw.conditions_met
      } catch { /* table absent — leave score null */ }

      const pct2 =
        (row.close && row.ma30w)
          ? (((Number(row.close) - Number(row.ma30w)) / Number(row.ma30w)) * 100).toFixed(1)
          : null

      // Build prompt — fields the second stock doesn't have (days_in_phase,
      // sector_breadth) are simply omitted from STOCK 2 so the LLM doesn't
      // hallucinate numbers. The instruction "Only explain the data given"
      // from the system prompt covers this.
      const prompt = `Compare these two stocks using PineX cycle analysis data:

STOCK 1: ${symbol} — ${companyName || ''}
Phase: ${phase || 'n/a'}
Criteria: ${criteriaScore != null ? `${criteriaScore}/5` : 'n/a'}
Days in phase: ${daysInPhase != null ? daysInPhase : 'n/a'}
Sector: ${sector || 'n/a'}${sectorBreadth != null ? ` (${sectorBreadth}% breadth)` : ''}
vs trend: ${pctFromMA != null ? `${pctFromMA}%` : 'n/a'}

STOCK 2: ${target} — ${row.name || ''}
Phase: ${row.stage || 'n/a'}${row.weinstein_substage ? ` (${row.weinstein_substage})` : ''}
Criteria: ${score2 != null ? `${score2}/5` : 'n/a'}
Sector: ${row.sector || 'n/a'}
vs trend: ${pct2 != null ? `${pct2}%` : 'n/a'}
RS vs Nifty: ${row.rs_vs_nifty != null ? row.rs_vs_nifty : 'n/a'}

Write 3-4 sentences comparing their cycle positions.
Which has stronger criteria?
Are they in the same sector?
What is notably different?
Plain English. Under 120 words.
Never give buy/sell advice.`

      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        prompt,
        { symbol, companyName, phase, sector, narrative: `Comparing ${symbol} vs ${target}` },
        {
          systemPromptOverride: SYSTEM,
          maxOutputTokens: 1200,
          temperature: 0.7,
          topP: 0.9,
          // Stream into setResponse so the answer appears word-by-word.
          // stripMarkdown runs on each accumulated chunk — cheap; the
          // regex passes are bound by the response length, not chunk
          // count.
          onChunk: (partial) => setResponse(stripMarkdown(partial)),
        },
      )

      let cleaned = stripMarkdown(text)
      if (finishReason === 'MAX_TOKENS') {
        cleaned += '...\n\n(Response was long — ask a follow-up for more detail)'
      }
      setResponse(cleaned)
      setOriginalPrompt(prompt)
      setLoading(false)

      logResearchUsage({
        userId, symbol,
        contextType: 'compare',
        category: `compare:${target}`,
        usage, finishReason, responseTimeMs,
        tradingConsent: false,
      })
      if (userId) {
        awardPoints(userId, 'research_question', {
          fallbackPoints: 2,
          notes: `Research (compare) ${symbol} vs ${target}`,
          referenceId: null,
        }).catch(() => {})
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Research] Compare error:', e)
      setError('Could not get a response. Check your key at aistudio.google.com')
      setLoading(false)
    }
  }

  // ── handleSaveNote ─────────────────────────────────────────────────────
  // Persist an AI response to research_notes via the lib helper. Tracks
  // savedKeys (one entry per response, prevents duplicate inserts) and
  // recentlySavedKey (single-element "just saved" flag that clears after
  // 2 seconds per spec).
  //
  // The recentlySavedKey timeout closes over the current noteKey; the
  // setter checks that the current value still matches before clearing
  // so a rapid second save on a different note doesn't accidentally
  // un-flash the new one.
  async function handleSaveNote({ noteKey, category, responseText, displaySymbol, displayName }) {
    if (!userId || !responseText) return
    if (savedKeys.has(noteKey)) return
    setSavingKey(noteKey)
    const result = await saveResearchNote({
      userId,
      symbol: displaySymbol || symbol,
      companyName: displayName != null ? displayName : companyName,
      category,
      responseText,
    })
    setSavingKey((cur) => (cur === noteKey ? null : cur))
    if (result.ok) {
      setSavedKeys((prev) => {
        const next = new Set(prev)
        next.add(noteKey)
        return next
      })
      setRecentlySavedKey(noteKey)
      setTimeout(() => {
        setRecentlySavedKey((cur) => (cur === noteKey ? null : cur))
      }, 2000)
    } else {
      // Surface a quiet inline error — don't tear down the response.
      // eslint-disable-next-line no-console
      console.warn('[Research] Save failed:', result.error)
    }
  }

  // ── Per-category data fetch + prompt build + Gemini call ─────────────
  async function runCategory(catKey, opts = {}) {
    const cat = CATEGORIES.find((c) => c.key === catKey)
    if (!cat) return

    setSelectedCategory(catKey)
    setResponse('')
    setError('')
    setRefused(false)
    setMissingMsg('')
    setFollowHistory([])
    setFollowInput('')
    setLoading(true)

    try {
      // 1. Fetch the data this category needs.
      const dataPack = await fetchCategoryData(catKey)
      // eslint-disable-next-line no-console
      console.log('[Research] Category:', catKey, '— Data fetched:', dataPack)

      // 2. If data missing, surface a clear message without calling Gemini.
      if (dataPack && dataPack.__missing) {
        setMissingMsg(dataPack.__missing)
        setLoading(false)
        return
      }

      // 3. Build the prompt.
      const userQuestion = opts.userQuestion
        ? String(opts.userQuestion).trim()
        : null
      const { prompt, systemOverride, generationOpts } = buildPrompt(catKey, dataPack, {
        symbol, companyName, phase, criteriaScore, daysInPhase,
        sector, sectorBreadth, narrative, pctFromMA,
        userQuestion,
      })

      if (!prompt) {
        setLoading(false)
        return
      }
      // eslint-disable-next-line no-console
      console.log('[Research] Prompt length:', prompt.length)

      // Block obvious buy/sell questions before they hit the network.
      if (userQuestion && isBlockedQuestion(userQuestion)) {
        setRefused(true)
        setLoading(false)
        return
      }

      // 4. Call Gemini with the prompt as the USER message and a strong
      //    system_instruction. Defaults: maxOutputTokens 1200 (≈900
      //    words) + temperature 0.7 — generous safety net for the
      //    ~120-word category prompts. Builders can override via
      //    generationOpts; company_overview uses 1500 / 0.5 for its
      //    longer, more factual structured profile.
      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        prompt,
        { symbol, companyName, phase, sector, narrative },
        {
          systemPromptOverride: systemOverride,
          maxOutputTokens: generationOpts?.maxOutputTokens ?? 1200,
          temperature:     generationOpts?.temperature     ?? 0.7,
          topP:            generationOpts?.topP            ?? 0.9,
          // Stream into setResponse so each token paints. The loading
          // dots auto-hide once `response` is non-empty (see the
          // {loading && !response && (...)} guard around the dot
          // animation), so the user sees the dots only until the
          // first token arrives (~500ms typically).
          onChunk: (partial) => setResponse(stripMarkdown(partial)),
        },
      )

      // eslint-disable-next-line no-console
      console.log('[Research] finishReason:', finishReason)
      // eslint-disable-next-line no-console
      console.log('[Research] full text length:', text?.length || 0)
      // eslint-disable-next-line no-console
      console.log('[Research] first 200 chars:', text?.substring(0, 200))

      let cleaned = stripMarkdown(text)
      if (finishReason === 'MAX_TOKENS') {
        cleaned += '...\n\n(Response was long — ask a follow-up for more detail)'
      }
      setResponse(cleaned)
      // Persist the user-turn that produced this answer so the
      // follow-up handler can reconstruct the full conversation.
      setOriginalPrompt(prompt)
      setLoading(false)

      logResearchUsage({
        userId, symbol,
        contextType: 'stock_page',
        category: catKey,
        usage, finishReason, responseTimeMs,
        tradingConsent: catKey === 'trading',
      })
      if (userId) {
        awardPoints(userId, 'research_question', {
          fallbackPoints: 2,
          notes: `Research (${catKey}) on ${symbol}`,
          referenceId: null,
        }).catch(() => {})
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Research] Error:', e)
      if (e && e.code === 'SAFETY') {
        logResearchUsage({
          userId, symbol,
          contextType: 'stock_page',
          category: catKey,
          usage: e.usage, finishReason: e.finishReason || 'SAFETY',
          responseTimeMs: e.responseTimeMs,
          tradingConsent: catKey === 'trading',
        })
        setError(e.message)
      } else {
        setError('Could not get a response. Check your key at aistudio.google.com')
      }
      setLoading(false)
    }
  }

  // ── Per-category Supabase fetchers ───────────────────────────────────
  // Shared "no usable data" message — every fundamentals category
  // points the user at the four ALWAYS-available tiles so they
  // know what they CAN use, not just what's missing. Pre-Gemini
  // early-exit so we never burn the user's quota on a request
  // whose best possible answer is "I don't have data for this".
  //
  // `kind` is a category key ('valuation' / 'quarterly' / 'growth' /
  // 'shareholding'). Unknown keys fall back to "This data".
  const fundamentalsMissingMsg = (kind) => {
    const kindLabel = {
      valuation:    'Valuation metrics',
      quarterly:    'Quarterly financial data',
      growth:       'Growth metrics',
      shareholding: 'Shareholding data',
    }[kind] || 'This data'
    return (
      `${kindLabel} for ${symbol} is not yet in PineX.\n\n` +
      `Available for this stock:\n` +
      `✅ Cycle Position Deep Dive\n` +
      `✅ Company Overview\n` +
      `✅ Trading Framework\n` +
      `✅ Ask Anything\n\n` +
      `Try Company Overview — Gemini knows most NSE-listed ` +
      `companies from its training data.`
    )
  }

  async function fetchCategoryData(catKey) {
    if (catKey === 'valuation') {
      // First gate: mount-time availability flag (cheap, in-memory).
      if (!availability.valuation) {
        return { __missing: fundamentalsMissingMsg('valuation') }
      }
      // Second gate: even when availability.valuation flipped true at
      // mount, the row may have only one stale field. Require at
      // least ONE of the marquee metrics (pe / market_cap / roe)
      // before paying for the Gemini call. Matches the brief's
      // hasValuation check.
      const m = companiesRow || {}
      const hasValuation = (
        m.pe_ratio != null ||
        m.market_cap != null ||
        m.roe != null
      )
      if (!hasValuation) {
        return { __missing: fundamentalsMissingMsg('valuation') }
      }
      return { companies: m }
    }

    if (catKey === 'growth' || catKey === 'quarterly') {
      // SOURCE: quarterly_financials_yf (populated weekly by
      // scripts/fetch_fundamentals_yf.py). The yf table is keyed by
      // symbol + quarter_end (not company_id + quarter string), so
      // no companyId is required to read it. We pull the latest 4
      // quarters newest-first and map yf's columns onto the shape
      // the downstream buildPrompt branch already expects:
      //
      //   yf.net_income   → row.pat
      //   yf.quarter_end  → row.quarter
      //   yf.revenue      → row.revenue (unchanged)
      //
      // EPS isn't a per-quarter field in the yf table — it's a TTM
      // value on key_metrics. The prompt renders 'N/A' when absent,
      // which is the right answer.
      //
      // Defensive try/catch — if the table doesn't exist yet (pre-
      // migration deploy) we fall through to fundamentalsMissingMsg
      // rather than crash.
      let yfRows = []
      try {
        const { data } = await supabase
          .from('quarterly_financials_yf')
          .select('quarter_end,revenue,gross_profit,operating_income,net_income,ebitda')
          .eq('symbol', symbol)
          .order('quarter_end', { ascending: false })
          .limit(4)
        yfRows = Array.isArray(data) ? data : []
      } catch {
        yfRows = []
      }
      // Map onto the prompt's legacy shape so the downstream 'growth'
      // builder (which still reads pat / eps / operating_margin) keeps
      // working without a rewrite. The 'quarterly' builder consumes
      // the RAW yfQuarters below — it now uses the wider yfinance
      // columns (gross_profit / operating_income / ebitda) directly.
      const rows = yfRows.map((r) => ({
        quarter:           r.quarter_end || null,
        revenue:           r.revenue ?? null,
        pat:               r.net_income ?? null,
        eps:               null,
        operating_margin:  (r.revenue && r.operating_income != null)
          ? Math.round((Number(r.operating_income) / Number(r.revenue)) * 100 * 10) / 10
          : null,
      }))
      // Value-presence check: at least one quarter must carry a
      // non-null revenue. yfinance occasionally returns rows with
      // null revenue but non-null EBITDA (early-stage reports);
      // revenue is the floor — without it nothing else reads.
      const hasRealRows = yfRows.length > 0 && yfRows.some((q) =>
        q.revenue != null || q.net_income != null,
      )
      if (!hasRealRows) {
        return { __missing: fundamentalsMissingMsg(catKey) }
      }
      // Both legacy (mapped) and raw rows handed downstream — each
      // prompt branch picks whichever shape it needs.
      return { financials: rows, yfQuarters: yfRows }
    }

    if (catKey === 'shareholding') {
      if (!availability.shareholding || !companyId) {
        return { __missing: fundamentalsMissingMsg('shareholding') }
      }
      let rows = []
      try {
        const { data } = await supabase
          .from('shareholding')
          .select('quarter,promoter_pct,promoter_pledge_pct,fii_pct,dii_pct,public_pct')
          .eq('company_id', companyId)
          .order('quarter', { ascending: false })
          .limit(4)
        rows = Array.isArray(data) ? data : []
      } catch {
        const { data } = await supabase
          .from('shareholding')
          .select('*')
          .eq('company_id', companyId)
          .order('quarter', { ascending: false })
          .limit(4)
        rows = Array.isArray(data) ? data : []
      }
      // Same emptiness check — at least one quarter must carry a
      // promoter / FII / DII / public number.
      const hasRealRows = rows.length > 0 && rows.some((q) =>
        q.promoter_pct != null ||
        q.fii_pct != null ||
        q.dii_pct != null ||
        q.public_pct != null,
      )
      if (!hasRealRows) {
        return { __missing: fundamentalsMissingMsg('shareholding') }
      }
      return { shareholding: rows }
    }

    // company_overview — try to fetch the stored profile from the
    // company_overview table (weekly-populated by
    // scripts/fetch_company_overview.py). If present, the buildPrompt
    // branch grounds Gemini's response in OUR data instead of
    // Gemini's training distribution. If absent → returns {}; the
    // prompt builder falls back to the original "synthesise from
    // your knowledge" prompt.
    if (catKey === 'company_overview') {
      try {
        const { data } = await supabase
          .from('company_overview')
          .select('about,business_model,products_brands,founded_year,headquarters,employee_count,promoter_names')
          .eq('symbol', symbol)
          .limit(1)
          .maybeSingle()
        if (data && (data.about || data.business_model || data.products_brands)) {
          return { overview: data }
        }
      } catch {
        // Table missing or RLS denial — fall back to empty pack.
      }
      return {}
    }

    // cycle / trading / freetext — props only, no fetch
    return {}
  }

  // ── Follow-up call — reuses category context + appends history ──────
  async function handleFollowUp(e) {
    e?.preventDefault()
    const q = followInput.trim()
    if (!q || followBusy || !selectedCategory) return
    if (isBlockedQuestion(q)) {
      setRefused(true)
      return
    }
    setFollowBusy(true)
    setError('')
    setRefused(false)
    try {
      const isTrading  = selectedCategory === 'trading'
      const isFreetext = selectedCategory === 'freetext'

      // Build the same system override the original request used.
      // Without this, the follow-up resets the persona and Gemini
      // forgets it's a research assistant grounded in PineX data.
      const baseSys = isFreetext ? FREETEXT_SYSTEM : SYSTEM
      const sharedSys =
        baseSys +
        (isTrading ? `\n${TRADING_EXTRA}` : '') +
        `\n\nAnswer the follow-up grounded in the prior conversation. ` +
        `Stay on the same stock and same research context.`

      // Reconstruct the multi-turn conversation that gave the user the
      // current answer. Without the original user-turn, Gemini sees a
      // model turn floating alone — that's why "who is the CEO?" was
      // coming back as a bare header (no anchor to the stock).
      const history = []
      if (originalPrompt) history.push({ role: 'user',  text: originalPrompt })
      if (response)       history.push({ role: 'model', text: response })
      for (const turn of followHistory) {
        history.push({ role: 'user',  text: turn.question })
        history.push({ role: 'model', text: turn.answer })
      }

      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        q,
        { symbol, companyName, phase, sector, narrative },
        {
          systemPromptOverride: sharedSys,
          history,
          maxOutputTokens: 1200,
          temperature: 0.7,
          topP: 0.9,
        },
      )

      // eslint-disable-next-line no-console
      console.log('[Research] follow-up finishReason:', finishReason, 'length:', text?.length || 0)

      let cleaned = stripMarkdown(text)
      if (finishReason === 'MAX_TOKENS') {
        cleaned += '...\n\n(Response was long — ask a follow-up for more detail)'
      }
      setFollowHistory((prev) => [...prev, { question: q, answer: cleaned }])
      setFollowInput('')

      logResearchUsage({
        userId, symbol,
        contextType: 'stock_page',
        category: selectedCategory,
        usage, finishReason, responseTimeMs,
        tradingConsent: isTrading,
      })
    } catch (err) {
      if (err && err.code === 'SAFETY') {
        logResearchUsage({
          userId, symbol,
          contextType: 'stock_page',
          category: selectedCategory,
          usage: err.usage, finishReason: err.finishReason || 'SAFETY',
          responseTimeMs: err.responseTimeMs,
          tradingConsent: selectedCategory === 'trading',
        })
        setError(err.message)
      } else {
        setError('Could not get a response. Check your key at aistudio.google.com')
      }
    } finally {
      setFollowBusy(false)
    }
  }

  function handleConsentConfirm() {
    setShowConsent(false)
    if (userId) logTradingConsent({ userId, symbol })
    runCategory('trading')
  }

  function closePanel() {
    setSelectedCategory(null)
    setResponse('')
    setError('')
    setRefused(false)
    setMissingMsg('')
    setFollowHistory([])
    setFollowInput('')
    setFreeInput('')
    setOriginalPrompt('')
    // Reset save tracking + compare scratch so re-opening a tile starts
    // with a fresh "💾 Save this insight" affordance.
    setSavedKeys(new Set())
    setRecentlySavedKey(null)
    setSavingKey(null)
    setCompareSymbolInput('')
    setCompareTargetSymbol(null)
  }

  const activeCat = selectedCategory
    ? CATEGORIES.find((c) => c.key === selectedCategory)
    : null

  return (
    <div style={{ marginTop: 28 }}>
      {/*
        Local keyframes for the criteria-change pulse on the Cycle tile.
        Scoped via a unique animation name to avoid colliding with any
        global "pulse" class. Renders inline so the component is self-
        contained — no index.css edit required.
      */}
      <style>{`
        @keyframes researchPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,159,11,0.55); }
          50%      { box-shadow: 0 0 0 8px rgba(245,159,11,0.00); }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <h3 style={{
          margin: 0, fontSize: 14, fontWeight: 700,
          color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>🔬</span>
          Research Assistant
          <span style={{
            fontSize: 9, fontWeight: 800,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 99,
            background: C.amberBg, color: C.amber,
            border: `1px solid ${C.amberBorder}`,
          }}>
            PRO
          </span>
        </h3>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0' }}>
          Pick a research category — your Gemini key, your AI, PineX sees nothing.
        </p>
      </div>

      {/* 7-tile category grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10,
      }}>
        {CATEGORIES.map((cat) => {
          const avail   = isAvailable(cat)
          const isActive = selectedCategory === cat.key
          // Dim sibling tiles when one is active for visual focus.
          const dimSibling = selectedCategory && !isActive
          const baseOpacity = avail ? (dimSibling ? 0.6 : 1) : 0.4
          const tooltip = !avail
            ? (cat.availability === 'needsFinancials'   ? 'Results data coming soon'
              : cat.availability === 'needsShareholding' ? 'Shareholding data coming soon'
              : cat.availability === 'needsValuation'    ? 'Valuation data coming soon'
              : '')
            : ''
          // Feature 5 — Criteria pulse: only the Cycle tile, only when
          // criteria_changes has a row for this symbol dated today.
          const pulseThisTile = cat.key === 'cycle' && criteriaChangedToday
          return (
            <button
              key={cat.key}
              type="button"
              title={tooltip}
              onClick={() => handleTileClick(cat)}
              disabled={!avail}
              style={{
                textAlign: 'left',
                padding: 16,
                background: isActive
                  ? 'rgba(245,159,11,0.10)'
                  : (cat.isTrading ? 'rgba(245,159,11,0.03)' : C.surface),
                border: `1px solid ${
                  isActive
                    ? C.amber
                    : pulseThisTile
                      ? C.amber
                      : cat.isTrading
                        ? C.amberBorder
                        : C.border
                }`,
                borderRadius: 12,
                cursor: avail ? 'pointer' : 'not-allowed',
                display: 'flex', flexDirection: 'column', gap: 6,
                minHeight: 96,
                position: 'relative',
                transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
                opacity: baseOpacity,
                // The pulse rides on box-shadow so it doesn't shift
                // surrounding tiles (border width changes would).
                animation: pulseThisTile ? 'researchPulse 2s ease-in-out infinite' : undefined,
              }}
              onMouseEnter={(e) => {
                if (avail && !isActive) {
                  e.currentTarget.style.borderColor = `${C.amber}66`
                  e.currentTarget.style.background = 'var(--bg-elevated)'
                }
              }}
              onMouseLeave={(e) => {
                if (avail && !isActive) {
                  e.currentTarget.style.borderColor = cat.isTrading ? C.amberBorder : C.border
                  e.currentTarget.style.background = cat.isTrading
                    ? 'rgba(245,159,11,0.03)'
                    : C.surface
                }
              }}
            >
              {/* Top row: emoji + status indicator (right) */}
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 8,
              }}>
                <span style={{ fontSize: 24 }}>{cat.emoji}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {cat.isTrading && avail && (
                    <span title="Trading framework requires consent"
                      style={{ fontSize: 12, color: C.amber }}>⚠️</span>
                  )}
                  {/* Status indicator: green dot when available, lock when not */}
                  {avail ? (
                    <span aria-hidden style={{
                      display: 'inline-block',
                      width: 8, height: 8, borderRadius: '50%',
                      background: C.green,
                    }} />
                  ) : (
                    <span aria-hidden style={{ fontSize: 12, color: C.textFaint }}>🔒</span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                {cat.title}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.45 }}>
                {cat.desc}
              </div>
              {/* Feature 5 — "Changed today" badge on the Cycle tile when
                  criteria_changes has a fresh row. Pairs with the amber
                  pulse animation on the tile's box-shadow. */}
              {pulseThisTile && (
                <span style={{
                  marginTop: 4,
                  alignSelf: 'flex-start',
                  fontSize: 10, fontWeight: 700,
                  color: C.amber,
                  background: 'rgba(245,159,11,0.10)',
                  border: `1px solid ${C.amberBorder}`,
                  borderRadius: 6,
                  padding: '2px 6px',
                  letterSpacing: '0.04em',
                }}>
                  Changed today
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Freetext input — only when ✍️ tile picked AND no response yet */}
      {selectedCategory === 'freetext' && !response && !loading && !refused && !error && (
        <div style={{ marginTop: 14 }}>
          <textarea
            value={freeInput}
            onChange={(e) => setFreeInput(e.target.value)}
            placeholder={`Ask anything about ${symbol || 'this stock'}…`}
            rows={3}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                if (freeInput.trim()) runCategory('freetext', { userQuestion: freeInput })
              }
            }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px',
              background: 'var(--bg-input)',
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.text, fontSize: 13, lineHeight: 1.5,
              resize: 'vertical', minHeight: 80, outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => runCategory('freetext', { userQuestion: freeInput })}
            disabled={!freeInput.trim()}
            style={{
              marginTop: 8,
              padding: '9px 20px',
              background: freeInput.trim() ? C.amber : 'var(--bg-elevated)',
              color: freeInput.trim() ? '#000' : C.textMuted,
              border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: freeInput.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Ask →
          </button>
        </div>
      )}

      {/* Compare input — only when ⚖️ tile picked AND no response yet.
          Same pattern as the freetext input above: collect the second
          symbol, then runCompare fetches its PineX row and asks Gemini. */}
      {selectedCategory === 'compare' && !response && !loading && !refused && !error && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
            Enter a stock symbol to compare with {symbol}:
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={compareSymbolInput}
              onChange={(e) => setCompareSymbolInput(e.target.value.toUpperCase())}
              placeholder="e.g. BIOCON"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (compareSymbolInput.trim()) runCompare()
                }
              }}
              style={{
                flex: 1, boxSizing: 'border-box',
                padding: '10px 12px',
                background: 'var(--bg-input)',
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                color: C.text, fontSize: 13,
                letterSpacing: '0.05em',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={runCompare}
              disabled={!compareSymbolInput.trim()}
              style={{
                padding: '9px 20px',
                background: compareSymbolInput.trim() ? C.amber : 'var(--bg-elevated)',
                color: compareSymbolInput.trim() ? '#000' : C.textMuted,
                border: 'none', borderRadius: 10,
                fontSize: 13, fontWeight: 700,
                cursor: compareSymbolInput.trim() ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              Compare
            </button>
          </div>
        </div>
      )}

      {/* Response panel — no height limits per spec */}
      <AnimatePresence>
        {selectedCategory && (loading || response || refused || error || missingMsg) && (
          <motion.div
            key={`response-${selectedCategory}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              marginTop: 16,
              background: C.surface,
              borderLeft: `3px solid ${error ? C.red : C.amber}`,
              borderRadius: '0 12px 12px 12px',
              padding: 20,
              width: '100%',
              minHeight: 120,
              maxHeight: 'none',
              overflow: 'visible',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{
                fontSize: 14, fontWeight: 700, color: C.text,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 18 }}>{activeCat?.emoji}</span>
                <span>{activeCat?.title}</span>
              </div>
              <button
                type="button" onClick={closePanel} aria-label="Close"
                style={{
                  background: 'transparent', border: 'none',
                  color: C.textMuted, cursor: 'pointer',
                  fontSize: 20, padding: 0, lineHeight: 1,
                }}
              >×</button>
            </div>

            <div style={{
              borderBottom: `1px solid ${C.border}`,
              marginTop: 10, marginBottom: 14,
            }} />

            {/* Loading state — dots show ONLY until the first streamed
                token arrives. The askGemini onChunk callback flips
                `response` from '' → first-fragment within ~500ms of the
                request firing; the moment `response` is non-empty we
                hide the dots and let the streamed text take over below.
                `loading` itself stays true through the full request so
                save / language pills / follow-up controls don't appear
                mid-stream. */}
            {loading && !response && (
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 8,
                color: C.textMuted, fontSize: 13,
                fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                fontStyle: 'italic',
                padding: '14px 0',
              }}>
                {[0, 1, 2].map((i) => (
                  <motion.span key={i}
                    animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                    transition={{
                      duration: 0.9, repeat: Infinity,
                      delay: i * 0.15, ease: 'easeInOut',
                    }}
                    style={{
                      display: 'inline-block',
                      width: 6, height: 6, borderRadius: '50%',
                      background: C.amber,
                    }}
                  />
                ))}
                <span style={{ marginLeft: 6 }}>Asking your research assistant…</span>
              </div>
            )}

            {/* Missing data — friendly message, NO Gemini call */}
            {missingMsg && (
              <div style={{
                padding: '14px 16px',
                background: 'var(--bg-elevated)',
                border: `1px solid ${C.amberBorder}`,
                borderRadius: 10,
                color: C.text, fontSize: 14, lineHeight: 1.6,
                fontFamily: 'Newsreader, ui-serif, Georgia, serif',
              }}>
                {missingMsg}
              </div>
            )}

            {/* Refused */}
            {refused && (
              <div style={{
                padding: '14px 16px',
                background: 'rgba(245,159,11,0.08)',
                border: `1px solid ${C.amberBorder}`,
                borderRadius: 10,
                color: C.amber, fontSize: 14, lineHeight: 1.6,
                fontFamily: 'Newsreader, ui-serif, Georgia, serif',
              }}>
                {REFUSAL_TEXT}
              </div>
            )}

            {/* Response text — Newsreader serif, no truncation. When
                the user picks a non-English language pill, swap in
                translatedResponse; otherwise show the original. While
                a translation is in flight, the original stays visible
                with a small amber "Translating to <lang>…" line below.

                SUBHEADING CONTRAST — Gemini returns section markers
                like "ABOUT", "PRODUCTS", "FINANCIALS" inline in the
                prose. stripMarkdown removes the ## prefix but the
                ALL-CAPS word then sits flush against the surrounding
                paragraph with no visual hierarchy. Per-line render
                below: any line that is short (< 30 chars) AND all
                uppercase AND contains at least one Latin letter
                renders as a small tracking-wide muted label. The
                length cap excludes sentences that happen to start
                with a capitalised acronym; the letter check excludes
                pure number / punctuation lines. */}
            {response && (() => {
              const displayedResponse =
                selectedLang !== 'en' && translatedResponse
                  ? translatedResponse
                  : response

              // Treat a line as a subheading when (a) it's short
              // enough to plausibly be a label, (b) it has at least
              // one letter so we don't promote "₹12,000 cr." style
              // numeric tails, and (c) every letter is uppercase.
              // Tested against the ABOUT / PRODUCTS / FINANCIALS /
              // GROWTH / CYCLE NOTES headers the Company Overview
              // category produces.
              const isSubheading = (line) => {
                const t = line.trim()
                if (!t || t.length > 30) return false
                if (!/[A-Za-z]/.test(t)) return false
                return t === t.toUpperCase()
              }

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  style={{
                    color: C.text,
                    fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                    fontSize: '0.95rem',
                    lineHeight: 1.8,
                    wordBreak: 'break-word',
                  }}
                >
                  {displayedResponse.split('\n').map((line, idx) => {
                    if (isSubheading(line)) {
                      return (
                        <div
                          key={idx}
                          style={{
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            color: C.textMuted,
                            marginTop: 16,
                            marginBottom: 4,
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                            fontWeight: 600,
                          }}
                        >
                          {line.trim()}
                        </div>
                      )
                    }
                    // Blank lines render as small vertical breathing
                    // room so paragraph spacing matches the previous
                    // `white-space: pre-wrap` behaviour visually.
                    if (!line.trim()) {
                      return <div key={idx} style={{ height: 8 }} />
                    }
                    return (
                      <div key={idx} style={{ whiteSpace: 'pre-wrap' }}>
                        {line}
                      </div>
                    )
                  })}
                </motion.div>
              )
            })()}

            {/* Language row — appears after every response. Tapping a
                pill kicks off a translation via handleTranslate; English
                resets the displayed text to the original. Pill state
                tracks selectedLang; the active language pill renders
                with an amber tint. */}
            {response && !loading && !error && (
              <div style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: `1px solid ${C.border}`,
              }}>
                <div style={{
                  fontSize: 11,
                  color: C.textMuted,
                  marginBottom: 8,
                  letterSpacing: '0.02em',
                }}>
                  🌐 Read in your language:
                </div>
                <div style={{
                  display: 'flex', gap: 8, flexWrap: 'wrap',
                }}>
                  {/* English — clicking resets the displayed text. */}
                  <button
                    type="button"
                    onClick={() => handleTranslate({ code: 'en' })}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      border: `1px solid ${selectedLang === 'en' ? C.amber : C.border}`,
                      background: selectedLang === 'en' ? C.amberBg : 'transparent',
                      color:      selectedLang === 'en' ? C.amber   : C.textMuted,
                      cursor: 'pointer',
                    }}
                  >
                    English
                  </button>
                  {LANGUAGE_OPTIONS.map((lang) => {
                    const isActive = selectedLang === lang.code
                    const isLoading = translating && isActive
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => handleTranslate(lang)}
                        disabled={translating}
                        style={{
                          padding: '4px 12px',
                          borderRadius: 20,
                          fontSize: 12,
                          border: `1px solid ${isActive ? C.amber : C.border}`,
                          background: isActive ? C.amberBg : 'transparent',
                          color:      isActive ? C.amber   : C.textMuted,
                          cursor: translating ? 'wait' : 'pointer',
                          opacity: translating && !isActive ? 0.6 : 1,
                        }}
                      >
                        {isLoading ? '…' : lang.label}
                      </button>
                    )
                  })}
                </div>
                {/* In-flight indicator — sits under the row while a
                    translation is being fetched. Original answer above
                    stays visible behind it. */}
                {translating && selectedLang !== 'en' && (
                  <div style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: C.amber,
                    textAlign: 'center',
                    fontStyle: 'italic',
                  }}>
                    Translating to {(LANGUAGE_OPTIONS.find(l => l.code === selectedLang) || {}).name || selectedLang}…
                  </div>
                )}
              </div>
            )}

            {/* Save button for the main response. Per spec: small + subtle
                (textMuted colour), appears under every AI answer; on save
                flashes "✅ Saved to your research notes" for 2 seconds
                then disappears. Compare-mode notes use the OTHER stock's
                symbol so the user finds the saved note under that ticker
                in /research-notes. */}
            {response && userId && (() => {
              const noteKey = `main:${selectedCategory}`
              const noteCategory =
                selectedCategory === 'compare' && compareTargetSymbol
                  ? `compare:${compareTargetSymbol}`
                  : selectedCategory
              const saveSymbol = selectedCategory === 'compare' && compareTargetSymbol
                ? compareTargetSymbol
                : symbol
              const saveName = selectedCategory === 'compare' && compareTargetSymbol
                ? `${symbol} vs ${compareTargetSymbol}`
                : companyName
              const justSaved = recentlySavedKey === noteKey
              const alreadySaved = savedKeys.has(noteKey)
              if (alreadySaved && !justSaved) return null
              return (
                <div style={{ marginTop: 12 }}>
                  {justSaved ? (
                    <span style={{
                      fontSize: 11, color: C.green,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      ✅ Saved to your research notes
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSaveNote({
                        noteKey,
                        category: noteCategory,
                        responseText: response,
                        displaySymbol: saveSymbol,
                        displayName: saveName,
                      })}
                      disabled={savingKey === noteKey}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        color: C.textMuted,
                        fontSize: 11,
                        cursor: savingKey === noteKey ? 'wait' : 'pointer',
                        textDecoration: 'underline',
                        textUnderlineOffset: 2,
                      }}
                    >
                      {savingKey === noteKey ? 'Saving…' : '💾 Save this insight'}
                    </button>
                  )}
                </div>
              )
            })()}

            {/* Follow-up history */}
            {followHistory.map((turn, i) => {
              const followKey = `follow:${i}:${selectedCategory}`
              const followCategory =
                selectedCategory === 'compare' && compareTargetSymbol
                  ? `compare:${compareTargetSymbol}_followup`
                  : `${selectedCategory}_followup`
              const followSymbol = selectedCategory === 'compare' && compareTargetSymbol
                ? compareTargetSymbol
                : symbol
              const followName = selectedCategory === 'compare' && compareTargetSymbol
                ? `${symbol} vs ${compareTargetSymbol}`
                : companyName
              const followJustSaved = recentlySavedKey === followKey
              const followAlreadySaved = savedKeys.has(followKey)
              return (
                <div key={i} style={{
                  marginTop: 16, paddingTop: 16,
                  borderTop: `1px solid ${C.border}`,
                }}>
                  <div style={{
                    fontSize: 13, color: C.amber, fontWeight: 700, marginBottom: 6,
                  }}>
                    ↳ {turn.question}
                  </div>
                  <div style={{
                    color: C.text,
                    fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                    fontSize: '0.95rem', lineHeight: 1.8,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {turn.answer}
                  </div>
                  {userId && !(followAlreadySaved && !followJustSaved) && (
                    <div style={{ marginTop: 8 }}>
                      {followJustSaved ? (
                        <span style={{
                          fontSize: 11, color: C.green,
                        }}>
                          ✅ Saved to your research notes
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSaveNote({
                            noteKey: followKey,
                            category: followCategory,
                            responseText: turn.answer,
                            displaySymbol: followSymbol,
                            displayName: followName,
                          })}
                          disabled={savingKey === followKey}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            color: C.textMuted,
                            fontSize: 11,
                            cursor: savingKey === followKey ? 'wait' : 'pointer',
                            textDecoration: 'underline',
                            textUnderlineOffset: 2,
                          }}
                        >
                          {savingKey === followKey ? 'Saving…' : '💾 Save this insight'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Error */}
            {error && (
              <div style={{
                marginTop: response ? 14 : 0,
                padding: '12px 14px',
                background: 'rgba(248,113,113,0.10)',
                border: `1px solid ${C.redBorder}`,
                borderRadius: 8,
                color: C.red, fontSize: 13, lineHeight: 1.55,
              }}>
                {error}
              </div>
            )}

            {/* Follow-up input — fades in after the initial response */}
            {response && !loading && !error && !missingMsg && (
              <motion.form
                onSubmit={handleFollowUp}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.4 }}
                style={{
                  marginTop: 16, display: 'flex', gap: 8,
                }}
              >
                <input
                  value={followInput}
                  onChange={(e) => setFollowInput(e.target.value)}
                  placeholder="Ask a follow-up…"
                  disabled={followBusy}
                  style={{
                    flex: 1, padding: '10px 12px',
                    background: 'var(--bg-input)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8, color: C.text,
                    fontSize: 13, outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={followBusy || !followInput.trim()}
                  style={{
                    padding: '10px 16px',
                    background: followBusy || !followInput.trim()
                      ? 'var(--bg-elevated)' : C.amber,
                    color: followBusy || !followInput.trim() ? C.textMuted : '#000',
                    border: 'none', borderRadius: 8,
                    fontSize: 13, fontWeight: 700,
                    cursor: followBusy || !followInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {followBusy ? '…' : '→'}
                </button>
              </motion.form>
            )}

            {/* Footer */}
            <div style={{
              marginTop: 14, paddingTop: 12,
              borderTop: `1px solid ${C.border}`,
              fontSize: 10, color: C.textMuted, textAlign: 'center',
              lineHeight: 1.55, fontStyle: 'italic',
            }}>
              Powered by your Gemini key · Not PineX analysis · Not investment advice
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trading consent modal */}
      <AnimatePresence>
        {showConsent && (
          <ConsentModal
            onCancel={() => setShowConsent(false)}
            onConfirm={handleConsentConfirm}
            symbol={symbol}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Prompt builders ────────────────────────────────────────────────────
// Each returns { prompt, systemOverride }. `prompt` becomes the user
// message — Gemini sees the values literally, no recall needed.

function buildPrompt(catKey, dataPack, ctx) {
  const {
    symbol, companyName, sector, phase, criteriaScore, daysInPhase,
    sectorBreadth, narrative, pctFromMA, userQuestion,
  } = ctx
  const sName = companyName || symbol || 'this stock'

  // ── PROSE PROMPT REWRITE ───────────────────────────────────────────
  // Numbered list instructions cause Gemini to write longer responses
  // that overflow the token budget mid-sentence. Prose instructions
  // ("write 3-4 sentences explaining…") keep answers compact and
  // complete. Each builder below targets ~120 words of flowing text.

  // company_overview is the exception: it asks for a 400-500-word
  // structured profile across seven named sections. Returns its own
  // generationOpts (maxOutputTokens 1500, temperature 0.5) so the
  // longer answer fits and the lower temperature keeps it factual.
  if (catKey === 'company_overview') {
    const dir = pctFromMA == null ? 'unknown' : (Number(pctFromMA) > 0 ? 'above' : 'below')
    const pctAbs = pctFromMA != null ? Math.abs(Number(pctFromMA)).toFixed(1) : 'N/A'

    // When fetchCategoryData returned a stored profile from the
    // company_overview table, inject those facts into the system
    // prompt as authoritative ground truth. Gemini's job becomes
    // "explain these facts in the structured sections", NOT
    // "synthesise a profile from training data" — drastically more
    // reliable + current. When the table has no row for this stock
    // the OVERVIEW_FACTS block is empty and Gemini falls back to
    // its prior behaviour.
    const ov = (dataPack && dataPack.overview) || null
    const overviewFactsBlock = ov ? (
`STORED COMPANY FACTS — use these verbatim, do not contradict:
${ov.about           ? `About: ${ov.about}\n`                                 : ''}` +
`${ov.business_model  ? `Business model: ${ov.business_model}\n`              : ''}` +
`${ov.products_brands ? `Products / brands: ${ov.products_brands}\n`          : ''}` +
`${ov.founded_year    ? `Founded: ${ov.founded_year}\n`                       : ''}` +
`${ov.headquarters    ? `Headquarters: ${ov.headquarters}\n`                  : ''}` +
`${ov.employee_count  ? `Employees: ${ov.employee_count}\n`                   : ''}` +
`${ov.promoter_names  ? `Promoters: ${ov.promoter_names}\n`                   : ''}` +
`\n`
    ) : ''
    const overviewSystem =
`You are writing a detailed company profile for an Indian retail trader using PineX cycle analysis platform.

COMPANY: ${companyName || symbol} (${symbol})
SECTOR: ${sector || 'Unknown'}
CYCLE PHASE: ${phase || 'Unknown'}
CRITERIA: ${criteriaScore != null ? criteriaScore : 'N/A'}/5
DAYS IN PHASE: ${daysInPhase != null ? daysInPhase : 'N/A'}
SECTOR BREADTH: ${sectorBreadth != null ? sectorBreadth : 'N/A'}%
VS TREND LINE: ${pctAbs}% ${dir}

${overviewFactsBlock}DATA SOURCES — what to use where:
- Use the PineX cycle data above for the CYCLE ANALYSIS section.
- For ABOUT, PRODUCTS & BRANDS, BUSINESS MODEL, COMPETITIVE POSITION,
  and MANAGEMENT sections: use your general knowledge about this
  company freely. You are a financial educator explaining a public
  listed company; this is public information.
- For FINANCIAL PROFILE: use the STORED COMPANY FACTS block above
  when present; otherwise fall back to your general knowledge.
- If you don't know specific details about this company, say so
  briefly and move on — don't dwell on it.
${ov ? '- When STORED COMPANY FACTS are provided above, treat them as authoritative and do not contradict them.\n' : ''}
Write a detailed profile with these exact sections and headings:

**ABOUT**
What the company does. Industry. Scale. When founded. 2-3 sentences.

**PRODUCTS & BRANDS**
Main products or services. Key brands if any. 2-3 sentences.

**BUSINESS MODEL**
How they make money. Distribution. Online/offline split. Revenue model. 2-3 sentences.

**COMPETITIVE POSITION**
Market position. Key advantage. Main competitors. 2-3 sentences.

**MANAGEMENT**
Key leadership. Promoter background. 1-2 sentences.

**FINANCIAL PROFILE**
Company size (large/mid/small cap). Growth story. Profitability. Any known challenges. 2-3 sentences.

**CYCLE ANALYSIS**
Connect their business fundamentals to their current cycle position. Does the technical picture match the fundamental story? 2-3 sentences.

Write 400-500 words total. Plain English throughout. End with exactly this line:
Not investment advice. Consult a SEBI registered adviser.`
    // The user-turn prompt is intentionally short — all the substance
    // lives in the system instruction above, which Gemini treats as
    // the authoritative spec.
    const prompt = `Profile for ${companyName || symbol} (${symbol}).`
    return {
      prompt,
      systemOverride: overviewSystem,
      // 3000 not 1500: the seven structured sections with bold
      // headings + section bodies tokenise denser than a free-form
      // 400-word answer. At 1500 the response was hitting MAX_TOKENS
      // mid-sentence (visible as the "Response was long…" tail).
      generationOpts: { maxOutputTokens: 3000, temperature: 0.5, topP: 0.9 },
    }
  }

  if (catKey === 'valuation') {
    const v = (dataPack && dataPack.companies) || {}
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n` +
      `Sector: ${sector || 'Unknown'}\n\n` +
      `VALUATION DATA FROM PINEX:\n` +
      `Market Cap: ${v.market_cap != null ? `Rs. ${Number(v.market_cap).toLocaleString('en-IN')} cr` : 'not in PineX'}\n` +
      `P/E Ratio: ${v.pe_ratio  != null ? v.pe_ratio  : 'not in PineX'}\n` +
      `P/B Ratio: ${v.pb_ratio  != null ? v.pb_ratio  : 'not in PineX'}\n` +
      `D/E Ratio: ${v.de_ratio  != null ? v.de_ratio  : 'not in PineX'}\n` +
      `Current Ratio: ${v.current_ratio != null ? v.current_ratio : 'not in PineX'}\n` +
      `ROE: ${v.roe  != null ? `${v.roe}%`  : 'not in PineX'}\n` +
      `ROCE: ${v.roce != null ? `${v.roce}%` : 'not in PineX'}\n\n` +
      `Write 3-4 sentences explaining what these valuation numbers tell ` +
      `a retail trader about this stock. Focus on the most interesting ` +
      `data points. If any value is missing say so briefly. Do not use ` +
      `numbered lists. Write as flowing sentences. Maximum 120 words total.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'growth') {
    const rows = (dataPack && dataPack.financials) || []
    const newest = rows[0] || {}
    const yearAgo = rows[3] || {}
    const revGrowth = (newest.revenue != null && yearAgo.revenue && yearAgo.revenue !== 0)
      ? (((newest.revenue - yearAgo.revenue) / yearAgo.revenue) * 100).toFixed(1)
      : null
    const patGrowth = (newest.pat != null && yearAgo.pat && yearAgo.pat !== 0)
      ? (((newest.pat - yearAgo.pat) / yearAgo.pat) * 100).toFixed(1)
      : null
    const quartersBlock = rows.length
      ? rows.map((q) => (
          `${q.quarter || '—'}: revenue ${q.revenue ?? 'N/A'}, ` +
          `PAT ${q.pat ?? 'N/A'}, ` +
          `EPS ${q.eps ?? 'N/A'}, ` +
          `op margin ${q.operating_margin != null ? `${q.operating_margin}%` : 'N/A'}`
        )).join('\n')
      : 'No quarterly rows available.'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n\n` +
      `QUARTERLY FINANCIAL DATA FROM PINEX (newest first):\n${quartersBlock}\n\n` +
      `Revenue trend: ${revGrowth != null ? `${revGrowth}%` : 'not calculable'} year-on-year\n` +
      `PAT trend: ${patGrowth != null ? `${patGrowth}%` : 'not calculable'} year-on-year\n\n` +
      `Write 3-4 sentences explaining the growth picture for a retail ` +
      `trader. Cover whether revenue and profit are accelerating or ` +
      `slowing, what the margin trend shows, and what stands out. If ` +
      `fewer than 4 quarters are available say so briefly. Do not use ` +
      `numbered lists. Write as flowing sentences. Maximum 120 words total.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'shareholding') {
    const rows = (dataPack && dataPack.shareholding) || []
    const block = rows.length
      ? rows.map((q) => (
          `${q.quarter || '—'}: promoter ${q.promoter_pct ?? 'N/A'}%, ` +
          `pledge ${q.promoter_pledge_pct ?? 0}%, ` +
          `FII ${q.fii_pct ?? 'N/A'}%, ` +
          `DII ${q.dii_pct ?? 'N/A'}%, ` +
          `public ${q.public_pct ?? 'N/A'}%`
        )).join('\n')
      : 'No shareholding rows available.'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n\n` +
      `SHAREHOLDING DATA FROM PINEX (newest first):\n${block}\n\n` +
      `Write 3-4 sentences explaining the shareholding picture for a ` +
      `retail trader. Cover the direction of promoter holding, FII and ` +
      `DII activity, and whether the promoter pledge level is a concern. ` +
      `Do not use numbered lists. Write as flowing sentences. ` +
      `Maximum 120 words total.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'quarterly') {
    // Read raw yfinance rows. Each row carries the wider column set
    // (revenue / gross_profit / operating_income / net_income / ebitda)
    // — figures are absolute rupees so we format to crore.
    const yfRows = (dataPack && dataPack.yfQuarters) || []

    // ── Local helpers (kept inline so this branch is self-contained) ─
    // formatCr — yfinance returns absolute rupees; divide by 10^7 for
    // crore. We pick precision based on magnitude: ≥ 100 Cr reads
    // cleaner without decimals, smaller numbers keep a single
    // decimal so a ₹4.2 Cr row doesn't round to 0.
    const formatCr = (n) => {
      if (n == null) return 'N/A'
      const v = Number(n)
      if (!Number.isFinite(v)) return 'N/A'
      const cr = v / 1e7
      if (Math.abs(cr) >= 100) return `${cr.toFixed(0)} Cr`
      if (Math.abs(cr) >= 10)  return `${cr.toFixed(1)} Cr`
      return `${cr.toFixed(2)} Cr`
    }
    // calcYoY — newest (index 0) vs 4 quarters ago (index 3) on the
    // chosen field. Falls back to 'not calculable' on missing /
    // zero divisor / fewer than 4 rows.
    const calcYoY = (rows, key) => {
      if (!Array.isArray(rows) || rows.length < 4) return 'not calculable'
      const newest = rows[0]?.[key]
      const yearAgo = rows[3]?.[key]
      if (newest == null || yearAgo == null) return 'not calculable'
      const ya = Number(yearAgo)
      if (!Number.isFinite(ya) || ya === 0) return 'not calculable'
      return `${(((Number(newest) - ya) / ya) * 100).toFixed(1)}%`
    }

    const quarterBlock = yfRows.length
      ? yfRows.map((q) => (
          `${q.quarter_end || '—'}:\n` +
          `  Revenue:          ${formatCr(q.revenue)}\n` +
          `  Net Income:       ${formatCr(q.net_income)}\n` +
          `  Operating Income: ${formatCr(q.operating_income)}\n` +
          `  EBITDA:           ${formatCr(q.ebitda)}`
        )).join('\n\n')
      : 'No quarterly rows available.'

    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n` +
      `Sector: ${sector || 'Unknown'}\n\n` +
      `QUARTERLY FINANCIALS (last 4 quarters)\n` +
      `Source: Public financial data\n\n` +
      `${quarterBlock}\n\n` +
      `YoY Revenue growth:    ${calcYoY(yfRows, 'revenue')}\n` +
      `YoY Net Income growth: ${calcYoY(yfRows, 'net_income')}\n\n` +
      `Explain in plain English: was the most recent quarter strong ` +
      `or weak? Is the trend improving? What stands out most? Under ` +
      `150 words. Not investment advice.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'cycle') {
    const dir = pctFromMA == null ? 'unknown' : (Number(pctFromMA) > 0 ? 'above' : 'below')
    const pctAbs = pctFromMA != null ? Math.abs(Number(pctFromMA)).toFixed(1) : 'N/A'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n` +
      `Sector: ${sector || 'Unknown'}\n\n` +
      `PINEX CYCLE DATA:\n` +
      `Phase: ${phase || 'Unknown'}\n` +
      `Criteria met: ${criteriaScore != null ? criteriaScore : 'N/A'} out of 5\n` +
      `Days in this phase: ${daysInPhase != null ? daysInPhase : 'N/A'}\n` +
      `Position vs 30W trend line: ${pctAbs}% ${dir}\n` +
      `Sector breadth: ${sectorBreadth != null ? `${sectorBreadth}%` : 'N/A'}\n` +
      `PineX description: "${narrative || '—'}"\n\n` +
      `Write 3-4 sentences explaining what this cycle position means ` +
      `for a retail trader. Cover what the phase means, what the ` +
      `criteria score tells us, and what would need to change for the ` +
      `phase to shift. Plain English. No jargon. Do not use numbered ` +
      `lists. Write as flowing sentences. Maximum 120 words total.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'trading') {
    const dir = pctFromMA == null ? 'unknown' : (Number(pctFromMA) > 0 ? 'above' : 'below')
    const pctAbs = pctFromMA != null ? Math.abs(Number(pctFromMA)).toFixed(1) : 'N/A'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n` +
      `Phase: ${phase || 'Unknown'}\n` +
      `Criteria: ${criteriaScore != null ? criteriaScore : 'N/A'}/5\n` +
      `Days in phase: ${daysInPhase != null ? daysInPhase : 'N/A'}\n` +
      `Distance from 30W trend line: ${pctAbs}% ${dir}\n\n` +
      `The user has consented to receive educational methodology content.\n\n` +
      `Write 3-4 sentences explaining: what the 30W trend line represents ` +
      `as a reference in cycle analysis, what this distance from it means ` +
      `in methodology terms, and what criteria changes would signal the ` +
      `phase is weakening. Do not use numbered lists. Do not give ` +
      `specific prices or rupee amounts. Write as flowing sentences. ` +
      `Maximum 120 words total.`
    return { prompt, systemOverride: SYSTEM + '\n' + TRADING_EXTRA }
  }

  if (catKey === 'freetext') {
    const q = userQuestion || `Tell me what I should look at first for ${sName}.`
    const dir = pctFromMA == null ? '' : (Number(pctFromMA) > 0 ? 'Above' : 'Below')
    const pctAbs = pctFromMA != null ? Math.abs(Number(pctFromMA)).toFixed(1) : 'N/A'
    // Free-text uses the more permissive FREETEXT_SYSTEM so the model
    // can answer "who is the CEO of HONASA?" / "what does Mamaearth
    // sell?" / "explain the D2C model" — research questions whose
    // answers live in Gemini's general knowledge, not the PineX
    // context. SEBI guardrails still apply (no buy/sell/targets).
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n` +
      `Sector: ${sector || 'Unknown'}\n` +
      `Phase: ${phase || 'Unknown'}\n` +
      `Criteria: ${criteriaScore != null ? criteriaScore : 'N/A'}/5\n` +
      `Days in phase: ${daysInPhase != null ? daysInPhase : 'N/A'}\n` +
      `Sector breadth: ${sectorBreadth != null ? `${sectorBreadth}%` : 'N/A'}\n` +
      (pctFromMA != null ? `${dir} trend line by ${pctAbs}%\n` : '') +
      `\n` +
      `User's question: "${q}"\n\n` +
      `Answer the question. Use the PineX context above for data-related ` +
      `aspects; use your general knowledge for company / management / ` +
      `product / history aspects. Aim for 300-500 words — thorough but ` +
      `not padded. Start with the actual answer, not a preamble.`
    return { prompt, systemOverride: FREETEXT_SYSTEM }
  }

  return { prompt: null, systemOverride: SYSTEM }
}

// ── No-key teaser ───────────────────────────────────────────────────────
function NoKeyTeaser() {
  return (
    <div style={{
      marginTop: 28,
      background: C.surface,
      border: `1px solid ${C.amberBorder}`,
      borderLeft: `4px solid ${C.amber}`,
      borderRadius: 12,
      padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>🔬</span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: C.amber,
        }}>
          Research Assistant
        </span>
      </div>
      <p style={{ fontSize: 14, color: C.text, margin: '0 0 6px' }}>
        Add your Gemini key in Settings to unlock AI research.
      </p>
      <p style={{
        fontSize: 13, color: C.textMuted,
        margin: '0 0 14px', lineHeight: 1.6,
        fontFamily: 'Newsreader, ui-serif, Georgia, serif',
      }}>
        Seven research categories — valuation, growth, shareholding, quarterly
        results, cycle position deep-dive, trading framework, and free-text.
        Your key stays on this device — PineX never sees it.
      </p>
      <Link to="/account#research" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '8px 16px',
        background: C.amber, color: '#000',
        border: 'none', borderRadius: 8,
        fontSize: 13, fontWeight: 700, textDecoration: 'none',
      }}>
        Go to Settings →
      </Link>
    </div>
  )
}

// ── Consent modal ───────────────────────────────────────────────────────
function ConsentModal({ onCancel, onConfirm, symbol }) {
  const [agreed, setAgreed] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460,
          background: C.surface,
          border: `1px solid ${C.amberBorder}`,
          borderRadius: 16,
          padding: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
            Trading Framework — Read Before Continuing
          </h3>
        </div>

        <p style={{
          fontSize: 13, color: C.text, lineHeight: 1.6, margin: '0 0 12px',
          fontFamily: 'Newsreader, ui-serif, Georgia, serif',
        }}>
          You are about to ask your AI assistant about <strong>trading framework
          methodology</strong> for {symbol || 'this stock'}.
        </p>
        <ul style={{
          margin: '0 0 14px', paddingLeft: 18,
          fontSize: 12, color: C.textMuted, lineHeight: 1.7,
        }}>
          <li>The assistant explains <strong>concepts and methodology</strong>, not specific prices.</li>
          <li>It will never give a buy or sell price.</li>
          <li>It will never give a specific stop-loss or target in Rupees.</li>
          <li>What you read is <strong>not investment advice</strong>.</li>
          <li>For real positions, consult a SEBI-registered investment adviser.</li>
        </ul>

        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 12px',
          background: 'var(--bg-elevated)',
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          cursor: 'pointer',
          marginBottom: 14,
        }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: 2, accentColor: C.amber }}
          />
          <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
            I understand this is educational methodology only — not investment
            advice — and I will consult a SEBI-registered adviser before any
            trading decision.
          </span>
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={onCancel}
            style={{
              flex: 1, padding: '10px 0',
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.text,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={!agreed}
            style={{
              flex: 1, padding: '10px 0',
              background: agreed ? C.amber : 'var(--bg-elevated)',
              color: agreed ? '#000' : C.textMuted,
              border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: agreed ? 'pointer' : 'not-allowed',
            }}>
            Continue
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
