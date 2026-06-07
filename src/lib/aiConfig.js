// ── aiConfig ─────────────────────────────────────────────────────────────
// Thin wrapper around the ai_config table. Reads are public; writes are
// gated by RLS to admin/superadmin. Every caller in the browser passes
// a hardcoded fallback so a missing/stale row never breaks the call —
// the DB is a hot-swap channel, not a hard dependency.
//
// Caching: getAiConfig() memoises per-key for the lifetime of the page
// (Map keyed by config_key). Reload to refresh. This matters because
// the Research Assistant fetches the model on every askGemini call —
// without the cache we'd waste a Supabase round-trip per question.

import { supabase } from './supabase'

const _cache = new Map()       // key -> resolved value
const _inflight = new Map()    // key -> Promise<value>   (de-dupes concurrent calls)

/**
 * Fetch a single ai_config value by key, with an optional fallback.
 *   model = await getAiConfig('gemini_research_model', 'gemini-2.5-flash')
 *
 * Returns the fallback if:
 *   - row doesn't exist, OR
 *   - is_active=false, OR
 *   - the network call fails.
 *
 * Once resolved (even to fallback), the value is cached for the rest of
 * the session. Call clearAiConfigCache() to force a refresh — used by
 * the admin UI immediately after a row update so the change takes
 * effect without a page reload.
 */
export async function getAiConfig(key, fallback = null) {
  if (_cache.has(key)) return _cache.get(key)
  if (_inflight.has(key)) return _inflight.get(key)

  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .from('ai_config')
        .select('config_value')
        .eq('config_key', key)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      const value = data?.config_value || fallback
      _cache.set(key, value)
      return value
    } catch {
      _cache.set(key, fallback)
      return fallback
    } finally {
      _inflight.delete(key)
    }
  })()
  _inflight.set(key, promise)
  return promise
}

/**
 * Pull every active config row, ordered by category. Used by the admin
 * UI to render the inline-edit table. Returns [] on any failure.
 */
export async function getAllAiConfig() {
  try {
    const { data } = await supabase
      .from('ai_config')
      .select('*')
      .order('category', { ascending: true })
      .order('config_key', { ascending: true })
    return data || []
  } catch {
    return []
  }
}

/**
 * Update one row by config_key. Pass an updatedBy string (admin email)
 * so the audit column reflects who made the change. Clears the cached
 * value so subsequent getAiConfig() calls return the new model name.
 */
export async function updateAiConfig(configKey, patch, updatedBy = null) {
  const updates = {
    ...patch,
    updated_at: new Date().toISOString(),
  }
  if (updatedBy) updates.updated_by = updatedBy
  const { data, error } = await supabase
    .from('ai_config')
    .update(updates)
    .eq('config_key', configKey)
    .select()
    .maybeSingle()
  if (error) throw error
  _cache.delete(configKey)
  return data
}

/**
 * Validate a model name format. Returns { ok, warning } — never blocks.
 * The check is heuristic: accepts gemini-MAJOR.MINOR-(flash|pro|ultra)
 * with optional -lite / -preview / arbitrary trailing suffix. Any other
 * shape produces a warning the admin UI surfaces with "Saving anyway."
 */
export function validateModelName(name) {
  if (!name || typeof name !== 'string') {
    return { ok: false, warning: 'Empty model name.' }
  }
  const pattern = /^gemini-[0-9]+(\.[0-9]+)?-(flash|pro|ultra)(-lite)?(-preview)?(-[a-z0-9-]+)?$/i
  if (pattern.test(name)) return { ok: true, warning: '' }
  return {
    ok: false,
    warning: 'This model name looks unusual. Make sure it matches exactly what Google AI Studio shows.',
  }
}

/**
 * Test a model by making a minimal Gemini call against the caller's
 * API key. Returns { ok, message }. Used by the "Test this model"
 * button per row in the admin UI.
 *
 * The apiKey arg is required — pulled from the admin's own browser
 * (localStorage pinex_gemini_key) so a server-side key isn't required
 * to validate model availability.
 */
export async function testModel(modelName, apiKey) {
  if (!modelName || !apiKey) {
    return { ok: false, message: 'Missing model name or API key.' }
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say: ok' }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0 },
      }),
    })
    if (res.ok) return { ok: true, message: 'Model responding correctly' }
    const body = await res.json().catch(() => ({}))
    return { ok: false, message: body?.error?.message || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, message: e?.message || 'Network error' }
  }
}

/**
 * Clear cached value(s). Pass a key to invalidate a single entry; no
 * args clears all.
 */
export function clearAiConfigCache(key) {
  if (key) _cache.delete(key)
  else _cache.clear()
}
