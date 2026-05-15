/**
 * Generates a stock description using Claude or Gemini.
 *
 * POST { symbol, model: 'claude'|'gemini', name, sector, industry, financialContext }
 * → { ok: true, description: '...' }
 *
 * Env: ANTHROPIC_API_KEY (for claude), GEMINI_API_KEY (for gemini)
 */

const https = require('https')

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
          catch { resolve({ status: res.statusCode, body: raw }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function buildPrompt(symbol, name, sector, industry, financialContext) {
  const co = [name, sector, industry].filter(Boolean).join(' · ')
  let prompt = `Write a concise company description for ${symbol} (${co}), an Indian listed company.`
  if (financialContext) prompt += `\n\nContext: ${financialContext}`
  prompt += `\n\nRequirements:
- 2-3 sentences only
- Focus on what the company does and its core business
- Mention sector/industry positioning if relevant
- Factual and neutral tone, no hype
- Maximum 280 characters total
- No asterisks, no markdown, plain text only`
  return prompt
}

async function generateClaude(prompt, apiKey) {
  const res = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    }
  )
  if (res.status !== 200) throw new Error(`Claude API ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`)
  const text = res.body?.content?.[0]?.text
  if (!text) throw new Error('Claude returned empty response')
  return text.trim().slice(0, 300)
}

async function generateGemini(prompt, apiKey) {
  const res = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/gemini-3.1-flash:generateContent?key=${apiKey}`,
    { 'content-type': 'application/json' },
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 120, temperature: 0.4 },
    }
  )
  if (res.status !== 200) throw new Error(`Gemini API ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`)
  const text = res.body?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned empty response')
  return text.trim().slice(0, 300)
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }
  }

  const { symbol, model = 'claude', name, sector, industry, financialContext } = body

  if (!symbol) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'symbol required' }) }
  }

  const prompt = buildPrompt(symbol, name, sector, industry, financialContext)

  try {
    let description

    if (model === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY || ''
      if (!apiKey) return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'GEMINI_API_KEY not configured' }) }
      description = await generateGemini(prompt, apiKey)
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY || ''
      if (!apiKey) return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured' }) }
      description = await generateClaude(prompt, apiKey)
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, description }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    }
  }
}
