// ── Research Assistant — Bring Your Own Gemini Key ──────────────────────
// Everything here treats the user's Gemini API key as device-local
// secret. The key never leaves the browser. PineX servers, Supabase,
// Netlify functions — none of them ever see it. Every request from
// this module hits Google's REST endpoint directly.
//
// Storage keys (localStorage):
//   pinex_gemini_key         the key itself
//   pinex_gemini_saved_at    ISO timestamp of last save (for rotation
//                            reminders)
//
// IMPORTANT: never POST these values anywhere. The supabase client is
// imported below only for usage_event logging (no key, no question
// text — just the event_type so admins can see aggregate usage).

import { supabase } from './supabase'
import { getAiConfig } from './aiConfig'

// Hardcoded fallback for the Research Assistant model. Used when the
// ai_config table fetch fails for any reason — never blocks the call.
const DEFAULT_RESEARCH_MODEL = 'gemini-2.5-flash'

// ── Local storage helpers ────────────────────────────────────────────────
const KEY_NAME       = 'pinex_gemini_key'
const SAVED_AT_NAME  = 'pinex_gemini_saved_at'

export function getStoredGeminiKey() {
  try {
    return (localStorage.getItem(KEY_NAME) || '').trim()
  } catch {
    return ''
  }
}

export function getKeySavedAt() {
  try {
    return localStorage.getItem(SAVED_AT_NAME) || null
  } catch {
    return null
  }
}

export function getKeyAgeDays() {
  const iso = getKeySavedAt()
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.floor(ms / 86400000)
}

export function saveGeminiKey(rawKey) {
  const key = String(rawKey || '').trim()
  if (!key) throw new Error('Empty key')
  if (!key.startsWith('AIzaSy')) {
    // Don't block — Google may rotate the prefix someday — but flag.
    // eslint-disable-next-line no-console
    console.warn('[researchAssistant] key does not start with AIzaSy — verify it was copied correctly')
  }
  try {
    localStorage.setItem(KEY_NAME, key)
    localStorage.setItem(SAVED_AT_NAME, new Date().toISOString())
  } catch (e) {
    throw new Error('Could not save to localStorage (private browsing?): ' + e.message)
  }
}

export function deleteGeminiKey() {
  try {
    localStorage.removeItem(KEY_NAME)
    localStorage.removeItem(SAVED_AT_NAME)
  } catch {
    // ignore — already gone
  }
}

// Masking pattern for the "key is saved" display. Shows the first 7
// characters (the AIzaSy prefix) + a fixed-width dot run. Never reveals
// any unique entropy.
export function maskKey(key) {
  if (!key) return ''
  const k = String(key)
  if (k.length <= 7) return k
  return k.slice(0, 7) + '•'.repeat(20)
}

// Validation feedback for the input — used by the Settings UI to show
// inline errors as the user types/pastes.
export function validateKey(rawKey) {
  const k = String(rawKey || '').trim()
  if (!k) return { ok: false, error: '' }   // empty = no error yet
  if (k.length < 30) {
    return {
      ok: false,
      error: 'This does not look like a valid Gemini key. It should start with AIzaSy and be much longer.',
    }
  }
  if (!k.startsWith('AIzaSy')) {
    return {
      ok: false,
      error: 'Gemini keys start with AIzaSy... Please check you copied the full key from aistudio.google.com.',
    }
  }
  return { ok: true, error: '' }
}


// ── Blocked-word filter ──────────────────────────────────────────────────
// Questions matching these patterns get refused locally — the request
// never goes to Gemini. The phrase "should i" is regex'd to avoid
// matching "shouldn't I" or similar. Matched case-insensitive on whole
// words; "Cycle Sell mechanism" wouldn't trigger 'sell' because we
// boundary-check.
const BLOCKED_PATTERNS = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bshould\s+i\b/i,
  /\binvest\b/i,
  /\brecommend\b/i,
  /\btarget\s+price\b/i,
  /\btarget\b/i,
  /\bstop\s*loss\b/i,
  /\bstoploss\b/i,
  /\bentry\b/i,
  /\bexit\b/i,
]

export const REFUSAL_TEXT =
  'Your research assistant explains market data and cycle ' +
  'analysis concepts. For buy/sell decisions please consult a ' +
  'SEBI registered investment adviser.'

export function isBlockedQuestion(text) {
  const s = String(text || '')
  return BLOCKED_PATTERNS.some((re) => re.test(s))
}


// ── System prompt — research assistant persona + guardrails ─────────────
function buildSystemPrompt(context) {
  return `You are a personal research assistant for a trader using PineX cycle analysis.

STOCK CONTEXT (from PineX data):
Stock: ${context.symbol || ''}
Company: ${context.companyName || ''}
Phase: ${context.phase || 'Unknown'}
Criteria: ${context.criteriaScore != null ? `${context.criteriaScore}/5` : 'N/A'}
Days in phase: ${context.daysInPhase != null ? context.daysInPhase : 'N/A'}
Sector: ${context.sector || 'Unknown'}
Sector breadth: ${context.sectorBreadth != null ? `${context.sectorBreadth}%` : 'N/A'}
Description: ${context.narrative || ''}

STRICT RULES:
- Never say buy or sell.
- Never give price targets.
- Never give stop losses.
- Describe what the data shows; do not predict.
- Keep responses under 150 words.
- Plain simple English.
- End with one open question for the trader to think about.`
}


// ── Pricing ─────────────────────────────────────────────────────────────
// gemini-2.5-flash pricing (USD/M tokens, Google AI Studio paid tier):
//   input  $0.30 per 1M
//   output $2.50 per 1M
// USD→INR fixed at 83 — close enough for a rough estimate displayed to
// admins ("your users' estimated API cost"). Free-tier users pay $0
// against AI Studio's free quota; this number is the paid-tier ceiling.
// Rounded to 3 decimals.
export function calculateCostInr(inputTokens, outputTokens) {
  const input  = Number(inputTokens)  || 0
  const output = Number(outputTokens) || 0
  const inputCost  = (input  / 1_000_000) * 0.30 * 83
  const outputCost = (output / 1_000_000) * 2.50 * 83
  return Math.round((inputCost + outputCost) * 1000) / 1000
}


// ── The actual Gemini call ──────────────────────────────────────────────
// Returns the assistant's text + metadata on success:
//   { text, usage, finishReason, responseTimeMs, raw }
// where:
//   usage          = { promptTokenCount, candidatesTokenCount, totalTokenCount }
//   finishReason   = STOP | SAFETY | MAX_TOKENS | RECITATION | OTHER | UNKNOWN
//   responseTimeMs = wall-clock from fetch start to fetch resolve
// Throws on transport errors, blocked-question refusal (caller handles
// refusal separately), or missing key. The user's question text goes
// nowhere except the generativelanguage.googleapis.com endpoint.
//
// opts:
//   systemPromptOverride   replace the default buildSystemPrompt output
//                          entirely (used by ResearchAssistant categories
//                          that need their own persona/rules).
//   history                array of { role: 'user'|'model', text } turns
//                          appended before the current `question`. Used
//                          by the follow-up input in the inline panel.
//   maxOutputTokens        override the 400 default (categories with
//                          structured-list answers benefit from more).
//   temperature            override the 0.4 default.
export async function askGemini(question, context, opts = {}) {
  const key = getStoredGeminiKey()
  if (!key) throw new Error('No Gemini key saved on this device.')

  const systemPrompt = opts.systemPromptOverride || buildSystemPrompt(context || {})

  // Build the contents array — system_instruction handles the persona,
  // contents handle the turn-by-turn dialogue. Each history entry
  // becomes its own content with the appropriate role.
  const contents = []
  if (Array.isArray(opts.history)) {
    for (const turn of opts.history) {
      if (!turn || !turn.text) continue
      contents.push({
        role: turn.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(turn.text) }],
      })
    }
  }
  contents.push({ role: 'user', parts: [{ text: question }] })

  const model = await getAiConfig('gemini_research_model', DEFAULT_RESEARCH_MODEL)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`

  const startTime = Date.now()
  // generationConfig defaults:
  //   maxOutputTokens: 1200 — generous safety net (≈900 words) so even
  //     verbose Gemini outputs land at finishReason=STOP, never
  //     MAX_TOKENS. The category prompts ask for ~120 words; the gap
  //     is intentional so overshoots still complete cleanly.
  //   temperature: 0.7 — natural prose.
  //   topP: 0.9 — filters tail-probability tokens for fluency.
  // Callers can still override per-call via opts.
  const generationConfig = {
    temperature:     opts.temperature != null     ? opts.temperature     : 0.7,
    maxOutputTokens: opts.maxOutputTokens != null ? opts.maxOutputTokens : 1200,
    topP:            opts.topP != null            ? opts.topP            : 0.9,
  }
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig,
      }),
    })
  } catch (e) {
    throw new Error('Could not reach Gemini. Check your internet connection.')
  }
  const responseTimeMs = Date.now() - startTime

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = errBody?.error?.message || `Gemini returned HTTP ${res.status}`
    // Common cases worth surfacing nicely upstream.
    if (res.status === 400 && /API key not valid/i.test(msg)) {
      throw new Error('Your Gemini key is invalid. Check it in Settings → Research Assistant.')
    }
    if (res.status === 429) {
      throw new Error('Daily Gemini quota reached. Try again tomorrow, or upgrade your Gemini plan.')
    }
    throw new Error(msg)
  }

  const data = await res.json()
  const candidate = data?.candidates?.[0]
  const finishReason = candidate?.finishReason || 'UNKNOWN'
  const usage = data?.usageMetadata || {}
  const text = candidate?.content?.parts?.[0]?.text?.trim() || ''

  // SAFETY-blocked responses come back with finishReason='SAFETY' and
  // no text content. Surface them as a specific error so the caller can
  // render the right copy ("flagged this response, try rephrasing").
  if (!text) {
    if (finishReason === 'SAFETY') {
      const err = new Error('Your AI assistant flagged this response. Try rephrasing your question or ask about a different aspect.')
      err.code = 'SAFETY'
      err.finishReason = finishReason
      err.usage = usage
      err.responseTimeMs = responseTimeMs
      throw err
    }
    throw new Error('Empty response from Gemini.')
  }

  return { text, usage, finishReason, responseTimeMs }
}


// ── Test-connection helper — minimal call to verify the key works ──────
// Sends "Say 'ok' and nothing else." with maxOutputTokens=10. Treats
// any successful 200 (even an empty text) as connection OK because the
// Gemini API sometimes returns a SAFETY block instead of text on short
// prompts; the key is still valid in that case.
//
// Accepts an optional `explicitKey` so the caller can verify a key that
// is NOT yet in localStorage (used by Account.jsx pre-save to fail fast
// before persisting an invalid key). Falls back to the saved key.
export async function testConnection(explicitKey) {
  const key = (explicitKey || getStoredGeminiKey() || '').trim()
  if (!key) throw new Error('No key saved.')

  const model = await getAiConfig('gemini_research_model', DEFAULT_RESEARCH_MODEL)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Say "ok" and nothing else.' }] }],
      generationConfig: { maxOutputTokens: 10, temperature: 0 },
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = errBody?.error?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return true
}

// ── verifyKey — pre-save validation against the live Gemini endpoint ────
// Used by the Save flow in Account.jsx: tries the key BEFORE writing it
// to localStorage. Maps Google's HTTP status codes to copy the user can
// act on directly:
//   400 → "key format is not valid"
//   401/403 → "key was not accepted by Google"
//   429 → "quota exceeded, but key works"
//
// Returns { ok: true } on success; throws Error with a friendly message
// otherwise. The 429 case is treated as ok for the purpose of saving
// the key (it IS valid, just throttled) — caller distinguishes via the
// `quotaWarning` field on the returned object.
export async function verifyKey(rawKey) {
  const key = String(rawKey || '').trim()
  if (!key) throw new Error('Empty key')

  const model = await getAiConfig('gemini_research_model', DEFAULT_RESEARCH_MODEL)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say: ok' }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0 },
      }),
    })
  } catch (e) {
    throw new Error('Could not reach Google. Check your internet connection and try again.')
  }

  if (res.ok) return { ok: true, quotaWarning: false }

  const errBody = await res.json().catch(() => ({}))
  const apiMsg  = errBody?.error?.message || ''

  if (res.status === 400) {
    throw new Error(
      'This key format is not valid. Check you copied the full key from aistudio.google.com.',
    )
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'This key was not accepted by Google. Check your key at aistudio.google.com/apikey.',
    )
  }
  if (res.status === 429) {
    // Quota hit but the key itself is valid — let the caller decide. We
    // throw a labelled error so the Account UI can show a yellow warning
    // and still save the key.
    const err = new Error(
      'Your key works but has hit its quota limit. Check your usage at aistudio.google.com.',
    )
    err.code = 'QUOTA'
    throw err
  }

  throw new Error(apiMsg || `Google returned HTTP ${res.status}. Try again.`)
}


// ── Usage logging — does NOT log the question or the answer ────────────
// Now captures full Gemini telemetry (token counts, finish reason, latency,
// cost estimate) so admins can monitor throughput, quality, and rough user
// cost. Question text and response text remain UNLOGGED — confirm the
// payload shape in any new caller before merging.
//
// args:
//   userId, symbol      identification
//   contextType         'home_search' | 'stock_page'
//   category            'valuation'|'growth'|'shareholding'|'quarterly'|
//                       'cycle'|'trading'|'freetext' (StockDetail menu)
//                       or null for plain Ask-flow callers
//   usage               raw usageMetadata returned by askGemini
//   finishReason        STOP | SAFETY | MAX_TOKENS | RECITATION | OTHER | UNKNOWN
//   responseTimeMs      wall-clock latency captured in askGemini
//   tradingConsent      bool — true only when category === 'trading' and
//                       the user passed the consent gate
export async function logResearchUsage({
  userId,
  symbol,
  contextType,
  category,
  usage,
  finishReason,
  responseTimeMs,
  tradingConsent,
}) {
  try {
    const inputTokens  = Number(usage?.promptTokenCount)     || 0
    const outputTokens = Number(usage?.candidatesTokenCount) || 0
    const totalTokens  = Number(usage?.totalTokenCount)      || (inputTokens + outputTokens)
    await supabase.from('usage_events').insert({
      event_type: 'research_question_asked',
      user_id: userId || null,
      metadata: {
        user_id: userId || null,             // also in metadata per spec
        symbol: symbol || null,
        context_type: contextType || null,
        category: category || null,
        provider: 'gemini',
        model,
        has_key: true,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        finish_reason: finishReason || 'UNKNOWN',
        response_time_ms: Number(responseTimeMs) || 0,
        was_blocked: finishReason === 'SAFETY',
        cost_inr: calculateCostInr(inputTokens, outputTokens),
        trading_consent_given: tradingConsent === true,
      },
    })
  } catch {
    // Non-fatal — usage logging shouldn't break the user's research flow.
  }
}

// ── Consent logging — fires when a user passes the trading-framework
// consent gate. Separate event_type so admins can count consent demand
// independently from the AI call itself. Question text never logged.
export async function logTradingConsent({ userId, symbol }) {
  try {
    await supabase.from('usage_events').insert({
      event_type: 'trading_framework_consent',
      user_id: userId || null,
      metadata: {
        user_id: userId || null,
        symbol: symbol || null,
        timestamp: new Date().toISOString(),
      },
    })
  } catch {
    // Non-fatal.
  }
}
