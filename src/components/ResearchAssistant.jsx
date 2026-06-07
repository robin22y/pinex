import { useState } from 'react'
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
// The 7-category research menu mounted at the bottom of StockDetail.
// Each tile fetches a different slice of PineX data on tap, builds an
// appropriate system prompt, and calls the user's own Gemini key.
//
// Render contract:
//   - no key  → teaser with deep-link to /account#research
//   - has key → 7-tile grid, plus the response panel below when active
//
// Privacy posture identical to ResearchPanel: question + answer text
// stays on-device, only telemetry (tokens / latency / finish_reason /
// cost estimate) is logged via logResearchUsage.

const CATEGORIES = [
  {
    key: 'valuation',
    emoji: '📊',
    title: 'Valuation Metrics',
    desc: 'P/E, P/B, Market Cap, D/E',
  },
  {
    key: 'growth',
    emoji: '📈',
    title: 'Growth & Momentum',
    desc: 'Revenue trend, EPS, PEG, P/S',
  },
  {
    key: 'shareholding',
    emoji: '👥',
    title: 'Shareholding Pattern',
    desc: 'Promoter, FII, DII trends',
  },
  {
    key: 'quarterly',
    emoji: '📋',
    title: 'Quarterly Results',
    desc: 'Revenue, PAT, margins analysis',
  },
  {
    key: 'cycle',
    emoji: '🔄',
    title: 'Cycle Position Deep Dive',
    desc: 'What this phase means in depth',
  },
  {
    key: 'trading',
    emoji: '🎯',
    title: 'Trading Framework',
    desc: 'Reference ranges, methodology',
    isTrading: true,
  },
  {
    key: 'freetext',
    emoji: '✍️',
    title: 'Ask Anything',
    desc: 'Your own question',
  },
]

const SHARED_RULES = `You are a personal research assistant for an Indian retail
trader using PineX. Plain simple English. Under 200 words. Never give specific
buy or sell prices. Never give specific stop-loss prices. Describe methodology
and context. End every response with:
"Not investment advice. Consult a SEBI registered adviser."`

const TRADING_EXTRA_RULES = `This user has explicitly requested educational
information about trading methodology frameworks. They have acknowledged this
is not investment advice.

Explain the 30W moving average as a reference methodology.
Explain percentage-based risk as a methodology concept.
NEVER give a specific price.
NEVER give Rs. amounts for stop loss or target.
Only explain the methodology in general terms using percentages and the data
provided as context.`

const FRIENDLY_ERRORS = {
  network:
    'Could not reach your AI assistant. Check your key is valid at aistudio.google.com',
}

// ── Per-category context builders ───────────────────────────────────────
// Each returns { systemPrompt, contextText }. The system prompt becomes
// Gemini's system_instruction; the contextText is what we put in front
// of the user's auto-generated question for the category.

function buildValuationContext({ symbol, companyName, sector, valuation }) {
  const v = valuation || {}
  const lines = [
    `Stock: ${symbol || '—'}`,
    `Company: ${companyName || '—'}`,
    `Sector: ${sector || 'Unknown'}`,
    v.market_cap     != null ? `Market cap: Rs. ${Number(v.market_cap).toLocaleString('en-IN')} cr` : null,
    v.pe_ratio       != null ? `P/E: ${v.pe_ratio}` : null,
    v.pb_ratio       != null ? `P/B: ${v.pb_ratio}` : null,
    v.de_ratio       != null ? `Debt/Equity: ${v.de_ratio}` : null,
    v.current_ratio  != null ? `Current ratio: ${v.current_ratio}` : null,
    v.roe            != null ? `ROE: ${v.roe}%` : null,
    v.roce           != null ? `ROCE: ${v.roce}%` : null,
  ].filter(Boolean)
  const systemPrompt = `${SHARED_RULES}

You are explaining valuation metrics for the following Indian stock.
Use the data provided to describe what each metric means in plain language
and how it compares to typical ranges. Do not give buy/sell advice.`
  return {
    systemPrompt,
    contextText: lines.join('\n'),
    autoQuestion:
      `Explain the valuation metrics for ${companyName || symbol}. What does each metric tell me about this company?`,
  }
}

function buildGrowthContext({ symbol, companyName, financialsRows }) {
  const rows = financialsRows || []
  const quarters = rows.slice(0, 4).map((r) => {
    return [
      r.quarter_name || r.quarter || '—',
      r.revenue          != null ? `revenue ${r.revenue}` : null,
      r.pat              != null ? `PAT ${r.pat}` : null,
      r.eps              != null ? `EPS ${r.eps}` : null,
      r.operating_margin != null ? `op margin ${r.operating_margin}%` : null,
    ].filter(Boolean).join(', ')
  })
  const systemPrompt = `${SHARED_RULES}

You are analysing the revenue and earnings trend for an Indian stock.
Describe the growth trajectory using the four most recent quarters.
Mention whether revenue, PAT, or margins are expanding, flat, or contracting.
Do not recommend buying or selling.`
  return {
    systemPrompt,
    contextText:
      `Stock: ${symbol || '—'}\nCompany: ${companyName || '—'}\n` +
      (quarters.length
        ? `Last quarters (newest first):\n${quarters.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`
        : `Quarterly financials are not available for this stock.`),
    autoQuestion:
      `Walk me through the revenue, PAT, and margin trend for ${companyName || symbol}. Is growth accelerating or slowing?`,
  }
}

function buildShareholdingContext({ symbol, companyName, shareholdingRows }) {
  const rows = shareholdingRows || []
  const quarters = rows.slice(0, 4).map((r) => {
    return [
      r.quarter_name || r.quarter || '—',
      r.promoter_pct != null ? `promoter ${r.promoter_pct}%` : null,
      r.fii_pct      != null ? `FII ${r.fii_pct}%` : null,
      r.dii_pct      != null ? `DII ${r.dii_pct}%` : null,
      r.public_pct   != null ? `public ${r.public_pct}%` : null,
    ].filter(Boolean).join(', ')
  })
  const systemPrompt = `${SHARED_RULES}

You are explaining the shareholding pattern of an Indian stock.
Describe how promoter, FII, DII, and public holdings have shifted over the
recent quarters. Mention what rising or falling institutional ownership
typically signals. Do not recommend buying or selling.`
  return {
    systemPrompt,
    contextText:
      `Stock: ${symbol || '—'}\nCompany: ${companyName || '—'}\n` +
      (quarters.length
        ? `Shareholding (newest first):\n${quarters.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`
        : `Shareholding data is not available for this stock.`),
    autoQuestion:
      `How has institutional ownership of ${companyName || symbol} changed over the last four quarters?`,
  }
}

function buildQuarterlyContext({ symbol, companyName, financialsRows }) {
  const rows = financialsRows || []
  const quarters = rows.slice(0, 4).map((r) => {
    return [
      r.quarter_name || r.quarter || '—',
      r.revenue          != null ? `revenue ${r.revenue}` : null,
      r.pat              != null ? `PAT ${r.pat}` : null,
      r.operating_margin != null ? `op margin ${r.operating_margin}%` : null,
    ].filter(Boolean).join(', ')
  })
  const systemPrompt = `${SHARED_RULES}

You are summarising the most recent quarterly result and its quarter-on-quarter
context for an Indian stock. Highlight which line items moved the most and
suggest one or two follow-up questions a researcher should think about.`
  return {
    systemPrompt,
    contextText:
      `Stock: ${symbol || '—'}\nCompany: ${companyName || '—'}\n` +
      (quarters.length
        ? `Last quarters (newest first):\n${quarters.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`
        : `Quarterly results are not available for this stock.`),
    autoQuestion:
      `Summarise the most recent quarterly result for ${companyName || symbol}. What stands out compared to prior quarters?`,
  }
}

function buildCycleContext({
  symbol, companyName, phase, criteriaScore,
  daysInPhase, sector, sectorBreadth, narrative,
}) {
  const lines = [
    `Stock: ${symbol || '—'}`,
    `Company: ${companyName || '—'}`,
    `Sector: ${sector || 'Unknown'}`,
    `Phase: ${phase || 'Unknown'}`,
    criteriaScore != null ? `Criteria score: ${criteriaScore}/5` : null,
    daysInPhase   != null ? `Days in phase: ${daysInPhase}` : null,
    sectorBreadth != null ? `Sector breadth: ${sectorBreadth}%` : null,
    narrative     ? `PineX narrative: ${narrative}` : null,
  ].filter(Boolean)
  const systemPrompt = `${SHARED_RULES}

You are explaining cycle analysis in depth. Walk the user through what their
stock's current Weinstein-style phase means, what the criteria score implies
about confluence, and how time-in-phase changes interpretation. Tie it back to
the sector context. Do not predict price moves.`
  return {
    systemPrompt,
    contextText: lines.join('\n'),
    autoQuestion:
      `Explain in depth what ${phase || 'this phase'} means for ${companyName || symbol}, factoring in the criteria score and days-in-phase.`,
  }
}

function buildTradingContext({
  symbol, companyName, phase, sector, pctFromMA, narrative,
}) {
  const lines = [
    `Stock: ${symbol || '—'}`,
    `Company: ${companyName || '—'}`,
    `Sector: ${sector || 'Unknown'}`,
    `Phase: ${phase || 'Unknown'}`,
    pctFromMA != null ? `Distance from 30W MA: ${Number(pctFromMA).toFixed(1)}%` : null,
    narrative ? `PineX narrative: ${narrative}` : null,
  ].filter(Boolean)
  const systemPrompt = `${SHARED_RULES}

${TRADING_EXTRA_RULES}`
  return {
    systemPrompt,
    contextText: lines.join('\n'),
    autoQuestion:
      `Explain the trading framework methodology relevant to ${companyName || symbol}. How would percentage-based risk and the 30W MA be used as reference concepts here? Do not give any specific price.`,
  }
}

function buildFreetextContext({
  symbol, companyName, phase, criteriaScore, daysInPhase, sector, sectorBreadth, narrative,
}) {
  const lines = [
    `Stock: ${symbol || '—'}`,
    `Company: ${companyName || '—'}`,
    `Sector: ${sector || 'Unknown'}`,
    `Phase: ${phase || 'Unknown'}`,
    criteriaScore != null ? `Criteria: ${criteriaScore}/5` : null,
    daysInPhase   != null ? `Days in phase: ${daysInPhase}` : null,
    sectorBreadth != null ? `Sector breadth: ${sectorBreadth}%` : null,
    narrative     ? `Narrative: ${narrative}` : null,
  ].filter(Boolean)
  const systemPrompt = `${SHARED_RULES}

Answer the user's question grounded in the stock context below. If the
question cannot be answered with the data provided, say so and suggest what
the user should look at next.`
  return {
    systemPrompt,
    contextText: lines.join('\n'),
    autoQuestion: null, // user types their own
  }
}

// ── Defensive lazy fetchers ──────────────────────────────────────────────
// Each table may or may not exist in the live DB. We catch every fetch
// so a missing table just yields null and the prompt builder gracefully
// reports "data not available" instead of crashing the component.

async function fetchValuation(symbol) {
  const fields = 'market_cap,pe_ratio,pb_ratio,de_ratio,current_ratio,roe,roce'
  try {
    const { data } = await supabase
      .from('companies')
      .select(fields)
      .eq('symbol', symbol)
      .limit(1)
      .maybeSingle()
    return data || null
  } catch {
    return null
  }
}

async function fetchFinancials(symbol) {
  try {
    const { data } = await supabase
      .from('financials')
      .select('quarter_name,revenue,pat,eps,operating_margin')
      .eq('symbol', symbol)
      .order('quarter_name', { ascending: false })
      .limit(4)
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

async function fetchShareholding(symbol) {
  try {
    const { data } = await supabase
      .from('shareholding')
      .select('quarter_name,promoter_pct,fii_pct,dii_pct,public_pct')
      .eq('symbol', symbol)
      .order('quarter_name', { ascending: false })
      .limit(4)
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

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
  // Re-read on every render rather than memoize — the user may have
  // saved a key in another tab and we want this to reflect immediately
  // when the user re-mounts the panel.
  const hasKey = Boolean(getStoredGeminiKey())

  const [selectedCategory, setSelectedCategory] = useState(null) // category key or null
  const [response, setResponse]                 = useState('')
  const [loading,  setLoading]                  = useState(false)
  const [error,    setError]                    = useState('')
  const [refused,  setRefused]                  = useState(false)
  const [showConsent, setShowConsent]           = useState(false)
  const [followInput, setFollowInput]           = useState('')
  const [followBusy,  setFollowBusy]            = useState(false)
  const [followHistory, setFollowHistory]       = useState([]) // [{question, answer}, ...]
  // freetext input only — surfaces when user picks the ✍️ tile
  const [freeInput, setFreeInput] = useState('')

  // ── No-key teaser ──────────────────────────────────────────────────────
  if (!hasKey) {
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

  // ── Helpers ────────────────────────────────────────────────────────────
  // Per-tile data fetch + askGemini call. Trading routes through the
  // consent modal first.
  function handleTileClick(catKey) {
    if (catKey === 'trading') {
      setShowConsent(true)
      return
    }
    runCategory(catKey)
  }

  async function runCategory(catKey, opts = {}) {
    setSelectedCategory(catKey)
    setResponse('')
    setError('')
    setRefused(false)
    setLoading(true)
    setFollowHistory([])
    setFollowInput('')

    const cat = CATEGORIES.find((c) => c.key === catKey)
    if (!cat) { setLoading(false); return }

    try {
      // Build the per-category context. Some categories need to fetch
      // extra rows; do that here so we hit Supabase only on demand.
      let ctxBuilder = buildFreetextContext
      let extraFetch = null
      if (catKey === 'valuation') {
        extraFetch = async () => ({ valuation: await fetchValuation(symbol) })
        ctxBuilder = buildValuationContext
      } else if (catKey === 'growth') {
        extraFetch = async () => ({ financialsRows: await fetchFinancials(symbol) })
        ctxBuilder = buildGrowthContext
      } else if (catKey === 'shareholding') {
        extraFetch = async () => ({ shareholdingRows: await fetchShareholding(symbol) })
        ctxBuilder = buildShareholdingContext
      } else if (catKey === 'quarterly') {
        extraFetch = async () => ({ financialsRows: await fetchFinancials(symbol) })
        ctxBuilder = buildQuarterlyContext
      } else if (catKey === 'cycle') {
        ctxBuilder = buildCycleContext
      } else if (catKey === 'trading') {
        ctxBuilder = buildTradingContext
      } else {
        ctxBuilder = buildFreetextContext
      }

      const extra = extraFetch ? await extraFetch() : {}
      const baseProps = {
        symbol, companyName, phase, criteriaScore, daysInPhase,
        sector, sectorBreadth, narrative, pctFromMA,
      }
      const { systemPrompt, contextText, autoQuestion } = ctxBuilder({
        ...baseProps, ...extra,
      })

      // Determine the question to ask. autoQuestion is the canned prompt
      // for everything except freetext; freetext requires the user to
      // type something via opts.userQuestion.
      const userQuestion = opts.userQuestion
        ? String(opts.userQuestion).trim()
        : autoQuestion
      if (!userQuestion) {
        setLoading(false)
        return
      }
      if (isBlockedQuestion(userQuestion)) {
        setRefused(true)
        setLoading(false)
        return
      }

      const fullQuestion = `Context:\n${contextText}\n\nQuestion: ${userQuestion}`

      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        userQuestion,
        baseProps,
        {
          systemPromptOverride: `${systemPrompt}\n\n--- STOCK CONTEXT ---\n${contextText}`,
          maxOutputTokens: catKey === 'trading' ? 500 : 400,
        },
      )

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
      if (e && e.code === 'SAFETY') {
        // Safety-blocked: log the event with finish_reason=SAFETY so
        // admins see it in the blocked count, then render the friendly
        // copy verbatim from the error message.
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
        setError(e?.message || FRIENDLY_ERRORS.network)
      }
      setLoading(false)
    }
  }

  // Follow-up call — reuses the previous category's context + appends
  // history so Gemini sees the conversation. Capped at the most recent
  // 4 turns to keep tokens bounded.
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
      const baseProps = {
        symbol, companyName, phase, criteriaScore, daysInPhase,
        sector, sectorBreadth, narrative, pctFromMA,
      }
      // Re-derive the same system prompt as the original category so
      // the persona stays consistent. The previous response is added
      // to history so Gemini can chain off it.
      const cat = CATEGORIES.find((c) => c.key === selectedCategory)
      const isTrading = selectedCategory === 'trading'

      const history = []
      if (response) {
        history.push({ role: 'model', text: response })
      }
      for (const turn of followHistory) {
        history.push({ role: 'user',  text: turn.question })
        history.push({ role: 'model', text: turn.answer })
      }

      const sharedSys = `${SHARED_RULES}${isTrading ? `\n\n${TRADING_EXTRA_RULES}` : ''}

Answer the follow-up grounded in the prior context. Be concise.`

      const { text, usage, finishReason, responseTimeMs } = await askGemini(
        q,
        baseProps,
        {
          systemPromptOverride: sharedSys,
          history,
          maxOutputTokens: 300,
        },
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
        setError(err?.message || FRIENDLY_ERRORS.network)
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
          const isActive = selectedCategory === cat.key
          const isTrading = cat.isTrading
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => handleTileClick(cat.key)}
              style={{
                textAlign: 'left',
                padding: 16,
                background: isActive ? 'rgba(245,159,11,0.08)' : C.surface,
                border: `1px solid ${
                  isActive
                    ? C.amber
                    : isTrading
                      ? C.amberBorder
                      : C.border
                }`,
                borderRadius: 12,
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 6,
                minHeight: 88,
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = `${C.amber}55`
                  e.currentTarget.style.background = 'var(--bg-elevated)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = isTrading ? C.amberBorder : C.border
                  e.currentTarget.style.background  = C.surface
                }
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 8,
              }}>
                <span style={{ fontSize: 24 }}>{cat.emoji}</span>
                {isTrading && (
                  <span title="Trading framework requires consent"
                    style={{ fontSize: 14, color: C.amber }}>⚠️</span>
                )}
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

      {/* Freetext input — surfaces below the grid when ✍️ tile picked */}
      {selectedCategory === 'freetext' && !response && !loading && !refused && (
        <div style={{ marginTop: 12 }}>
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
              resize: 'vertical', minHeight: 70, outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => runCategory('freetext', { userQuestion: freeInput })}
            disabled={!freeInput.trim()}
            style={{
              marginTop: 8,
              padding: '8px 18px',
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

      {/* Response panel — opens below the grid for any active category */}
      <AnimatePresence>
        {selectedCategory && (loading || response || refused || error) && (
          <motion.div
            key={`response-${selectedCategory}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              marginTop: 12,
              background: C.surface,
              borderLeft: `3px solid ${C.amber}`,
              borderRadius: '0 12px 12px 0',
              padding: '16px 18px',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 10,
            }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: C.text,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>{activeCat?.emoji}</span>
                <span>{activeCat?.title}</span>
              </div>
              <button
                type="button" onClick={closePanel} aria-label="Close"
                style={{
                  background: 'transparent', border: 'none',
                  color: C.textMuted, cursor: 'pointer',
                  fontSize: 18, padding: 0, lineHeight: 1,
                }}
              >×</button>
            </div>

            {/* Loading state */}
            {loading && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                color: C.textMuted, fontSize: 12,
                fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                fontStyle: 'italic',
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
                <span style={{ marginLeft: 4 }}>Your analyst is thinking…</span>
              </div>
            )}

            {/* Refusal */}
            {refused && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(245,159,11,0.08)',
                border: `1px solid ${C.amberBorder}`,
                borderRadius: 8,
                color: C.amber, fontSize: 13, lineHeight: 1.55,
                fontFamily: 'Newsreader, ui-serif, Georgia, serif',
              }}>
                {REFUSAL_TEXT}
              </div>
            )}

            {/* Response text */}
            {response && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                style={{
                  color: C.text,
                  fontSize: '0.9rem', lineHeight: 1.7,
                  fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {response}
              </motion.div>
            )}

            {/* Follow-up history */}
            {followHistory.map((turn, i) => (
              <div key={i} style={{
                marginTop: 12, paddingTop: 12,
                borderTop: `1px solid ${C.border}`,
              }}>
                <div style={{
                  fontSize: 12, color: C.amber, fontWeight: 700, marginBottom: 4,
                }}>
                  ↳ {turn.question}
                </div>
                <div style={{
                  color: C.text, fontSize: '0.9rem', lineHeight: 1.7,
                  fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                  whiteSpace: 'pre-wrap',
                }}>
                  {turn.answer}
                </div>
              </div>
            ))}

            {/* Error */}
            {error && (
              <div style={{
                marginTop: 12,
                padding: '10px 12px',
                background: 'rgba(248,113,113,0.10)',
                border: `1px solid ${C.redBorder}`,
                borderRadius: 8,
                color: C.red, fontSize: 12, lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            {/* Follow-up input — appears with fade-in after the initial
                response loads. Disabled while a follow-up is in flight. */}
            {response && !loading && !error && (
              <motion.form
                onSubmit={handleFollowUp}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.4 }}
                style={{
                  marginTop: 12, display: 'flex', gap: 8,
                }}
              >
                <input
                  value={followInput}
                  onChange={(e) => setFollowInput(e.target.value)}
                  placeholder="Ask a follow-up…"
                  disabled={followBusy}
                  style={{
                    flex: 1, padding: '8px 10px',
                    background: 'var(--bg-input)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8, color: C.text,
                    fontSize: 12, outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={followBusy || !followInput.trim()}
                  style={{
                    padding: '8px 14px',
                    background: followBusy || !followInput.trim()
                      ? 'var(--bg-elevated)' : C.amber,
                    color: followBusy || !followInput.trim() ? C.textMuted : '#000',
                    border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 700,
                    cursor: followBusy || !followInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {followBusy ? '…' : '→'}
                </button>
              </motion.form>
            )}

            {/* Footer */}
            <div style={{
              marginTop: 12, paddingTop: 10,
              borderTop: `1px solid ${C.border}`,
              fontSize: 10, color: C.textMuted, textAlign: 'center',
              lineHeight: 1.55, fontStyle: 'italic',
            }}>
              Powered by your Gemini key · Not PineX analysis · Not investment advice
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trading-framework consent modal */}
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

// ── Consent modal ───────────────────────────────────────────────────────
// Full-screen overlay. Checkbox is required before Continue is enabled.
// Logs the consent event upstream (handleConsentConfirm) on confirm.
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
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <h3 style={{
            margin: 0, fontSize: 16, fontWeight: 700, color: C.text,
          }}>
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
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px 0',
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.text,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!agreed}
            style={{
              flex: 1, padding: '10px 0',
              background: agreed ? C.amber : 'var(--bg-elevated)',
              color: agreed ? '#000' : C.textMuted,
              border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: agreed ? 'pointer' : 'not-allowed',
            }}
          >
            Continue
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
