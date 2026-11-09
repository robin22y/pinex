// scripts/prerender_studies.mjs
//
// Static Company Study pages (Phase 5). Runs inside the Netlify build after
// `vite build` and prerender_pulse.mjs:
//
//   dist/company/<slug>/index.html   one page per published study
//   dist/company/index.html          directory (newest updated first)
//   dist/company/404.html            "study not found" (netlify.toml serves it)
//   dist/sitemap.xml                 study URLs appended; existing entries kept
//
// Pages are plain HTML: study.css and the web-font CSS are inlined, no React
// or supabase-js is shipped. Rendering reuses src/components/study/* through
// react-dom/server, compiled by Vite's SSR loader (same as
// scripts/test_study_render.mjs; no new dependencies).
//
// Data: anon key only. RLS returns published content only, so whole tables
// are read in paginated requests (one per table, not one per study).
//
// Exit codes:
//   1  a published study rendered empty or threw (a broken page must not ship)
//   1  Supabase unreachable / HTTP errors after 3 retries (5 s, 15 s, 30 s):
//      failing the build keeps the previous deploy, with its study pages, live
//   0  everything else. 0 published studies is a success, not an error.
//      STUDIES_PRERENDER=0 skips the script entirely (study pages go offline).
//
// Usage:
//   node scripts/prerender_studies.mjs              (after vite build)
//   node scripts/prerender_studies.mjs --fixtures   (fixtures → scratch/site/, no Supabase)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = process.argv.includes('--fixtures')
const OUT = FIXTURES ? resolve(ROOT, 'scratch/site') : resolve(ROOT, 'dist')
const SITE = 'https://pinex.in'
const SIZE_WARN = 150 * 1024
const TAG = '[prerender_studies]'

const log = (...a) => console.log(TAG, ...a)
const warn = (...a) => console.warn(TAG, 'WARNING:', ...a)
function loud(msg) {
  const bar = '!'.repeat(72)
  console.error(`\n${bar}\n${TAG} ${msg}\n${TAG} Study pages were NOT generated in this build.\n${bar}\n`)
}

if (process.env.STUDIES_PRERENDER === '0' && !FIXTURES) {
  log('STUDIES_PRERENDER=0 — skipped.')
  process.exit(0)
}

// ── .env.local autoloader (same as prerender_pulse.mjs) ───────────────
try {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* no .env.local */
}
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const MEDIA_BASE = `${SUPABASE_URL}/storage/v1/object/public/study-media/`

// ── HTML helpers ──────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const has = (s) => typeof s === 'string' && s.trim() !== ''
// Escape < and the JS line separators (U+2028/2029) inside JSON-LD.
const LS_RE = new RegExp(String.fromCharCode(0x2028), "g")
const PS_RE = new RegExp(String.fromCharCode(0x2029), "g")
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c").replace(LS_RE, "\\u2028").replace(PS_RE, "\\u2029")

function clip(text, max = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').replace(/[*_`#>[\]]/g, '').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : cut.length)}…`
}

const absUrl = (u) => (!u ? null : /^https?:\/\//.test(u) ? u : `${SITE}${u.startsWith('/') ? '' : '/'}${u}`)

/** Largest non-AVIF variant, preferring the 1600 one (OG / JSON-LD image). */
function shareImage(media) {
  const vs = (media?.variants || []).filter((v) => v?.path && v.format !== 'avif')
  if (!vs.length) return null
  const v = vs.find((x) => Number(x.width) === 1600) || vs.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]
  const h = v.height || (media.width && media.height && v.width ? Math.round((media.height * v.width) / media.width) : null)
  return { url: absUrl(v.path), width: v.width || null, height: h, alt: media.alt_text, type: v.format === 'webp' ? 'image/webp' : v.format === 'png' ? 'image/png' : 'image/jpeg' }
}

// ── Fonts: inline Google Fonts CSS + preload the serif ───────────────

const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&display=swap'
const FONT_LINKS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  `<link rel="stylesheet" href="${FONT_CSS_URL}">`

// Preloading the serif is OFF by default: the variable Newsreader file is
// ~147 KB and, preloaded, it competes with the hero image. Lighthouse mobile
// on the fixture page: 84 with the preload, 96 without (FCP 3.0 s → 1.6 s).
// Text paints in the fallback serif either way (font-display: swap).
const PRELOAD_FONT = process.env.STUDIES_FONT_PRELOAD === '1'

async function loadFonts() {
  try {
    const res = await fetch(FONT_CSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const css = await res.text()
    // The upright latin Newsreader face is the one every page needs first.
    let preload = null
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
      if (m[1] === 'latin' && /Newsreader/.test(m[2]) && /font-style:\s*normal/.test(m[2])) {
        preload = /url\((https:[^)]+\.woff2)\)/.exec(m[2])?.[1] || null
        break
      }
    }
    // Keep only the latin + latin-ext subsets: the pages are English.
    const kept = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)]
      .filter((m) => m[1] === 'latin' || m[1] === 'latin-ext')
      .map((m) => m[2])
      .join('\n')
    const head =
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      (preload && PRELOAD_FONT ? `<link rel="preload" as="font" type="font/woff2" href="${esc(preload)}" crossorigin>` : '') +
      `<style>${kept || css}</style>`
    return { head, inlined: true }
  } catch (e) {
    warn(`could not inline Google Fonts CSS (${e.message}); linking it instead.`)
    return { head: FONT_LINKS, inlined: false }
  }
}

// ── Page chrome ───────────────────────────────────────────────────────

const CHROME_CSS = `
html{-webkit-text-size-adjust:100%}
html,body{margin:0}
body{background:#F2F0E9}
.px-skip{position:absolute;left:-9999px;top:8px;background:#fff;color:#111;padding:8px 12px;z-index:10;border-radius:4px}
.px-skip:focus{left:8px}
.px-bar{background:#0B0F18;color:#E5E9F0;font:500 14px/1 'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
.px-bar nav{max-width:1040px;margin:0 auto;padding:0 16px;height:48px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.px-bar a{color:#E5E9F0;text-decoration:none;padding:12px 0}
.px-bar a:hover,.px-bar a:focus-visible{text-decoration:underline}
.px-mark{font-weight:800;font-size:17px;letter-spacing:-.02em}
.px-mark span{color:#38BDF8}
.px-intro{font-family:var(--st-sans);color:var(--st-muted);max-width:640px}
`

function topBar() {
  return (
    '<a class="px-skip" href="#main">Skip to content</a>' +
    '<header class="px-bar"><nav aria-label="Site">' +
    '<a class="px-mark" href="/" aria-label="PineX home">Pine<span>X</span></a>' +
    '<a href="/company">Company studies</a>' +
    '</nav></header>'
  )
}

function documentHtml({ title, description, canonical, robots, og, jsonld, fontsHead, css, body }) {
  const meta = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    description ? `<meta name="description" content="${esc(description)}">` : '',
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    `<meta name="robots" content="${robots || 'index, follow, max-image-preview:large'}">`,
    '<meta name="theme-color" content="#0B0F18">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  ]
  if (og) {
    meta.push(
      `<meta property="og:type" content="${og.type || 'website'}">`,
      '<meta property="og:site_name" content="PineX">',
      `<meta property="og:title" content="${esc(og.title || title)}">`,
      description ? `<meta property="og:description" content="${esc(description)}">` : '',
      canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
      '<meta property="og:locale" content="en_IN">',
      `<meta name="twitter:card" content="${og.image ? 'summary_large_image' : 'summary'}">`,
      `<meta name="twitter:title" content="${esc(og.title || title)}">`,
      description ? `<meta name="twitter:description" content="${esc(description)}">` : '',
    )
    if (og.image) {
      meta.push(
        `<meta property="og:image" content="${esc(og.image.url)}">`,
        og.image.type ? `<meta property="og:image:type" content="${og.image.type}">` : '',
        og.image.width ? `<meta property="og:image:width" content="${og.image.width}">` : '',
        og.image.height ? `<meta property="og:image:height" content="${og.image.height}">` : '',
        og.image.alt ? `<meta property="og:image:alt" content="${esc(og.image.alt)}">` : '',
        `<meta name="twitter:image" content="${esc(og.image.url)}">`,
        og.image.alt ? `<meta name="twitter:image:alt" content="${esc(og.image.alt)}">` : '',
      )
    }
    if (og.published) meta.push(`<meta property="article:published_time" content="${esc(og.published)}">`)
    if (og.modified) meta.push(`<meta property="article:modified_time" content="${esc(og.modified)}">`)
  }
  if (jsonld) meta.push(`<script type="application/ld+json">${jsonLd(jsonld)}</script>`)
  return (
    '<!doctype html><html lang="en"><head>' +
    meta.filter(Boolean).join('') +
    fontsHead +
    `<style>${CHROME_CSS}${css}</style>` +
    `</head><body>${topBar()}<main id="main">${body}</main></body></html>`
  )
}

// ── Data: Supabase (anon, paginated) ──────────────────────────────────

/** Network or HTTP failure talking to Supabase (retried; fails the build if it persists). */
const netError = (msg, cause) => Object.assign(new Error(msg, { cause }), { network: true })

async function rest(path, params = {}, init = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let res
  try {
    res = await fetch(url, {
      ...init,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    throw netError(`${path}: ${e?.cause?.code || e?.name || 'network error'} ${e?.message || ''}`.trim(), e)
  }
  if (!res.ok) throw netError(`${path}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`)
  try {
    return await res.json()
  } catch (e) {
    throw netError(`${path}: response body was not JSON (${e.message})`, e)
  }
}

// Retries after 5 s, 15 s and 30 s. An empty result (0 published studies) is
// a success — only network / HTTP errors are retried.
const RETRY_DELAYS_MS = [5000, 15000, 30000]

async function withRetries(load) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load()
    } catch (e) {
      if (!e?.network || attempt >= RETRY_DELAYS_MS.length) throw e
      const wait = RETRY_DELAYS_MS[attempt]
      warn(`Supabase read failed (${e.message}). Retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${wait / 1000}s…`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

/** Every row the anon role may read, 1000 at a time. */
async function all(table, params = {}) {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const page = await rest(table, { select: '*', order: 'id', ...params, limit: '1000', offset: String(offset) })
    out.push(...page)
    if (page.length < 1000) return out
  }
}

const groupBy = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = r[key]
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

async function loadLive(withMediaBase) {
  const companies = await all('study_companies', { status: 'eq.published', order: 'updated_at.desc,id' })
  const ids = new Set(companies.map((c) => c.id))
  const tables = {
    sources: ['study_sources'],
    founders: ['study_founders'],
    timeline: ['study_timeline'],
    products: ['study_products'],
    tam: ['study_tam'],
    developments: ['study_developments'],
    risks: ['study_risks'],
    watch_items: ['study_watch_items'],
    financial_periods: ['study_financials_latest', { order: 'study_company_id,period_end' }],
    segment_periods: ['study_segments_latest', { order: 'study_company_id,period_end' }],
    shareholding: ['study_shareholding_latest', { order: 'study_company_id,period_end' }],
    ownership_changes: ['study_ownership_changes'],
    period_notes: ['study_period_notes'],
  }
  const entries = await Promise.all(Object.entries(tables).map(async ([k, [t, p]]) => [k, groupBy((await all(t, p)).filter((r) => ids.has(r.study_company_id)), 'study_company_id')]))
  const child = Object.fromEntries(entries)

  const [mediaRows, seriesRows, links, siteRows] = await Promise.all([
    all('study_media'),
    all('study_series', { is_active: 'eq.true', order: 'sort_order,id' }),
    all('study_company_series', { order: 'series_id' }),
    rest('rpc/site_content_published', {}, {
      method: 'POST',
      body: JSON.stringify({ p_keys: ['site.labels', 'study.sections', 'site.disclaimer', 'home.sections', 'company.directory'] }),
    }),
  ])
  const media = new Map(mediaRows.map((m) => [m.id, withMediaBase(m, MEDIA_BASE)]))
  const site = Object.fromEntries(siteRows.map((r) => [r.key, r.value]))

  const m = (id) => (id ? media.get(id) || null : null)
  const studies = companies.map((c) => {
    const rows = (k) => child[k].get(c.id) || []
    const img = (list) => list.map((r) => ({ ...r, image: m(r.image_id) }))
    return {
      company: { ...c, hero_image: m(c.hero_image_id), card_image: m(c.card_image_id), logo_image: m(c.logo_image_id) },
      sources: rows('sources'),
      founders: img(rows('founders')),
      timeline: img(rows('timeline')),
      products: img(rows('products')),
      tam: rows('tam'),
      developments: rows('developments'),
      risks: rows('risks'),
      watch_items: rows('watch_items'),
      financial_periods: rows('financial_periods'),
      segment_periods: rows('segment_periods'),
      shareholding: rows('shareholding'),
      ownership_changes: rows('ownership_changes'),
      period_notes: rows('period_notes'),
    }
  })
  const counts = new Map()
  for (const l of links) if (ids.has(l.study_company_id)) counts.set(l.series_id, (counts.get(l.series_id) || 0) + 1)
  const series = seriesRows.map((s) => ({ ...s, image: m(s.image_id), study_count: counts.get(s.id) || 0 })).filter((s) => s.study_count > 0)
  return { studies, series, site }
}

// ── Data: fixtures (local test) ───────────────────────────────────────

async function loadFixtures(server) {
  const fx = await server.ssrLoadModule('/src/components/study/__fixtures__/sample-study.js')
  // Fixture media point at example.com. Make real local files with sharp
  // (a devDependency) so images load when scratch/site is served.
  const { default: sharp } = await import('sharp')
  const made = new Map()
  const COLORS = ['#3F6E5A', '#7A5C3E', '#2F4F6F', '#6B3F5E', '#55603A']
  async function localise(media) {
    if (!media?.variants) return media
    const variants = []
    for (const v of media.variants) {
      const file = v.path.split('/').pop()
      const local = `/media/${file}`
      if (!made.has(file)) {
        const w = Number(v.width) || 400
        const h = Math.max(1, Math.round((w * (media.height || 1)) / (media.width || 1)))
        const c = COLORS[made.size % COLORS.length]
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#E9E4D6"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * (media.focal_x ?? 0.5)}" cy="${h * (media.focal_y ?? 0.5)}" r="${Math.min(w, h) / 10}" fill="#fff" opacity=".7"/></svg>`
        const fmt = v.format === 'jpeg' || /\.jpe?g$/.test(file) ? 'jpeg' : v.format || 'png'
        mkdirSync(resolve(OUT, 'media'), { recursive: true })
        await sharp(Buffer.from(svg)).toFormat(fmt, { quality: 70 }).toFile(resolve(OUT, 'media', file))
        made.set(file, true)
      }
      variants.push({ ...v, path: local })
    }
    return { ...media, variants, storage_path: variants[variants.length - 1]?.path }
  }
  async function localiseStudy(s, status = 'published') {
    const c = s.company
    const withImgs = async (rows) => Promise.all((rows || []).map(async (r) => ({ ...r, image: await localise(r.image) })))
    return {
      ...s,
      company: { ...c, status, hero_image: await localise(c.hero_image), card_image: await localise(c.card_image), logo_image: await localise(c.logo_image) },
      founders: await withImgs(s.founders),
      products: await withImgs(s.products),
      timeline: await withImgs(s.timeline),
    }
  }
  const studies = [await localiseStudy(fx.sampleStudyInr), await localiseStudy(fx.sampleStudyUsd)]
  studies[0].company.card_image = await localise(fx.mediaProduct)
  const series = await Promise.all(
    fx.sampleHome.series.filter((s) => s.is_active !== false).map(async (s) => ({ ...s, image: await localise(s.image) })),
  )
  return {
    studies,
    series,
    site: {
      'site.labels': fx.sampleLabels,
      'study.sections': fx.sampleSectionTitles,
      'home.sections': fx.sampleHome.sections,
    },
  }
}

// ── Sitemap ───────────────────────────────────────────────────────────

function updateSitemap(entries) {
  const path = resolve(OUT, 'sitemap.xml')
  let xml = existsSync(path)
    ? readFileSync(path, 'utf8')
    : FIXTURES && existsSync(resolve(ROOT, 'public/sitemap.xml'))
      ? readFileSync(resolve(ROOT, 'public/sitemap.xml'), 'utf8')
      : '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n'
  let added = 0
  const block = entries
    .filter((e) => {
      if (xml.includes(`<loc>${e.loc}</loc>`)) return false
      added++
      return true
    })
    .map(
      (e) =>
        `  <url>\n    <loc>${esc(e.loc)}</loc>\n${e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : ''}    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>\n`,
    )
    .join('')
  if (!/<\/urlset>/.test(xml)) xml += '\n</urlset>\n'
  xml = xml.replace(/<\/urlset>\s*$/, `${block}</urlset>\n`)
  writeFileSync(path, xml, 'utf8')
  return added
}

// ── Main ──────────────────────────────────────────────────────────────

if (!FIXTURES) {
  if (!SUPABASE_URL || !ANON_KEY) {
    loud('Supabase URL / anon key missing in the build environment.')
    process.exit(0)
  }
  if (!existsSync(resolve(OUT, 'index.html'))) {
    loud(`${OUT}/index.html not found — did vite build run?`)
    process.exit(0)
  }
}

const { createServer } = await import('vite')
const { default: react } = await import('@vitejs/plugin-react')
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
})

let exitCode = 0
try {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const C = await server.ssrLoadModule('/src/components/study/index.js')
  const css = readFileSync(resolve(ROOT, 'src/styles/study.css'), 'utf8')

  let data
  try {
    data = FIXTURES ? await loadFixtures(server) : await withRetries(() => loadLive(C.withMediaBase))
  } catch (e) {
    // Fail the build: Netlify then keeps the previous deploy (with its study
    // pages) live. Exiting 0 would ship a deploy without them.
    exitCode = 1
    if (e?.network) {
      loud(
        `Studies prerender: Supabase unreachable after ${RETRY_DELAYS_MS.length} retries — failing build to keep previous deploy live. ` +
          `Set STUDIES_PRERENDER=0 only if you accept study pages going offline.\n  Last error: ${e.message}`,
      )
    } else {
      loud(`Studies prerender: could not assemble study data — failing build to keep previous deploy live.\n  ${e?.stack || e}`)
    }
    throw Object.assign(new Error('data'), { handled: true })
  }
  const { studies, series, site } = data
  const labels = site['site.labels'] || undefined
  const sectionTitles = site['study.sections'] || undefined
  const discRaw = site['site.disclaimer']
  const disclaimer = typeof discRaw === 'string' ? discRaw : discRaw?.text
  const fonts = await loadFonts()

  mkdirSync(resolve(OUT, 'company'), { recursive: true })
  const fatal = []
  const sizes = []
  const sitemap = []

  // ── study pages ──
  for (const s of studies) {
    const c = s.company
    const slug = c.slug
    let html
    try {
      html = renderToStaticMarkup(createElement(C.StudyPage, { study: s, labels, sectionTitles, disclaimer, lang: 'en' }))
    } catch (e) {
      fatal.push(`${slug || c.id}: render threw — ${e?.stack || e}`)
      continue
    }
    if (!slug || !html || html.length < 200 || !/<h1\b/.test(html)) {
      fatal.push(`${slug || c.id}: rendered empty (${html?.length ?? 0} bytes)`)
      continue
    }
    const canonical = `${SITE}/company/${encodeURIComponent(slug)}`
    const description = clip(has(c.summary) ? c.summary : c.story_hook || c.headline || `${c.name}: a PineX company study.`)
    const image = shareImage(c.hero_image) || shareImage(c.card_image)
    const headline = clip(has(c.headline) ? c.headline : c.name, 110)
    const page = documentHtml({
      title: `${c.name} — Company Study | PineX`,
      description,
      canonical,
      fontsHead: fonts.head,
      css,
      og: { type: 'article', title: `${c.name} — Company Study`, image, published: c.published_at, modified: c.updated_at },
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline,
        description,
        ...(image ? { image: [image.url] } : {}),
        ...(c.published_at ? { datePublished: c.published_at } : {}),
        ...(c.updated_at ? { dateModified: c.updated_at } : {}),
        author: { '@type': 'Organization', name: 'PineX Research', url: SITE },
        publisher: { '@type': 'Organization', name: 'PineX Research', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/pwa-512.png` } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
        about: { '@type': 'Organization', name: c.name, ...(has(c.website) ? { url: c.website } : {}) },
        inLanguage: 'en',
      },
      body: html,
    })
    const dir = resolve(OUT, 'company', slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'index.html'), page, 'utf8')
    sizes.push([`company/${slug}/index.html`, Buffer.byteLength(page)])
    sitemap.push({ loc: canonical, lastmod: String(c.updated_at || '').slice(0, 10) || null, changefreq: 'weekly', priority: '0.8' })
  }

  // ── directory ──
  const cards = studies
    .map((s) => s.company)
    .filter((c) => c.slug)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  const dirText = site['company.directory'] || {}
  const homeSec = site['home.sections'] || {}
  const dirTitle = dirText.title || 'Company studies'
  const dirIntro = dirText.intro || 'Long-form studies of listed companies: how they started, what they make, how the numbers have moved and what we are watching. Research, not recommendations.'
  const dirBody = renderToStaticMarkup(
    createElement(
      C.StudyLayout,
      { width: 'wide', lang: 'en' },
      createElement('h1', null, dirTitle),
      createElement('p', { className: 'px-intro' }, dirIntro),
      cards.length
        ? createElement(C.LatestStudies, { title: dirText.list_title || 'All studies', studies: cards, labels })
        : createElement('p', { className: 'px-intro' }, dirText.empty || 'The first studies are on their way.'),
      createElement(C.SeriesList, { title: homeSec.popular_series?.title || 'Series', series, labels }),
    ),
  )
  const dirPage = documentHtml({
    title: `${dirTitle} | PineX`,
    description: clip(dirIntro),
    canonical: `${SITE}/company`,
    fontsHead: fonts.head,
    css,
    og: { type: 'website', title: dirTitle, image: shareImage(cards[0]?.card_image) || shareImage(cards[0]?.hero_image) },
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: dirTitle,
      url: `${SITE}/company`,
      publisher: { '@type': 'Organization', name: 'PineX Research', url: SITE },
      hasPart: cards.map((c) => ({ '@type': 'Article', headline: clip(c.headline || c.name, 110), url: `${SITE}/company/${encodeURIComponent(c.slug)}` })),
    },
    body: dirBody,
  })
  writeFileSync(resolve(OUT, 'company/index.html'), dirPage, 'utf8')
  sizes.push(['company/index.html', Buffer.byteLength(dirPage)])
  sitemap.unshift({ loc: `${SITE}/company`, lastmod: String(cards[0]?.updated_at || '').slice(0, 10) || null, changefreq: 'weekly', priority: '0.7' })

  // ── 404 ──
  const nfBody = renderToStaticMarkup(
    createElement(
      C.StudyLayout,
      { lang: 'en' },
      createElement('h1', null, 'Study not found'),
      createElement('p', { className: 'px-intro' }, 'There is no published study at this address. It may have moved or been withdrawn.'),
      createElement('p', { className: 'px-intro' }, createElement('a', { href: '/company' }, 'See all company studies')),
    ),
  )
  const nfPage = documentHtml({ title: 'Study not found | PineX', robots: 'noindex', fontsHead: fonts.head, css, body: nfBody })
  writeFileSync(resolve(OUT, 'company/404.html'), nfPage, 'utf8')
  sizes.push(['company/404.html', Buffer.byteLength(nfPage)])

  const added = updateSitemap(sitemap)

  // ── report ──
  for (const [file, bytes] of sizes) {
    const kb = (bytes / 1024).toFixed(1)
    if (bytes > SIZE_WARN) warn(`${file} is ${kb} KB (over 150 KB)`)
    else log(`${file}  ${kb} KB`)
  }
  log(`${studies.length} published stud${studies.length === 1 ? 'y' : 'ies'}, ${added} sitemap URL(s) added, fonts ${fonts.inlined ? 'inlined' : 'linked'} → ${OUT}`)
  if (fatal.length) {
    console.error(`${TAG} FAILED — a published study did not render:\n  ${fatal.join('\n  ')}`)
    exitCode = 1
  }
} catch (e) {
  if (!e?.handled) {
    // Unexpected error outside a single study's render (e.g. the SSR loader).
    loud(`Unexpected error: ${e?.stack || e}`)
  }
} finally {
  await server.close()
}
process.exit(exitCode)
