/**
 * Dark UI tokens — Nexio-inspired: deep charcoal base, near-white headings,
 * teal primary actions, restrained borders.
 */
export const C = {
  base: '#05070A',
  surface: '#0B0F18',
  surface2: '#111620',
  surfaceCard: '#121A29',
  border: '#1f2938',
  borderHover: '#2e3f5a',
  text: '#F1F5F9',
  textHeading: '#FFFFFF',
  textMuted: '#949EAB',
  textFaint: '#5c6570',
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
