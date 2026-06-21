import { useCallback } from 'react'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'

const FREE_DAILY_STOCK_VIEW_LIMIT = 5

function getLocalCalendarDateString() {
  return new Date().toISOString().split('T')[0]
}

/**
 * useViewLimit — enforces the free-tier daily stock-view cap.
 *
 * Free users get FREE_DAILY_STOCK_VIEW_LIMIT (5) distinct stock
 * detail views per local-calendar day. Pro users (active 'pro' or
 * in-window 'pro_trial' — i.e. `isPro` from context) are uncapped;
 * the hook still logs their views to `daily_views` for analytics
 * but never returns `allowed: false` for them.
 *
 * checkAndRecordView(companyId) → { allowed, viewsToday, limit }
 *   - allowed=false ONLY for free users who already viewed 5
 *     DISTINCT companies today AND haven't seen this one yet
 *   - revisiting a stock the user already viewed today is always
 *     allowed (and doesn't bump the counter) — the cap targets
 *     breadth-of-discovery, not refresh behavior
 *
 * getTodayViewCount() → number — distinct stocks viewed today.
 */
export function useViewLimit() {
  const { user, isPro } = useAuth()

  const getTodayViewCount = useCallback(async () => {
    if (!user?.id) return 0
    const today = getLocalCalendarDateString()
    const { data, error } = await supabase
      .from('daily_views')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('viewed_date', today)
    if (error || !data) return 0
    return new Set(data.map(r => r.company_id).filter(Boolean)).size
  }, [user])

  const checkAndRecordView = useCallback(
    async (companyId) => {
      // Anonymous + invalid input pass through; no row written.
      if (!user?.id || !companyId) return { allowed: true }

      const today = getLocalCalendarDateString()

      // Read first so we can count distinct companies AND know if
      // this exact (user, day, company) row already exists.
      const { data: existing } = await supabase
        .from('daily_views')
        .select('company_id')
        .eq('user_id', user.id)
        .eq('viewed_date', today)

      const distinctIds = new Set((existing || []).map(r => r.company_id).filter(Boolean))
      const alreadySeen = distinctIds.has(companyId)
      const viewsToday  = distinctIds.size

      // Free users hitting the cap on a NEW stock: block, don't log.
      if (!isPro && !alreadySeen && viewsToday >= FREE_DAILY_STOCK_VIEW_LIMIT) {
        return {
          allowed:    false,
          viewsToday,
          limit:      FREE_DAILY_STOCK_VIEW_LIMIT,
        }
      }

      // Pro user OR free user under cap OR repeat visit — log once
      // per (user, day, company). Insert is fire-and-forget so a
      // unique-constraint collision (when running concurrently
      // across tabs) doesn't bubble up to the caller.
      if (!alreadySeen) {
        try {
          await supabase.from('daily_views').insert({
            user_id:     user.id,
            viewed_date: today,
            company_id:  companyId,
          })
        } catch { /* dedupe collision tolerated */ }
      }

      return {
        allowed:    true,
        viewsToday: viewsToday + (alreadySeen ? 0 : 1),
        limit:      isPro ? null : FREE_DAILY_STOCK_VIEW_LIMIT,
      }
    },
    [user, isPro],
  )

  return { checkAndRecordView, getTodayViewCount, isPro, limit: FREE_DAILY_STOCK_VIEW_LIMIT }
}
