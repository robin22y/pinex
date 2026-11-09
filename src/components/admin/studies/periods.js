/**
 * Period-data helpers for the Studies admin (Phase 4b): metric lists,
 * spreadsheet paste parsing, fiscal-quarter suggestion, revision history,
 * and the non-blocking sanity checks.
 */
import { finKey, latestRevisions, segKey, shKey } from '../../study/data.js'
import { CATEGORY_LABELS } from '../../study/labels.js'
import { growth, margin, toNum } from '../../study/format.js'

// ── Metrics ─────────────────────────────────────────────────────────────

// [key, label, aliases for paste matching, { perShare }]
export const FIN_FIELDS = [
  { key: 'revenue', label: 'Revenue', aliases: ['revenue from operations', 'sales', 'net sales', 'total revenue', 'turnover', 'income from operations'] },
  { key: 'ebitda', label: 'EBITDA', aliases: ['operating profit', 'pbdit', 'ebitda before other income'] },
  { key: 'pat', label: 'Profit after tax', aliases: ['pat', 'net profit', 'profit for the period', 'net income', 'profit after tax'] },
  { key: 'eps', label: 'EPS', perShare: true, aliases: ['earnings per share', 'diluted eps', 'basic eps'] },
  { key: 'other_income', label: 'Other income', aliases: ['other income'] },
  { key: 'cfo', label: 'Cash from operations', aliases: ['cfo', 'operating cash flow', 'cash flow from operations', 'net cash from operating activities'] },
  { key: 'capex', label: 'Capex', aliases: ['capital expenditure', 'purchase of fixed assets', 'purchase of ppe'] },
  { key: 'total_debt', label: 'Total debt', aliases: ['debt', 'borrowings', 'total borrowings', 'gross debt'] },
  { key: 'cash', label: 'Cash', aliases: ['cash and equivalents', 'cash and cash equivalents', 'cash & bank', 'cash and bank'] },
]
export const FIN_KEYS = FIN_FIELDS.map((f) => f.key)

export const SH_CATEGORIES = Object.keys(CATEGORY_LABELS)
const SH_ALIASES = {
  promoter_insider: ['promoter', 'promoters', 'promoter group', 'insiders', 'promoter & promoter group'],
  institutional_foreign: ['fii', 'fpi', 'fiis', 'fpis', 'foreign institutions', 'foreign portfolio investors'],
  institutional_domestic: ['dii', 'diis', 'domestic institutions'],
  mutual_funds: ['mf', 'mutual fund', 'mutual funds'],
  insurance: ['insurance', 'insurance companies'],
  public_retail: ['public', 'retail', 'public / retail', 'non-institutions', 'individuals'],
  government: ['government', 'govt'],
  other: ['other', 'others'],
}
export const SH_FIELDS = SH_CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key], aliases: SH_ALIASES[key] || [] }))

// ── Number parsing ──────────────────────────────────────────────────────

// Non-breaking and narrow no-break spaces (Excel and Sheets paste them).
const NBSP_RE = new RegExp(`[${String.fromCharCode(160, 8239)}]`, 'g')

/**
 * "1,234.5" → 1234.5 · "(123)" → -123 · "-" / "—" / "" → null · "12.5%" → 12.5
 * Returns undefined when the text is not a number at all.
 */
export function parseNumberCell(s) {
  if (s === null || s === undefined) return null
  if (typeof s === 'number') return Number.isFinite(s) ? s : undefined
  let t = String(s).trim().replace(NBSP_RE, ' ')
  if (t === '' || /^[-–—]+$/.test(t) || /^(na|n\/a|nil)$/i.test(t)) return null
  let neg = false
  const paren = /^\((.*)\)$/.exec(t)
  if (paren) {
    neg = true
    t = paren[1]
  }
  t = t.replace(/[₹$€£¥%\s,]/g, '').replace(/^(rs\.?|inr|usd)/i, '').replace(/[−–]/g, '-')
  if (t === '' || t === '-') return null
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return undefined
  const n = Number(t)
  return neg ? -Math.abs(n) : n
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function matchField(label, fields) {
  const l = norm(label)
  if (!l) return null
  for (const f of fields) if (norm(f.key) === l || norm(f.label) === l) return f
  for (const f of fields) if (f.aliases?.some((a) => norm(a) === l)) return f
  for (const f of fields) if (f.aliases?.some((a) => l.includes(norm(a))) || l.includes(norm(f.label))) return f
  return null
}

/** True when the pasted text looks like spreadsheet cells (tab or several lines). */
export const looksLikeSheet = (text) => /\t|\n./.test(String(text || '').trim())

/**
 * Parse a paste from Excel / Google Sheets for a fixed list of fields.
 *   label + value columns → matched by label (key, label or alias)
 *   a single column       → values in field order
 * → { values: { key: number|null }, unmatched: [label], invalid: [text], mode }
 */
export function parseFieldPaste(text, fields) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '')
  const cells = lines.map((l) => l.split('\t'))
  const values = {}
  const unmatched = []
  const invalid = []
  const multi = cells.some((c) => c.length > 1)
  if (!multi) {
    cells.forEach((c, i) => {
      if (i >= fields.length) return
      const v = parseNumberCell(c[0])
      if (v === undefined) invalid.push(c[0])
      else values[fields[i].key] = v
    })
    return { values, unmatched, invalid, mode: 'column' }
  }
  for (const c of cells) {
    const label = c[0]
    const valueText = c.slice(1).find((x) => x.trim() !== '') ?? ''
    // Derived rows (margins, growth) must not overwrite the base figure.
    const f = /margin|%|growth|yoy|qoq|y-o-y|q-o-q|change/i.test(label) ? null : matchField(label, fields)
    if (!f) {
      if (label.trim()) unmatched.push(label.trim())
      continue
    }
    const v = parseNumberCell(valueText)
    if (v === undefined) invalid.push(`${label}: ${valueText}`)
    else values[f.key] = v
  }
  return { values, unmatched, invalid, mode: 'labels' }
}

/**
 * Rows of "name \t n1 \t n2 …" (segments: name, revenue, ebit;
 * ownership: holder, pct_to  or  holder, pct_from, pct_to).
 * → [{ name, nums: [number|null] }]
 */
export function parseRowsPaste(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const c = l.split('\t')
      return { name: c[0].trim(), nums: c.slice(1).map((x) => parseNumberCell(x) ?? null) }
    })
    .filter((r) => r.name && !/^(segment|holder|name|category)s?$/i.test(r.name))
}

export function matchShareCategory(label) {
  return matchField(label, SH_FIELDS)?.key ?? null
}

// ── Dates and fiscal quarters ───────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')
/** Last day of month m (1–12) of year y as YYYY-MM-DD. */
export function monthEnd(y, m) {
  const yy = y + Math.floor((m - 1) / 12)
  const mm = ((((m - 1) % 12) + 12) % 12) + 1
  const d = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  return `${yy}-${pad(mm)}-${pad(d)}`
}
const ym = (iso) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''))
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null
}
/** Same month-end n months later (n may be negative). */
export function shiftMonths(iso, n) {
  const p = ym(iso)
  return p ? monthEnd(p.y, p.m + n) : null
}

/**
 * Fiscal label for a quarter ending on iso, for a fiscal year ending in
 * month fy (1–12). FY ending in March: Sep 2026 → "Q2 FY27".
 * Calendar-year reporters (fy = 12): "Q3 2026".
 */
export function quarterLabel(iso, fy = 3) {
  const p = ym(iso)
  if (!p) return ''
  const f = Number(fy) || 12
  const q = Math.floor(((p.m - f - 1 + 24) % 12) / 3) + 1
  const fyYear = p.m <= f ? p.y : p.y + 1
  return f === 12 ? `Q${q} ${fyYear}` : `Q${q} FY${String(fyYear).slice(-2)}`
}

/** Is iso a quarter end for this fiscal year? */
export const isQuarterEnd = (iso, fy = 3) => {
  const p = ym(iso)
  return Boolean(p) && ((p.m - (Number(fy) || 12)) % 3 + 3) % 3 === 0
}

/**
 * Next period to enter: 3 months after the latest 'Q' period_end; with no
 * quarters yet, the latest fiscal quarter end at least ~45 days ago.
 */
export function suggestNextQuarter(financialRows, fy, today = new Date()) {
  const qs = (financialRows || []).filter((r) => r.period_type === 'Q' && r.period_end).map((r) => r.period_end).sort()
  let end
  if (qs.length) end = shiftMonths(qs[qs.length - 1], 3)
  else {
    const t = new Date(today.getTime() - 45 * 864e5)
    let y = t.getUTCFullYear()
    let m = t.getUTCMonth() + 1
    for (let i = 0; i < 3 && !isQuarterEnd(monthEnd(y, m), fy); i++) m -= 1
    if (m < 1) {
      m += 12
      y -= 1
    }
    end = monthEnd(y, m)
  }
  return { period_end: end, fiscal_label: quarterLabel(end, fy) }
}

// ── Revisions ───────────────────────────────────────────────────────────

export const KEY_FNS = { financial: finKey, segment: segKey, shareholding: shKey }

/** Map(key → latest row). */
export function latestMap(rows, keyFn) {
  return new Map(latestRevisions(rows, keyFn).map((r) => [keyFn(r), r]))
}

/** All revisions of one key, newest first. */
export function revisionsOf(rows, keyFn, key) {
  return (rows || []).filter((r) => keyFn(r) === key).sort((a, b) => (toNum(b.revision) ?? 1) - (toNum(a.revision) ?? 1))
}

/** Next revision number for a key. */
export function nextRevision(rows, keyFn, key) {
  return (rows || []).filter((r) => keyFn(r) === key).reduce((m, r) => Math.max(m, toNum(r.revision) ?? 1), 0) + 1
}

/** Latest row for a Q period n months before iso (same basis). */
export function comparable(latestRows, iso, months, basis, type = 'Q') {
  const target = shiftMonths(iso, -months)
  return latestRows.find((r) => r.period_type === type && r.basis === basis && r.period_end === target) || null
}

// ── Sanity checks (non-blocking) ────────────────────────────────────────

/**
 * → [string] warnings.
 * fin: { key: number|null }, prevQ: latest row of last quarter, exists: boolean
 */
export function financialWarnings(fin, prevQ, { exists, label } = {}) {
  const w = []
  if (exists) w.push(`${label || 'This period'} already exists — saving creates a new revision (a correction); the old figures stay in history.`)
  const rev = toNum(fin.revenue)
  if (rev !== null && rev < 0) w.push('Revenue is negative.')
  if (rev !== null && toNum(fin.ebitda) !== null && toNum(fin.ebitda) > rev) w.push('EBITDA is larger than revenue.')
  if (prevQ) {
    for (const f of FIN_FIELDS) {
      const a = toNum(fin[f.key])
      const b = toNum(prevQ[f.key])
      if (a === null || b === null || b === 0) continue
      const change = ((a - b) / Math.abs(b)) * 100
      if (Math.abs(change) > 50) w.push(`${f.label} changed ${change > 0 ? '+' : ''}${change.toFixed(0)}% vs last quarter — check the unit and sign.`)
    }
  }
  return w
}

export function shareholdingTotal(values) {
  const nums = Object.values(values).map(toNum).filter((v) => v !== null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null
}

export function shareholdingWarning(total) {
  if (total === null) return null
  if (total < 99.5 || total > 100.5) return `Shareholding adds up to ${total.toFixed(2)}%, not 100% (allowed 99.5–100.5%).`
  return null
}

/** YoY / QoQ / margins for the wizard's live comparisons. */
export function liveStats(fin, prevQ, yearAgo) {
  return {
    yoy: (k) => growth(fin[k], yearAgo?.[k]),
    qoq: (k) => growth(fin[k], prevQ?.[k]),
    ebitdaMargin: margin(fin.ebitda, fin.revenue),
    patMargin: margin(fin.pat, fin.revenue),
    ebitdaMarginPrev: prevQ ? margin(prevQ.ebitda, prevQ.revenue) : null,
    patMarginPrev: prevQ ? margin(prevQ.pat, prevQ.revenue) : null,
  }
}
