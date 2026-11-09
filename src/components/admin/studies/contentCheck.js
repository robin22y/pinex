/**
 * Non-blocking content check: whole-word scan for advice-like language.
 * Longer phrases are listed first so "strong buy" is reported once, not
 * also as "buy".
 */
export const FLAGGED_TERMS = ['strong buy', 'target price', 'multibagger', 'undervalued', 'buy', 'sell']

const RE = new RegExp(`\\b(${FLAGGED_TERMS.map((t) => t.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi')

/**
 * scanText('Story', text) → [{ where, term, excerpt }]
 */
export function scanText(where, text) {
  if (typeof text !== 'string' || !text) return []
  const hits = []
  for (const m of text.matchAll(RE)) {
    const start = Math.max(0, m.index - 30)
    const end = Math.min(text.length, m.index + m[0].length + 30)
    hits.push({
      where,
      term: m[0].toLowerCase().replace(/\s+/g, ' '),
      excerpt: `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`,
    })
  }
  return hits
}

/** Scan several fields: fields = { key: label }. */
export function scanFields(obj, fields, prefix = '') {
  return Object.entries(fields).flatMap(([key, label]) => scanText(prefix ? `${prefix} · ${label}` : label, obj?.[key]))
}
