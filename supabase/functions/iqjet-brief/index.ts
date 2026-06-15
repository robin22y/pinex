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
    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body must be JSON' }, 400)
    }
    const { context, systemPrompt, model } = body || {}
    if (!context || typeof context !== 'object') {
      return json({ error: 'Missing "context" object in body' }, 400)
    }
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

    // ── 4. Compose Gemini call ─────────────────────────────────────
    const useModel = (typeof model === 'string' && model) || DEFAULT_MODEL
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}` +
      `:generateContent?key=${encodeURIComponent(geminiKey)}`

    const userMessage =
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

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature:     0.2,
          maxOutputTokens: 4000,
          thinkingConfig:  { thinkingBudget: 0 },
        },
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

    return json({ brief: text }, 200)
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
