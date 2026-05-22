const ws = require('ws')
const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) }
  }

  try {
    const { email, name, inviteCode } = JSON.parse(event.body || '{}')

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) }
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { WebSocket: ws },
    })

    // Verify invite code still has credits
    const { data: inviter } = await supabaseAdmin
      .from('profiles')
      .select('id, invite_credits')
      .eq('invite_code', inviteCode)
      .single()

    if (!inviter || inviter.invite_credits <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invite link has no credits remaining' }) }
    }

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: name,
        invited_from_waitlist: true,
        invite_code_used: inviteCode,
      },
      redirectTo: `${process.env.SITE_URL || 'https://pinex.in'}/welcome`,
    })

    if (inviteError) {
      return { statusCode: 500, body: JSON.stringify({ error: inviteError.message }) }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) }

  } catch (err) {
    console.error('accept-invite crash:', err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) }
  }
}
