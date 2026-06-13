/** Canonical key e.g. "Stage 1+" → "stage1+" */

export function normalizeStageKey(stage) {
  return String(stage ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '')
}

/** Normalize DB/copy variants into config keys (`Stage 1`, `Stage 1+`, …). */
export function canonicalStageForBadge(stage) {
  if (stage == null || !String(stage).trim()) return 'Unclassified'
  const k = normalizeStageKey(stage)
  if (k === 'unclassified') return 'Unclassified'
  if (k === 'stage1+') return 'Stage 1+'
  if (k === 'stage1') return 'Stage 1'
  if (k === 'stage2') return 'Stage 2'
  if (k === 'stage3') return 'Stage 3'
  if (k === 'stage4') return 'Stage 4'
  return 'Unclassified'
}

/**
 * Display-label map for the PineX cycle phases.
 *
 * WHY: The DB column `price_data.stage` stores the literal strings
 * "Stage 1" / "Stage 2" / "Stage 3" / "Stage 4" / "Stage 1+" — those
 * are the canonical identifiers used in queries, comparisons, and
 * the `STAGE_BADGE_CONFIG` keys below. **Never rename the keys** or
 * every filter / colour / tooltip breaks.
 *
 * The user-facing names are different and routed through this map.
 * Callsites that need to *display* a stage should call
 * `stageDisplayName(stage)` (or read `.label` from `stageBadge`) so
 * the wording can evolve without touching every screen.
 */
export const STAGE_DISPLAY_NAMES = {
  'Stage 1':   'Basing',
  'Stage 1+':  'Emerging ↗',
  'Stage 2':   'Advancing',
  'Stage 3':   'Topping',
  'Stage 4':   'Declining',
  Unclassified: 'N/A',
}

/**
 * Resolve a DB stage value to its PineX display label.
 *
 * Accepts any of the canonical-key variants `canonicalStageForBadge`
 * understands ("stage2", "Stage 2", "STAGE2", " stage 2 ", etc.).
 * Falls back to "N/A" for unknown / missing inputs.
 */
export function stageDisplayName(stage) {
  const canon = canonicalStageForBadge(stage)
  return STAGE_DISPLAY_NAMES[canon] || STAGE_DISPLAY_NAMES.Unclassified
}

/** Visual + label preset for every Stage cluster (badge, tiles, KPI dots).
 *
 * Keys MUST stay as the DB values ("Stage 1", "Stage 2", …) — they're
 * the lookup keys read all over the app. Only the `label` field is
 * the user-facing string; that pulls from `STAGE_DISPLAY_NAMES` so
 * the wording stays in one place. */
const STAGE_BADGE_CONFIG = {
  'Stage 1': {
    bg: '#0C2340',
    color: '#38BDF8',
    label: STAGE_DISPLAY_NAMES['Stage 1'],
  },
  'Stage 1+': {
    bg: '#042f2e',
    color: '#0D9488',
    label: STAGE_DISPLAY_NAMES['Stage 1+'],
  },
  'Stage 2': {
    bg: '#052E16',
    color: '#16A34A',
    label: STAGE_DISPLAY_NAMES['Stage 2'],
  },
  'Stage 3': {
    bg: '#1C1A00',
    color: '#D97706',
    label: STAGE_DISPLAY_NAMES['Stage 3'],
  },
  'Stage 4': {
    bg: '#1C0000',
    color: '#DC2626',
    label: STAGE_DISPLAY_NAMES['Stage 4'],
  },
  Unclassified: {
    bg: '#1E293B',
    color: '#64748B',
    label: STAGE_DISPLAY_NAMES.Unclassified,
  },
}

export function stageBadge(stage) {
  const canon = canonicalStageForBadge(stage)
  return STAGE_BADGE_CONFIG[canon] || STAGE_BADGE_CONFIG.Unclassified
}

/** Treemap tile / KPI accent colour (readable on dark bg). */
export function stageAccentColor(stage) {
  return stageBadge(stage).color
}

/** Pills matching StockDetail hero / key-metrics (border from accent). */
export function stageHeaderPillStyle(stage) {
  const { bg, color } = stageBadge(stage)
  return {
    background: bg,
    border: `1px solid ${hexAlpha(color, 0.42)}`,
    color,
  }
}

/** @param {number} alpha 0–1 */
function hexAlpha(hex, alpha) {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('')
  }
  const num = Number.parseInt(h, 16)
  if (!Number.isFinite(num)) return `rgba(100,116,139,${alpha})`
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r},${g},${b},${alpha})`
}

export const STAGE_EMERGING_TITLE = 'Breaking out of base — watch for MA crossover'

/** Weinstein emergence bucket / DB value `Stage 1+`. */
export function isStageOnePlus(stage) {
  return canonicalStageForBadge(stage) === 'Stage 1+'
}

/** Short label everywhere (Emerging ↗ etc.). */
export function stageShortDisplay(stage) {
  return stageBadge(stage).label
}

/** Paragraph-style wording for peer links. */
export function stagePrettyFromDb(stage) {
  if (!stage || !String(stage).trim()) return '—'
  return stageBadge(stage).label
}

/** Maps to `Badge` status for fallbacks still using Badge.jsx */
export function stageToBadgeStatus(stage) {
  const k = canonicalStageForBadge(stage)
  if (k === 'Stage 1+') return 'teal'
  if (k === 'Stage 2') return 'green'
  if (k === 'Stage 1') return 'blue'
  if (k === 'Stage 3') return 'amber'
  if (k === 'Stage 4') return 'red'
  return 'neutral'
}

/** Scanner / sector list: Stage 1 uses amber dots (legacy). */
export function heatMapStageBadgeStatus(stageRaw) {
  const k = canonicalStageForBadge(stageRaw)
  if (k === 'Stage 1+') return 'teal'
  if (k === 'Stage 2') return 'green'
  if (k === 'Stage 1') return 'amber'
  if (k === 'Stage 3') return 'red'
  if (k === 'Stage 4') return 'red'
  return 'neutral'
}

export function heatMapStageLabel(stage) {
  return stageBadge(stage).label
}

/** Sort peers: Stage 2 → Emerging → Stage 1 → rest. */
export function stagePeersSortOrder(stage) {
  const order = {
    Stage2: 0,
    Stage1Plus: 0.5,
    Stage1: 1,
    Other: 2,
  }
  const k = canonicalStageForBadge(stage)
  if (k === 'Stage 2') return order.Stage2
  if (k === 'Stage 1+') return order.Stage1Plus
  if (k === 'Stage 1') return order.Stage1
  return order.Other
}
