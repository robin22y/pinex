const ws = require('ws')
const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Missing env vars: ${!supabaseUrl ? 'SUPABASE_URL ' : ''}${!serviceKey ? 'SUPABASE_SERVICE_KEY' : ''}`.trim() },
    )}
  }

  const authHeader = event.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '').trim()

  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        WebSocket: ws,
      },
    })

    const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    const user = userData?.user

    if (authErr || !user) {
      return { statusCode: 401, body: JSON.stringify({ error: `Invalid token: ${authErr?.message || 'no user'}` }) }
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'robin22y@gmail.com'
    const isAdmin =
      ['admin', 'superadmin'].includes(profile?.role) ||
      user.email === ADMIN_EMAIL

    if (!isAdmin) {
      return { statusCode: 403, body: JSON.stringify({ error: `Not admin (role: ${profile?.role}, email: ${user.email})` }) }
    }

    const { email, name, waitlistId } = JSON.parse(event.body || '{}')

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) }
    }

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: name,
        invited_from_waitlist: true,
      },
      redirectTo: `${process.env.SITE_URL || 'https://pinex.in'}/welcome`,
    })

    if (inviteError) {
      return { statusCode: 500, body: JSON.stringify({ error: inviteError.message }) }
    }

    if (waitlistId) {
      await supabaseAdmin
        .from('waitlist')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: user.email,
        })
        .eq('id', waitlistId)
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, email }) }

  } catch (err) {
    console.error('invite-user crash:', err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) }
  }
}
