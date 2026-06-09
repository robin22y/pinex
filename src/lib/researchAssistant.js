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

// Google AI Studio now issues keys with two prefixes:
//   AIzaSy   — older Cloud-style key (still works)
//   AQ.      — newer AI-Studio-issued key
// Anything else is suspect but we don't block — Google may add more.
function looksLikeGeminiKey(k) {
  return k.startsWith('AIzaSy') || k.startsWith('AQ.')
}

export function saveGeminiKey(rawKey) {
  const key = String(rawKey || '').trim()
  if (!key) throw new Error('Empty key')
  if (!looksLikeGeminiKey(key)) {
    // Don't block — Google may add more prefixes — but flag for the user.
    // eslint-disable-next-line no-console
    console.warn('[researchAssistant] key prefix not recognised (expected AIzaSy or AQ.) — verify it was copied correctly')
  }
  try {
    localStorage.setItem(KEY_NAME, key)
    localStorage.setItem(SAVED_AT_NAME, new Date().toISOString())
    // Clear the logged flag so ensureKeyRegistered fires for the new
    // key on the next surface mount — even if the user replaced an
    // older logged key. logKeySaved is fire-and-forget so the duplicate
    // event from commitSave is harmless.
    localStorage.removeItem(KEY_LOGGED_FLAG)
  } catch (e) {
    throw new Error('Could not save to localStorage (private browsing?): ' + e.message)
  }
}

export function deleteGeminiKey() {
  try {
    localStorage.removeItem(KEY_NAME)
    localStorage.removeItem(SAVED_AT_NAME)
    localStorage.removeItem(KEY_LOGGED_FLAG)
  } catch {
    // ignore — already gone
  }
}

// Masking pattern for the "key is saved" display. Shows the first
// recognised prefix (3-6 chars depending on AIzaSy vs AQ.) + a
// fixed-width dot run. Never reveals any unique entropy.
export function maskKey(key) {
  if (!key) return ''
  const k = String(key)
  // AQ. keys are shorter at the front — preserve through the dot so
  // the user still sees the meaningful prefix.
  const prefixLen = k.startsWith('AQ.') ? 5 : 7
  if (k.length <= prefixLen) return k
  return k.slice(0, prefixLen) + '•'.repeat(20)
}

// Validation feedback for the input — used by the Settings UI to show
// inline errors as the user types/pastes.
//
// Accepts both Gemini key prefixes:
//   AIzaSy   — older Cloud-style key
//   AQ.      — newer AI-Studio-issued key (rolling out from 2026)
export function validateKey(rawKey) {
  const k = String(rawKey || '').trim()
  if (!k) return { ok: false, error: '' }   // empty = no error yet
  if (k.length < 30) {
    return {
      ok: false,
      error: 'This looks too short for a Gemini key. Paste the full key from aistudio.google.com.',
    }
  }
  if (!looksLikeGeminiKey(k)) {
    return {
      ok: false,
      error: 'Unrecognised prefix. Gemini keys start with AIzaSy or AQ. — verify you copied the full key from aistudio.google.com.',
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
//   onChunk                OPTIONAL — when provided, switches to the
//                          streamGenerateContent SSE endpoint and calls
//                          onChunk(accumulatedText) every time a new
//                          token arrives. The returned text is the
//                          fully-accumulated answer (same shape as
//                          non-streaming). Callers that want a
//                          word-by-word UI pass setResponse-style
//                          callbacks; everything else keeps the
//                          original behaviour unchanged.
export async function askGemini(question, context, opts = {}) {
  const key = getStoredGeminiKey()
  if (!key) throw new Error('No Gemini key saved on this device.')

  const systemPrompt = opts.systemPromptOverride || buildSystemPrompt(context || {})
  const useStream = typeof opts.onChunk === 'function'

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
  // Endpoint switches on whether the caller wants SSE chunks. Non-
  // streaming endpoint returns one JSON blob; streaming endpoint
  // returns text/event-stream framed JSON chunks. Both accept the
  // same request body shape.
  const endpoint = useStream
    ? `streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`
    : `generateContent?key=${encodeURIComponent(key)}`
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}`

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
  // thinkingConfig (Gemini 2.5 family) — controls the hidden reasoning
  // budget. Default on 2.5 Flash is dynamic (-1) which can quietly
  // consume HUNDREDS-to-THOUSANDS of tokens BEFORE any visible text is
  // emitted, eating maxOutputTokens. Symptom: the response cuts off
  // partway with finishReason=MAX_TOKENS even though the visible prose
  // is short. Categories that don't need reasoning (structured retrieval
  // like company_overview) should pass thinkingConfig: { thinkingBudget: 0 }
  // to disable thinking entirely. Categories that benefit from
  // reasoning (cycle deep-dive) can leave it default. Older Gemini
  // models silently ignore this field.
  if (opts.thinkingConfig) {
    generationConfig.thinkingConfig = opts.thinkingConfig
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

  // ── Streaming branch ─────────────────────────────────────────────────
  // SSE format: each event is `data: <json>\n\n`. Each json chunk has
  // the same shape as the non-streaming response but only a partial
  // text fragment. Usage metadata + finishReason land on the last
  // chunk. We accumulate text + call opts.onChunk(accumulated) every
  // time a new fragment arrives so the UI can render word-by-word.
  if (useStream) {
    if (!res.body || !res.body.getReader) {
      // Edge runtime / fetch polyfill without a readable stream — fall
      // through to JSON parse. Extremely rare; modern browsers ship
      // ReadableStream natively.
      const data = await res.json().catch(() => ({}))
      const cand = data?.candidates?.[0]
      const text = cand?.content?.parts?.[0]?.text?.trim() || ''
      if (text) opts.onChunk(text)
      return {
        text,
        usage: data?.usageMetadata || {},
        finishReason: cand?.finishReason || 'UNKNOWN',
        responseTimeMs,
      }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let accumulated = ''
    let usage = {}
    let finishReason = 'UNKNOWN'

    // Parse one SSE event (the text between two blank-line separators).
    // An event may contain multiple `data:` lines; each is its own JSON
    // payload. Trailing \r stripped so CRLF-normalized streams parse
    // the same as LF-only.
    const processEvent = (event) => {
      for (const rawLine of event.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let json
        try { json = JSON.parse(payload) } catch { continue }
        const cand = json?.candidates?.[0]
        const partial = cand?.content?.parts?.[0]?.text
        if (partial) {
          accumulated += partial
          try { opts.onChunk(accumulated) } catch { /* UI callback failure shouldn't kill the stream */ }
        }
        if (cand?.finishReason) finishReason = cand.finishReason
        if (json?.usageMetadata) usage = json.usageMetadata
      }
    }

    // Find the next event boundary, preferring LF (\n\n) but also
    // recognising CRLF (\r\n\r\n) which some proxies inject. Returns
    // -1 / 0 when no complete event is buffered yet.
    const nextBoundary = (buf) => {
      const lf = buf.indexOf('\n\n')
      const crlf = buf.indexOf('\r\n\r\n')
      if (lf === -1 && crlf === -1) return { idx: -1, skip: 0 }
      if (lf === -1)                 return { idx: crlf, skip: 4 }
      if (crlf === -1)               return { idx: lf, skip: 2 }
      return lf < crlf ? { idx: lf, skip: 2 } : { idx: crlf, skip: 4 }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const { idx, skip } = nextBoundary(buffer)
        if (idx === -1) break
        processEvent(buffer.slice(0, idx))
        buffer = buffer.slice(idx + skip)
      }
    }
    // Drain the trailing event. Google sometimes closes the stream
    // with a final `data: {...}\n` (single newline + EOF) instead of
    // the canonical `\n\n` separator — without this drain the last
    // chunk's text was lost, leaving accumulated='' and the user got
    // "Empty response from Gemini" → "Could not get a response" in
    // the panel. The bug only showed for short answers that fit in a
    // single SSE event.
    if (buffer.trim()) processEvent(buffer)

    const text = accumulated.trim()
    // SAFETY-blocked stream: finishReason=SAFETY, no text. Same shape
    // as the non-streaming SAFETY path below.
    if (!text) {
      if (finishReason === 'SAFETY') {
        const err = new Error('Your AI assistant flagged this response. Try rephrasing your question or ask about a different aspect.')
        err.code = 'SAFETY'
        err.finishReason = finishReason
        err.usage = usage
        err.responseTimeMs = Date.now() - startTime
        throw err
      }
      throw new Error('Empty response from Gemini.')
    }
    return { text, usage, finishReason, responseTimeMs: Date.now() - startTime }
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
    const apiError = errBody?.error || {}
    // Surface as much of Google's response as possible so the Settings
    // UI can show the user what actually went wrong. status + code +
    // reasons[] often carry the most actionable hint (PERMISSION_DENIED,
    // API_KEY_INVALID, QUOTA_EXCEEDED, etc.).
    const parts = [apiError.message || `HTTP ${res.status}`]
    if (apiError.status) parts.push(`(${apiError.status})`)
    const reasons = (apiError.details || [])
      .map((d) => d.reason || d['@type'])
      .filter(Boolean)
    if (reasons.length) parts.push(`[${reasons.join(', ')}]`)
    const err = new Error(parts.join(' '))
    err.apiStatus = apiError.status || null
    err.httpStatus = res.status
    err.raw = errBody
    throw err
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

// localStorage flag — set after logKeySaved fires successfully. Prevents
// duplicate events on every page mount via ensureKeyRegistered.
const KEY_LOGGED_FLAG = 'pinex_gemini_key_logged'

// ── ensureKeyRegistered ─────────────────────────────────────────────────
// Backfill helper for users who saved their Gemini key BEFORE the
// logKeySaved telemetry shipped (commit 8bcd662). Their key sits in
// localStorage with no matching research_key_saved audit event, so the
// admin Research Assistant funnel shows 0 registered users even though
// real users have keys.
//
// On mount of any Research Assistant surface (Account settings, the
// 7-tile menu, the home AI panel), call this. It:
//   1. Checks localStorage for a saved key
//   2. Checks if we've already logged it (pinex_gemini_key_logged flag)
//   3. If key exists but not logged, fires logKeySaved + sets the flag
// Idempotent — runs once per browser per key.
//
// The flag is keyed on the key value's existence, not the key itself
// (we never store the key in any analytics path). Re-saving a new key
// invalidates the flag (saveGeminiKey clears it below) so the new
// registration is logged.
export async function ensureKeyRegistered(userId) {
  if (!userId) return
  let alreadyLogged = false
  let hasKey = false
  try {
    hasKey = Boolean(localStorage.getItem(KEY_NAME))
    alreadyLogged = localStorage.getItem(KEY_LOGGED_FLAG) === '1'
  } catch {
    return
  }
  if (!hasKey || alreadyLogged) return
  await logKeySaved({ userId })
  try { localStorage.setItem(KEY_LOGGED_FLAG, '1') } catch {}
}

// ── Key-save logging — fires the moment a user passes verifyKey() and
// commits the key to localStorage. Separate event_type so admins can
// measure the funnel:
//   registered  = distinct user_ids with event_type='research_key_saved'
//   active      = distinct user_ids with event_type='research_question_asked'
//   activation% = active / registered
// The key itself is NEVER in the payload — only the registration event.
// A user who deletes + re-adds a key produces multiple rows, so admin
// queries should use DISTINCT user_id for the registered count.
export async function logKeySaved({ userId }) {
  try {
    await supabase.from('usage_events').insert({
      event_type: 'research_key_saved',
      user_id: userId || null,
      metadata: {
        user_id: userId || null,
        provider: 'gemini',
        verified: true,            // verifyKey() succeeded before this call
        timestamp: new Date().toISOString(),
      },
    })
  } catch {
    // Non-fatal — funnel logging shouldn't block the save flow.
  }
}

// ── saveResearchNote ────────────────────────────────────────────────────
// Persist an AI response to research_notes when the user clicks 💾.
//
// PRIVACY: the standing "PineX never sees your answer" promise covers the
// Gemini round-trip itself (made client-side to Google with the user's
// own key, PineX servers are never in the loop). research_notes is an
// opt-in archive — rows only land here when the user explicitly clicks
// save on a specific response. RLS scopes reads/writes to the owner.
//
// We do NOT log to usage_events for saves — the analytics promise
// ("question text never logged, answer text never logged") would be
// silently broken if a save event piggybacked the response text into
// metadata. If we ever want save-funnel telemetry we'd add a separate
// event_type with a count only — no text.
//
// Returns { ok, error } so callers can flip the toast without inspecting
// the supabase client error shape.
export async function saveResearchNote({
  userId,
  symbol,
  companyName,
  category,
  responseText,
}) {
  if (!userId || !symbol || !category || !responseText) {
    return { ok: false, error: 'Missing required fields' }
  }
  try {
    const { error } = await supabase.from('research_notes').insert({
      user_id: userId,
      symbol: String(symbol).toUpperCase().slice(0, 64),
      company_name: companyName ? String(companyName).slice(0, 200) : null,
      category: String(category).slice(0, 40),
      response_text: String(responseText),
    })
    if (error) return { ok: false, error: error.message || 'Save failed' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'Save failed' }
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
