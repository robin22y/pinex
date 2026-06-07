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
  { key: 'valuation',    emoji: '📊', title: 'Valuation Metrics',     desc: 'P/E, P/B, Market Cap, D/E',          availability: 'needsValuation' },
  { key: 'growth',       emoji: '📈', title: 'Growth & Momentum',     desc: 'Revenue trend, EPS, PEG, P/S',       availability: 'needsFinancials' },
  { key: 'shareholding', emoji: '👥', title: 'Shareholding Pattern',  desc: 'Promoter, FII, DII trends',          availability: 'needsShareholding' },
  { key: 'quarterly',    emoji: '📋', title: 'Quarterly Results',     desc: 'Revenue, PAT, margins analysis',     availability: 'needsFinancials' },
  { key: 'cycle',        emoji: '🔄', title: 'Cycle Position Deep Dive', desc: 'What this phase means in depth', availability: 'always' },
  { key: 'trading',      emoji: '🎯', title: 'Trading Framework',     desc: 'Reference ranges, methodology',      availability: 'always', isTrading: true },
  { key: 'freetext',     emoji: '✍️', title: 'Ask Anything',          desc: 'Your own question',                  availability: 'always' },
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

  // ── Availability check on mount ──────────────────────────────────────
  useEffect(() => {
    if (!hasKey || !symbol) return
    let cancelled = false
    ;(async () => {
      try {
        // One companies query gets us the company_id + every valuation
        // field we care about. Defensive select string: if any of these
        // columns don't exist in this deployment's schema, PostgREST
        // throws and we fall through to "no valuation".
        let row = null
        try {
          const { data } = await supabase
            .from('companies')
            .select('id,market_cap,pe_ratio,pb_ratio,de_ratio,current_ratio,roe,roce')
            .eq('symbol', symbol)
            .limit(1)
            .maybeSingle()
          row = data || null
        } catch (e) {
          // Some columns missing — retry with the minimal set
          const { data } = await supabase
            .from('companies')
            .select('id,market_cap')
            .eq('symbol', symbol)
            .limit(1)
            .maybeSingle()
          row = data || null
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
    runCategory(cat.key)
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
      const { prompt, systemOverride } = buildPrompt(catKey, dataPack, {
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
      //    system_instruction. maxOutputTokens 1200 is a generous safety
      //    net — the prompt asks for ~120 words, so the gap is intentional.
      //    If we still hit MAX_TOKENS the response is appended with a
      //    follow-up hint so users never see a silent mid-sentence cut.
      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        prompt,
        { symbol, companyName, phase, sector, narrative },
        {
          systemPromptOverride: systemOverride,
          maxOutputTokens: 1200,
          temperature: 0.7,
          topP: 0.9,
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
  async function fetchCategoryData(catKey) {
    if (catKey === 'valuation') {
      // companiesRow is already populated by the mount-time availability
      // check. Surface the missing-data message if no useful fields.
      if (!availability.valuation) {
        return { __missing:
          `Valuation metrics for ${symbol} are not yet in PineX. ` +
          `The Cycle Position Deep Dive is available — try that instead.` }
      }
      return { companies: companiesRow || {} }
    }

    if (catKey === 'growth' || catKey === 'quarterly') {
      if (!availability.financials || !companyId) {
        return { __missing:
          `Quarterly financials for ${symbol} are not yet in PineX. ` +
          `PineX currently has data for the largest NSE stocks. ` +
          `Try: Cycle Position Deep Dive — always available.` }
      }
      try {
        const { data } = await supabase
          .from('financials')
          .select('quarter,revenue,pat,eps,operating_margin,pat_growth_qoq,pat_growth_yoy')
          .eq('company_id', companyId)
          .order('quarter', { ascending: false })
          .limit(4)
        return { financials: Array.isArray(data) ? data : [] }
      } catch {
        // Some columns missing — fall back to *
        const { data } = await supabase
          .from('financials')
          .select('*')
          .eq('company_id', companyId)
          .order('quarter', { ascending: false })
          .limit(4)
        return { financials: Array.isArray(data) ? data : [] }
      }
    }

    if (catKey === 'shareholding') {
      if (!availability.shareholding || !companyId) {
        return { __missing:
          `Shareholding data for ${symbol} is not yet in PineX. ` +
          `Try: Cycle Position Deep Dive — always available.` }
      }
      try {
        const { data } = await supabase
          .from('shareholding')
          .select('quarter,promoter_pct,promoter_pledge_pct,fii_pct,dii_pct,public_pct')
          .eq('company_id', companyId)
          .order('quarter', { ascending: false })
          .limit(4)
        return { shareholding: Array.isArray(data) ? data : [] }
      } catch {
        const { data } = await supabase
          .from('shareholding')
          .select('*')
          .eq('company_id', companyId)
          .order('quarter', { ascending: false })
          .limit(4)
        return { shareholding: Array.isArray(data) ? data : [] }
      }
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
  }

  const activeCat = selectedCategory
    ? CATEGORIES.find((c) => c.key === selectedCategory)
    : null

  return (
    <div style={{ marginTop: 28 }}>
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

            {/* Loading state */}
            {loading && (
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

            {/* Response text — Newsreader serif, no truncation */}
            {response && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                style={{
                  color: C.text,
                  fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                  fontSize: '0.95rem',
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {response}
              </motion.div>
            )}

            {/* Follow-up history */}
            {followHistory.map((turn, i) => (
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
              </div>
            ))}

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
    const rows = (dataPack && dataPack.financials) || []
    const newest = rows[0] || {}
    const yearAgo = rows[3] || {}
    const revYoy = (newest.revenue != null && yearAgo.revenue && yearAgo.revenue !== 0)
      ? (((newest.revenue - yearAgo.revenue) / yearAgo.revenue) * 100).toFixed(1)
      : null
    const patYoy = newest.pat_growth_yoy != null
      ? newest.pat_growth_yoy
      : (newest.pat != null && yearAgo.pat && yearAgo.pat !== 0
          ? (((newest.pat - yearAgo.pat) / yearAgo.pat) * 100).toFixed(1)
          : null)
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n\n` +
      `LATEST QUARTERLY RESULTS FROM PINEX:\n` +
      `Most recent quarter: ${newest.quarter || '—'}\n` +
      `Revenue: ${newest.revenue ?? 'N/A'}\n` +
      `PAT (profit after tax): ${newest.pat ?? 'N/A'}\n` +
      `EPS: ${newest.eps ?? 'N/A'}\n` +
      `Operating Margin: ${newest.operating_margin != null ? `${newest.operating_margin}%` : 'N/A'}\n` +
      `Revenue YoY: ${revYoy != null ? `${revYoy}%` : 'not calculable'}\n` +
      `PAT YoY: ${patYoy != null ? `${patYoy}%` : 'not calculable'}\n\n` +
      `Write 3-4 sentences explaining whether this was a good or ` +
      `disappointing quarter for an Indian retail trader. Cover the ` +
      `biggest year-on-year change, what the margin trend says, and ` +
      `what to watch for next quarter. Do not use numbered lists. ` +
      `Write as flowing sentences. Maximum 120 words total.`
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
