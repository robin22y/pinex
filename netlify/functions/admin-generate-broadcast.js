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

function callGemini(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    })
    const path = `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path,
        method: 'POST',
        headers: {
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
            // 2.5 Flash thinking model: parts[0] may be the thought (thought:true),
            // actual response is the last part without the thought flag
            const parts = parsed?.candidates?.[0]?.content?.parts || []
            const responsePart = parts.find(p => !p.thought) || parts[parts.length - 1]
            resolve(responsePart?.text || '')
          } catch { reject(new Error('Gemini response parse error')) }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function buildSectorPrompt(sector) {
  const name = sector.display_name || sector.index_name || 'Unknown'

  function fmtChg(val) {
    if (val == null) return '—'
    const n = Number(val)
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
  }

  return `You are writing a sector spotlight post for the PineX Telegram channel (@pinexin) — an Indian retail investor community focused on cycle (stage) analysis.

SECTOR DATA FROM OUR SYSTEM:
Sector / Index: ${name}
1 Day change:   ${fmtChg(sector.change_1d)}
1 Week change:  ${fmtChg(sector.change_1w)}
1 Month change: ${fmtChg(sector.change_1m)}
3 Month change: ${fmtChg(sector.change_3m)}

You also have access to your general knowledge about this sector — the major companies in it, recent news, policy tailwinds/headwinds, global trends, and anything that is well-known public information. Use both the data above AND your knowledge to write a richer post.

Write a Telegram sector spotlight message following these rules:
1. Max 200 words
2. Start with the sector name in bold (*Sector Name*)
3. 1-2 sentences on what this sector covers and why it matters to Indian retail investors
4. 2-3 bullet points: performance figures + one key driver or observation per timeframe
5. 1 sentence on any notable trend, news, or macro factor affecting this sector right now
6. End with: "Data for educational purposes only. Not investment advice."
7. NO buy/sell recommendations, NO price targets, NO specific stock picks
8. Use 1-2 relevant emojis only
9. Keep it factual, grounded, and useful

Format it ready to paste into Telegram (use *bold* for headers).`
}

function buildSpotlightPrompt(stock, company, delivery) {
  const symbol = company?.symbol || 'UNKNOWN'
  const stage = stock.stage || 'Unclassified'
  const sub = stock.weinstein_substage ? ` (${stock.weinstein_substage})` : ''
  const sector = company?.sector || 'Unknown'
  const industry = company?.industry || ''
  const name = company?.name || symbol

  const close = stock.close != null ? Number(stock.close) : null
  const ma30w = stock.ma30w != null ? Number(stock.ma30w) : null
  const pctFromMa = close != null && ma30w != null ? ((close - ma30w) / ma30w * 100) : null

  const price = close != null ? `₹${close.toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : '—'
  const rs = stock.rs_vs_nifty != null ? `${Number(stock.rs_vs_nifty).toFixed(1)}%` : '—'
  const pctMa = pctFromMa != null ? `${pctFromMa.toFixed(1)}%` : '—'
  const rsi = stock.rsi != null ? Number(stock.rsi).toFixed(0) : '—'
  const del7 = delivery?.avg_delivery_7d != null ? `${Number(delivery.avg_delivery_7d).toFixed(1)}%` : null
  const del30 = delivery?.avg_delivery_30d != null ? `${Number(delivery.avg_delivery_30d).toFixed(1)}%` : null
  const delStr = del7 ? `${del7} (7-day avg)` : del30 ? `${del30} (30-day avg)` : '—'
  const volRatio = delivery?.vol_ratio != null ? `${Number(delivery.vol_ratio).toFixed(2)}x avg` : '—'
  const swingX = delivery?.high_conviction ? 'Yes ⚡' : 'No'

  return `You are writing a stock spotlight post for the PineX Telegram channel (@pinexin) — an Indian retail investor community focused on cycle (stage) analysis.

STOCK DATA FROM OUR SYSTEM (use these exact numbers in your post):
Symbol: ${symbol}
Company: ${name}
Sector: ${sector}${industry && industry !== sector ? ` / ${industry}` : ''}
Stage: ${stage}${sub}
Current Price: ${price}
RS vs Nifty (1-year): ${rs}
% from 30-Week MA: ${pctMa}
RSI (14): ${rsi}
Delivery %: ${delStr}
Volume vs 30D avg: ${volRatio}
SwingX setup: ${swingX}

You also have access to your general knowledge about this company — its business model, recent developments, competitive position, products/services, and any well-known public information. Use both the data above AND your knowledge to write a richer, more informative post.

Write a Telegram spotlight message following these rules:
1. Max 200 words
2. Start with the stock symbol in bold (*${symbol}*)
3. 1-2 sentences about what the company actually does — be specific (products, market position, scale)
4. 2-3 bullet points using the ACTUAL numbers from the data above (stage, RS %, delivery %, etc.)
5. 1 sentence connecting the technical picture (${stage}, RS vs Nifty, delivery) to the business context
6. End with: "Data for educational purposes only. Not investment advice."
7. NO buy/sell recommendations, NO price targets
8. Use 1-2 relevant emojis only
9. Do NOT invent numbers — every metric must come from the data above

Format it ready to paste into Telegram (use *bold* for headers).`
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

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
  const claudeKey = process.env.CLAUDE_API_KEY || ''
  const geminiKey = process.env.GEMINI_API_KEY || ''

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

  // ── POST { symbol?, model? } → generate with Claude or Gemini ───────────
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}')
    const useGemini = String(body.model || '').toLowerCase() === 'gemini'

    async function callAI(prompt) {
      if (useGemini) {
        if (!geminiKey) throw new Error('GEMINI_API_KEY not configured')
        return callGemini(geminiKey, prompt)
      }
      if (!claudeKey) throw new Error('CLAUDE_API_KEY not configured')
      return callClaude(claudeKey, prompt)
    }

    // ── Single-stock spotlight ────────────────────────────────────────────
    if (body.symbol) {
      const sym = String(body.symbol).toUpperCase().trim()
      let stock = null, company = null, delivery = null
      try {
        const cos = await supabaseGet(supabaseUrl, serviceKey,
          `companies?symbol=eq.${encodeURIComponent(sym)}&select=id,symbol,name,sector,industry&limit=1`)
        company = Array.isArray(cos) ? cos[0] : null
      } catch (e) { console.error('companies fetch', e) }
      if (company?.id) {
        try {
          const pd = await supabaseGet(supabaseUrl, serviceKey,
            `price_data?company_id=eq.${company.id}&is_latest=eq.true&select=*&limit=1`)
          stock = Array.isArray(pd) ? pd[0] : null
        } catch (e) { console.error('price_data fetch', e) }
        try {
          const dl = await supabaseGet(supabaseUrl, serviceKey,
            `delivery_signals?company_id=eq.${company.id}&select=avg_delivery_7d,avg_delivery_30d,pct_from_30w,vol_ratio,high_conviction&order=date.desc&limit=1`)
          delivery = Array.isArray(dl) ? dl[0] : null
        } catch (e) { console.error('delivery_signals fetch', e) }
      }

      if (!stock) {
        return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ ok: false, error: `Stock ${sym} not found` }) }
      }

      let message
      try {
        message = await callAI(buildSpotlightPrompt(stock, company, delivery))
      } catch (err) {
        return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) }
      }
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, message, stock, company, delivery }) }
    }

    // ── Sector spotlight ──────────────────────────────────────────────────
    if (body.sector) {
      const sectorName = String(body.sector).trim()
      let sector = null
      try {
        const rows = await supabaseGet(supabaseUrl, serviceKey,
          `nifty_sectors?index_name=eq.${encodeURIComponent(sectorName)}&select=*&order=date.desc&limit=1`)
        sector = Array.isArray(rows) ? rows[0] : null
        if (!sector) {
          const rows2 = await supabaseGet(supabaseUrl, serviceKey,
            `nifty_sectors?display_name=eq.${encodeURIComponent(sectorName)}&select=*&order=date.desc&limit=1`)
          sector = Array.isArray(rows2) ? rows2[0] : null
        }
      } catch (e) { console.error('nifty_sectors fetch', e) }

      if (!sector) sector = { index_name: sectorName, display_name: sectorName }

      let message
      try {
        message = await callAI(buildSectorPrompt(sector))
      } catch (err) {
        return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) }
      }
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, message, sector }) }
    }

    // ── Weekly broadcast ─────────────────────────────────────────────────
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
      message = await callAI(buildPrompt(stocks, history))
    } catch (err) {
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) }
    }

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
