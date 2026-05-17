/**
 * Generate a company description using Claude or Gemini.
 *
 * POST { symbol, name, sector, provider: 'claude' | 'gemini' }
 * → { ok: true, description: '...' }
 *
 * Env: CLAUDE_API_KEY, GEMINI_API_KEY, SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_KEY
 */
const https = require('https')

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

const PROMPT = (name, symbol, sector) =>
  `Write a concise company description for ${name} (NSE: ${symbol}), an Indian listed company in the ${sector || 'diversified'} sector. ` +
  `2-3 sentences, plain English, no investment advice, no buy/sell recommendation. ` +
  `Describe what the company does, its key products/services, and its market position.`

async function callClaude(prompt) {
  const apiKey = process.env.CLAUDE_API_KEY
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set')

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            const text = json.content?.[0]?.text
            if (!text) return reject(new Error(json.error?.message || 'Claude returned no text'))
            resolve(text.trim())
          } catch {
            reject(new Error('Failed to parse Claude response'))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 200, temperature: 0.4 },
  })

  return new Promise((resolve, reject) => {
    const path = `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text
            if (!text) return reject(new Error(json.error?.message || 'Gemini returned no text'))
            resolve(text.trim())
          } catch {
            reject(new Error('Failed to parse Gemini response'))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function saveDescription(symbol, description) {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) return

  const body = JSON.stringify({ description, description_approved: false })
  const encodedSymbol = encodeURIComponent(symbol)

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: new URL(supabaseUrl).hostname,
        path: `/rest/v1/companies?symbol=eq.${encodedSymbol}`,
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => { res.on('data', () => {}); res.on('end', resolve) }
    )
    req.on('error', resolve)
    req.write(body)
    req.end()
  })
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  try {
    const { symbol, name, sector, provider = 'claude' } = JSON.parse(event.body || '{}')
    if (!symbol) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'symbol required' }) }

    const prompt = PROMPT(name || symbol, symbol, sector)

    const description = provider === 'gemini'
      ? await callGemini(prompt)
      : await callClaude(prompt)

    await saveDescription(symbol, description)

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, description }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: err.message }),
    }
  }
}
