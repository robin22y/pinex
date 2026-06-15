// iqjet-telegram — Supabase Edge Function.
//
// Direct-message broadcast: takes a list of Telegram user IDs and the
// admin's message body, fans out one-by-one sendMessage calls
// (rate-limited to ≤1 per second so we don't trip Telegram's 30/sec
// global cap or its 1/sec per-chat cap), records the per-recipient
// outcome in iqjet_broadcasts, and returns the delivery status.
//
// This is INTENTIONALLY DISTINCT from iqjet-telegram-send. That one
// posts to a single channel (TELEGRAM_CHANNEL_ID). This one targets
// individual users by chat_id — DMs only. They never share a target.
//
// Deploy:
//   supabase functions deploy iqjet-telegram
//   # Reuses the existing token. No channel id needed.
//   supabase secrets set TELEGRAM_BOT_TOKEN=...your-bot-token...
//
// Request body:
//   {
//     user_ids: string[]               // 1..200 entries, each a numeric chat_id
//     message:  string                 // 1..4096 chars
//     parse_mode?: 'Markdown' | 'HTML' | null   // default 'Markdown', null = plain text
//   }
//
// Response (200):
//   {
//     ok: true,
//     attempted: number,
//     delivered: number,
//     failed: number,
//     statuses: [{ user_id, ok, error?, message_id? }, ...]
//   }
//
// Auth: bearer JWT, admin email enforced server-side.

// @ts-ignore
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const MAX_RECIPIENTS = 200          // belt-and-braces cap
const MAX_TEXT_LEN   = 4096         // Telegram sendMessage hard limit
const RATE_LIMIT_MS  = 1000         // 1 second between sends (Telegram per-chat cap)
const BROADCAST_TABLE = 'iqjet_broadcasts'

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
    // @ts-ignore
    const supabaseService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return json({ error: 'Server env vars missing' }, 500)
    }

    const supaUser = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: userRes, error: userErr } = await supaUser.auth.getUser()
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

    const message    = String(body?.message || '').trim()
    const parseMode  = body?.parse_mode === null ? null
                     : String(body?.parse_mode || 'Markdown')
    let userIds: string[] = Array.isArray(body?.user_ids) ? body.user_ids : []
    userIds = userIds.map((u) => String(u).trim()).filter(Boolean)
    // Telegram chat_ids are numeric (positive for users, negative for
    // groups). Reject anything else early so we don't waste an API
    // call per typo.
    const invalid = userIds.filter((u) => !/^-?\d+$/.test(u))

    if (userIds.length === 0)            return json({ error: 'user_ids is empty' }, 400)
    if (userIds.length > MAX_RECIPIENTS) return json({ error: `Too many recipients (${userIds.length} > ${MAX_RECIPIENTS})` }, 400)
    if (!message)                        return json({ error: 'Missing "message" string' }, 400)
    if (message.length > MAX_TEXT_LEN)   return json({ error: `Message exceeds ${MAX_TEXT_LEN} chars` }, 400)
    if (parseMode !== null && !['Markdown', 'MarkdownV2', 'HTML'].includes(parseMode)) {
      return json({ error: `Invalid parse_mode "${parseMode}"` }, 400)
    }

    // ── 3. Telegram bot token ──────────────────────────────────────
    // @ts-ignore
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    if (!botToken) {
      return json({
        error: 'TELEGRAM_BOT_TOKEN not configured on the server. ' +
          'Run: supabase secrets set TELEGRAM_BOT_TOKEN=...',
      }, 500)
    }

    // ── 4. Send loop (rate-limited) ────────────────────────────────
    const statuses: Array<{ user_id: string; ok: boolean; error?: string; message_id?: number | null }> = []
    let delivered = 0
    let failed = 0

    // Pre-emptively fail the invalid-format ones so they show up in
    // statuses but don't burn an API call.
    const invalidSet = new Set(invalid)

    for (let i = 0; i < userIds.length; i++) {
      const uid = userIds[i]

      if (invalidSet.has(uid)) {
        statuses.push({ user_id: uid, ok: false, error: 'Invalid format — chat_id must be a number' })
        failed++
        continue
      }

      if (i > 0) {
        // Telegram per-chat cap is ~1 msg/sec. Sleep BEFORE every
        // call after the first.
        await sleep(RATE_LIMIT_MS)
      }

      const send = (mode: string | null) => fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: uid,
            text: message,
            ...(mode ? { parse_mode: mode } : {}),
            disable_web_page_preview: true,
          }),
        },
      )

      try {
        let res = await send(parseMode)
        let tg  = await res.json().catch(() => ({}))
        // Plain-text fallback: if Markdown parse failed, try again
        // without parse_mode so the message still lands.
        if (!res.ok && parseMode && tg?.description && /parse/i.test(tg.description)) {
          res = await send(null)
          tg  = await res.json().catch(() => ({}))
        }
        if (res.ok && tg?.ok) {
          statuses.push({ user_id: uid, ok: true, message_id: tg.result?.message_id ?? null })
          delivered++
        } else {
          const desc = String(tg?.description || `HTTP ${res.status}`)
          statuses.push({ user_id: uid, ok: false, error: desc })
          failed++
        }
      } catch (e) {
        statuses.push({ user_id: uid, ok: false, error: String((e as any)?.message || e) })
        failed++
      }
    }

    // ── 5. Audit log ───────────────────────────────────────────────
    const supaSvc = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const preview = message.length > 200 ? message.slice(0, 200) + '…' : message
    await supaSvc.from(BROADCAST_TABLE).insert({
      recipient_count: userIds.length,
      message_preview: preview,
      user_ids:        userIds,
      delivery_status: statuses,
      sent_by:         email,
    })

    return json({
      ok: true,
      attempted: userIds.length,
      delivered,
      failed,
      statuses,
    }, 200)
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
})

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
