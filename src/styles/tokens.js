export const C = {
  base: '#080C14',
  surface: '#0D1525',
  surface2: '#111827',
  border: '#1E293B',
  borderHover: '#2D3F55',
  text: '#E2E8F0',
  textMuted: '#64748B',
  textFaint: '#334155',
  green: '#22C55E',
  greenBg: '#052E16',
  greenBorder: '#166534',
  amber: '#F59E0B',
  amberBg: '#1C1000',
  amberBorder: '#92400E',
  red: '#EF4444',
  redBg: '#1C0000',
  redBorder: '#991B1B',
  blue: '#38BDF8',
  blueBg: '#0C2340',
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
  return C.surface
}
