/**
 * Insert a new company row using the service key (bypasses RLS).
 * POST { symbol, name, sector, bse_code?, tier?, website_url? }
 * → { ok: true } | { ok: false, error: '...' }
 */
const https = require('https')

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not set' }) }
  }

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }
  }

  const symbol = String(payload.symbol || '').trim().toUpperCase()
  const name = String(payload.name || '').trim()
  if (!symbol || !name) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'symbol and name are required' }) }
  }

  const row = {
    symbol,
    name,
    sector: String(payload.sector || 'Others').trim(),
    ...(payload.bse_code ? { bse_code: String(payload.bse_code).trim() } : {}),
    ...(payload.tier != null ? { tier: Number(payload.tier) || 1 } : {}),
    ...(payload.website_url ? { website_url: String(payload.website_url).trim() } : {}),
  }

  const body = JSON.stringify(row)
  const hostname = new URL(supabaseUrl).hostname

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname,
        path: '/rest/v1/companies',
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) })
          } else {
            let msg = data
            try { msg = JSON.parse(data)?.message || JSON.parse(data)?.error || data } catch {}
            resolve({ statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: false, error: `DB ${res.statusCode}: ${msg}` }) })
          }
        })
      }
    )
    req.on('error', (err) => resolve({ statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) }))
    req.write(body)
    req.end()
  })
}
