// iqjet-telegram-send — Supabase Edge Function.
//
// Posts an arbitrary message to Robin's IQjet Telegram channel on
// behalf of the admin user. Keeps TELEGRAM_BOT_TOKEN server-side so
// the bot credentials never touch the browser, and reuses the same
// channel id (TELEGRAM_CHANNEL_ID) the existing Python pipeline
// (scripts/iqjet/post_iqjet_telegram.py) already targets — keeps the
// posting history consistent across the daily-pipeline and on-demand
// admin flows.
//
// Deploy:
//   supabase functions deploy iqjet-telegram-send
//   supabase secrets set TELEGRAM_BOT_TOKEN=...your-bot-token...
//   supabase secrets set TELEGRAM_CHANNEL_ID=...your-channel-id...
//
// Request body:
//   {
//     text:        string,                    // 1..4096 chars
//     parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2',  // default 'HTML'
//     chat_id?:    string | number,           // optional override; defaults to TELEGRAM_CHANNEL_ID
//     disable_web_page_preview?: boolean,     // default true (radar messages are link-free)
//   }
//
// Response (200):
//   { ok: true, message_id: number }
//
// Errors:
//   401 missing/invalid auth · 403 not the admin · 400 bad body
//   500 missing secret / Telegram API failure
//
// Auth: bearer JWT, admin email enforced server-side.

// @ts-ignore
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const MAX_TEXT_LEN = 4096   // Telegram's hard limit for sendMessage

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
    // ── 1. Auth ────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ error: 'Missing Authorization bearer' }, 401)

    // @ts-ignore
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')
    // @ts-ignore
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !supabaseAnon) {
      return json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY not set' }, 500)
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
    try { body = await req.json() }
    catch { return json({ error: 'Body must be JSON' }, 400) }

    const text       = String(body?.text || '').trim()
    const parseMode  = String(body?.parse_mode || 'HTML')
    const disablePrev = body?.disable_web_page_preview !== false
    if (!text)                    return json({ error: 'Missing "text" string' }, 400)
    if (text.length > MAX_TEXT_LEN) {
      return json({
        error: `text exceeds Telegram's ${MAX_TEXT_LEN}-char limit`,
        length: text.length,
      }, 400)
    }
    if (!['HTML', 'Markdown', 'MarkdownV2'].includes(parseMode)) {
      return json({ error: `Invalid parse_mode "${parseMode}"` }, 400)
    }

    // ── 3. Secrets ─────────────────────────────────────────────────
    // @ts-ignore
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    // @ts-ignore
    const envChat = Deno.env.get('TELEGRAM_CHANNEL_ID')
    const chatId = body?.chat_id != null ? String(body.chat_id) : envChat
    if (!botToken) {
      return json({
        error: 'TELEGRAM_BOT_TOKEN not configured. ' +
          'Run: supabase secrets set TELEGRAM_BOT_TOKEN=...',
      }, 500)
    }
    if (!chatId) {
      return json({
        error: 'No chat_id — set TELEGRAM_CHANNEL_ID secret or pass chat_id in body.',
      }, 500)
    }

    // ── 4. Telegram API call ───────────────────────────────────────
    const tgRes = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:                    chatId,
          text,
          parse_mode:                 parseMode,
          disable_web_page_preview:   disablePrev,
        }),
      },
    )
    const tgBody = await tgRes.json().catch(() => ({}))
    if (!tgRes.ok || !tgBody?.ok) {
      const desc = tgBody?.description || `Telegram HTTP ${tgRes.status}`
      return json({ error: `Telegram API: ${desc}` }, 502)
    }

    return json(
      { ok: true, message_id: tgBody?.result?.message_id ?? null },
      200,
    )
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
