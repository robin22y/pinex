import { useCallback, useMemo } from 'react'
import { CONFIG } from '../config'
import { useAuth } from '../context'

/* ════════════════════════════════════════════════════════════════
   PineX product tiering — single source of truth
   ════════════════════════════════════════════════════════════════

   The three lists below describe PineX's permanent product
   structure. Every gate in the app should resolve through this
   file rather than hard-coding a plan check at the callsite.

   ──────────────────────────────────────────────────────────────
   FREE_FOREVER
   ──────────────────────────────────────────────────────────────
   Promised to every logged-in user, paid or unpaid, in perpetuity.
   These features cannot be moved to Pro under any future tier
   restructuring — they are part of the platform's core value
   proposition.

     • Academy / all learning content
     • All 2,100+ NSE stocks (data access)
     • SwingX full list
     • Phase data + the basic screener
     • Watchlist at the current free-tier capacity

   These keys are documented for clarity. `canAccess()` ignores
   them — anything outside PRO_FEATURES is unconditionally
   accessible by design.

   ──────────────────────────────────────────────────────────────
   PRO_FEATURES
   ──────────────────────────────────────────────────────────────
   The set the future Pro tier will gate. Every entry below has
   a stable string key so individual surfaces can call
   `canAccess('alerts')` etc. without coupling to plan internals.
   See OPEN_FREE below — today every feature is open to all users.

   ──────────────────────────────────────────────────────────────
   EDITORIAL_NEVER
   ──────────────────────────────────────────────────────────────
   PineX is built on cycle analysis, factual observations, and
   neutral questions. The following will NEVER be offered, at any
   tier, regardless of demand:

     • Price targets
     • Stop-loss recommendations
     • Buy/sell signals
     • Forward-looking statements ("this will go up", etc.)

   This is a tone + regulatory line, not a feature list. Anything
   shipped on PineX should be auditable against it.
   ════════════════════════════════════════════════════════════════ */

/** Features the eventual Pro tier will gate. Keys are stable. */
const PRO_FEATURES = new Set([
  // Notifications + delivery
  'alerts',                  // Per-stock and per-watchlist alerts

  // Data export
  'pdf_export',              // Technical Structure Report PDF
  'csv_export',              // Tabular exports of any list

  // Screener
  'advanced_screener_filters', // multi-condition / saved filter sets

  // Watchlist
  'multiple_watchlists',     // Free users get one; Pro gets many
  'unlimited_watchlist',     // Per-list size limit lifted

  // Portfolio
  'portfolio_tracker',       // Manual holdings + per-position view

  // Reports + briefs
  'morning_brief_full',      // Free users get a teaser; Pro full
  'weekly_phase_report',     // End-of-week per-watchlist digest
  'historical_phase_log',    // Per-stock phase-transition timeline

  // Stock detail tools
  'personal_notes',          // Per-stock notes attached to watchlist
  'position_math_tool',      // Position sizing / R-multiple helper
])

/**
 * Free-forever feature keys — documented so a future contributor
 * doesn't accidentally add them to PRO_FEATURES. Not used at
 * runtime; the canAccess() default-allow path covers them.
 */
// eslint-disable-next-line no-unused-vars
const FREE_FOREVER = new Set([
  'academy',
  'all_nse_stocks',
  'swingx_full_list',
  'phase_data',
  'basic_screener',
  'basic_watchlist',
])

/**
 * Editorial scope — the things PineX will never offer. Not a
 * runtime gate; recorded here so reviewers can grep for it.
 */
// eslint-disable-next-line no-unused-vars
const EDITORIAL_NEVER = Object.freeze([
  'price_targets',
  'stop_loss_recommendations',
  'buy_sell_signals',
  'forward_looking_statements',
])

/**
 * OPEN_FREE — temporary kill switch that opens every Pro feature
 * to every user.
 *
 * WHY: Pro tier is on the roadmap but not shipping yet. Until then
 * watchlist limits and every other "Pro" feature should be free
 * for everyone. Flip this to `false` the day Pro launches — every
 * gate site keeps working unchanged, so the toggle is a single-
 * line change at launch time, not a refactor.
 */
const OPEN_FREE = true

/**
 * Back-compat alias — earlier code referenced PAYWALLED_FEATURES.
 * Kept so an accidental external import keeps resolving while we
 * migrate any stragglers to the new PRO_FEATURES name.
 */
const PAYWALLED_FEATURES = PRO_FEATURES

export function usePlan() {
  const { profile } = useAuth()

  const isPaid = profile?.plan === 'paid'
  const isFree = !isPaid

  /**
   * canAccess(featureKey) — single API every gate should resolve
   * through. Order of checks:
   *   1. OPEN_FREE kill-switch (currently ON) — everyone passes
   *   2. CONFIG.features.paywallActive=false (env override) — pass
   *   3. Feature not in PRO_FEATURES — implicitly FREE_FOREVER, pass
   *   4. User is on the paid plan — pass
   *   5. Otherwise — block
   * The FREE_FOREVER set is documented above; we don't check it
   * here because anything outside PRO_FEATURES is, by definition,
   * unrestricted.
   */
  const canAccess = useCallback(
    (feature) => {
      if (OPEN_FREE) return true
      if (CONFIG.features.paywallActive === false) return true
      if (!PRO_FEATURES.has(feature)) return true
      return isPaid
    },
    [isPaid],
  )

  const limits = useMemo(() => ({ ...CONFIG.limits }), [])

  return {
    isPaid,
    isFree,
    canAccess,
    limits,
  }
}
