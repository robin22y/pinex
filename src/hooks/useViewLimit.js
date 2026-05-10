import { useCallback } from 'react'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'

function getLocalCalendarDateString() {
  return new Date().toISOString().split('T')[0]
}

/** Records views for analytics; does not enforce a daily cap. */
export function useViewLimit() {
  const { user } = useAuth()

  const getTodayViewCount = useCallback(async () => {
    if (!user?.id) return 0

    const today = getLocalCalendarDateString()
    const { count, error } = await supabase
      .from('daily_views')
      .select('id', { count: 'exact' })
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

      await supabase.from('daily_views').insert({
        user_id: user.id,
        viewed_date: today,
        company_id: companyId,
      })

      return { allowed: true }
    },
    [user],
  )

  return { checkAndRecordView, getTodayViewCount }
}
