/**
 * data.js — pure selectors and "has data" predicates shared by the study
 * components, StudyToc and StudyPage. One predicate per section, so a
 * section that renders nothing never gets a TOC entry.
 *
 * Expected `study` shape (keys mirror the v3 tables, minus the study_ prefix):
 *   {
 *     company,              // study_companies row
 *     sources, founders, timeline, products, tam, developments, risks,
 *     watch_items, financial_periods, segment_periods, shareholding,
 *     ownership_changes, period_notes
 *   }
 * Period arrays may contain several revisions per key; only the highest
 * revision is used (same rule as the *_latest views).
 */
import { toNum } from './format.js'

export const arr = (v) => (Array.isArray(v) ? v : [])
export const hasText = (v) => typeof v === 'string' && v.trim() !== ''

export const bySortOrder = (a, b) => (toNum(a?.sort_order) ?? 0) - (toNum(b?.sort_order) ?? 0)
export const sortedRows = (rows) => arr(rows).slice().sort(bySortOrder)
export const byPeriodAsc = (a, b) => String(a.period_end).localeCompare(String(b.period_end))

// ── Revisions ───────────────────────────────────────────────────────────

export function latestRevisions(rows, keyFn) {
  const best = new Map()
  for (const r of arr(rows)) {
    if (!r) continue
    const k = keyFn(r)
    const prev = best.get(k)
    if (!prev || (toNum(r.revision) ?? 1) > (toNum(prev.revision) ?? 1)) best.set(k, r)
  }
  return [...best.values()]
}

export const finKey = (r) => [r.period_end, r.period_type, r.basis].join('|')
export const segKey = (r) => [r.period_end, r.period_type, r.basis, r.segment_name].join('|')
export const shKey = (r) => [r.period_end, r.category].join('|')

/** Consolidated when available, else standalone. */
export function pickBasis(rows) {
  if (rows.some((r) => r.basis === 'consolidated')) return 'consolidated'
  if (rows.some((r) => r.basis === 'standalone')) return 'standalone'
  return null
}

/** Months since year 0 for a 'YYYY-MM-DD' — used to find QoQ / YoY comparables. */
export function monthIndex(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''))
  return m ? Number(m[1]) * 12 + Number(m[2]) : null
}

export const FIN_METRICS = ['revenue', 'ebitda', 'pat', 'eps', 'other_income', 'total_debt', 'cash', 'cfo', 'capex']
export const rowHasNumbers = (r) => FIN_METRICS.some((k) => toNum(r?.[k]) !== null)

/** Latest-revision rows of one period_type, one basis, oldest first. */
export function financialSeries(rows, periodType) {
  const latest = latestRevisions(
    arr(rows).filter((r) => r?.period_type === periodType && r.period_end),
    finKey,
  ).filter(rowHasNumbers)
  const basis = pickBasis(latest)
  return latest.filter((r) => r.basis === basis).sort(byPeriodAsc)
}

// ── Per-section selectors ───────────────────────────────────────────────

export const founderRows = (s) => sortedRows(s?.founders).filter((f) => hasText(f?.name))
export const timelineRows = (s) => sortedRows(s?.timeline).filter((t) => hasText(t?.title))
export const productRows = (s) => sortedRows(s?.products).filter((p) => hasText(p?.name))
export const tamRows = (s) => sortedRows(s?.tam).filter((t) => hasText(t?.market))
export const developmentRows = (s) => sortedRows(s?.developments).filter((d) => hasText(d?.title))
export const riskRows = (s) => sortedRows(s?.risks).filter((r) => hasText(r?.title))
export const watchRows = (s) =>
  sortedRows(s?.watch_items).filter((w) => w?.is_active !== false && hasText(w?.label))
/**
 * Same rule as the generated study_ownership_changes.direction column, so a
 * draft row that has not been saved yet (no generated value) still groups
 * correctly. NULL = unchanged.
 */
export function ownershipDirection(o) {
  if (o?.direction) return o.direction
  const from = toNum(o?.pct_from) ?? 0
  const to = toNum(o?.pct_to) ?? 0
  if (from === 0 && to > 0) return 'new'
  if (from > 0 && to === 0) return 'exit'
  if (to > from) return 'increase'
  if (to < from) return 'decrease'
  return null
}

/** Rows with a holder and an actual change (unchanged rows are not shown). */
export const ownershipRows = (s) =>
  sortedRows(s?.ownership_changes).filter((o) => hasText(o?.holder_name) && ownershipDirection(o) !== null)
export const sourceRows = (s) => sortedRows(s?.sources).filter((x) => x?.id && hasText(x?.title))

export const quarterSeries = (s) => financialSeries(s?.financial_periods, 'Q')
export const fySeries = (s) => financialSeries(s?.financial_periods, 'FY')

export function segmentRows(s) {
  return latestRevisions(
    arr(s?.segment_periods).filter((r) => r?.period_end && hasText(r?.segment_name)),
    segKey,
  ).filter((r) => toNum(r.revenue) !== null || toNum(r.ebit) !== null)
}

export function shareholdingRows(s) {
  return latestRevisions(
    arr(s?.shareholding).filter((r) => r?.period_end && r?.category),
    shKey,
  ).filter((r) => toNum(r.pct) !== null)
}

// ── Section registry (order = page order) ───────────────────────────────

export const SECTIONS = [
  { id: 'story',             label: 'The story',           has: (s) => hasText(s?.company?.story_md) },
  { id: 'founders',          label: 'The people',          has: (s) => founderRows(s).length > 0 },
  { id: 'timeline',          label: 'Timeline',            has: (s) => timelineRows(s).length > 0 },
  { id: 'products',          label: 'Products',            has: (s) => productRows(s).length > 0 },
  { id: 'market',            label: 'Market',              has: (s) => tamRows(s).length > 0 },
  { id: 'latest-quarter',    label: 'Latest quarter',      has: (s) => quarterSeries(s).length > 0 },
  { id: 'financial-history', label: 'Financial history',   has: (s) => fySeries(s).length > 0 },
  { id: 'segments',          label: 'Segments',            has: (s) => segmentRows(s).length > 0 },
  { id: 'shareholding',      label: 'Shareholding',        has: (s) => shareholdingRows(s).length > 0 },
  { id: 'ownership-changes', label: 'Ownership changes',   has: (s) => ownershipRows(s).length > 0 },
  { id: 'developments',      label: 'Developments',        has: (s) => developmentRows(s).length > 0 },
  {
    id: 'then-now-next',
    label: 'Then, now, next',
    has: (s) => hasText(s?.company?.then_text) || hasText(s?.company?.now_text) || hasText(s?.company?.next_text),
  },
  { id: 'risks',             label: 'Risks',               has: (s) => riskRows(s).length > 0 },
  { id: 'watching',          label: "What we're watching", has: (s) => watchRows(s).length > 0 },
  { id: 'central-question',  label: 'The central question', has: (s) => hasText(s?.company?.central_question) },
  { id: 'sources',           label: 'Sources',             has: (s) => sourceRows(s).length > 0 },
]

export const sectionLabel = (id) => SECTIONS.find((x) => x.id === id)?.label ?? id

/**
 * Fallback section titles (same text as the 'study.sections' seed in
 * studies_v4_site_content.sql). The published site passes the
 * site_content value; these only cover a preview with nothing loaded.
 */
export const DEFAULT_SECTION_TITLES = {
  contents: 'Contents',
  ...Object.fromEntries(SECTIONS.map((x) => [x.id, x.label])),
}

// ── Sources numbering ───────────────────────────────────────────────────

export const SOURCE_KINDS = [
  ['annual_report', 'Annual reports'],
  ['quarterly_result', 'Quarterly results'],
  ['investor_presentation', 'Investor presentations'],
  ['concall', 'Earnings calls'],
  ['regulatory_filing', 'Regulatory filings'],
  ['shareholding_filing', 'Shareholding filings'],
  ['fund_disclosure', 'Fund disclosures'],
  ['government', 'Government and official data'],
  ['other', 'Other sources'],
]

/**
 * Sources grouped in display order, each with its footnote number.
 * Returns { groups: [{ kind, label, items: [{ source, n }] }], numbers: Map(id -> n) }.
 */
export function numberSources(sources) {
  const rows = arr(sources).filter((x) => x?.id && hasText(x?.title)).slice().sort(bySortOrder)
  const known = new Set(SOURCE_KINDS.map(([k]) => k))
  const groups = []
  const numbers = new Map()
  let n = 0
  for (const [kind, label] of SOURCE_KINDS) {
    const items = rows.filter((r) => (known.has(r.kind) ? r.kind : 'other') === kind)
    if (!items.length) continue
    groups.push({ kind, label, items: items.map((source) => ({ source, n: ++n })) })
    for (const it of groups[groups.length - 1].items) numbers.set(it.source.id, it.n)
  }
  return { groups, numbers }
}

// ── Reading time ────────────────────────────────────────────────────────

function words(text) {
  return hasText(text) ? text.trim().split(/\s+/).length : 0
}

/** Minutes at 230 wpm over the long-form text fields; minimum 1. */
export function readingMinutes(s) {
  const c = s?.company || {}
  let total =
    words(c.story_md) + words(c.then_text) + words(c.now_text) + words(c.next_text) +
    words(c.central_question) + words(c.story_hook)
  for (const f of founderRows(s)) total += words(f.founding_story) + words(f.previous_career)
  for (const t of timelineRows(s)) total += words(t.body)
  for (const p of productRows(s)) total += words(p.description) + words(p.applications)
  for (const d of developmentRows(s)) total += words(d.body)
  for (const r of riskRows(s)) total += words(r.body)
  for (const o of ownershipRows(s)) total += words(o.profile)
  return Math.max(1, Math.round(total / 230))
}
