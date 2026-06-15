// send-bulk-email — admin bulk-send via Resend.
//
// Distinct from admin-send-email.js (the template-driven send used by
// EmailAdmin's "Send test →" + the academy/reengagement/invite flows).
// THIS function accepts ad-hoc { recipients, subject, body } payloads
// and personalises each send with the recipient's first name.
//
// REQUEST SHAPE
//   POST /.netlify/functions/send-bulk-email
//   Authorization: Bearer <user_session_token>
//   {
//     recipients: [{ email: string, name?: string }, …],
//     subject:    string,
//     body:       string,         // plain text, \n -> <br>
//   }
//
// RESPONSE SHAPE
//   200 { sent: number, failed: number, errors: [{ email, error }] }
//   400 { error: string }   — bad request / missing fields
//   401 { error: 'Unauthorized' }
//   403 { error: 'Not admin' }
//   500 { error: 'Email service not configured' }   — no RESEND_API_KEY
//
// PERSONALISATION
//   `{name}` in subject / body is replaced per-recipient with the
//   first token of recipient.name (split on whitespace). When name is
//   empty or missing we substitute "there" so the body still reads
//   like a personal note ("Hi there,").
//
// RATE LIMIT
//   Per the spec — max 50 recipients per call. If more are supplied
//   we batch through them with a 500 ms delay between sends so we
//   don't hammer Resend's per-second budget. The cap is the limit,
//   not the batch size; we still send all of them, just paced.

const { Resend } = require('resend')
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const FROM = 'PineX <robin@pinex.in>'
const MAX_RECIPIENTS = 1000  // sanity cap so a misuse can't fan out to 50k

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function firstName(name) {
  if (!name || typeof name !== 'string') return 'there'
  const tok = name.trim().split(/\s+/)[0]
  return tok || 'there'
}

function personalise(template, name) {
  return String(template || '').split('{name}').join(firstName(name))
}

// Plain-text -> styled HTML card. The admin composes in plain text
// (newlines + the {name} placeholder); we wrap it in the branded
// PineX template so every recipient gets the same dark-card look —
// header logo, body prose, CTA button, footer disclaimer.
//
// The first line that LOOKS like a heading (≤80 chars, no period, no
// "Hi ...") is promoted to <h2>. Lines blank-separated become paragraphs.
// A bare URL on its own line becomes a button (the LAST such URL wins,
// or admins can pin one as the CTA via the placeholder convention).
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function linkify(s) {
  // Turn bare URLs inside a paragraph into clickable links.
  return s.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    const safe = escapeHtml(m)
    return `<a href="${safe}" style="color:#00C805;text-decoration:underline;">${safe}</a>`
  })
}

function toHtml(plain) {
  // Strip stray CR, split into trimmed paragraphs by blank lines.
  const raw = String(plain || '').replace(/\r/g, '')
  const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)

  // First block becomes the heading if it doesn't end in punctuation
  // and is short — otherwise we render it as a normal paragraph.
  let heading = ''
  let bodyBlocks = blocks
  if (blocks.length > 0) {
    const first = blocks[0]
    const looksLikeHeading = first.length <= 80 && !/[.!?]$/.test(first) && !first.includes('\n')
    if (looksLikeHeading) {
      heading = first
      bodyBlocks = blocks.slice(1)
    }
  }

  // Detect a CTA — the last block that is exactly a single URL. If
  // present it's rendered as a button instead of a plain paragraph.
  let cta = null
  if (bodyBlocks.length > 0) {
    const lastBlock = bodyBlocks[bodyBlocks.length - 1]
    const urlOnly = lastBlock.match(/^(https?:\/\/\S+)$/)
    if (urlOnly) {
      cta = urlOnly[1]
      bodyBlocks = bodyBlocks.slice(0, -1)
    }
  }

  // Each remaining block: escape, replace single newlines with <br>,
  // linkify URLs, wrap in <p>.
  const paragraphsHtml = bodyBlocks
    .map((b) => {
      const escaped = escapeHtml(b).replace(/\n/g, '<br>')
      return `<p>${linkify(escaped)}</p>`
    })
    .join('\n')

  const ctaHtml = cta
    ? `<a href="${escapeHtml(cta)}" class="btn">Open →</a>`
    : ''
  const headingHtml = heading
    ? `<h2>${escapeHtml(heading)}</h2>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f9fa; margin: 0; padding: 20px; }
  .card { max-width: 480px; margin: 0 auto; background: #0B0E11; border-radius: 16px; overflow: hidden; }
  .header { background: #0F1217; padding: 28px 28px 20px; border-bottom: 1px solid #1E2530; }
  .logo { font-size: 22px; font-weight: 800; color: #E2E8F0; letter-spacing: -0.01em; }
  .logo span { color: #00C805; }
  .body { padding: 24px 28px; }
  .body h2 { color: #E2E8F0; font-size: 20px; margin: 0 0 12px; }
  .body p { color: #94A3B8; line-height: 1.7; margin: 0 0 16px; font-size: 14px; }
  .body a { color: #60A5FA; }
  .btn { display: inline-block; background: #00C805; color: #000 !important; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; margin: 8px 0; }
  .footer { padding: 16px 28px; border-top: 1px solid #1E2530; font-size: 10px; color: #334155; font-style: italic; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="logo">Pine<span>X</span></div>
  </div>
  <div class="body">
    ${headingHtml}
    ${paragraphsHtml}
    ${ctaHtml}
  </div>
  <div class="footer">Educational data only. Not investment advice. Not SEBI registered. pinex.in</div>
</div>
</body>
</html>`
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  if (!process.env.RESEND_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Email service not configured' }),
    }
  }

  // ── Admin gate ──────────────────────────────────────────────────────
  const token = (event.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { WebSocket: ws },
    },
  )

  let callerId = null
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token)
    callerId = user?.id || null
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
  }
  if (!callerId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'superadmin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not admin' }) }
  }

  // ── Parse body ──────────────────────────────────────────────────────
  let payload
  try { payload = JSON.parse(event.body || '{}') }
  catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }
  const { recipients, subject, body } = payload || {}

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'recipients required' }) }
  }
  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'subject required' }) }
  }
  if (!body || typeof body !== 'string' || !body.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'body required' }) }
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Too many recipients (max ${MAX_RECIPIENTS} per call)` }),
    }
  }

  // Dedupe by email so the same address never receives two copies
  // even if it appears twice in the recipient list.
  const seen = new Set()
  const dedupedRecipients = []
  for (const r of recipients) {
    const email = String(r?.email || '').trim().toLowerCase()
    if (!email || !/.+@.+\..+/.test(email)) continue
    if (seen.has(email)) continue
    seen.add(email)
    dedupedRecipients.push({ email, name: typeof r?.name === 'string' ? r.name : '' })
  }

  if (dedupedRecipients.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No valid recipient emails' }) }
  }

  const resend = new Resend(process.env.RESEND_API_KEY)

  // ── Send loop ───────────────────────────────────────────────────────
  // Per-send pacing — Resend's free tier caps at 2 requests / second.
  // The prior pattern ("sleep 500 ms after every 50 sends") still
  // burst-fired the first 50 at ~100 req/sec → exactly the symptom
  // Robin saw ("Too many requests. You can only make 2 requests per
  // second" on 55 of 69 sends).
  //
  // 550 ms between every send = 1.81 req/sec, safely below the 2/s
  // ceiling. For 69 recipients that's ~38 s wall-clock, which is
  // why this file is named `*-background.js`: Netlify routes any
  // function ending in `-background` to the background runtime
  // (15-minute timeout instead of the 10 s sync cap). The handler
  // still returns 200 with results so the caller's response code
  // path keeps working — Netlify simply doesn't wait for it.
  //
  // 429 RETRY — defensive against any provider hiccup where the
  // burst limit re-trips despite our pacing. One retry per send,
  // with a 2 s wait. Past the retry we give up on that recipient
  // and continue.
  async function sendOne(r) {
    const personalisedSubject = personalise(subject, r.name)
    const personalisedBody    = personalise(body, r.name)
    const payload = {
      from: FROM,
      to: r.email,
      subject: personalisedSubject,
      text: personalisedBody,
      html: toHtml(personalisedBody),
    }
    try {
      const { error } = await resend.emails.send(payload)
      if (!error) return { email: r.email, success: true }
      const msg = error.message || JSON.stringify(error)
      // Retry once on rate-limit errors.
      if (/too many requests|rate.?limit|429/i.test(msg)) {
        await sleep(2000)
        const retry = await resend.emails.send(payload)
        if (!retry.error) return { email: r.email, success: true }
        return { email: r.email, success: false, error: retry.error.message || msg }
      }
      return { email: r.email, success: false, error: msg }
    } catch (err) {
      return { email: r.email, success: false, error: err.message }
    }
  }

  const results = []
  for (let i = 0; i < dedupedRecipients.length; i++) {
    const r = dedupedRecipients[i]
    const result = await sendOne(r)
    if (!result.success) {
      console.error('[send-bulk-email] failed:', result.email, result.error)
    }
    results.push(result)
    // Per-send pacing (skip the wait on the last send to save time).
    if (i < dedupedRecipients.length - 1) {
      await sleep(550)
    }
  }

  const sent = results.filter((r) => r.success).length
  const failed = results.length - sent
  const errors = results
    .filter((r) => !r.success)
    .map((r) => ({ email: r.email, error: r.error || 'unknown' }))

  // Audit trail — best-effort insert into usage_events so admins have
  // a record of who sent what. Failure is non-fatal; logging never
  // blocks the response.
  try {
    await supabaseAdmin
      .from('usage_events')
      .insert({
        event_type: 'admin_bulk_email_sent',
        user_id: callerId,
        metadata: {
          recipient_count: dedupedRecipients.length,
          sent,
          failed,
          subject: subject.trim().slice(0, 200),
        },
      })
  } catch (e) {
    console.error('[send-bulk-email] usage_events insert failed:', e?.message)
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sent, failed, errors }),
  }
}
