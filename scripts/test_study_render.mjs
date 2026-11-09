// scripts/test_study_render.mjs
//
// Renders <StudyPage> for the fictional fixtures with react-dom/server and
// writes standalone previews (study.css inlined):
//
//   scratch/study-preview-inr.html
//   scratch/study-preview-usd.html
//   scratch/study-preview-empty.html
//
// JSX is compiled by Vite's SSR loader (vite + @vitejs/plugin-react are
// already devDependencies) with configFile:false, so the app's vite.config.js
// and PWA setup are not involved. No new dependencies.
//
// Fails (exit 1) when:
//   - any render throws, or produces empty output
//   - visible text or attributes contain the whole words "buy", "sell",
//     "target price" or "price_data" (case-insensitive)
//   - any heading is empty, or heading levels skip (h1 → h3)
//   - a section has an <h2> but no content
//   - the empty fixture renders any optional section or the TOC
//   - a SourceRef points at an id missing from the Sources list
//
// Usage: node scripts/test_study_render.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'scratch')

const failures = []
const fail = (name, msg) => failures.push(`[${name}] ${msg}`)

const BANNED = [/\bbuy\b/i, /\bsell\b/i, /\btarget\s+price\b/i, /\bprice_data\b/i]
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&display=swap" rel="stylesheet">'

function checkMarkup(name, html, opts = {}) {
  const { expectEmpty = false } = opts
  if (!opts.allowTiny && (!html || html.length < 200)) fail(name, `output is empty or tiny (${html?.length ?? 0} bytes)`)

  for (const re of BANNED) {
    const m = re.exec(html)
    if (m) fail(name, `banned term "${m[0]}" near: …${html.slice(Math.max(0, m.index - 60), m.index + 40)}…`)
  }

  // Empty headings
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
    if (!m[2].replace(/<[^>]+>/g, '').trim()) fail(name, `empty <h${m[1]}>`)
  }

  // Heading order: never skip a level going down.
  let prev = 0
  for (const m of html.matchAll(/<h([1-6])\b/g)) {
    const lvl = Number(m[1])
    if (prev && lvl > prev + 1) fail(name, `heading jumps from h${prev} to h${lvl}`)
    prev = lvl
  }
  const h1 = (html.match(/<h1\b/g) || []).length
  if (h1 !== (opts.h1 ?? 1)) fail(name, `expected ${opts.h1 ?? 1} <h1>, got ${h1}`)

  // Images: alt + width + height on every <img>, one credit per image,
  // lazy unless it is the single high-priority hero or the (above-the-fold) logo.
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0])
  for (const img of imgs) {
    if (!/\balt="[^"]*\S[^"]*"/.test(img)) fail(name, `<img> without alt text: ${img.slice(0, 90)}`)
    if (!/\bwidth="\d+"/.test(img) || !/\bheight="\d+"/.test(img)) fail(name, `<img> without width/height: ${img.slice(0, 90)}`)
    const priority = /fetchpriority="high"/i.test(img)
    if (!priority && !/class="st-logo"/.test(img) && !/loading="lazy"/.test(img)) fail(name, `non-hero <img> not lazy: ${img.slice(0, 90)}`)
    if (!/object-position:/.test(img)) fail(name, `<img> without object-position: ${img.slice(0, 90)}`)
  }
  const credits = (html.match(/class="st-credit"/g) || []).length
  if (credits !== imgs.length) fail(name, `${imgs.length} images but ${credits} credit lines`)
  if ((html.match(/fetchpriority="high"/gi) || []).length > 1) fail(name, 'more than one fetchpriority="high" image')
  if (opts.images !== undefined && imgs.length !== opts.images) fail(name, `expected ${opts.images} images, got ${imgs.length}`)

  // A section whose only child is its h2.
  for (const m of html.matchAll(/<section\b[^>]*>\s*<h2\b[^>]*>[\s\S]*?<\/h2>\s*<\/section>/g)) {
    fail(name, `section with heading but no content: ${m[0].slice(0, 80)}`)
  }

  // Every SourceRef target exists.
  const anchors = new Set([...html.matchAll(/id="(src-[^"]+)"/g)].map((m) => m[1]))
  for (const m of html.matchAll(/href="#(src-[^"]+)"/g)) {
    if (!anchors.has(m[1])) fail(name, `SourceRef to missing #${m[1]}`)
  }

  // TOC entries all resolve to a section id.
  const ids = new Set([...html.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]))
  const toc = html.match(/<nav class="st-toc"[\s\S]*?<\/nav>/)
  if (toc) {
    for (const m of toc[0].matchAll(/href="#([^"]+)"/g)) {
      if (!ids.has(m[1])) fail(name, `TOC links to #${m[1]} which did not render`)
    }
  }

  if (expectEmpty) {
    const h2 = (html.match(/<h2\b/g) || []).length
    if (h2 !== 0) fail(name, `empty fixture rendered ${h2} <h2> (expected 0)`)
    if (/<section\b/.test(html)) fail(name, 'empty fixture rendered a <section>')
    if (/st-toc/.test(html)) fail(name, 'empty fixture rendered the TOC')
    if (/st-headline/.test(html)) fail(name, 'whitespace-only headline rendered')
    if (/<img\b/.test(html)) fail(name, 'empty fixture rendered an image')
  }
}

function page(title, body, css) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title}</title><meta name="robots" content="noindex">${FONTS}` +
    `<style>html,body{margin:0}body{background:#F2F0E9}${css}</style></head><body>${body}</body></html>`
  )
}

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
  const { default: StudyPage } = await server.ssrLoadModule('/src/components/study/StudyPage.jsx')
  const fx = await server.ssrLoadModule('/src/components/study/__fixtures__/sample-study.js')
  const fmt = await server.ssrLoadModule('/src/components/study/format.js')
  const css = readFileSync(resolve(ROOT, 'src/styles/study.css'), 'utf8')

  // ── format.js unit checks ──────────────────────────────────────────
  const eq = (label, got, want) => {
    if (got !== want) fail('format', `${label}: got "${got}", want "${want}"`)
  }
  eq('indian grouping', fmt.formatFigure(1234567, 'INR', 'crore'), '12,34,567')
  eq('intl grouping', fmt.formatFigure(1234567, 'USD', 'million'), '1,234,567')
  eq('amount INR', fmt.formatAmount(1342.7, 'INR', 'crore'), '₹1,343 crore')
  eq('amount USD', fmt.formatAmount(48.25, 'USD', 'million'), 'US$48.3 million')
  eq('amount negative', fmt.formatAmount(-12.5, 'INR', 'crore'), '−₹12.5 crore')
  eq('unit label INR', fmt.unitLabel('INR', 'crore'), '₹ crore')
  eq('unit label USD', fmt.unitLabel('USD', 'million'), 'US$ million')
  eq('missing amount', fmt.formatAmount(null, 'INR', 'crore'), '—')
  eq('missing is not zero', fmt.formatFigure('', 'INR', 'crore'), '—')
  eq('zero stays zero', fmt.formatFigure(0, 'INR', 'crore'), '0.00')
  eq('pct', fmt.formatPct(12.345), '12.3%')
  eq('date', fmt.formatDate('2026-11-08'), '8 Nov 2026')
  eq('timestamp date', fmt.formatDate('2026-11-08T23:30:00Z'), '8 Nov 2026')
  eq('fiscal label passthrough', fmt.fiscalLabel({ fiscal_label: 'Q2 FY27', period_end: '2026-09-30' }), 'Q2 FY27')
  eq('fiscal label fallback', fmt.fiscalLabel({ period_end: '2026-09-30' }), 'Sep 2026')
  eq('unsafe href', String(fmt.safeHref('javascript:alert(1)')), 'null')

  // ── renders ────────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true })
  const home = await server.ssrLoadModule('/src/components/study/index.js')
  const studyProps = (study) => ({
    study,
    labels: fx.sampleLabels,
    sectionTitles: fx.sampleSectionTitles,
  })
  const H = fx.sampleHome
  const homeTree = (data) =>
    createElement(
      home.StudyLayout,
      { width: 'wide' },
      createElement(home.HomeHero, { hero: data.hero, study: data.heroStudy }),
      createElement(home.ValuePropStrip, { items: data.valueProps }),
      data.sections?.latest_studies?.visible &&
        createElement(home.LatestStudies, { title: data.sections.latest_studies.title, studies: data.studies, labels: data.labels }),
      data.sections?.whats_new?.visible &&
        createElement(home.WhatsNewList, { title: data.sections.whats_new.title, items: data.whatsNew, labels: data.labels }),
      data.sections?.popular_series?.visible &&
        createElement(home.SeriesList, { title: data.sections.popular_series.title, series: data.series, labels: data.labels }),
    )
  const homeEmpty = { hero: {}, heroStudy: null, valueProps: [], sections: H.sections, studies: [], whatsNew: [], series: [] }

  // [name, element factory, checkMarkup opts]
  // INR images: hero, logo, founder, product, timeline = 5 (the no-credit and no-alt media are refused).
  // Home images: hero (study fallback), one card (the no-credit card image is refused), one series = 3.
  const cases = [
    ['inr', () => createElement(StudyPage, studyProps(fx.sampleStudyInr)), { images: 5 }],
    ['usd', () => createElement(StudyPage, studyProps(fx.sampleStudyUsd)), { images: 0 }],
    ['empty', () => createElement(StudyPage, studyProps(fx.sampleStudyEmpty)), { expectEmpty: true, images: 0 }],
    ['home', () => homeTree({ ...H, labels: fx.sampleLabels }), { images: 3 }],
    ['home-empty', () => homeTree({ ...homeEmpty, labels: fx.sampleLabels }), { h1: 0, images: 0, allowTiny: true }],
  ]
  const sizes = []
  const out = {}
  for (const [name, make, opts] of cases) {
    let html = ''
    try {
      html = renderToStaticMarkup(make())
    } catch (e) {
      fail(name, `render threw: ${e?.stack || e}`)
      continue
    }
    // Deterministic: a second render must be byte-identical.
    if (renderToStaticMarkup(make()) !== html) fail(name, 'render is not deterministic')
    checkMarkup(name, html, opts)
    out[name] = html

    const doc = page(`${name} — study preview`, html, css)
    const file = resolve(OUT_DIR, `study-preview-${name}.html`)
    writeFileSync(file, doc, 'utf8')
    sizes.push({
      name,
      file,
      markup: Buffer.byteLength(html),
      total: Buffer.byteLength(doc),
      gzip: gzipSync(doc).length,
    })
  }
  if (out['home-empty'] && /<(section|h2|li)\b/.test(out['home-empty'])) {
    fail('home-empty', 'empty homepage data rendered sections or list items')
  }

  // Fixture-specific expectations.
  const inr = out.inr || ''
  const expect = (label, cond) => {
    if (!cond) fail('inr', label)
  }
  expect('raw <script> must be escaped', !inr.includes('<script>') && inr.includes('&lt;script&gt;'))
  expect('javascript: link must not render as a link', !/href="javascript:/i.test(inr))
  expect('restated FY26 PAT (rev 2) is used', inr.includes('21.72') && !inr.includes('20.20'))
  expect('FY21 is outside the 5-year window', !inr.includes('FY21'))
  expect('inactive watch item hidden', !inr.includes('Old item no longer tracked'))
  expect('unchanged holder hidden', !inr.includes('Steady Example Trust'))
  expect('ownership heading present', inr.includes('>Ownership changes</h2>'))
  expect('neutral ownership wording', inr.includes('changed its disclosed holding from 2.10% to 2.90%'))
  expect('byline', inr.includes('PineX Research'))
  expect('pull quote rendered', /<blockquote>/.test(inr))
  expect('indian grouping in tables', inr.includes('1,342.7') === false && inr.includes('1,343'))
  expect('section title override from site_content', inr.includes('>The story so far</h2>'))
  expect('label from data', inr.includes('>Company Study</p>'))
  expect('read time from labels template', / min read/.test(inr))
  expect('hero is high priority', /<img[^>]*fetchpriority="high"[^>]*>/i.test(inr) && inr.includes('Fictional illustration: exmat plant'))
  expect('srcset from variants', inr.includes('exmat-plant-640.avif 640w, https://example.com/media/exmat-plant-1280.avif 1280w'))
  expect('avif + webp sources, jpeg fallback', /<source type="image\/avif"/.test(inr) && /<source type="image\/webp"/.test(inr) && /exmat-plant-640\.jpg 640w/.test(inr))
  expect('focal point applied', inr.includes('object-position:50% 35%'))
  expect('caption rendered', inr.includes('The original plant, as described in the FY24 annual report.'))
  expect('media without credit refused', !inr.includes('no-credit'))
  expect('media without alt refused', !inr.includes('no-alt'))
  expect('pledged sub-row under promoters', inr.includes('Pledged (% of promoter holding)'))
  const usd = out.usd || ''
  if (!usd.includes('1,234,568')) fail('usd', 'international grouping not applied (expected 1,234,568)')
  if (!usd.includes('US$ million')) fail('usd', 'unit label "US$ million" missing')
  if (!usd.includes('−12,501') && !usd.includes('−12,500')) fail('usd', 'negative PAT not formatted with minus sign')

  const hm = out.home || ''
  const hx = (label, cond) => {
    if (!cond) fail('home', label)
  }
  hx('hero headline falls back to study headline', hm.includes(fx.sampleStudyInr.company.headline))
  hx('hero CTA from site_content', hm.includes('>Read the study</a>') && hm.includes('href="/company/example-materials"'))
  hx('section titles from site_content', hm.includes('>Latest studies</h2>') && hm.includes('>Popular series</h2>'))
  hx('card title uses card_title', hm.includes('How a binder maker found three markets'))
  hx('read time template', hm.includes('9 min read') && hm.includes('4 min read'))
  hx('series count template', hm.includes('3 studies'))
  hx('inactive series hidden', !hm.includes('Retired series'))
  // value props 3 known keys (1 unknown) + whats-new 2 icon keys + series 2 icon keys
  hx('unknown icon key renders nothing', (hm.match(/class="st-icon/g) || []).length === 3 + 2 + 2)
  hx('unsafe whats-new link not linked', !/href="javascript:/i.test(hm) && hm.includes('Unsafe link must not be linked'))
  hx('kind labels from site_content', hm.includes('Results note') && hm.includes('Development'))

  console.log('\nStudy render test')
  for (const s of sizes) {
    console.log(
      `  ${s.name.padEnd(10)} markup ${(s.markup / 1024).toFixed(1).padStart(6)} KB · page ${(s.total / 1024)
        .toFixed(1)
        .padStart(6)} KB · gzip ${(s.gzip / 1024).toFixed(1).padStart(5)} KB  → ${s.file}`,
    )
  }
} catch (e) {
  fail('harness', e?.stack || String(e))
} finally {
  await server.close()
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  exitCode = 1
} else {
  console.log('\nAll checks passed.')
}
process.exit(exitCode)
