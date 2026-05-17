/**
 * Returns all Supabase Auth users merged with their profiles rows.
 * Uses supabase.auth.admin API (service key required).
 *
 * GET → { ok: true, users: [...], total: N }
 * Each user: { id, email, created_at, last_sign_in_at, ...profileFields }
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const https = require('https')

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function fetchAuthUsersPage(supabaseUrl, serviceKey, page, perPage) {
  const host = new URL(supabaseUrl).hostname
  const path = `/auth/v1/admin/users?page=${page}&per_page=${perPage}`
  return httpsGet(host, path, {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  })
}

async function fetchProfiles(supabaseUrl, serviceKey) {
  const host = new URL(supabaseUrl).hostname
  const path = '/rest/v1/profiles?select=*&limit=10000'
  return httpsGet(host, path, {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  })
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 501,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: `Missing env: ${!supabaseUrl ? 'SUPABASE_URL' : ''} ${!serviceKey ? 'SUPABASE_SERVICE_KEY' : ''}`.trim() }),
    }
  }

  try {
    // Always fetch profiles first with service key (bypasses RLS — shows all users)
    const profRes = await fetchProfiles(supabaseUrl, serviceKey)
    const profiles = Array.isArray(profRes.body) ? profRes.body : []
    const profileMap = {}
    for (const p of profiles) profileMap[p.id] = p

    // Try auth admin API for emails + sign-in times
    const allAuthUsers = []
    let authError = null
    const perPage = 1000
    for (let page = 1; page <= 5; page++) {
      const res = await fetchAuthUsersPage(supabaseUrl, serviceKey, page, perPage)
      if (res.status !== 200) {
        authError = `Auth API ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`
        break
      }
      const users = res.body?.users || []
      allAuthUsers.push(...users)
      if (users.length < perPage) break
    }

    let users
    if (allAuthUsers.length > 0) {
      // Full merge: auth users + profile data
      users = allAuthUsers.map((u) => {
        const prof = profileMap[u.id] || {}
        return {
          id: u.id,
          email: u.email || prof.email || '',
          phone: u.phone || '',
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
          plan: prof.plan || 'free',
          banned: prof.banned || u.banned || false,
          full_name: prof.full_name || u.user_metadata?.full_name || '',
          avatar_url: prof.avatar_url || u.user_metadata?.avatar_url || '',
          role: prof.role || u.role || 'authenticated',
          provider: u.app_metadata?.provider || '',
        }
      })
    } else {
      // Fallback: profiles only (no last_sign_in_at, but all users visible)
      users = profiles.map((p) => ({
        id: p.id,
        email: p.email || '',
        created_at: p.created_at,
        plan: p.plan || 'free',
        banned: p.banned || false,
        full_name: p.full_name || '',
        avatar_url: p.avatar_url || '',
        role: p.role || 'authenticated',
      }))
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: true,
        users,
        total: users.length,
        ...(authError ? { warning: `Auth API unavailable (${authError}) — showing profiles only` } : {}),
      }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    }
  }
}
