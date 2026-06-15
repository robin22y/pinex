// iqjet-brief — Supabase Edge Function.
//
// Server-side Gemini caller for /iqjet-desk. Removes the BYOK pattern
// from the browser so GEMINI_API_KEY never leaves the server.
//
// Deploy:
//   supabase functions deploy iqjet-brief
//   supabase secrets set GEMINI_API_KEY=...your-key...
//
// Auth model:
//   - The Supabase Edge runtime auto-verifies the caller's JWT when
//     verify_jwt = true (the default). We additionally call
//     auth.getUser() to read the email and gate to robin22y@gmail.com
//     — defence in depth so a leaked JWT from another user can't burn
//     the admin's Gemini quota.
//
// Request body:
//   { context: object, systemPrompt: string, model?: string }
//
// Response (200):
//   { brief: string }
//
// Errors:
//   401 missing/invalid auth
//   403 not the admin
//   400 missing fields
//   500 misconfigured / Gemini error / empty response
//
// CORS is open because /iqjet-desk is served from the same origin as
// the rest of the app; the OPTIONS preflight is still needed when the
// frontend runs on a different host (e.g. localhost during dev).

// @ts-ignore - Deno std import (resolved at edge-runtime build time)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore - esm.sh import (resolved at edge-runtime build time)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const DEFAULT_MODEL = 'gemini-2.5-flash'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  try {
    // ── 1. Auth — verify JWT + admin email ─────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ error: 'Missing Authorization bearer' }, 401)

    // @ts-ignore - Deno global available in edge runtime
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    // @ts-ignore
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !supabaseAnon) {
      return json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY not set in function env' }, 500)
    }

    const supa = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: userRes, error: userErr } = await supa.auth.getUser()
    if (userErr || !userRes?.user) {
      return json({ error: 'Invalid or expired JWT' }, 401)
    }
    const email = String(userRes.user.email || '').trim().toLowerCase()
    if (email !== ADMIN_EMAIL) {
      return json({ error: 'Forbidden' }, 403)
    }

    // ── 2. Body ────────────────────────────────────────────────────
    // Mode switch:
    //   mode: 'morning_brief'      (default — context + system prompt → free-form text brief)
    //   mode: 'earnings_analysis'  (transcript text → strict JSON per the prompt)
    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body must be JSON' }, 400)
    }
    const mode = String(body?.mode || 'morning_brief')
    if (mode !== 'morning_brief' && mode !== 'earnings_analysis') {
      return json({ error: `Unknown mode "${mode}"` }, 400)
    }
    const { systemPrompt, model } = body || {}
    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return json({ error: 'Missing "systemPrompt" string in body' }, 400)
    }

    // ── 3. Gemini key ──────────────────────────────────────────────
    // @ts-ignore
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) {
      return json({
        error: 'GEMINI_API_KEY not configured on the server. ' +
          'Run: supabase secrets set GEMINI_API_KEY=...your-key...',
      }, 500)
    }

    const useModel = (typeof model === 'string' && model) || DEFAULT_MODEL
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}` +
      `:generateContent?key=${encodeURIComponent(geminiKey)}`

    // ── 4. Mode-specific payload ───────────────────────────────────
    let userMessage: string
    const generationConfig: any = {
      temperature:     0.2,
      maxOutputTokens: 4000,
      thinkingConfig:  { thinkingBudget: 0 },
    }

    if (mode === 'morning_brief') {
      const context = body?.context
      if (!context || typeof context !== 'object') {
        return json({ error: 'Missing "context" object in body' }, 400)
      }
      userMessage =
        "Generate today's IQJET DAILY brief using the format defined in " +
        'your system prompt. Use the following data:\n\n' +
        '```json\n' +
        JSON.stringify(context, null, 2) +
        '\n```\n\n' +
        'Notes on missing data:\n' +
        "- Any field with value 'unavailable' has no live collector yet. " +
        'Briefly acknowledge the gap if it matters; do NOT make up values.\n' +
        '- The US market collectors are entirely pending — for the US row, ' +
        'say so plainly rather than fabricating a verdict.\n' +
        "- If robins_desk is 'unavailable', skip the ROBIN'S DESK section.\n"
    } else {
      // earnings_analysis
      const transcript = String(body?.transcript || '').trim()
      const symbol     = String(body?.symbol || '').trim().toUpperCase()
      const callDate   = String(body?.call_date || '').trim()
      if (!transcript) return json({ error: 'Missing "transcript" string' }, 400)
      if (transcript.length < 200) return json({ error: 'Transcript too short' }, 400)
      // Soft cap — Gemini 2.5-flash handles ~1M input tokens, but huge
      // transcripts waste quota and rarely add value. Trim to 200k chars
      // (~50k tokens) — enough for the longest earnings call.
      const trimmed = transcript.length > 200_000 ? transcript.slice(0, 200_000) : transcript
      userMessage =
        `Analyse the following NSE-listed earnings call transcript for ${symbol || 'this company'}` +
        (callDate ? ` (call date ${callDate})` : '') + `.\n\n` +
        `Follow the JSON schema defined in section 7 of your system prompt.\n` +
        `Output JSON ONLY — no prose, no markdown, no preamble.\n\n` +
        `--- TRANSCRIPT ---\n${trimmed}\n--- END TRANSCRIPT ---\n`
      generationConfig.responseMimeType = 'application/json'
    }

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig,
      }),
    })

    if (!geminiRes.ok) {
      const errBody = await geminiRes.json().catch(() => ({}))
      const msg = errBody?.error?.message || `Gemini HTTP ${geminiRes.status}`
      return json({ error: msg }, geminiRes.status === 429 ? 429 : 502)
    }

    const result = await geminiRes.json()
    const parts = result?.candidates?.[0]?.content?.parts || []
    const text = parts
      .map((p: any) => (p && typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim()
    if (!text) {
      return json({ error: 'Gemini returned empty text' }, 502)
    }

    if (mode === 'earnings_analysis') {
      // Validate JSON shape before returning. Gemini's JSON mode is
      // usually reliable, but defensively parse here so the frontend
      // doesn't have to.
      let parsed: any
      try { parsed = JSON.parse(text) }
      catch {
        // Sometimes the model wraps in ```json ... ```. Strip and retry.
        const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
        try { parsed = JSON.parse(stripped) }
        catch (e: any) {
          return json({ error: `Gemini did not return valid JSON: ${e?.message}`, raw: text }, 502)
        }
      }
      return json({ analysis: parsed, raw: text }, 200)
    }

    return json({ brief: text }, 200)
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
