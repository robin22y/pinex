import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { awardPoints } from '../lib/pointsAwarder'
import {
  askGemini,
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
2. Plain simple English always. Maximum 200 words. Short sentences.
3. Never give buy/sell advice. Never give price targets.
   Never give specific stop-loss prices.
4. Always end with exactly this line:
   "Not investment advice. Consult a SEBI registered adviser."
5. If multiple data fields are null, say "Some data is not available
   in PineX for this stock" and explain what IS available.
6. Indian context always. Mention Indian market norms where relevant.`

const TRADING_EXTRA = `
TRADING FRAMEWORK SPECIFIC RULES:
The user has explicitly consented to receive educational reference content
about cycle-analysis trading methodology. Explain methodology concepts only.
NEVER give a specific price, NEVER give Rs. amounts for stop loss or target,
ONLY explain methodology in general terms using percentages and the data
provided as context.`

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
      //    system_instruction. Response is returned as text.
      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        prompt,
        { symbol, companyName, phase, sector, narrative },
        {
          systemPromptOverride: systemOverride,
          maxOutputTokens: catKey === 'trading' ? 500 : 400,
        },
      )

      // eslint-disable-next-line no-console
      console.log('[Research] Response (first 100):', text?.substring(0, 100))

      setResponse(text)
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
      const isTrading = selectedCategory === 'trading'
      const sharedSys =
        SYSTEM +
        (isTrading ? `\n${TRADING_EXTRA}` : '') +
        `\n\nAnswer the follow-up grounded in the prior context. Be concise.`

      const history = []
      if (response) history.push({ role: 'model', text: response })
      for (const turn of followHistory) {
        history.push({ role: 'user',  text: turn.question })
        history.push({ role: 'model', text: turn.answer })
      }

      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        q,
        { symbol, companyName, phase, sector, narrative },
        { systemPromptOverride: sharedSys, history, maxOutputTokens: 300 },
      )

      setFollowHistory((prev) => [...prev, { question: q, answer: text }])
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

  if (catKey === 'valuation') {
    const v = (dataPack && dataPack.companies) || {}
    const lines = [
      `Stock: ${symbol} — ${companyName || ''}`,
      `Sector: ${sector || 'Unknown'}`,
      ``,
      `VALUATION DATA FROM PINEX:`,
      `Market Cap: ${v.market_cap != null ? `Rs. ${Number(v.market_cap).toLocaleString('en-IN')} cr` : 'not available'}`,
      `P/E Ratio: ${v.pe_ratio  != null ? v.pe_ratio  : 'not available'}`,
      `P/B Ratio: ${v.pb_ratio  != null ? v.pb_ratio  : 'not available'}`,
      `D/E Ratio: ${v.de_ratio  != null ? v.de_ratio  : 'not available'}`,
      `Current Ratio: ${v.current_ratio != null ? v.current_ratio : 'not available'}`,
      `ROE: ${v.roe  != null ? `${v.roe}%`  : 'not available'}`,
      `ROCE: ${v.roce != null ? `${v.roce}%` : 'not available'}`,
      ``,
      `Using ONLY the data above:`,
      `1. What does the P/E tell us about how the market is pricing this stock?`,
      `2. What does the D/E ratio suggest about the company's debt level?`,
      `3. Is the ROE strong or weak for an Indian company in this sector?`,
      `4. What stands out most from these numbers?`,
      ``,
      `Explain each point in 1-2 sentences. If a value is "not available" say so and skip that point.`,
    ]
    return { prompt: lines.join('\n'), systemOverride: SYSTEM }
  }

  if (catKey === 'growth') {
    const rows = (dataPack && dataPack.financials) || []
    const newest = rows[0] || {}
    const yearAgo = rows[3] || {} // 4 quarters back
    const revGrowth = (newest.revenue != null && yearAgo.revenue && yearAgo.revenue !== 0)
      ? (((newest.revenue - yearAgo.revenue) / yearAgo.revenue) * 100).toFixed(1)
      : null
    const patGrowth = (newest.pat != null && yearAgo.pat && yearAgo.pat !== 0)
      ? (((newest.pat - yearAgo.pat) / yearAgo.pat) * 100).toFixed(1)
      : null
    const quartersBlock = rows.length
      ? rows.map((q) => (
          `${q.quarter || '—'}:\n` +
          `   Revenue: ${q.revenue != null ? q.revenue : 'N/A'}\n` +
          `   PAT: ${q.pat != null ? q.pat : 'N/A'}\n` +
          `   EPS: ${q.eps != null ? q.eps : 'N/A'}\n` +
          `   Operating Margin: ${q.operating_margin != null ? `${q.operating_margin}%` : 'N/A'}`
        )).join('\n\n')
      : 'No quarterly rows available.'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n\n` +
      `QUARTERLY FINANCIAL DATA FROM PINEX:\n${quartersBlock}\n\n` +
      `Revenue trend: ${revGrowth != null ? `${revGrowth}%` : 'not calculable'} year-on-year\n` +
      `PAT trend: ${patGrowth != null ? `${patGrowth}%` : 'not calculable'} year-on-year\n\n` +
      `Using ONLY the data above:\n` +
      `1. Is revenue growing or shrinking? By how much?\n` +
      `2. Is profit (PAT) growing faster or slower than revenue?\n` +
      `3. What does the EPS trend show?\n` +
      `4. Is operating margin improving?\n\n` +
      `If less than 4 quarters are available work with what is there and note it.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'shareholding') {
    const rows = (dataPack && dataPack.shareholding) || []
    const block = rows.length
      ? rows.map((q) => (
          `${q.quarter || '—'}:\n` +
          `   Promoter: ${q.promoter_pct != null ? `${q.promoter_pct}%` : 'N/A'}\n` +
          `   Promoter Pledge: ${q.promoter_pledge_pct != null ? `${q.promoter_pledge_pct}%` : '0%'}\n` +
          `   FII: ${q.fii_pct != null ? `${q.fii_pct}%` : 'N/A'}\n` +
          `   DII: ${q.dii_pct != null ? `${q.dii_pct}%` : 'N/A'}\n` +
          `   Public: ${q.public_pct != null ? `${q.public_pct}%` : 'N/A'}`
        )).join('\n\n')
      : 'No shareholding rows available.'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n\n` +
      `SHAREHOLDING DATA FROM PINEX:\n${block}\n\n` +
      `Using ONLY the data above:\n` +
      `1. Is promoter holding increasing or decreasing? What does this suggest about management confidence?\n` +
      `2. What is the promoter pledge level? Is it a concern?\n` +
      `3. Are FIIs buying or selling? What does this suggest?\n` +
      `4. Are DIIs (mutual funds, insurance) increasing their stake?\n` +
      `5. What is the overall picture?\n\n` +
      `Keep each answer to 1-2 sentences.`
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
      `LATEST QUARTERLY RESULTS FROM PINEX:\n\n` +
      `Most recent quarter: ${newest.quarter || '—'}\n` +
      `Revenue: ${newest.revenue != null ? newest.revenue : 'N/A'}\n` +
      `PAT (profit after tax): ${newest.pat != null ? newest.pat : 'N/A'}\n` +
      `EPS: ${newest.eps != null ? newest.eps : 'N/A'}\n` +
      `Operating Margin: ${newest.operating_margin != null ? `${newest.operating_margin}%` : 'N/A'}\n\n` +
      `Year-on-year comparison:\n` +
      `Revenue: ${revYoy != null ? `${revYoy}% change` : 'not calculable'}\n` +
      `PAT: ${patYoy != null ? `${patYoy}% change` : 'not calculable'}\n\n` +
      `Using ONLY the data above:\n` +
      `1. Was this a good or disappointing quarter? In plain English.\n` +
      `2. What changed most year-on-year?\n` +
      `3. What does the margin trend say about the business?\n` +
      `4. What should a trader watch for in the next quarter?\n\n` +
      `Be direct and clear. Indian retail trader audience.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'cycle') {
    const dir = pctFromMA == null ? 'unknown' : (Number(pctFromMA) > 0 ? 'above' : 'below')
    const pctAbs = pctFromMA != null ? Math.abs(Number(pctFromMA)).toFixed(1) : 'N/A'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n` +
      `Sector: ${sector || 'Unknown'}\n\n` +
      `CYCLE ANALYSIS DATA FROM PINEX:\n` +
      `Current phase: ${phase || 'Unknown'}\n` +
      `Criteria met: ${criteriaScore != null ? criteriaScore : 'N/A'} out of 5\n` +
      `Days in this phase: ${daysInPhase != null ? daysInPhase : 'N/A'}\n` +
      `Position vs 30W trend line: ${pctAbs}% ${dir}\n` +
      `Sector breadth: ${sectorBreadth != null ? `${sectorBreadth}%` : 'N/A'} of sector stocks above trend\n\n` +
      `PineX description: "${narrative || '—'}"\n\n` +
      `Using ONLY the data above:\n` +
      `1. What does being in the ${phase || 'current'} phase mean for this stock? Explain in simple terms.\n` +
      `2. What does ${criteriaScore != null ? criteriaScore : 'this'}/5 criteria tell us?\n` +
      `3. The stock has been in this phase for ${daysInPhase != null ? daysInPhase : 'some'} days. Is that short, medium or long? What does duration mean in cycle analysis?\n` +
      `4. What would need to change for this stock to move to a different phase?\n\n` +
      `Teach the methodology — not a verdict.`
    return { prompt, systemOverride: SYSTEM }
  }

  if (catKey === 'trading') {
    const dir = pctFromMA == null ? 'unknown' : (Number(pctFromMA) > 0 ? 'above' : 'below')
    const pctAbs = pctFromMA != null ? Math.abs(Number(pctFromMA)).toFixed(1) : 'N/A'
    const prompt =
      `Stock: ${symbol} — ${companyName || ''}\n\n` +
      `CYCLE DATA FROM PINEX:\n` +
      `Phase: ${phase || 'Unknown'}\n` +
      `Criteria: ${criteriaScore != null ? criteriaScore : 'N/A'}/5\n` +
      `Days in phase: ${daysInPhase != null ? daysInPhase : 'N/A'}\n` +
      `Distance from 30W trend line: ${pctAbs}% ${dir}\n\n` +
      `The user has explicitly consented to receive educational reference content about trading methodology.\n\n` +
      `Using cycle analysis methodology concepts (educational only):\n` +
      `1. In cycle analysis what does the 30-week moving average represent as a reference level for traders using this methodology?\n` +
      `2. The stock is ${pctAbs}% ${dir} its 30W trend line. What does this distance mean in terms of cycle methodology? Is it early stage, extended, or somewhere in between?\n` +
      `3. Explain the concept of percentage-based position sizing as it applies to cycle analysis methodology — without giving specific amounts.\n` +
      `4. What criteria changes would suggest the current phase is weakening?\n\n` +
      `IMPORTANT: Do not give any specific price levels, rupee amounts, or percentages as targets or stoplosses. Only explain the methodology concepts using the data provided.`
    return { prompt, systemOverride: SYSTEM + '\n' + TRADING_EXTRA }
  }

  if (catKey === 'freetext') {
    const q = userQuestion || `Tell me what I should look at first for ${sName}.`
    const dir = pctFromMA == null ? '' : (Number(pctFromMA) > 0 ? 'Above' : 'Below')
    const pctAbs = pctFromMA != null ? Math.abs(Number(pctFromMA)).toFixed(1) : 'N/A'
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
      `Answer the question using the context above and your knowledge of cycle analysis methodology. ` +
      `Plain English. Under 150 words. Never give buy/sell advice.`
    return { prompt, systemOverride: SYSTEM }
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
