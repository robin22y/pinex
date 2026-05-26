import { useCallback, useMemo } from 'react'
import { CONFIG } from '../config'
import { useAuth } from '../context'

const PAYWALLED_FEATURES = new Set([
  'full_scanner',
  'alerts',
  'unlimited_views',
  'unlimited_watchlist',
  'unlimited_portfolio',
  'unlimited_downloads',
  'no_ads',
])

/**
 * OPEN_FREE — temporary kill switch that opens every paywalled
 * feature to every user.
 *
 * WHY: Pro tier is on the roadmap but not shipping yet. Until then
 * the watchlist (and every other "unlimited_*" feature) should be
 * free for everyone. Flip this to `false` the day pro launches —
 * `PAYWALLED_FEATURES` + `canAccess` + the per-feature gating
 * sites all keep working unchanged, so the toggle is a single-line
 * change at launch time, not a refactor.
 */
const OPEN_FREE = true

export function usePlan() {
  const { profile } = useAuth()

  const isPaid = profile?.plan === 'paid'
  const isFree = !isPaid

  const canAccess = useCallback(
    (feature) => {
      // Free-for-all override — see OPEN_FREE above.
      if (OPEN_FREE) return true
      if (CONFIG.features.paywallActive === false) {
        return true
      }
      if (!PAYWALLED_FEATURES.has(feature)) {
        return true
      }
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
