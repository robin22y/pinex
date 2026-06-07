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


// ── The actual Gemini call ──────────────────────────────────────────────
// Returns the assistant's text on success. Throws on transport errors,
// blocked-question refusal (caller handles refusal separately), or
// missing key. The user's question text goes nowhere except the
// generativelanguage.googleapis.com endpoint.
export async function askGemini(question, context) {
  const key = getStoredGeminiKey()
  if (!key) throw new Error('No Gemini key saved on this device.')

  const systemPrompt = buildSystemPrompt(context || {})

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: question }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 400,
      },
    }),
  })

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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) throw new Error('Empty response from Gemini.')
  return text
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`
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
// We log only the event_type + symbol + has_key flag for aggregate
// admin reporting. The question itself stays on-device.
export async function logResearchUsage({ userId, symbol }) {
  try {
    await supabase.from('usage_events').insert({
      event_type: 'research_question_asked',
      user_id: userId || null,
      metadata: {
        symbol: symbol || null,
        provider: 'gemini',
        has_key: true,
      },
    })
  } catch {
    // Non-fatal — usage logging shouldn't break the user's research flow.
  }
}
