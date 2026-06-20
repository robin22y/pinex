// scripts/prerender_pulse.mjs
//
// Bakes today's /pulse data into dist/index.html as
// `<script>window.__PULSE_BOOTSTRAP__ = {...}</script>` so the public
// landing paints fully-rendered content before any JS executes.
// Pulse.jsx reads the global at mount and uses it as initial state;
// when absent (dev, build with no env, fetch failure) Pulse falls back
// to its normal client-side fetch — there's no breakage.
//
// Runs after `vite build`. Wired in package.json. Designed to NEVER
// fail the build: every error path exits 0 with a warning so a flaky
// Supabase doesn't gate a deploy.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ── .env.local autoloader ────────────────────────────────────────────
// Netlify supplies env vars via the build environment; local builds
// (npm run build on a developer machine) read them from .env.local.
// This shim mirrors Vite's behaviour without pulling Vite into the
// script. No-op if the file is absent.
try {
  const envFile = readFileSync('.env.local', 'utf8')
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch { /* no .env.local — fine, we'll just use process.env */ }

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  ''
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  ''

const HTML_PATH = resolve('dist/index.html')

function warn(msg) {
  console.warn(`[prerender_pulse] ${msg} — Pulse will fetch at runtime instead`)
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  warn('Supabase env vars missing')
  process.exit(0)
}

if (!existsSync(HTML_PATH)) {
  warn(`${HTML_PATH} not found (did vite build run?)`)
  process.exit(0)
}

// Tiny PostgREST helper. Mirrors the supabase-js query patterns used
// in src/pages/Pulse.jsx so the bootstrap shape matches exactly.
async function rest(path, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`)
  return res.json()
}

// The select string is intentionally identical to Pulse.jsx so any
// future schema change shows up in BOTH places when the prerender
// breaks against the new columns.
const INTERNALS_COLS = [
  'date', 'nifty_close', 'india_vix', 'vix_level',
  'stage1_count', 'stage2_count', 'stage3_count', 'stage4_count',
  'total_stocks', 'stage2_pct', 'stage4_pct',
  'advances', 'declines', 'ad_ratio',
  'above_ma30w_pct', 'above_ma30w_count',
  'market_phase', 'market_health_score',
  'nifty_change_1d', 'nifty_change_1w',
  'new_52w_highs', 'new_52w_lows',
  'divergence_active', 'divergence_severity',
].join(',')

const SECTORS_COLS = 'name,display_name,stage2_pct,health,total_companies,stage2_count'

try {
  // 1. Latest market_internals row
  const internalsRows = await rest('market_internals', {
    select: INTERNALS_COLS,
    order: 'date.desc',
    limit: '1',
  })
  if (!internalsRows.length) {
    warn('market_internals returned 0 rows')
    process.exit(0)
  }
  const internals = internalsRows[0]
  const dataDate = internals.date

  // 2. Sectors for that date (with prior-date fallback, matching Pulse.jsx)
  let sectors = await rest('sectors', {
    select: SECTORS_COLS,
    date: `eq.${dataDate}`,
    order: 'stage2_pct.desc',
  })
  if (sectors.length === 0) {
    const fallbackProbe = await rest('sectors', {
      select: 'date',
      date: `lte.${dataDate}`,
      order: 'date.desc',
      limit: '1',
    })
    const fallbackDate = fallbackProbe[0]?.date
    if (fallbackDate && fallbackDate !== dataDate) {
      sectors = await rest('sectors', {
        select: SECTORS_COLS,
        date: `eq.${fallbackDate}`,
        order: 'stage2_pct.desc',
      })
    }
  }

  // 3. Available dates for the prev/next DateNav (~500 trading days ≈ 2y)
  const datesRows = await rest('market_internals', {
    select: 'date',
    date: 'gte.2020-01-28',
    order: 'date.desc',
    limit: '500',
  })
  const availableDates = datesRows.map((r) => r.date)

  const bootstrap = {
    date: dataDate,
    internals,
    sectors,
    availableDates,
    // Stamp so the runtime can decide whether to revalidate aggressively
    // if the build is hours old vs. minutes old.
    builtAt: new Date().toISOString(),
  }

  // Escape `<` to prevent any `</script>` payload inside the JSON
  // (defence-in-depth; the data is structured and shouldn't carry HTML).
  const safe = JSON.stringify(bootstrap).replace(/</g, '\\u003c')
  const tag = `<script>window.__PULSE_BOOTSTRAP__=${safe};</script>`

  let html = readFileSync(HTML_PATH, 'utf8')
  if (!/<\/head>/i.test(html)) {
    warn('no </head> in dist/index.html — refusing to inject')
    process.exit(0)
  }
  if (html.includes('window.__PULSE_BOOTSTRAP__')) {
    // Idempotent — replace existing tag in case the script is run twice.
    html = html.replace(
      /<script>window\.__PULSE_BOOTSTRAP__=[\s\S]*?<\/script>/,
      tag,
    )
  } else {
    html = html.replace(/<\/head>/i, `    ${tag}\n  </head>`)
  }
  writeFileSync(HTML_PATH, html, 'utf8')

  console.log(
    `[prerender_pulse] OK — date=${dataDate} sectors=${sectors.length} dates=${availableDates.length}`,
  )
} catch (e) {
  warn(`fetch failed: ${e.message}`)
  process.exit(0)
}
