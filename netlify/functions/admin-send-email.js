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
  const { type, userIds, testEmail } =
    JSON.parse(event.body || '{}')

  if (!type || !userIds?.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'type and userIds required'
      })
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

  // Fetch user data for variable substitution.
  // academy_completed_at is selected (and not
  // academy_score yet — see earlier WHY comment).
  const { data: users } =
    await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, ' +
              'academy_completed_at')
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
            // academy_score column not
            // confirmed yet — placeholder.
            '0')
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
