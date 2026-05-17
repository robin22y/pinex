/**
 * Build PATCH payloads for public.companies — only columns present on the loaded row.
 * Avoids PostgREST 400s from unknown columns (see README schema).
 */

/** Never send these keys even if they appear on a row object. */
const PATCH_DENY = new Set([
  'id',
  'symbol',
  'created_at',
  'updated_at',
  'suspended',
])

/**
 * @param {Record<string, unknown> | null | undefined} companyRow
 * @param {Record<string, unknown>} values
 */
export function buildCompanyPatch(companyRow, values) {
  if (!companyRow) return {}
  const out = {}
  for (const [key, val] of Object.entries(values)) {
    if (PATCH_DENY.has(key)) continue
    if (!(key in companyRow)) continue
    out[key] = val
  }
  return out
}

/** Normalize AI / form description text (DB-friendly plain string). */
export function normalizeCompanyDescription(text) {
  return String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 300)
}

/**
 * @param {import('@supabase/supabase-js').PostgrestError | null} error
 */
export function formatSupabaseError(error) {
  if (!error) return ''
  return [error.message, error.details, error.hint, error.code].filter(Boolean).join(' — ')
}
