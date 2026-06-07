/**
 * generate-question.js — server-side Gemini call for the admin Daily
 * Question generator. Pattern mirrors generate-description-gemini.js:
 * raw https.request() for both Gemini and Supabase REST so the function
 * bundle stays small (no @google/generative-ai, no @supabase/supabase-js).
 *
 * Request:
 *   POST /.netlify/functions/generate-question
 *   { save?: boolean }   default false — preview-only
 *
 * Response (200):
 *   { question: string, context: { breadth, top_sectors } }
 *
 * Response (5xx):
 *   { error: string }
 *
 * Behaviour:
 *   1. Fetches latest market_internals row → above_ma30w_pct breadth.
 *   2. Fetches top 3 sectors by stage2_pct on the most recent date.
 *   3. Builds the Gemini prompt with both, calls gemini-2.5-flash-lite.
 *   4. If save=true, upserts daily_questions on (question_date, question_text,
 *      question_type, points_value, generated_by). Otherwise returns
 *      the generated text without writing.
 *
 * Env vars (set in Netlify dashboard):
 *   GEMINI_API_KEY            required
 *   SUPABASE_URL              required
 *   SUPABASE_SERVICE_KEY      required (service role — bypasses RLS so the
 *                             function can read market_internals/sectors
 *                             regardless of the caller's identity)
 */

const https = require('https')

// ── HTTPS helpers ────────────────────────────────────────────────────────
function httpsRequest(method, url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj == null ? null : JSON.stringify(bodyObj)
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          // Some PostgREST upserts return 201 with empty body; tolerate that.
          if (!raw) return resolve({ statusCode: res.statusCode, data: null })
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(raw) })
          } catch {
            resolve({ statusCode: res.statusCode, data: { raw } })
          }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function supabaseHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra,
  }
}

// ── Handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: '' }
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

  if (!GEMINI_KEY) {
    return {
      statusCode: 500, headers: HEADERS,
      body: JSON.stringify({ error: 'GEMINI_API_KEY not set in Netlify env' }),
    }
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500, headers: HEADERS,
      body: JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not set' }),
    }
  }

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { /* keep empty */ }
  const shouldSave = body.save === true

  try {
    // ── 1. Fetch breadth (latest market_internals row) ─────────────────
    // Column name on the live table is `date`, not `trading_date`.
    const breadthRes = await httpsRequest(
      'GET',
      `${SUPABASE_URL}/rest/v1/market_internals?select=above_ma30w_pct,date&order=date.desc&limit=1`,
      supabaseHeaders(SUPABASE_SERVICE_KEY),
      null,
    )
    const breadthRow = Array.isArray(breadthRes.data) ? breadthRes.data[0] : null
    const breadthPct = breadthRow && breadthRow.above_ma30w_pct != null
      ? `${Number(breadthRow.above_ma30w_pct).toFixed(0)}%`
      : 'mixed'

    // ── 2. Fetch top 3 sectors by stage2_pct on the most recent date ────
    // sectors.date can be NULL for legacy rows — Postgres ORDER DESC puts
    // NULLs first, so we explicitly filter them out.
    const sectorsRes = await httpsRequest(
      'GET',
      `${SUPABASE_URL}/rest/v1/sectors?select=name,stage2_pct,health,date&date=not.is.null&order=date.desc,stage2_pct.desc&limit=3`,
      supabaseHeaders(SUPABASE_SERVICE_KEY),
      null,
    )
    const sectors = Array.isArray(sectorsRes.data) ? sectorsRes.data : []
    const topSectors = sectors
      .map((s) => `${s.name} (${Number(s.stage2_pct || 0).toFixed(0)}%)`)
      .join(', ') || 'data not available'

    // ── 3. Build prompt + call Gemini ──────────────────────────────────
    const prompt = `You write daily educational questions for Indian retail traders learning cycle analysis on NSE stocks.

Today's market context:
Market breadth: ${breadthPct} of stocks above their long-term trend line.
Strongest sectors today: ${topSectors}.

Write ONE question that:
- Makes the trader think about what they observe in the market
- Is grounded in the context above
- Uses plain simple English (a first-time investor should understand it)
- Is 2-4 sentences maximum
- Never gives investment advice
- Never says buy, sell, target, stop loss, breakout, bullish, bearish
- Ends with a question mark
- Subtly encourages them to look at the data on PineX

Return ONLY the question text. No preamble. No explanation. No quotation marks. Just the question itself.`

    // Model name from ai_config table (admin-editable via /admin/pipeline).
    // Falls back to gemini-2.5-flash-lite when the row is missing/inactive
    // or the lookup fails. Public-read RLS, so no extra auth needed.
    let modelName = 'gemini-2.5-flash-lite'
    try {
      const modelRes = await httpsRequest(
        'GET',
        `${SUPABASE_URL}/rest/v1/ai_config?select=config_value&config_key=eq.gemini_question_model&is_active=eq.true&limit=1`,
        supabaseHeaders(SUPABASE_SERVICE_KEY),
        null,
      )
      const row = Array.isArray(modelRes.data) ? modelRes.data[0] : null
      if (row?.config_value) modelName = row.config_value
    } catch (e) {
      console.warn('[generate-question] ai_config fetch failed, using fallback:', e?.message)
    }

    const geminiRes = await httpsRequest(
      'POST',
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`,
      {},
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.6 },
      },
    )

    const question = geminiRes?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!question) {
      console.error('Gemini raw response:', JSON.stringify(geminiRes?.data))
      throw new Error('Empty Gemini response')
    }

    // ── 4. Optionally save ─────────────────────────────────────────────
    if (shouldSave) {
      const today = new Date().toISOString().slice(0, 10)
      const upsertRes = await httpsRequest(
        'POST',
        `${SUPABASE_URL}/rest/v1/daily_questions?on_conflict=question_date`,
        supabaseHeaders(SUPABASE_SERVICE_KEY, {
          // resolution=merge-duplicates makes a POST behave as upsert
          // when an existing row matches the on_conflict target.
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        {
          question_date: today,
          question_text: question,
          question_type: 'market',
          points_value: 5,
          generated_by: 'gemini',
        },
      )
      if (upsertRes.statusCode >= 400) {
        console.error('daily_questions upsert failed:', upsertRes)
        throw new Error(`Save failed: HTTP ${upsertRes.statusCode}`)
      }
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        question,
        context: { breadth: breadthPct, top_sectors: topSectors },
      }),
    }
  } catch (err) {
    console.error('generate-question error:', err)
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: String(err?.message || err) }),
    }
  }
}
