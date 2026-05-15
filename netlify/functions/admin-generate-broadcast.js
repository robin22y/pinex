/**
 * Generates or retrieves an AI weekly broadcast message.
 * GET  → returns latest draft from telegram_broadcasts table
 * POST { regenerate: true } → calls Claude, saves draft, returns message
 * Env: CLAUDE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const https = require('https')

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

function supabaseGet(supabaseUrl, serviceKey, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${supabaseUrl}/rest/v1/${path}`)
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function supabaseRpc(supabaseUrl, serviceKey, rpcName, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params)
    const req = https.request(
      {
        hostname: new URL(supabaseUrl).hostname,
        path: `/rest/v1/rpc/${rpcName}`,
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve([]) }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function supabaseInsert(supabaseUrl, serviceKey, table, row) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(row)
    const req = https.request(
      {
        hostname: new URL(supabaseUrl).hostname,
        path: `/rest/v1/${table}`,
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Prefer: 'return=representation',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function callClaude(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            resolve(parsed?.content?.[0]?.text || '')
          } catch { reject(new Error('Claude response parse error')) }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function buildPrompt(stocks, history) {
  const latest = history[0] || {}
  const prev = history[1] || {}
  const breadthNow = (latest.above_ma150_pct || 0).toFixed(0)
  const breadthPrev = (prev.above_ma150_pct || 0).toFixed(0)
  const stage2Pct = (latest.stage2_pct || 0).toFixed(0)
  const vix = (latest.india_vix || 0).toFixed(1)
  const nifty = Math.round(latest.nifty_close || 0).toLocaleString()

  const stockList = stocks.slice(0, 10).map(s =>
    `- ${s.symbol} (${s.sector || ''}) RS: ${(s.rs_vs_nifty || 0).toFixed(1)}% Del: ${Math.round(s.avg_delivery_30d || 0)}%`
  ).join('\n') || 'None meeting all criteria this week.'

  return `You are writing a weekly market update for Indian retail investors on a Telegram channel called PineX.

MARKET DATA THIS WEEK:
- Nifty 50: ${nifty}
- Stocks above 30W MA: ${breadthNow}% (was ${breadthPrev}% last week)
- Stocks in uptrend phase: ${stage2Pct}%
- India VIX: ${vix}

STOCKS MEETING ALL 5 CONDITIONS (Stage 2 + above MAs + high delivery + positive momentum):
${stockList}

Write a Telegram message with these rules:
1. Maximum 200 words
2. Start with market breadth context
3. Mention how many stocks meet all conditions
4. Name top 3 stocks with one factual observation each (delivery, sector, RS)
5. End with one factual market observation
6. NO buy/sell advice, NO price targets
7. Plain language — no jargon
8. Use emojis sparingly (1-2 max)
9. Add disclaimer: "Data for educational purposes only. Not investment advice."

Tone: Factual, calm, informative.`
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
  const claudeKey = process.env.CLAUDE_API_KEY || ''

  // ── GET: return latest draft ──────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const rows = await supabaseGet(supabaseUrl, serviceKey,
        'telegram_broadcasts?select=*&order=generated_at.desc&limit=1')
      const latest = Array.isArray(rows) ? rows[0] : null
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ ok: true, broadcast: latest || null }),
      }
    } catch (err) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, broadcast: null }) }
    }
  }

  // ── POST { regenerate: true } → generate fresh with Claude ───────────────
  if (event.httpMethod === 'POST') {
    if (!claudeKey) {
      return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'CLAUDE_API_KEY not configured' }) }
    }

    // Fetch stocks and market context from Supabase
    let stocks = []
    let history = []
    try {
      const allStocks = await supabaseRpc(supabaseUrl, serviceKey, 'get_home_stocks')
      stocks = (Array.isArray(allStocks) ? allStocks : [])
        .filter(s =>
          s.stage === 'Stage 2' &&
          (s.close || 0) > (s.ma30w || 0) &&
          (s.close || 0) > (s.ma50 || 0) &&
          (s.avg_delivery_30d || 0) > 40 &&
          (s.vol_ratio || 0) > 1.0 &&
          (s.price_change_7d || 0) > 0
        )
        .sort((a, b) => (b.rs_vs_nifty || -999) - (a.rs_vs_nifty || -999))
        .slice(0, 10)
    } catch (e) {
      console.error('Failed to fetch stocks:', e)
    }

    try {
      history = await supabaseGet(supabaseUrl, serviceKey,
        'market_internals?select=*&order=date.desc&limit=7')
      if (!Array.isArray(history)) history = []
    } catch (e) {
      console.error('Failed to fetch market internals:', e)
    }

    let message
    try {
      message = await callClaude(claudeKey, buildPrompt(stocks, history))
    } catch (err) {
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ ok: false, error: `Claude error: ${err.message}` }) }
    }

    // Save to telegram_broadcasts
    try {
      await supabaseInsert(supabaseUrl, serviceKey, 'telegram_broadcasts', {
        message,
        generated_at: new Date().toISOString(),
        status: 'draft',
      })
    } catch (e) {
      console.error('Failed to save broadcast to DB:', e)
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, message, stockCount: stocks.length }),
    }
  }

  return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
}
