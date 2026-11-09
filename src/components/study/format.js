/**
 * format.js — deterministic formatting for Company Study components.
 *
 * Everything here is hand-rolled rather than Intl-based on purpose: the same
 * components render in Node (static prerender) and in the browser (admin
 * preview), and ICU data differs between runtimes. Hand-rolled output is
 * byte-identical in both.
 *
 * Missing values (null / undefined / '' / NaN) always render as DASH —
 * never as 0.
 */

export const DASH = '—'
const MINUS = '−' // U+2212, typographic minus

/** Parse a number from a number or numeric string (PostgREST may send either). */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function isMissing(v) {
  return toNum(v) === null
}

// ── Currency ────────────────────────────────────────────────────────────

const SYMBOLS = {
  INR: '₹',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: 'CN¥',
  HKD: 'HK$',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  NZD: 'NZ$',
  KRW: '₩',
  TWD: 'NT$',
}

/** '₹', 'US$', or the ISO code followed by a space for anything unmapped. */
export function currencySymbol(currency) {
  if (!currency) return ''
  const code = String(currency).toUpperCase()
  return SYMBOLS[code] ?? `${code} `
}

/** Indian lakh/crore digit grouping for INR or lakh/crore units. */
export function usesIndianGrouping(currency, unit) {
  return String(currency || '').toUpperCase() === 'INR' || unit === 'lakh' || unit === 'crore'
}

/** "₹ crore", "US$ million", "€ billion". */
export function unitLabel(currency, unit) {
  return [currencySymbol(currency).trim(), unit].filter(Boolean).join(' ')
}

// ── Numbers ─────────────────────────────────────────────────────────────

function groupDigits(intStr, indian) {
  if (!indian) return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (intStr.length <= 3) return intStr
  const last3 = intStr.slice(-3)
  const rest = intStr.slice(0, -3)
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
}

/** Fewer decimals for big numbers: 1,234 · 85.4 · 4.56 */
export function autoDecimals(n) {
  const a = Math.abs(n)
  if (a >= 100) return 0
  if (a >= 10) return 1
  return 2
}

/**
 * formatNumber(1234567.8, { indian: true }) -> "12,34,568"
 * formatNumber(1234567.8)                   -> "1,234,568"
 */
export function formatNumber(value, { indian = false, decimals } = {}) {
  const n = toNum(value)
  if (n === null) return DASH
  const d = decimals ?? autoDecimals(n)
  const fixed = Math.abs(n).toFixed(d)
  const [int, frac] = fixed.split('.')
  const body = groupDigits(int, indian) + (frac ? `.${frac}` : '')
  const isNeg = n < 0 && Number(fixed) !== 0
  return (isNeg ? MINUS : '') + body
}

/** Number only, grouped for the given currency/unit (for table cells). */
export function formatFigure(value, currency, unit, opts = {}) {
  return formatNumber(value, { indian: usesIndianGrouping(currency, unit), decimals: opts.decimals })
}

/**
 * formatAmount(1234.5, 'INR', 'crore')   -> "₹1,235 crore"
 * formatAmount(48.25, 'USD', 'million')  -> "US$48.3 million"
 * formatAmount(-12, 'INR', 'crore')      -> "−₹12.0 crore"
 */
export function formatAmount(value, currency, unit, opts = {}) {
  const n = toNum(value)
  if (n === null) return DASH
  const num = formatFigure(n, currency, unit, opts)
  const sign = num.startsWith(MINUS) ? MINUS : ''
  const abs = sign ? num.slice(1) : num
  return `${sign}${currencySymbol(currency)}${abs}${unit ? ` ${unit}` : ''}`
}

/** "12.3%" */
export function formatPct(value, decimals = 1) {
  const n = toNum(value)
  if (n === null) return DASH
  return `${formatNumber(n, { decimals })}%`
}

/** "+12.3%" / "−4.0%" — for growth rates. */
export function formatSignedPct(value, decimals = 1) {
  const n = toNum(value)
  if (n === null) return DASH
  const body = formatNumber(n, { decimals })
  return `${n > 0 && body !== formatNumber(0, { decimals }) ? '+' : ''}${body}%`
}

/** "+1.2 pp" — for changes in margins / holdings. */
export function formatPp(value, decimals = 1) {
  const n = toNum(value)
  if (n === null) return DASH
  const body = formatNumber(n, { decimals })
  return `${n > 0 && body !== formatNumber(0, { decimals }) ? '+' : ''}${body} pp`
}

/** Growth in % from prev to curr. Null when prev is missing or not positive. */
export function growth(curr, prev) {
  const c = toNum(curr)
  const p = toNum(prev)
  if (c === null || p === null || p <= 0) return null
  return ((c - p) / p) * 100
}

/** num / den in %. Null when den is missing or not positive. */
export function margin(num, den) {
  const n = toNum(num)
  const d = toNum(den)
  if (n === null || d === null || d <= 0) return null
  return (n / d) * 100
}

// ── Dates ───────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dateParts(value) {
  if (!value) return null
  const s = value instanceof Date ? value.toISOString() : String(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { y: Number(m[1]), m: month, d: Number(m[3]) }
}

/** "8 Nov 2026". Reads the YYYY-MM-DD part only, so no timezone drift. */
export function formatDate(value) {
  const p = dateParts(value)
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : DASH
}

/** "Nov 2026" */
export function formatMonthYear(value) {
  const p = dateParts(value)
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : DASH
}

/** "2026-11-08" for <time dateTime>. */
export function isoDate(value) {
  const p = dateParts(value)
  if (!p) return undefined
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** The row's own fiscal_label, else "Sep 2026" from period_end. */
export function fiscalLabel(row) {
  const label = typeof row?.fiscal_label === 'string' ? row.fiscal_label.trim() : ''
  if (label) return label
  return row?.period_end ? formatMonthYear(row.period_end) : DASH
}

// ── URLs ────────────────────────────────────────────────────────────────

/** Only http(s), mailto, same-site paths and in-page anchors are linked. */
export function safeHref(url) {
  if (typeof url !== 'string') return null
  const u = url.trim()
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u
  if (u.startsWith('#')) return u
  if (u.startsWith('/') && !u.startsWith('//')) return u
  return null
}

/** Images: http(s) or same-site paths only. */
export function safeSrc(url) {
  if (typeof url !== 'string') return null
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('/') && !u.startsWith('//')) return u
  return null
}
