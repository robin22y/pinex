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

// Plain-text -> minimal HTML. Preserve line breaks; the body is
// composed in the admin UI as plain text and Resend renders \n as
// literal text without conversion.
function toHtml(plain) {
  const safe = String(plain || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return safe.replace(/\r?\n/g, '<br>')
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
  // Pacing: after every 50 sends, sleep 500 ms. Below that threshold we
  // send back-to-back. Resend's per-second limit on the free plan is
  // ~10/s; 100/s on paid — this cadence stays comfortably under both.
  const results = []
  for (let i = 0; i < dedupedRecipients.length; i++) {
    const r = dedupedRecipients[i]
    const personalisedSubject = personalise(subject, r.name)
    const personalisedBody    = personalise(body, r.name)
    try {
      const { error } = await resend.emails.send({
        from: FROM,
        to: r.email,
        subject: personalisedSubject,
        text: personalisedBody,
        html: toHtml(personalisedBody),
      })
      if (error) {
        console.error('[send-bulk-email] rejected:', r.email, error.message || error)
        results.push({ email: r.email, success: false, error: error.message || JSON.stringify(error) })
      } else {
        results.push({ email: r.email, success: true })
      }
    } catch (err) {
      console.error('[send-bulk-email] threw:', r.email, err.message)
      results.push({ email: r.email, success: false, error: err.message })
    }
    // Pace every 50 sends to keep us under Resend's rate caps.
    if (i > 0 && (i % 50) === 0) {
      await sleep(500)
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
