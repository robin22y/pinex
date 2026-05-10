/**
 * Canonical sector health from `sectors.health` (DB: green | red | amber).
 * Also accepts legacy labels: strong → green, weak → red, mixed → amber.
 */
export function normalizeSectorHealthKey(raw) {
  const h = String(raw || '').toLowerCase().trim()
  if (h === 'green' || h === 'strong') return 'green'
  if (h === 'red' || h === 'weak') return 'red'
  if (h === 'amber' || h === 'mixed') return 'amber'
  return 'amber'
}

export function getHealthColor(health) {
  if (health === 'green') return '#22C55E'
  if (health === 'red') return '#EF4444'
  return '#F59E0B'
}

export function getHealthBg(health) {
  if (health === 'green') return '#052E16'
  if (health === 'red') return '#1C0000'
  return '#1C1000'
}

/** UI copy: green → Strong, amber → Mixed, red → Weak */
export function getHealthDisplayLabel(health) {
  if (health === 'green') return 'Strong'
  if (health === 'red') return 'Weak'
  return 'Mixed'
}

/** Maps raw DB value to Badge `status` (green | amber | red). */
export function sectorHealthBadgeStatus(raw) {
  const k = normalizeSectorHealthKey(raw)
  if (k === 'green') return 'green'
  if (k === 'red') return 'red'
  return 'amber'
}
