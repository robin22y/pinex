// This function sends invite emails
// for user-to-user invites
// No admin auth required —
// invite code is the authentication

// WHY: 'ws' is required for the same reason as
// invite-user.js — Node 20 has no native
// WebSocket and Supabase Realtime crashes
// without it. The createClient call below
// passes it in via `global: { WebSocket: ws }`.
const ws = require('ws')
const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405 }
  }

  const supabaseAdmin = createClient(
    (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, ''),
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { WebSocket: ws },
    }
  )

  const { email, name, inviteCode } = JSON.parse(event.body || '{}')

  if (!email || !inviteCode) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Email and invite code required' }),
    }
  }

  // Validate invite code
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, invite_credits')
    .eq('invite_code', inviteCode)
    .single()

  if (!profile || profile.invite_credits <= 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid or expired invite' }),
    }
  }

  try {
    // Send invite email
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: name,
        invited_by_code: inviteCode,
        invited_by_user: profile.id,
      },
      redirectTo: `${process.env.SITE_URL || 'https://pinex.in'}/welcome`,
    })

    if (error) throw error

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    }
  }
}
