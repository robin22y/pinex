/**
 * labels.js — display labels and text helpers for the study components.
 * Kept out of the .jsx files so those export components only (React
 * fast-refresh rule) and so the admin editor can reuse the same wording.
 */
import { formatDate, formatPct, isoDate, toNum } from './format.js'
import { ownershipDirection } from './data.js'

export const DEVELOPMENT_LABELS = {
  filing: 'Filing',
  order: 'Order',
  management: 'Management',
  capex: 'Capex',
  regulatory: 'Regulatory',
  other: 'Other',
}

export const HOLDER_TYPE_LABELS = {
  fii: 'Foreign institution',
  mf: 'Mutual fund',
  insurance: 'Insurance company',
  dii_other: 'Domestic institution',
  promoter: 'Promoter / insider',
  other: 'Other',
}

export function ownershipSentence(o) {
  const dir = ownershipDirection(o)
  const from = formatPct(o.pct_from, 2)
  const to = formatPct(o.pct_to, 2)
  if (dir === 'new') return `${o.holder_name} disclosed a holding of ${to}, with no holding disclosed at the start of the period.`
  if (dir === 'exit') return `${o.holder_name} changed its disclosed holding from ${from} to no disclosed holding.`
  return `${o.holder_name} changed its disclosed holding from ${from} to ${to}.`
}

export const SEVERITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' }

export const CATEGORY_LABELS = {
  promoter_insider: 'Promoters / insiders',
  institutional_foreign: 'Foreign institutions',
  institutional_domestic: 'Domestic institutions',
  mutual_funds: 'Mutual funds',
  insurance: 'Insurance companies',
  public_retail: 'Public / retail',
  government: 'Government',
  other: 'Other',
}

export const BYLINE = 'PineX Research'

// Small fixed map (ICU country names differ between Node and browsers).
const COUNTRIES = {
  IN: 'India', US: 'United States', GB: 'United Kingdom', JP: 'Japan', DE: 'Germany',
  FR: 'France', NL: 'Netherlands', CH: 'Switzerland', SE: 'Sweden', DK: 'Denmark',
  KR: 'South Korea', TW: 'Taiwan', CN: 'China', HK: 'Hong Kong', SG: 'Singapore',
  AU: 'Australia', CA: 'Canada', IT: 'Italy', ES: 'Spain', IE: 'Ireland', IL: 'Israel',
  BR: 'Brazil', ZA: 'South Africa', NO: 'Norway', FI: 'Finland', BE: 'Belgium',
}

export const countryName = (code) => (code ? COUNTRIES[String(code).toUpperCase()] ?? code : null)

export const LEVEL_LABELS = {
  tam: 'Total addressable market',
  sam: 'Serviceable market',
  company_opportunity: 'Company opportunity',
}

export const ESTIMATE_LABELS = {
  company: 'Company estimate',
  third_party: 'Third-party estimate',
  pinex_calc: 'PineX calculation',
}

export function whenLabel(row) {
  if (row?.event_date) return { text: formatDate(row.event_date), dateTime: isoDate(row.event_date) }
  const y = toNum(row?.event_year)
  return y !== null ? { text: String(y), dateTime: String(y) } : null
}

/**
 * Neutral one-sentence summary for aria-label:
 * "Revenue went from ₹1,020 crore in FY22 to ₹1,850 crore in FY26."
 */
export function seriesSummary(title, points, fmt) {
  const known = points.filter((p) => toNum(p.value) !== null)
  if (!known.length) return `${title}: no data.`
  const first = known[0]
  const last = known[known.length - 1]
  const missing = points.length - known.length
  const gap = missing ? ` No data for ${missing} of ${points.length} periods.` : ''
  if (known.length === 1) return `${title}: ${fmt(last.value)} in ${last.label}.${gap}`
  return `${title} went from ${fmt(first.value)} in ${first.label} to ${fmt(last.value)} in ${last.label}.${gap}`
}
