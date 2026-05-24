import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'

const LOCAL_KEY = 'pinex_academy_v2'
const REQUIRED_MODULES = ['stage_basics']

export function useAcademy() {
  const { user, profile } = useAuth()
  const [modules, setModules] = useState([])
  const [progress, setProgress] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      await loadModules()
      if (!cancelled) await loadProgress()
    }
    init()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const loadModules = async () => {
    try {
      const { data } = await supabase
        .from('academy_modules')
        .select('*')
        .eq('is_published', true)
        .order('sort_order')
      setModules(data || [])
    } catch {
      setModules([])
    }
  }

  // WHY: Academy progress is stored in
  // localStorage for guests (no account
  // needed to learn). On login, we merge
  // localStorage into the DB so progress
  // is not lost when a guest creates
  // an account after completing modules.
  const loadProgress = async () => {
    // Load local first (fast)
    try {
      const local = JSON.parse(
        localStorage.getItem(LOCAL_KEY) || '{}'
      )
      setProgress(local)
    } catch {
      // ignore parse errors
    }

    // Load from DB if logged in
    if (user?.id) {
      try {
        const { data } = await supabase
          .from('user_module_progress')
          .select('*')
          .eq('user_id', user.id)

        if (data?.length) {
          const dbProgress = {}
          data.forEach((r) => {
            dbProgress[r.module_id] = {
              passed: r.passed,
              best_score: r.best_score,
              attempts: r.attempts,
              passed_at: r.passed_at,
            }
          })
          setProgress(dbProgress)
          localStorage.setItem(
            LOCAL_KEY,
            JSON.stringify(dbProgress)
          )
        }
      } catch {
        // ignore — keep local snapshot
      }
    }
    setLoading(false)
  }

  // WHY: passed is monotonic — once true it stays
  // true even if the user later fails a retake.
  // best_score is the high-water mark; last_score
  // is the most recent attempt. attempts always
  // increments. passed_at is frozen on first pass
  // so the certificate shows the original date.
  const saveProgress = async (moduleId, score, passed, total) => {
    const now = new Date().toISOString()
    const existing = progress[moduleId] || {}

    const updated = {
      attempts: (existing.attempts || 0) + 1,
      best_score: Math.max(existing.best_score || 0, score),
      last_score: score,
      passed: existing.passed || passed,
      passed_at: existing.passed
        ? existing.passed_at
        : passed
        ? now
        : null,
    }

    const newProgress = {
      ...progress,
      [moduleId]: updated,
    }
    setProgress(newProgress)
    localStorage.setItem(LOCAL_KEY, JSON.stringify(newProgress))

    if (user?.id) {
      try {
        await supabase
          .from('user_module_progress')
          .upsert(
            {
              user_id: user.id,
              module_id: moduleId,
              attempts: updated.attempts,
              best_score: updated.best_score,
              last_score: score,
              passed: updated.passed,
              passed_at: updated.passed_at,
              status: updated.passed ? 'passed' : 'failed',
              updated_at: now,
            },
            { onConflict: 'user_id,module_id' }
          )

        // Check if required modules passed
        const allPassed = REQUIRED_MODULES.every(
          (id) => newProgress[id]?.passed
        )

        if (allPassed && !profile?.academy_completed) {
          await supabase
            .from('profiles')
            .update({
              academy_completed: true,
              academy_completed_at: now,
            })
            .eq('id', user.id)
        }
      } catch {
        // local-first: tolerate DB errors silently
      }
    }

    return updated
  }

  const hasScreenerAccess =
    profile?.academy_grandfathered ||
    profile?.academy_completed ||
    REQUIRED_MODULES.every((id) => progress[id]?.passed)

  return {
    modules,
    progress,
    loading,
    saveProgress,
    hasScreenerAccess,
  }
}
