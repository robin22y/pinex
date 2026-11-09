/**
 * admin-publish-study — publish / unpublish / archive a Company Study and
 * rebuild the static site (Phase 5).
 *
 * POST { study_company_id, action: 'publish' | 'unpublish' | 'archive' | 'rebuild' }
 *   Authorization: Bearer <the admin's Supabase access token>
 *   (study_company_id is optional for 'rebuild' — a site-wide rebuild)
 *
 * 1. Verifies the caller's Supabase JWT (auth/v1/user), then checks
 *    profiles.role in ('admin','superadmin') with the service key.
 * 2. Applies the status change with the service key
 *    (publish → 'published', unpublish → 'reviewed', archive → 'archived').
 * 3. Debounce: if the build hook fired in the last 3 minutes
 *    (site_content 'system.last_build_hook'), it is NOT fired again and the
 *    response says so ({ queued: false, reason }). Otherwise it POSTs to
 *    NETLIFY_BUILD_HOOK_URL, records the time, and sets
 *    study_companies.last_built_at (needs scripts/sql/studies_v6_publish.sql).
 *
 * The hook URL never leaves this function. Errors are plain words.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_KEY,
 *      NETLIFY_BUILD_HOOK_URL
 */

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const ACTIONS = { publish: 'published', unpublish: 'reviewed', archive: 'archived', rebuild: null }
const DEBOUNCE_MS = 3 * 60 * 1000
const BUILD_KEY = 'system.last_build_hook'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) })
const fail = (statusCode, error) => reply(statusCode, { ok: false, error })

function dbError(prefix, status, text) {
  let msg = text
  try {
    const j = JSON.parse(text)
    msg = j.message || j.error || j.msg || text
  } catch {
    /* plain text */
  }
  if (status === 401 || status === 403) return `${prefix}: the server's database key was rejected. Check SUPABASE_SERVICE_KEY on Netlify.`
  if (/last_built_at/.test(msg)) return `${prefix}: column last_built_at is missing — run scripts/sql/studies_v6_publish.sql.`
  return `${prefix}: ${msg || `HTTP ${status}`}`
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return fail(405, 'Use POST.')

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
  if (!supabaseUrl || !serviceKey) return fail(501, 'The server is missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set them in Netlify → Site configuration → Environment variables.')

  // ── body ──
  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return fail(400, 'The request was not valid JSON.')
  }
  const action = String(body.action || '')
  const studyId = body.study_company_id ? String(body.study_company_id) : null
  if (!(action in ACTIONS)) return fail(400, 'Unknown action. Use publish, unpublish, archive or rebuild.')
  if (action !== 'rebuild' && !studyId) return fail(400, 'study_company_id is required.')
  if (studyId && !UUID.test(studyId)) return fail(400, 'study_company_id is not a valid id.')

  // ── who is calling? ──
  const auth = event.headers?.authorization || event.headers?.Authorization || ''
  const jwt = /^Bearer\s+(.+)$/i.exec(auth)?.[1]
  if (!jwt) return fail(401, 'You are not signed in. Sign in again and retry.')

  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
  const db = (path, init = {}) => fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } })

  let userId
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` } })
    if (!r.ok) return fail(401, 'Your session has expired or is invalid. Sign in again and retry.')
    userId = (await r.json())?.id
  } catch {
    return fail(502, "Couldn't reach Supabase to check your sign-in. Try again in a minute.")
  }
  if (!userId) return fail(401, 'Your session could not be verified. Sign in again.')

  try {
    const r = await db(`profiles?id=eq.${userId}&select=role`)
    if (!r.ok) return fail(502, dbError('Checking your role', r.status, await r.text()))
    const role = (await r.json())[0]?.role
    if (!['admin', 'superadmin'].includes(role)) return fail(403, `Your account's role is "${role || 'none'}". Publishing needs admin or superadmin.`)
  } catch {
    return fail(502, "Couldn't reach Supabase to check your role. Try again in a minute.")
  }

  // ── status change ──
  let study = null
  const warnings = []
  try {
    if (studyId) {
      const r = await db(`study_companies?id=eq.${studyId}&select=id,slug,name,status`)
      if (!r.ok) return fail(502, dbError('Reading the study', r.status, await r.text()))
      study = (await r.json())[0]
      if (!study) return fail(404, 'That study no longer exists.')
    }
    const target = ACTIONS[action]
    if (target && study.status !== target) {
      const r = await db(`study_companies?id=eq.${studyId}&select=id,slug,name,status,published_at,updated_at,version`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: target }),
      })
      if (!r.ok) return fail(502, dbError('Changing the status', r.status, await r.text()))
      study = (await r.json())[0] || study
    }
  } catch {
    return fail(502, "Couldn't reach Supabase to change the status. Nothing was changed.")
  }

  // ── rebuild (debounced) ──
  const now = new Date()
  const hook = process.env.NETLIFY_BUILD_HOOK_URL || ''
  let queued = false
  let reason = null
  let lastBuild = null
  try {
    const r = await db(`site_content?key=eq.${encodeURIComponent(BUILD_KEY)}&select=value`)
    if (r.ok) lastBuild = (await r.json())[0]?.value || null
  } catch {
    /* treated as "no recent build" */
  }
  const lastAt = lastBuild?.at ? new Date(lastBuild.at) : null
  const ago = lastAt ? now - lastAt : Infinity

  if (!hook) {
    reason = 'The status was saved, but NETLIFY_BUILD_HOOK_URL is not set on Netlify, so the live site was not rebuilt.'
  } else if (ago < DEBOUNCE_MS) {
    const secs = Math.round(ago / 1000)
    const wait = Math.ceil((DEBOUNCE_MS - ago) / 1000)
    reason = `A rebuild was started ${secs < 60 ? `${secs} seconds` : `${Math.round(secs / 60)} minute(s)`} ago, so another was not started. If that build began before this change, use "Rebuild site" in about ${Math.ceil(wait / 60)} minute(s) to include it.`
  } else {
    try {
      const title = encodeURIComponent(`Studies: ${action}${study?.slug ? ` ${study.slug}` : ''}`)
      const r = await fetch(`${hook}${hook.includes('?') ? '&' : '?'}trigger_title=${title}`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
      if (!r.ok) {
        reason = `The status was saved, but Netlify refused the rebuild request (HTTP ${r.status}). Check NETLIFY_BUILD_HOOK_URL.`
      } else {
        queued = true
        const value = { at: now.toISOString(), by: userId, action, study_company_id: studyId, slug: study?.slug || null }
        const w = await db('site_content?on_conflict=key', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ key: BUILD_KEY, value, status: 'published' }),
        })
        if (!w.ok) warnings.push(dbError('Recording the build time', w.status, await w.text()))
        if (studyId) {
          const u = await db(`study_companies?id=eq.${studyId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ last_built_at: now.toISOString() }),
          })
          if (!u.ok) warnings.push(dbError('Recording last_built_at', u.status, await u.text()))
        }
      }
    } catch {
      reason = "The status was saved, but Netlify couldn't be reached to start the rebuild. Use \"Rebuild site\" in a minute."
    }
  }

  return reply(200, {
    ok: true,
    action,
    study: study ? { id: study.id, slug: study.slug, name: study.name, status: study.status, published_at: study.published_at, updated_at: study.updated_at, version: study.version } : null,
    queued,
    reason,
    built_at: queued ? now.toISOString() : lastBuild?.at || null,
    page_url: study?.slug ? `/company/${study.slug}` : null,
    warnings,
  })
}
