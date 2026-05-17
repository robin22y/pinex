/**
 * Sends a custom Telegram message to the channel or all subscribers.
 * Body: { message: string, target: 'channel' | 'all' | 'test', testChatId?: string }
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const https = require('https')

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

function sendTelegram(token, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    })
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve({ ok: false, raw: data })
          }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function fetchSubscriberChatIds(supabaseUrl, serviceKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${supabaseUrl}/rest/v1/telegram_subscribers?select=chat_id`)
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
          try {
            const rows = JSON.parse(data)
            resolve(Array.isArray(rows) ? rows.map((r) => String(r.chat_id)).filter(Boolean) : [])
          } catch {
            resolve([])
          }
        })
      },
    )
    req.on('error', () => resolve([]))
    req.end()
  })
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || ''
  const channelId = (process.env.TELEGRAM_CHANNEL_ID || '').replace(/^t\.me\//, '@').replace(/^https:\/\/t\.me\//, '@')
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  if (!token) {
    return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }) }
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }
  }

  const { message, target = 'channel', testChatId } = body

  if (!message || !message.trim()) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'message is required' }) }
  }

  let chatIds = []

  if (target === 'channel') {
    if (!channelId) {
      return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'TELEGRAM_CHANNEL_ID not configured' }) }
    }
    chatIds = [channelId]
  } else if (target === 'all') {
    if (!supabaseUrl || !serviceKey) {
      return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Supabase env not configured' }) }
    }
    chatIds = await fetchSubscriberChatIds(supabaseUrl, serviceKey)
    if (chatIds.length === 0) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, sent: 0, note: 'No subscribers found' }) }
    }
  } else if (target === 'test') {
    const id = testChatId || channelId
    if (!id) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'No test chat ID' }) }
    }
    chatIds = [id]
  } else {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'target must be channel | all | test' }) }
  }

  let sent = 0
  let failed = 0
  const errors = []

  for (const chatId of chatIds) {
    try {
      const result = await sendTelegram(token, chatId, message.trim())
      if (result.ok) {
        sent++
      } else {
        failed++
        errors.push({ chatId, error: result.description || JSON.stringify(result) })
      }
    } catch (err) {
      failed++
      errors.push({ chatId, error: String(err) })
    }
    if (chatIds.length > 1) await new Promise((r) => setTimeout(r, 40))
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sent, failed, total: chatIds.length, errors: errors.slice(0, 5) }),
  }
}
