/**
 * Field / table / tab configuration for the Studies admin.
 * ChildListEditor is driven entirely by CHILD_TABLES below.
 */
import { DEVELOPMENT_LABELS, ESTIMATE_LABELS, LEVEL_LABELS, SEVERITY_LABELS } from '../../study/labels.js'
import { SOURCE_KINDS } from '../../study/data.js'

export const STATUSES = ['draft', 'researching', 'reviewed', 'published', 'archived']
export const STATUS_LABELS = {
  draft: 'Draft',
  researching: 'Researching',
  reviewed: 'Reviewed',
  published: 'Published',
  archived: 'Archived',
}

const opts = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }))
const UNITS = ['thousand', 'million', 'billion', 'lakh', 'crore'].map((v) => ({ value: v, label: v }))

// Field types: text, textarea, number, date, url, select, checkbox,
// source (SourcePicker), media (MediaPicker), tam_inputs (repeatable rows).
export const CHILD_TABLES = {
  sources: {
    table: 'study_sources',
    title: 'Sources',
    noun: 'source',
    summary: (r) => r.title,
    meta: (r) => [SOURCE_KIND_LABELS[r.kind], r.publisher, r.document_date].filter(Boolean).join(' · '),
    defaults: { kind: 'annual_report' },
    fields: [
      { key: 'kind', label: 'Type', type: 'select', required: true, options: SOURCE_KINDS.map(([value, label]) => ({ value, label })) },
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Annual Report FY25' },
      { key: 'publisher', label: 'Publisher', type: 'text' },
      { key: 'url', label: 'URL', type: 'url' },
      { key: 'document_date', label: 'Document date', type: 'date' },
      { key: 'page', label: 'Page(s)', type: 'text', placeholder: 'p. 42' },
      { key: 'accessed_on', label: 'Accessed on', type: 'date' },
      { key: 'archive_url', label: 'Archive URL', type: 'url' },
    ],
  },
  founders: {
    table: 'study_founders',
    title: 'Founders',
    noun: 'founder',
    summary: (r) => r.name,
    meta: (r) => r.current_role,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'current_role', label: 'Current role', type: 'text' },
      { key: 'education', label: 'Education', type: 'text' },
      { key: 'previous_career', label: 'Before this', type: 'textarea' },
      { key: 'founding_story', label: 'Founding story', type: 'textarea' },
      { key: 'image_id', label: 'Photo', type: 'media' },
      { key: 'source_id', label: 'Source', type: 'source' },
    ],
  },
  timeline: {
    table: 'study_timeline',
    title: 'Timeline',
    noun: 'event',
    summary: (r) => r.title,
    meta: (r) => r.event_date || r.event_year,
    fields: [
      { key: 'event_date', label: 'Date', type: 'date', help: 'Or just a year below.' },
      { key: 'event_year', label: 'Year', type: 'number', min: 1600, max: 2200 },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Body', type: 'textarea' },
      { key: 'is_pull_quote', label: 'Show as pull quote', type: 'checkbox' },
      { key: 'image_id', label: 'Image', type: 'media' },
      { key: 'source_id', label: 'Source', type: 'source' },
    ],
  },
  products: {
    table: 'study_products',
    title: 'Products',
    noun: 'product',
    summary: (r) => r.name,
    meta: (r) => r.category,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'applications', label: 'Applications', type: 'textarea' },
      { key: 'end_markets', label: 'End markets', type: 'text' },
      { key: 'customers_disclosed', label: 'Customers (disclosed)', type: 'text' },
      { key: 'interesting_fact', label: 'Interesting fact', type: 'textarea' },
      { key: 'image_id', label: 'Image', type: 'media' },
      { key: 'source_id', label: 'Source', type: 'source' },
    ],
  },
  tam: {
    table: 'study_tam',
    title: 'Market & TAM',
    noun: 'market estimate',
    summary: (r) => [r.market, r.geography].filter(Boolean).join(', '),
    meta: (r) => [LEVEL_LABELS[r.level], ESTIMATE_LABELS[r.estimate_type]].filter(Boolean).join(' · '),
    defaults: { level: 'tam', estimate_type: 'company', inputs: [] },
    fields: [
      { key: 'market', label: 'Market', type: 'text', required: true },
      { key: 'geography', label: 'Geography', type: 'text' },
      { key: 'level', label: 'Level', type: 'select', required: true, options: opts(LEVEL_LABELS) },
      { key: 'estimate_type', label: 'Estimate type', type: 'select', required: true, options: opts(ESTIMATE_LABELS) },
      { key: 'inputs', label: 'Inputs', type: 'tam_inputs' },
      { key: 'calculation', label: 'Calculation (show the arithmetic)', type: 'textarea' },
      { key: 'result_value', label: 'Result value', type: 'number', step: 'any' },
      { key: 'result_currency', label: 'Result currency', type: 'text', placeholder: 'INR', upper: true, maxLength: 3 },
      { key: 'result_unit', label: 'Result unit', type: 'select', options: UNITS },
      { key: 'as_of_year', label: 'As of year', type: 'number', min: 1900, max: 2200 },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'source_id', label: 'Source', type: 'source' },
    ],
  },
  developments: {
    table: 'study_developments',
    title: 'Developments',
    noun: 'development',
    summary: (r) => r.title,
    meta: (r) => [r.event_date, DEVELOPMENT_LABELS[r.category]].filter(Boolean).join(' · '),
    defaults: { category: 'other' },
    fields: [
      { key: 'event_date', label: 'Date', type: 'date' },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Body', type: 'textarea' },
      { key: 'category', label: 'Category', type: 'select', required: true, options: opts(DEVELOPMENT_LABELS) },
      { key: 'source_id', label: 'Source', type: 'source' },
    ],
  },
  risks: {
    table: 'study_risks',
    title: 'Risks',
    noun: 'risk',
    summary: (r) => r.title,
    meta: (r) => SEVERITY_LABELS[r.severity],
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Body', type: 'textarea' },
      { key: 'severity', label: 'Severity', type: 'select', options: opts(SEVERITY_LABELS) },
      { key: 'source_id', label: 'Source', type: 'source' },
    ],
  },
  watch_items: {
    table: 'study_watch_items',
    title: "What we're watching",
    noun: 'item',
    summary: (r) => r.label,
    meta: (r) => (r.is_active === false ? 'Hidden' : ''),
    defaults: { is_active: true },
    fields: [
      { key: 'label', label: 'Label', type: 'text', required: true },
      { key: 'note', label: 'Note', type: 'textarea' },
      { key: 'is_active', label: 'Show on the page', type: 'checkbox' },
    ],
  },
}

export const SOURCE_KIND_LABELS = Object.fromEntries(SOURCE_KINDS)

// Tabs. `child` → ChildListEditor with CHILD_TABLES[child]. `phase` → disabled placeholder.
export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'story', label: 'Story' },
  { id: 'founders', label: 'Founders', child: 'founders' },
  { id: 'timeline', label: 'Timeline', child: 'timeline' },
  { id: 'products', label: 'Products', child: 'products' },
  { id: 'market', label: 'Market & TAM', child: 'tam' },
  { id: 'developments', label: 'Developments', child: 'developments' },
  { id: 'risks', label: 'Risks', child: 'risks' },
  { id: 'watching', label: "What we're watching", child: 'watch_items' },
  { id: 'sources', label: 'Sources', child: 'sources' },
  { id: 'series', label: 'Series' },
  { id: 'latest-quarter', label: 'Latest quarter', phase: '4b' },
  { id: 'financials', label: 'Financials', phase: '4b' },
  { id: 'segments', label: 'Segments', phase: '4b' },
  { id: 'shareholding', label: 'Shareholding', phase: '4b' },
  { id: 'ownership', label: 'Ownership changes', phase: '4b' },
]

// study_freshness flags → label + the tab that fixes it.
export const FLAGS = [
  { key: 'financials_stale', label: 'Financials stale', tab: 'financials' },
  { key: 'missing_latest_quarter', label: 'Latest quarter missing', tab: 'latest-quarter' },
  { key: 'shareholding_stale', label: 'Shareholding stale', tab: 'shareholding' },
  { key: 'missing_shareholding', label: 'No shareholding', tab: 'shareholding' },
  { key: 'review_stale', label: 'Review > 180 days', tab: 'overview' },
  { key: 'missing_sources', label: 'No sources', tab: 'sources' },
  { key: 'missing_tam', label: 'No TAM', tab: 'market' },
]

/** Active flags for a study_freshness row. "No shareholding" supersedes "stale". */
export function activeFlags(f) {
  if (!f) return []
  return FLAGS.filter((x) => f[x.key] && !(x.key === 'shareholding_stale' && f.missing_shareholding))
}

// Company fields edited on Overview / Story, with the label used in content warnings.
export const COMPANY_TEXT_FIELDS = {
  name: 'Name',
  label: 'Label',
  headline: 'Headline',
  story_hook: 'Story hook',
  summary: 'Summary',
  card_title: 'Card title',
  card_summary: 'Card summary',
  story_md: 'Story',
  central_question: 'Central question',
  then_text: 'Then',
  now_text: 'Now',
  next_text: 'Next',
}

export const COMPANY_FIELDS = [
  'name', 'slug', 'country', 'exchange', 'ticker', 'isin', 'sector', 'industry', 'website',
  'reporting_currency', 'reporting_unit', 'accounting_standard', 'fiscal_year_end_month',
  'label', 'featured', 'headline', 'story_hook', 'summary', 'card_title', 'card_summary',
  'read_time_minutes', 'hero_image_id', 'card_image_id', 'logo_image_id',
  'story_md', 'central_question', 'then_text', 'now_text', 'next_text',
]

export const UNIT_OPTIONS = UNITS
export const ACCOUNTING_OPTIONS = [
  { value: 'ind_as', label: 'Ind AS' },
  { value: 'ifrs', label: 'IFRS' },
  { value: 'us_gaap', label: 'US GAAP' },
  { value: 'other', label: 'Other' },
]
export const MONTH_OPTIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(
  (label, i) => ({ value: String(i + 1), label }),
)
