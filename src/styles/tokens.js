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
  green: '#34D399',
  greenBg: '#052818',
  greenBorder: '#166534',
  amber: '#FBBF24',
  amberBg: '#1f1500',
  amberBorder: '#92400e',
  red: '#F87171',
  redBg: '#1f0a0a',
  redBorder: '#991B1B',
  blue: '#38BDF8',
  blueBg: '#0c1e2f',
  purple: '#A78BFA',
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
