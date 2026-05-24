// useAcademy — central read/write hook for
// academy module progress.
//
// SCREENER UNLOCK MODEL
//   A user unlocks the screener when they have
//   READ all required-module lessons — not when
//   they pass the quiz. The quiz is still graded
//   and saved (drives the certificate + future
//   personalisation) but it's not gating.
//
//   This decision came from feedback that the
//   8-minute Stage Analysis primer adds real
//   value as soon as the user has SEEN it; a
//   wrong quiz answer shouldn't lock them out
//   of data they're already entitled to read.
//
// SCHEMA HINT — run in Supabase before deploy:
//   alter table user_module_progress
//     add column if not exists
//     lessons_completed boolean default false;
//   alter table user_module_progress
//     add column if not exists
//     lessons_completed_at timestamptz;
//
//   Existing rows default to false. Users who
//   only have `passed = true` from earlier
//   builds will need to re-visit the lessons
//   once to unlock — or you can backfill:
//     update user_module_progress
//       set lessons_completed = true,
//           lessons_completed_at = passed_at
//       where passed = true;

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'

const LOCAL_KEY = 'pinex_academy_v2'
// WHY: Module ids must match `academy_modules.id`
// (also the key on `user_module_progress`).
// See scripts/academy/content/*.json for the
// canonical id of each module.
//
// REQUIRED_BY_LEVEL maps each access level to the
// set of modules whose lessons must be read
// before that level unlocks. The lists are
// monotonic by design — every screener module is
// also a swingx module, and every swingx module
// is also an advanced module — so a user can
// graduate from one level to the next by
// completing additional modules in order.
const REQUIRED_BY_LEVEL = {
  screener: ['core_foundation', 'volume_rules'],
  swingx: [
    'core_foundation',
    'volume_rules',
    'stage2_advancing',
    'relative_strength_selection',
  ],
  advanced: [
    'core_foundation',
    'volume_rules',
    'stage1_basing',
    'stage2_advancing',
    'stage3_topping',
    'stage4_declining',
    'relative_strength_selection',
    'shortterm_50day',
  ],
}

// Legacy name — kept for the existing
// `saveProgress` / `saveLessonProgress` flows
// that flip `academy_completed` when the
// screener bar is met. Don't add new callers.
const REQUIRED_MODULES = REQUIRED_BY_LEVEL.screener

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
              // Two new fields — drives the
              // screener-unlock check below.
              lessons_completed: r.lessons_completed,
              lessons_completed_at: r.lessons_completed_at,
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
      ...existing,
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

        // NB: screener unlock no longer keyed off
        // `passed` — see saveLessonProgress below.
        // We still set academy_completed when the
        // quiz is passed for certificate eligibility,
        // but the gate primarily looks at
        // lessons_completed.
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

  // WHY: Called when the user reaches the last
  // lesson of a module (before the quiz). This
  // is what unlocks the screener — completing
  // the quiz is a separate, optional step that
  // earns the certificate.
  const saveLessonProgress = async (moduleId) => {
    const now = new Date().toISOString()
    const existing = progress[moduleId] || {}

    // Idempotent: don't bump timestamps if the
    // module's lessons are already marked done.
    if (existing.lessons_completed) {
      return existing
    }

    const updated = {
      ...existing,
      lessons_completed: true,
      lessons_completed_at: now,
    }

    const newProgress = {
      ...progress,
      [moduleId]: updated,
    }
    setProgress(newProgress)

    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(newProgress))
    } catch {
      // ignore — quota / privacy mode
    }

    if (user?.id) {
      try {
        await supabase
          .from('user_module_progress')
          .upsert(
            {
              user_id: user.id,
              module_id: moduleId,
              lessons_completed: true,
              lessons_completed_at: now,
              status: 'lessons_done',
              updated_at: now,
            },
            { onConflict: 'user_id,module_id' }
          )

        // If every required module has its
        // lessons read → unlock the screener
        // by flipping academy_completed.
        const allLessonsDone = REQUIRED_MODULES.every(
          (id) => newProgress[id]?.lessons_completed
        )

        if (allLessonsDone && !profile?.academy_completed) {
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

  // Helpers for the per-level access checks.
  // Grandfathered + completed unlock every level
  // unconditionally (existing users keep their
  // privileges; new users earn each level by
  // reading the required modules).
  const hasGrandfathered = !!profile?.academy_grandfathered
  const hasCompleted = !!profile?.academy_completed

  const lessonsDoneFor = (ids) =>
    ids.every((id) => progress[id]?.lessons_completed)

  const accessFor = (level) =>
    hasGrandfathered ||
    hasCompleted ||
    lessonsDoneFor(REQUIRED_BY_LEVEL[level] || [])

  // Each level's unlock state. Quiz pass is
  // intentionally NOT a factor — see file
  // header for rationale.
  const hasScreenerAccess = accessFor('screener')
  const hasSwingXAccess = accessFor('swingx')
  const hasAdvancedAccess = accessFor('advanced')

  // Module ids the user still needs to complete
  // for each level. Empty array = level unlocked.
  // Returned so the AcademyRequired bottom sheet
  // can show "X more modules to unlock" if it
  // ever needs to (the static per-level message
  // map handles the basic display today).
  const nextRequiredForScreener = REQUIRED_BY_LEVEL.screener.filter(
    (id) => !progress[id]?.lessons_completed,
  )
  const nextRequiredForSwingX = REQUIRED_BY_LEVEL.swingx.filter(
    (id) => !progress[id]?.lessons_completed,
  )
  const nextRequiredForAdvanced = REQUIRED_BY_LEVEL.advanced.filter(
    (id) => !progress[id]?.lessons_completed,
  )

  return {
    modules,
    progress,
    loading,
    saveProgress,        // quiz scores
    saveLessonProgress,  // lesson completion → unlocks level
    hasScreenerAccess,
    hasSwingXAccess,
    hasAdvancedAccess,
    nextRequiredForScreener,
    nextRequiredForSwingX,
    nextRequiredForAdvanced,
  }
}
