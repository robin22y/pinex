const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  // Only POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405 }
  }

  // Auth check — must have valid admin session token
  const authHeader = event.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')

  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    }
  }

  // Create admin client with service key
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Verify the token belongs to an admin
  const { data: { user }, error: authErr } =
    await supabaseAdmin.auth.getUser(token)

  if (authErr || !user) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid token' }),
    }
  }

  // Check admin role
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!['admin', 'superadmin'].includes(profile?.role)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Not admin' }),
    }
  }

  // Parse body
  const { email, name, waitlistId } = JSON.parse(event.body || '{}')

  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Email required' }),
    }
  }

  try {
    // Send Supabase invite
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: name,
        invited_from_waitlist: true,
      },
      redirectTo: `${process.env.SITE_URL || 'https://pinex.in'}/login`,
    })

    if (error) throw error

    // Update waitlist status
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

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, email }),
    }
  } catch (err) {
    console.error('Invite error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
