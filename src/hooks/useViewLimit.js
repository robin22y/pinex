import { useCallback } from 'react'
import { CONFIG } from '../config'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'

function getLocalCalendarDateString() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function useViewLimit() {
  const { user, profile } = useAuth()
  const isPaid = profile?.plan === 'paid'

  const getTodayViewCount = useCallback(async () => {
    if (!user?.id) return 0

    const today = getLocalCalendarDateString()
    const { count, error } = await supabase
      .from('daily_views')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('viewed_date', today)

    if (error) return 0
    return count ?? 0
  }, [user])

  const checkAndRecordView = useCallback(
    async (companyId) => {
      if (!user?.id) {
        return { allowed: true }
      }

      const today = getLocalCalendarDateString()
      const limit = CONFIG.limits.freeStockViewsPerDay

      const { count, error: countError } = await supabase
        .from('daily_views')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('viewed_date', today)

      if (countError) {
        return { allowed: true }
      }

      const currentCount = count ?? 0

      if (currentCount >= limit && !isPaid) {
        return { allowed: false, count: currentCount, limit }
      }

      const { error: insertError } = await supabase.from('daily_views').insert({
        user_id: user.id,
        viewed_date: today,
        company_id: companyId,
      })

      if (insertError) {
        return { allowed: true, count: currentCount }
      }

      return { allowed: true, count: currentCount + 1 }
    },
    [user, isPaid],
  )

  return { checkAndRecordView, getTodayViewCount }
}
