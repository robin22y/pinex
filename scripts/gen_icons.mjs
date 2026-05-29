// gen_icons.mjs — regenerate PineX branding raster assets from code.
//
//   node scripts/gen_icons.mjs
//
// Writes two files into public/:
//   • apple-touch-icon.png  (180x180)  — iOS home-screen / Safari pinned tab.
//   • og-image.png          (1200x630) — social share card (og:image / twitter:image).
//
// Rendered with sharp (SVG -> PNG) so they stay in version control without a
// design tool. The OG card is deliberately brand-forward and legally neutral:
// NO specific stock picks, prices, stage verdicts or buy-looking badges — it
// carries the "Data only · Not investment advice · Not SEBI registered" line
// instead, matching the app's editorial posture. Brand green is #00C805 to
// match --accent and favicon.svg.

import sharp from 'sharp'
import { fileURLToPath } from 'url'
import path from 'path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = path.join(root, 'public')
const FONT = 'Arial, Helvetica, sans-serif'

// ── apple-touch-icon.png (180x180) — full-bleed tile, iOS masks corners ──
const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#0B0E11"/>
  <text x="33" y="126" font-family="${FONT}" font-size="108" font-weight="700" fill="#E2E8F0">P</text>
  <text x="99" y="126" font-family="${FONT}" font-size="108" font-weight="800" fill="#00C805">X</text>
</svg>`
await sharp(Buffer.from(appleSvg)).png().toFile(path.join(pub, 'apple-touch-icon.png'))

// ── og-image.png (1200x630) — brand-forward, legally neutral (no picks) ──
const pill = (x, w, label) => `
  <rect x="${x}" y="392" width="${w}" height="46" rx="23" fill="#0f1a12" stroke="#00C80540" stroke-width="1.5"/>
  <text x="${x + w / 2}" y="421" font-family="${FONT}" font-size="19" font-weight="700" fill="#00C805" text-anchor="middle">${label}</text>`

// Decorative ascending area chart (abstract — not real data)
const pts = [[700,470],[760,452],[820,468],[880,408],[940,424],[1000,372],[1060,348],[1124,312]]
const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ')
const area = line + ` L1124,520 L700,520 Z`
const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="#00C805"/>`).join('')

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="85%" cy="12%" r="55%">
      <stop offset="0%" stop-color="#00C805" stop-opacity="0.16"/>
      <stop offset="70%" stop-color="#00C805" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0 L0 0 0 40" fill="none" stroke="#00C805" stroke-opacity="0.045" stroke-width="1"/>
    </pattern>
    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00C805" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#00C805" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="#0B0E11"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="6" fill="#00C805"/>

  <!-- Logo tile -->
  <rect x="80" y="118" width="96" height="96" rx="22" fill="#0f1a12" stroke="#00C80566" stroke-width="2"/>
  <text x="128" y="186" font-family="${FONT}" font-size="58" font-weight="800" fill="#00C805" text-anchor="middle">P</text>

  <!-- Wordmark -->
  <text x="198" y="178" font-family="${FONT}" font-size="78" font-weight="900" fill="#FFFFFF" letter-spacing="-2">pine<tspan fill="#00C805">X</tspan></text>
  <text x="202" y="214" font-family="${FONT}" font-size="25" font-weight="600" fill="#94A3B8">Indian Stock Market Intelligence</text>

  <!-- Separator -->
  <rect x="82" y="262" width="92" height="5" rx="2.5" fill="#00C805"/>

  <!-- Tagline -->
  <text x="82" y="312" font-family="${FONT}" font-size="27" font-weight="600" fill="#CBD5E1">Cycle analysis, delivery data and a</text>
  <text x="82" y="350" font-family="${FONT}" font-size="27" font-weight="600" fill="#CBD5E1">build-your-own screening Lab for 2,100+ NSE stocks.</text>

  <!-- Pills -->
  ${pill(82, 196, '2,100+ NSE Stocks')}
  ${pill(294, 170, 'Cycle Analysis')}
  ${pill(480, 158, 'Screening Lab')}

  <!-- Right-side abstract chart motif -->
  <path d="${area}" fill="url(#areaFill)"/>
  <path d="${line}" fill="none" stroke="#00C805" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}

  <!-- Footer: URL + neutral disclaimer -->
  <text x="82" y="556" font-family="${FONT}" font-size="24" font-weight="700" fill="#475569"><tspan fill="#00C805" font-weight="800">pinex</tspan>.in</text>
  <text x="1118" y="556" font-family="${FONT}" font-size="16" font-weight="600" fill="#64748B" text-anchor="end">Data only · Not investment advice · Not SEBI registered</text>
</svg>`

await sharp(Buffer.from(ogSvg)).png().toFile(path.join(pub, 'og-image.png'))

const a = await sharp(path.join(pub, 'apple-touch-icon.png')).metadata()
const o = await sharp(path.join(pub, 'og-image.png')).metadata()
console.log('apple-touch-icon.png', a.width + 'x' + a.height)
console.log('og-image.png', o.width + 'x' + o.height)
