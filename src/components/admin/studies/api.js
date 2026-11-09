/**
 * Data access for the Studies admin (Phase 4a).
 *
 * Every call returns { data, error } where error is a plain-English string
 * (or null). Nothing here swallows a Supabase error: callers show it.
 *
 * Tables: scripts/sql/studies_v3_standalone.sql + studies_v4_site_content.sql.
 */
import { supabase } from '../../../lib/supabase'
import { withMediaBase } from '../../study/media.js'

export const BUCKET = 'study-media'
export const MEDIA_BASE = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/`

// study key → table. "content" tables are copied by Duplicate; "period"
// tables are append-only history (edited in Phase 4b) and are not.
export const CONTENT_TABLES = {
  sources: 'study_sources',
  founders: 'study_founders',
  timeline: 'study_timeline',
  products: 'study_products',
  tam: 'study_tam',
  developments: 'study_developments',
  risks: 'study_risks',
  watch_items: 'study_watch_items',
}
export const PERIOD_TABLES = {
  financial_periods: 'study_financial_periods',
  segment_periods: 'study_segment_periods',
  shareholding: 'study_shareholding',
  ownership_changes: 'study_ownership_changes',
  period_notes: 'study_period_notes',
}

// ── Errors ──────────────────────────────────────────────────────────────

const CONSTRAINT_TEXT = {
  study_companies_slug_key: 'That slug is already used by another study.',
  study_companies_exchange_ticker_key: 'Another study already uses this exchange and ticker.',
  study_companies_country_check: 'Country must be a 2-letter ISO code, e.g. IN or US.',
  study_companies_isin_check: 'ISIN must be 12 characters, e.g. INE123A01016.',
  study_companies_reporting_currency_check: 'Reporting currency must be a 3-letter ISO code, e.g. INR or USD.',
  study_companies_reporting_unit_check: 'Reporting unit must be thousand, million, billion, lakh or crore.',
  study_companies_fiscal_year_end_month_check: 'Fiscal year-end month must be 1–12.',
  study_companies_read_time_check: 'Read time must be between 1 and 600 minutes.',
  study_companies_status_check: 'That status is not allowed.',
  study_media_alt_text_check: 'Alt text is required.',
  study_media_credit_check: 'Credit is required.',
  study_media_storage_path_key: 'An image with this storage path already exists.',
  study_media_focal_x_check: 'Focal point must be inside the image.',
  study_media_focal_y_check: 'Focal point must be inside the image.',
  study_tam_result_currency_check: 'Result currency must be a 3-letter ISO code, e.g. INR.',
  study_tam_as_of_year_check: 'As-of year must be between 1900 and 2200.',
  study_timeline_event_year_check: 'Year must be between 1600 and 2200.',
  study_series_slug_key: 'That series slug is already used.',
  study_financial_periods_key: 'That revision of this period already exists — reload and try again.',
  study_segment_periods_key: 'That revision of this segment already exists — reload and try again.',
  study_shareholding_key: 'That revision of this shareholding row already exists — reload and try again.',
  study_ownership_changes_period_check: '"To" date must be after the "from" date.',
  study_shareholding_pct_check: 'Shareholding % must be between 0 and 100.',
  study_shareholding_pledged_pct_check: 'Pledged % must be between 0 and 100.',
}

/** Turn a Supabase / PostgREST / Storage / JS error into plain words. */
export function errorText(err, action) {
  if (!err) return null
  const msg = String(err.message || err.error_description || err.error || err)
  const code = err.code || ''
  const constraint = /constraint "([^"]+)"/.exec(msg)?.[1]
  const column = /column "([^"]+)"/.exec(msg)?.[1] || /'([^']+)' column/.exec(msg)?.[1]
  let plain
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    plain = "Couldn't reach Supabase. Check your connection and try again."
  } else if (/JWT expired|invalid JWT|not authenticated/i.test(msg)) {
    plain = 'Your session has expired. Sign in again, then retry.'
  } else if (code === 'PGRST202' || /Could not find the function/i.test(msg)) {
    plain = 'The save function is missing. Run scripts/sql/studies_v5_quarterly_rpc.sql in Supabase first. Nothing was saved.'
  } else if (code === '42501' || /row-level security|permission denied|Unauthorized/i.test(msg)) {
    plain = "Permission denied. Your account needs role 'admin' or 'superadmin' in profiles for this."
  } else if (constraint && CONSTRAINT_TEXT[constraint]) {
    plain = CONSTRAINT_TEXT[constraint]
  } else if (code === '23505') {
    plain = 'That value is already used by another row and must be unique.'
  } else if (code === '23514') {
    plain = /append-only/.test(msg) ? msg : `A value is not allowed${constraint ? ` (${constraint})` : ''}.`
  } else if (code === '23502') {
    plain = `A required field is empty${column ? `: ${column}` : ''}.`
  } else if (code === '23503') {
    plain = 'This refers to a row that no longer exists.'
  } else if (code === '22P02' || code === '22007' || code === '22008') {
    plain = 'A value has the wrong format (for example text in a number or date field).'
  } else if (code === '22003') {
    plain = 'A number is too large.'
  } else if (code === '42P01' || code === 'PGRST205' || /relation .* does not exist|Could not find the table/i.test(msg)) {
    plain = 'A table is missing. Have studies_v3_standalone.sql and studies_v4_site_content.sql been run?'
  } else if (code === '42703' || code === 'PGRST204' || /Could not find the .* column/i.test(msg)) {
    plain = `A column is missing${column ? ` (${column})` : ''}. Has studies_v4_site_content.sql been run?`
  } else if (/Bucket not found/i.test(msg)) {
    plain = "The 'study-media' storage bucket doesn't exist. Has studies_v4_site_content.sql been run?"
  } else if (/maximum allowed size|Payload too large|413/i.test(msg)) {
    plain = 'The file is larger than the 5 MB bucket limit.'
  } else if (/mime type|invalid_mime_type/i.test(msg)) {
    plain = 'This file type is not allowed in the bucket (WebP, AVIF, JPEG or PNG only).'
  } else if (/already exists|Duplicate/i.test(msg) && err.statusCode) {
    plain = 'A file already exists at that path.'
  } else {
    plain = msg || 'Something went wrong.'
  }
  const detail = plain === msg ? '' : ` — ${msg}`
  return `${action ? `${action}: ` : ''}${plain}${detail}`
}

const wrap = async (action, promise) => {
  try {
    const { data, error } = await promise
    return { data: data ?? null, error: errorText(error, action) }
  } catch (e) {
    return { data: null, error: errorText(e, action) }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Mirror of public.study_slugify(). */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** '' → null, trims strings. Leaves numbers/booleans/objects. */
export function clean(v) {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim()
  return t === '' ? null : t
}

// ── Studies ─────────────────────────────────────────────────────────────

export const STUDY_LIST_COLS = 'id, slug, name, exchange, ticker, sector, status, featured, updated_at'

export function listStudies() {
  return wrap('Loading studies', supabase.from('study_companies').select(STUDY_LIST_COLS).order('updated_at', { ascending: false }))
}

export function listFreshness() {
  return wrap('Loading freshness flags', supabase.from('study_freshness').select('*'))
}

export async function freshnessFor(id) {
  const r = await wrap('Loading freshness flags', supabase.from('study_freshness').select('*').eq('study_company_id', id).maybeSingle())
  return r
}

export async function slugTaken(slug, exceptId) {
  let q = supabase.from('study_companies').select('id').eq('slug', slug).limit(1)
  if (exceptId) q = q.neq('id', exceptId)
  const r = await wrap('Checking slug', q)
  return { taken: Boolean(r.data?.length), error: r.error }
}

async function freeSlug(base, exceptId) {
  let slug = base || 'study'
  for (let i = 2; i < 50; i++) {
    const { taken, error } = await slugTaken(slug, exceptId)
    if (error) return { slug: null, error }
    if (!taken) return { slug, error: null }
    slug = `${base}-${i}`
  }
  return { slug: null, error: 'Could not find a free slug.' }
}

export async function createStudy({ name, exchange, ticker }) {
  const { slug, error } = await freeSlug(slugify(name))
  if (error) return { data: null, error }
  return wrap(
    'Creating study',
    supabase
      .from('study_companies')
      .insert({ name: clean(name), slug, exchange: clean(exchange)?.toUpperCase() ?? null, ticker: clean(ticker)?.toUpperCase() ?? null, status: 'draft' })
      .select('id')
      .single(),
  )
}

export function updateStudy(id, patch) {
  return wrap('Saving study', supabase.from('study_companies').update(patch).eq('id', id).select('*').single())
}

export function archiveStudy(id) {
  return updateStudy(id, { status: 'archived' })
}

/**
 * Duplicate: copies the study_companies row and the content child tables
 * (sources first, so source_id links are remapped), plus series links.
 * Period data (financials, segments, shareholding, ownership, notes) is
 * NOT copied. The copy is a draft with slug "<slug>-copy" and no ticker
 * (exchange + ticker must be unique).
 */
export async function duplicateStudy(id) {
  const src = await wrap('Reading study', supabase.from('study_companies').select('*').eq('id', id).single())
  if (src.error) return src
  const c = src.data
  const { slug, error: slugErr } = await freeSlug(`${c.slug || slugify(c.name)}-copy`)
  if (slugErr) return { data: null, error: slugErr }
  const row = { ...c }
  for (const k of ['id', 'created_at', 'updated_at', 'published_at', 'reviewed_at', 'version']) delete row[k]
  Object.assign(row, { slug, name: `${c.name} (copy)`, status: 'draft', ticker: null, featured: false })
  const ins = await wrap('Creating copy', supabase.from('study_companies').insert(row).select('id').single())
  if (ins.error) return ins
  const newId = ins.data.id

  const fail = (error) => ({ data: { id: newId }, error: `${error} The copy was created but is incomplete — open it to check, or archive it.` })
  const sourceMap = new Map()
  for (const [key, table] of Object.entries(CONTENT_TABLES)) {
    const rows = await wrap(`Reading ${key}`, supabase.from(table).select('*').eq('study_company_id', id).order('sort_order'))
    if (rows.error) return fail(rows.error)
    if (!rows.data.length) continue
    const copies = rows.data.map((r) => {
      const x = { ...r, study_company_id: newId }
      for (const k of ['created_at', 'updated_at']) delete x[k]
      if (key === 'sources') {
        const nid = crypto.randomUUID()
        sourceMap.set(r.id, nid)
        x.id = nid
      } else {
        delete x.id
        if ('source_id' in x) x.source_id = x.source_id ? (sourceMap.get(x.source_id) ?? null) : null
        if (key === 'tam' && Array.isArray(x.inputs)) {
          x.inputs = x.inputs.map((inp) => ({ ...inp, source_id: inp?.source_id ? (sourceMap.get(inp.source_id) ?? null) : null }))
        }
      }
      return x
    })
    const w = await wrap(`Copying ${key}`, supabase.from(table).insert(copies))
    if (w.error) return fail(w.error)
  }
  const ser = await wrap('Reading series', supabase.from('study_company_series').select('series_id, sort_order').eq('study_company_id', id))
  if (ser.error) return fail(ser.error)
  if (ser.data.length) {
    const w = await wrap('Copying series', supabase.from('study_company_series').insert(ser.data.map((s) => ({ ...s, study_company_id: newId }))))
    if (w.error) return fail(w.error)
  }
  return { data: { id: newId }, error: null }
}

// ── Load one study (editor + preview) ───────────────────────────────────

export async function loadStudy(id, { withPeriods = false } = {}) {
  const errors = []
  const company = await wrap('Loading study', supabase.from('study_companies').select('*').eq('id', id).maybeSingle())
  if (company.error) return { data: null, error: company.error }
  if (!company.data) return { data: null, error: 'Study not found. It may have been deleted.' }
  const tables = { ...CONTENT_TABLES, ...(withPeriods ? PERIOD_TABLES : {}) }
  const entries = await Promise.all(
    Object.entries(tables).map(async ([key, table]) => {
      const order = key in PERIOD_TABLES && key !== 'ownership_changes' ? 'period_end' : 'sort_order'
      const r = await wrap(`Loading ${key.replace('_', ' ')}`, supabase.from(table).select('*').eq('study_company_id', id).order(order))
      if (r.error) errors.push(r.error)
      return [key, r.data || []]
    }),
  )
  return { data: { company: company.data, ...Object.fromEntries(entries) }, error: errors.length ? errors.join('\n') : null }
}

/** Attach study_media objects (with public URLs) to a loaded study, for StudyPage. */
export async function resolveStudyMedia(study) {
  const c = study.company
  const ids = new Set([c.hero_image_id, c.card_image_id, c.logo_image_id])
  for (const k of ['founders', 'products', 'timeline']) for (const r of study[k] || []) ids.add(r.image_id)
  ids.delete(null)
  ids.delete(undefined)
  const { data: media, error } = await getMediaByIds([...ids])
  const m = (id) => (id ? media.get(id) || null : null)
  const withImg = (rows) => (rows || []).map((r) => ({ ...r, image: m(r.image_id) }))
  return {
    data: {
      ...study,
      company: { ...c, hero_image: m(c.hero_image_id), card_image: m(c.card_image_id), logo_image: m(c.logo_image_id) },
      founders: withImg(study.founders),
      products: withImg(study.products),
      timeline: withImg(study.timeline),
    },
    error,
  }
}

// ── Child rows ──────────────────────────────────────────────────────────

export function insertRow(table, row) {
  return wrap('Adding row', supabase.from(table).insert(row).select('*').single())
}
export function updateRow(table, id, patch) {
  return wrap('Saving row', supabase.from(table).update(patch).eq('id', id).select('*').single())
}
export function deleteRow(table, id) {
  return wrap('Deleting row', supabase.from(table).delete().eq('id', id))
}
/** Persist sort_order for rows whose position changed. */
export async function saveOrder(table, rows) {
  for (let i = 0; i < rows.length; i++) {
    const want = i + 1
    if (rows[i].sort_order === want) continue
    const r = await wrap('Saving order', supabase.from(table).update({ sort_order: want }).eq('id', rows[i].id))
    if (r.error) return r
  }
  return { data: true, error: null }
}

// ── Series ──────────────────────────────────────────────────────────────

export function listSeries() {
  return wrap('Loading series', supabase.from('study_series').select('id, slug, name, description, is_active, sort_order').order('sort_order'))
}
export function studySeries(id) {
  return wrap('Loading series links', supabase.from('study_company_series').select('series_id, sort_order').eq('study_company_id', id))
}
export function linkSeries(studyId, seriesId) {
  return wrap('Adding to series', supabase.from('study_company_series').insert({ study_company_id: studyId, series_id: seriesId }))
}
export function unlinkSeries(studyId, seriesId) {
  return wrap('Removing from series', supabase.from('study_company_series').delete().eq('study_company_id', studyId).eq('series_id', seriesId))
}

// ── Site content (labels for preview) ───────────────────────────────────

export async function previewSiteContent() {
  const r = await wrap('Loading site labels', supabase.from('site_content').select('key, value').in('key', ['site.labels', 'study.sections', 'site.disclaimer']))
  const map = Object.fromEntries((r.data || []).map((x) => [x.key, x.value]))
  const disc = map['site.disclaimer']
  return {
    data: {
      labels: map['site.labels'] || undefined,
      sectionTitles: map['study.sections'] || undefined,
      disclaimer: typeof disc === 'string' ? disc : disc?.text,
    },
    error: r.error,
  }
}

// ── Media ───────────────────────────────────────────────────────────────

export const mediaUrl = (path) => (path ? (/^https?:\/\//.test(path) ? path : MEDIA_BASE + String(path).replace(/^\/+/, '')) : null)

/** Smallest variant URL, for admin thumbnails. */
export function thumbUrl(media, preferWidth = 480) {
  const vs = (media?.variants || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0))
  const pick = vs.find((v) => (v.width || 0) >= preferWidth && v.format === 'webp') || vs.find((v) => v.format === 'webp') || vs[0]
  return mediaUrl(pick?.path || media?.storage_path)
}

export function listMedia() {
  return wrap('Loading media', supabase.from('study_media').select('*').order('created_at', { ascending: false }).limit(1000))
}

export async function getMediaByIds(ids) {
  const out = new Map()
  if (!ids.length) return { data: out, error: null }
  const r = await wrap('Loading images', supabase.from('study_media').select('*').in('id', ids))
  for (const m of r.data || []) out.set(m.id, withMediaBase(m, MEDIA_BASE))
  return { data: out, error: r.error }
}

export function insertMedia(row) {
  return wrap('Saving image details', supabase.from('study_media').insert(row).select('*').single())
}
export function updateMedia(id, patch) {
  return wrap('Saving image details', supabase.from('study_media').update(patch).eq('id', id).select('*').single())
}

export async function uploadFile(path, blob, contentType) {
  return wrap(
    'Uploading',
    supabase.storage.from(BUCKET).upload(path, blob, { contentType, cacheControl: '31536000', upsert: false }),
  )
}
export function removeFiles(paths) {
  return wrap('Removing files', supabase.storage.from(BUCKET).remove(paths))
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Where each media id is used: Map(id → [{ label, href }]).
 * Covers study images (hero/card/logo, founders, products, timeline),
 * series images and any site_content value or draft_value.
 */
export async function mediaUsage() {
  const usage = new Map()
  const add = (id, label, href) => {
    if (!id) return
    if (!usage.has(id)) usage.set(id, [])
    usage.get(id).push({ label, href })
  }
  const [studies, founders, products, timeline, series, content] = await Promise.all([
    wrap('Checking study images', supabase.from('study_companies').select('id, name, hero_image_id, card_image_id, logo_image_id')),
    wrap('Checking founder images', supabase.from('study_founders').select('study_company_id, name, image_id').not('image_id', 'is', null)),
    wrap('Checking product images', supabase.from('study_products').select('study_company_id, name, image_id').not('image_id', 'is', null)),
    wrap('Checking timeline images', supabase.from('study_timeline').select('study_company_id, title, image_id').not('image_id', 'is', null)),
    wrap('Checking series images', supabase.from('study_series').select('id, name, image_id').not('image_id', 'is', null)),
    wrap('Checking site content', supabase.from('site_content').select('key, value, draft_value')),
  ])
  const names = new Map((studies.data || []).map((s) => [s.id, s.name]))
  for (const s of studies.data || []) {
    const href = `/admin/studies/${s.id}`
    add(s.hero_image_id, `${s.name} · hero`, href)
    add(s.card_image_id, `${s.name} · card`, href)
    add(s.logo_image_id, `${s.name} · logo`, href)
  }
  for (const [rows, tab, what] of [
    [founders.data, 'founders', 'founder'],
    [products.data, 'products', 'product'],
    [timeline.data, 'timeline', 'timeline'],
  ]) {
    for (const r of rows || []) add(r.image_id, `${names.get(r.study_company_id) || 'Study'} · ${what}: ${r.name || r.title}`, `/admin/studies/${r.study_company_id}?tab=${tab}`)
  }
  for (const s of series.data || []) add(s.image_id, `Series · ${s.name}`, null)
  for (const row of content.data || []) {
    const ids = new Set(JSON.stringify([row.value, row.draft_value]).match(UUID_RE) || [])
    for (const id of ids) add(id.toLowerCase(), `Site content · ${row.key}`, null)
  }
  const error = [studies, founders, products, timeline, series, content].map((r) => r.error).filter(Boolean).join('\n') || null
  return { data: usage, error }
}

// ── Period data (Phase 4b) ──────────────────────────────────────────────

/**
 * One-transaction period write (financials, segments, shareholding,
 * ownership, note, developments, reviewed) via the v5 RPC. If any part
 * fails, the database rolls all of it back.
 */
export function savePeriodUpdate(studyId, payload) {
  return wrap('Saving period', supabase.rpc('study_save_period_update', { p_study_company_id: studyId, p: payload }))
}

/** Append one revision row (append-only tables: never UPDATE). */
export function insertRevision(table, row) {
  return wrap('Saving correction', supabase.from(table).insert(row).select('*').single())
}

export function loadPeriodTable(table, studyId) {
  return wrap('Reloading', supabase.from(table).select('*').eq('study_company_id', studyId).order('period_end'))
}
