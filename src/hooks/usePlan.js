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

export function usePlan() {
  const { profile } = useAuth()

  const isPaid = profile?.plan === 'paid'
  const isFree = !isPaid

  const canAccess = useCallback(
    (feature) => {
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
