/**
 * Dark UI tokens — Nexio-inspired: deep charcoal base, near-white headings,
 * teal primary actions, restrained borders.
 */
// Background / border / text tokens now point at the CSS variables
// defined in src/theme.css. The variables flip automatically when
// the user switches between dark and sepia, so every component using
// C.surface / C.text / C.border etc. gets the right theme value with
// zero per-file edits.
//
// Accent + semantic colors (green/red/amber/blue/purple) stay as
// fixed hex strings — they're brand colors and read correctly on
// both backgrounds.
// Every token here that referenced a hardcoded hex (greenBg, amber,
// redBorder etc.) now resolves via the CSS variables defined in
// src/theme.css. Sepia + dark each carry their own values, so any
// component using e.g. C.amber inherits the right hue (bright #FBBF24
// in dark / muted #8B6914 in sepia) with zero per-callsite edits.
//
// The previous "fixed hex strings, they read correctly on both
// backgrounds" comment was wrong — bright dark-mode amber bled through
// to /lab in sepia. The semantic-via-CSS-var indirection fixes it.
export const C = {
  base: 'var(--bg-primary)',
  surface: 'var(--bg-surface)',
  surface2: 'var(--bg-elevated)',
  surfaceCard: 'var(--bg-elevated)',
  border: 'var(--border)',
  borderHover: 'var(--border-hover)',
  text: 'var(--text-primary)',
  textHeading: 'var(--text-primary)',
  textMuted: 'var(--text-muted)',
  textFaint: 'var(--text-hint)',
  accent: '#2DD4BF',
  accentMuted: '#115e54',
  accentBg: '#0f2420',
  accentOn: '#05070A',
  green:       'var(--positive)',
  greenBg:     'var(--positive-dim)',
  greenBorder: 'var(--positive-border)',
  amber:       'var(--warning)',
  amberBg:     'var(--warning-dim)',
  amberBorder: 'var(--warning-border)',
  red:         'var(--negative)',
  redBg:       'var(--negative-dim)',
  redBorder:   'var(--negative-border)',
  blue:        'var(--info)',
  blueBg:      'var(--info-dim)',
  purple:      'var(--info)', // closest semantic; sepia has no purple variant
}

// Font stacks. `mono` is loaded from Google Fonts in index.html and
// also exposed as the `.num` utility in src/index.css — use either
// (`style={{ fontFamily: FONTS.mono }}` or `className="num"`) to put
// numeric values onto JetBrains Mono with tabular figures.
export const FONTS = {
  mono: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
  sans: 'inherit',
}

export const statusColor = (status) => {
  if (status === 'green') return C.green
  if (status === 'amber') return C.amber
  if (status === 'red') return C.red
  return C.textMuted
}

export const statusBg = (status) => {
  if (status === 'green') return C.greenBg
  if (status === 'amber') return C.amberBg
  if (status === 'red') return C.redBg
  return C.surfaceCard
}
