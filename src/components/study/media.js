/**
 * media.js — helpers for study_media objects.
 *
 * A media object is a study_media row as the components receive it:
 *   { variants: [{ width, path, format }], width, height, alt_text, credit,
 *     caption, focal_x, focal_y, storage_path? }
 *
 * Variant paths must already be URLs (https://… or /…) when they reach a
 * component. Loaders turn bucket paths into public URLs with
 * withMediaBase(media, `${SUPABASE_URL}/storage/v1/object/public/study-media/`).
 *
 * Rule enforced here: an image renders only with non-empty alt_text AND
 * credit AND width/height AND at least one usable URL.
 */
import { hasText } from './data.js'
import { safeSrc, toNum } from './format.js'

const FALLBACK_ORDER = ['jpeg', 'jpg', 'png', 'webp', 'avif']
const MIME = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png' }

function formatOf(v) {
  const f = String(v?.format || '').toLowerCase()
  if (f) return f === 'jpg' ? 'jpeg' : f
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(String(v?.path || ''))
  return m ? (m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()) : 'jpeg'
}

/**
 * { fallback: { src, srcSet }, sources: [{ type, srcSet }] } or null.
 * Modern formats (avif, webp) become <source>s when a more compatible
 * fallback format exists; otherwise everything goes on the <img>.
 */
export function mediaSources(media) {
  const variants = (Array.isArray(media?.variants) ? media.variants : [])
    .map((v) => ({ width: toNum(v?.width), src: safeSrc(v?.path), format: formatOf(v) }))
    .filter((v) => v.src)
  if (!variants.length) {
    const src = safeSrc(media?.storage_path)
    return src ? { fallback: { src, srcSet: undefined }, sources: [] } : null
  }
  const byFormat = new Map()
  for (const v of variants) {
    if (!byFormat.has(v.format)) byFormat.set(v.format, [])
    byFormat.get(v.format).push(v)
  }
  for (const list of byFormat.values()) list.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  const fallbackFormat = FALLBACK_ORDER.find((f) => byFormat.has(f)) ?? [...byFormat.keys()][0]
  const srcSetOf = (list) =>
    list.every((v) => v.width) ? list.map((v) => `${v.src} ${v.width}w`).join(', ') : undefined
  const fb = byFormat.get(fallbackFormat)
  // Middle-sized variant as the plain src: a sensible default for browsers ignoring srcset.
  const mid = fb[Math.floor((fb.length - 1) / 2)]
  const sources = ['avif', 'webp']
    .filter((f) => f !== fallbackFormat && byFormat.has(f))
    .map((f) => ({ type: MIME[f], srcSet: srcSetOf(byFormat.get(f)) }))
    .filter((s) => s.srcSet)
  return { fallback: { src: mid.src, srcSet: srcSetOf(fb) }, sources }
}

export function hasMedia(media) {
  return Boolean(
    media &&
      hasText(media.alt_text) &&
      hasText(media.credit) &&
      toNum(media.width) > 0 &&
      toNum(media.height) > 0 &&
      mediaSources(media),
  )
}

/** CSS object-position from focal_x / focal_y (0–1, default centre). */
export function objectPosition(media) {
  const clamp = (v) => Math.min(1, Math.max(0, toNum(v) ?? 0.5))
  return `${Math.round(clamp(media?.focal_x) * 100)}% ${Math.round(clamp(media?.focal_y) * 100)}%`
}

/** Prefix bucket-relative paths with the public bucket URL (for loaders). */
export function withMediaBase(media, baseUrl) {
  if (!media) return media
  const base = String(baseUrl || '').replace(/\/?$/, '/')
  const fix = (p) => (typeof p === 'string' && p && !/^(https?:)?\//i.test(p) ? base + p.replace(/^\/+/, '') : p)
  return {
    ...media,
    storage_path: fix(media.storage_path),
    variants: (Array.isArray(media.variants) ? media.variants : []).map((v) => ({ ...v, path: fix(v?.path) })),
  }
}

// ── Links ───────────────────────────────────────────────────────────────

export const studyHref = (slug) => (slug ? `/company/${encodeURIComponent(slug)}` : null)
export const seriesHref = (slug) => (slug ? `/series/${encodeURIComponent(slug)}` : null)

/** "{n} min read" → "7 min read". Returns null when the template is missing. */
export function fillTemplate(template, n) {
  if (!hasText(template) || toNum(n) === null) return null
  return template.replace(/\{n\}/g, String(n))
}
