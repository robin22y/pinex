// WHY: Resend.com is our email provider.
// This function handles all admin-triggered
// emails: re-engagement, congratulations.
// Uses service key so only callable
// by verified admin sessions.

const { Resend } = require('resend')
const { createClient } = require(
  '@supabase/supabase-js')
const ws = require('ws')

const resend = new Resend(
  process.env.RESEND_API_KEY)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405 }
  }

  if (!process.env.RESEND_API_KEY) {
    console.error(
      'RESEND_API_KEY not set')
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Email service not configured'
      })
    }
  }

  // Verify admin token
  const token = (
    event.headers.authorization || '')
    .replace('Bearer ', '').trim()

  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        error: 'Unauthorized'
      })
    }
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { WebSocket: ws },
    }
  )

  // Verify admin
  const { data: { user } } =
    await supabaseAdmin.auth
      .getUser(token)

  const { data: profile } =
    await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user?.id)
      .single()

  if (profile?.role !== 'admin' &&
      profile?.role !== 'superadmin') {
    return {
      statusCode: 403,
      body: JSON.stringify({
        error: 'Not admin'
      })
    }
  }

  // HOW IT WORKS — request shape
  //   { type, userIds, testEmail? }
  //   type      — id in email_templates
  //               (e.g. 'congratulations',
  //               'reengagement', 'invite').
  //   userIds   — array of profile uuids
  //               whose data drives variable
  //               substitution.
  //   testEmail — OPTIONAL. When present,
  //               every send is redirected
  //               to this address instead of
  //               the per-user `email`.
  //               Used by the EmailAdmin
  //               "Send test →" button so an
  //               admin can preview to their
  //               own inbox without spamming
  //               the selected user(s).
  const body = JSON.parse(event.body || '{}')
  const { type, userIds, testEmail } = body

  if (!type || !userIds?.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'type and userIds required'
      })
    }
  }

  // ── feedback_reply ──────────────────────────────────────────
  // Special case: admin replying to a user's feedback. Unlike the
  // re-engagement / congratulations flows this does NOT use the
  // email_templates table — the reply text is per-message, so we
  // build the HTML inline from feedbackReplyTemplate(). Body
  // carries { replyText, originalMessage, originalRating } on top
  // of the usual { userIds }.
  if (type === 'feedback_reply') {
    const { replyText, originalMessage, originalRating } = body
    if (!replyText || !String(replyText).trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'replyText required' }),
      }
    }

    const { data: fbUsers } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds)

    const EMOJIS = ['', '😞', '😕', '😐', '😊', '🤩']
    const fbResults = []
    for (const u of (fbUsers || [])) {
      const recipient = testEmail || u.email
      if (!recipient) {
        fbResults.push({ email: null, success: false, error: 'no email on profile' })
        continue
      }
      try {
        const { error } = await resend.emails.send({
          from: 'PineX <noreply@pinex.in>',
          to: recipient,
          subject: 'Re: Your PineX feedback',
          html: feedbackReplyTemplate(
            u.full_name || 'there',
            String(replyText).trim(),
            originalMessage || '',
            originalRating || 0,
            EMOJIS[originalRating] || '',
          ),
        })
        if (error) {
          console.error('[admin-send-email] feedback_reply rejected:', error)
        }
        fbResults.push({
          email: recipient,
          success: !error,
          error: error?.message || (error ? JSON.stringify(error) : null),
        })
      } catch (err) {
        console.error('[admin-send-email] feedback_reply threw:', err)
        fbResults.push({ email: recipient, success: false, error: err.message })
      }
    }

    const fbSent = fbResults.filter((r) => r.success).length
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sent: fbSent,
        failed: fbResults.length - fbSent,
        success: fbSent > 0,
        results: fbResults,
      }),
    }
  }

  // WHY: Templates live in `email_templates`
  // so admins can edit subject + body in the
  // /admin/email UI without a code change.
  // We fetch ONCE per request (same template
  // for the whole userIds batch).
  const { data: template, error: templateErr } =
    await supabaseAdmin
      .from('email_templates')
      .select('subject, html_body')
      .eq('id', type)
      .single()

  if (templateErr || !template) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: 'Template not found: ' + type,
      })
    }
  }

  // Fetch user data for variable substitution. academy_score is
  // now persisted by useAcademy.js on completion (and backfilled
  // for legacy graduates) so we can pull it directly and surface
  // the real percentage in the {{score}} template variable.
  const { data: users } =
    await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, academy_completed_at, academy_score')
      .in('id', userIds)

  // WHY: Resend's free tier caps at 2 requests/sec.
  // A tight loop over 20 users gets the first ~4
  // through and the rest rejected with "Too many
  // requests". We sleep 600ms between sends to
  // stay safely under 2/sec. Netlify's synchronous-
  // function timeout is 10s on free + 26s on paid,
  // so we cap each invocation at MAX_PER_BATCH to
  // avoid hitting that ceiling. Whatever's left
  // over is reported back as `remaining` so the
  // admin UI can prompt the user to click again
  // for the next batch.
  const MAX_PER_BATCH = 12
  const THROTTLE_MS = 600
  const sleep = (ms) =>
    new Promise((r) => setTimeout(r, ms))

  const usersAll = users || []
  const usersToSend = usersAll.slice(0, MAX_PER_BATCH)
  const remaining = usersAll.length - usersToSend.length

  const results = []

  for (let idx = 0; idx < usersToSend.length; idx++) {
    if (idx > 0) await sleep(THROTTLE_MS)
    const u = usersToSend[idx]
    try {
      // HOW IT WORKS — variable substitution
      //   {{name}}, {{email}}, {{score}},
      //   {{date}}, {{certificate_url}},
      //   {{app_url}} are replaced inline in
      //   both the subject and html_body.
      //   Keep this list in sync with the
      //   "Available variables" card on
      //   /admin/email — if you add a token
      //   here, surface it there too.
      const replaceVars = (str) =>
        (str || '')
          .replace(/\{\{name\}\}/g,
            u.full_name || 'there')
          .replace(/\{\{email\}\}/g,
            u.email || '')
          .replace(/\{\{score\}\}/g,
            // Real percentage from profiles.academy_score.
            // The column is now written by useAcademy.js on
            // completion AND has been backfilled for legacy
            // graduates. Falls back to '—' for any row that
            // somehow still has NULL so a broken template
            // never reads "Score: 0%".
            (u.academy_score != null
              ? String(u.academy_score)
              : '—'))
          .replace(/\{\{date\}\}/g,
            u.academy_completed_at
              ? new Date(u.academy_completed_at)
                  .toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
              : new Date()
                  .toLocaleDateString('en-IN'))
          .replace(/\{\{certificate_url\}\}/g,
            'https://pinex.in/certificate')
          .replace(/\{\{app_url\}\}/g,
            'https://pinex.in')

      const emailData = {
        from: 'PineX <noreply@pinex.in>',
        // testEmail override — see top-of-handler
        // request-shape comment.
        to: testEmail || u.email,
        subject: replaceVars(template.subject),
        html: replaceVars(template.html_body),
      }

      const { error } =
        await resend.emails.send(emailData)

      if (error) {
        // Log the full Resend error to Netlify
        // function logs so the admin can diagnose
        // batch-wide failures (rate limit, domain
        // unverified, invalid key, etc.) without
        // having to read the UI response.
        console.error('[admin-send-email] Resend rejected:', {
          to: testEmail || u.email,
          error_name: error.name,
          error_message: error.message,
          error_statusCode: error.statusCode,
          full: error,
        })
      }

      results.push({
        email: testEmail || u.email,
        success: !error,
        error: error?.message || (error ? JSON.stringify(error) : null),
        error_name: error?.name,
        error_statusCode: error?.statusCode,
      })

    } catch (err) {
      console.error('[admin-send-email] threw:', {
        to: testEmail || u.email,
        message: err.message,
        stack: err.stack,
      })
      results.push({
        email: testEmail || u.email,
        success: false,
        error: err.message,
      })
    }
  }

  const sent = results.filter(
    r => r.success).length
  const failed = results.filter(
    r => !r.success).length

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sent,
      failed,
      results,
      // Number of selected users NOT processed in this
      // invocation (capped by MAX_PER_BATCH). Admin UI
      // prompts the user to re-click to send these.
      remaining,
      batchSize: MAX_PER_BATCH,
    })
  }
}

// ── feedbackReplyTemplate ─────────────────────────────────────
// Inline HTML for the admin → user feedback reply email. Kept
// here (not in email_templates) because the reply text is unique
// per message and shouldn't be a stored, editable template. Dark
// theme to match the PineX app. All interpolated values are
// escaped to avoid breaking the markup or injecting HTML from
// user-supplied feedback.
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function feedbackReplyTemplate(name, reply, originalMsg, rating, emoji) {
  const safeName = escapeHtml(name)
  const safeReply = escapeHtml(reply).replace(/\n/g, '<br>')
  const safeOriginal = escapeHtml(originalMsg)
  const originalBlock = originalMsg
    ? `
    <div style="background:rgba(255,255,255,0.03);border:1px solid #1E2530;border-radius:8px;padding:12px 14px;margin-bottom:20px;">
      <div style="font-size:10px;color:#334155;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Your feedback ${emoji || ''}</div>
      <div style="font-size:12px;color:#475569;line-height:1.6;">${safeOriginal}</div>
    </div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#060810;margin:0;padding:20px;">
  <div style="max-width:480px;margin:0 auto;background:#0F1217;border:1px solid #1E2530;border-radius:16px;overflow:hidden;">
    <div style="height:2px;background:linear-gradient(90deg,transparent,#00C805,transparent);"></div>
    <div style="padding:24px 28px 16px;border-bottom:1px solid #1E2530;">
      <div style="font-size:20px;font-weight:800;color:#E2E8F0;letter-spacing:-0.02em;">pine<span style="color:#00C805;font-weight:900;">X</span></div>
    </div>
    <div style="padding:24px 28px;">
      <h2 style="color:#E2E8F0;font-size:18px;margin:0 0 12px;letter-spacing:-0.02em;">Hi ${safeName} 👋</h2>
      <p style="color:#94A3B8;line-height:1.7;font-size:14px;margin:0 0 16px;">Thank you for your feedback. Here is a personal reply from the PineX team.</p>
      <div style="background:#151A22;border:1px solid #1E2530;border-left:3px solid #00C805;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px;">
        <div style="font-size:14px;color:#E2E8F0;line-height:1.7;">${safeReply}</div>
      </div>
      ${originalBlock}
      <p style="color:#94A3B8;line-height:1.7;font-size:14px;margin:0 0 16px;">We read every piece of feedback and it shapes how PineX evolves. Thank you for being part of the early community.</p>
      <a href="https://pinex.in" style="display:inline-block;background:#00C805;color:#000;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Back to PineX →</a>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #1E2530;background:#0B0E11;font-size:10px;color:#334155;font-style:italic;line-height:1.7;">
      Educational data only. Not investment advice. Not SEBI registered. pinex.in
    </div>
  </div>
</body>
</html>`
}
