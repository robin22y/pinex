// Returns ALL user feedback for admins, joined with author identity.
//
// The client-side FeedbackSummary widget can only read feedback the row-level
// security policy lets through. That policy is brittle (it was written against
// a hardcoded email), so admins frequently saw nothing. This function instead
// verifies the caller is an admin via their bearer token + profiles.role —
// the SAME gate admin-send-email uses — then reads feedback with the SERVICE
// key, which bypasses RLS entirely. So any admin reliably sees every user's
// feedback regardless of how the table's RLS is configured.
//
// GET  (Authorization: Bearer <access_token>)
//   → { ok: true, feedback: [ { id, rating, message, page, created_at,
//        user_id, admin_reply?, replied_at?, profiles: {email, full_name} } ] }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js')

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 501, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Missing Supabase service env' }) }
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) }
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify the caller is an admin (same gate as admin-send-email).
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user?.id) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Invalid session' }) }
  }
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'superadmin') {
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Not admin' }) }
  }

  // Service key bypasses RLS → admin sees every user's feedback. select('*')
  // is resilient to the optional reply columns not being deployed.
  const { data: rows, error } = await admin
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: error.message }) }
  }

  // Hydrate author identity (email / name) for display.
  const ids = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))]
  const byId = {}
  if (ids.length) {
    const { data: profs } = await admin.from('profiles').select('id, email, full_name').in('id', ids)
    profs?.forEach((p) => { byId[p.id] = p })
  }
  const feedback = (rows || []).map((r) => ({ ...r, profiles: byId[r.user_id] || null }))

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, feedback }) }
}
