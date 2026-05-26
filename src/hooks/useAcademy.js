// useAcademy — central read/write hook for
// academy module progress.
//
// PROGRESSIVE UNLOCK MODEL
//   A user unlocks features proportional to
//   their education level. Each tier has its
//   own module-requirement list (ACCESS_REQUIREMENTS).
//   A module counts as "complete" for unlock
//   purposes when either:
//     - lessons_completed is true (the user has
//       READ the lessons), OR
//     - passed is true (the user has passed the
//       module's quiz — kept as an alias so
//       earlier completions still count).
//
//   Strongest SEBI position: each feature
//   requires the user to have actually seen the
//   concepts behind it — they can't, e.g.,
//   touch SwingX without first reading about
//   Relative Strength.
//
//   Grandfathered users (academy_grandfathered
//   = true) and users with academy_completed =
//   true on the profile keep full access to
//   every level regardless of module state.
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
//   builds still unlock everything because the
//   completion check accepts either flag.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'

const LOCAL_KEY = 'pinex_academy_v2'

// WHY: Module ids must match `academy_modules.id`
// (also the key on `user_module_progress`).
// See scripts/academy/content/*.json for the
// canonical id of each module.
//
// ACCESS_REQUIREMENTS maps each access level to
// the set of modules whose lessons must be read
// before that level unlocks. Monotonic by
// design — every screener module is also a
// swingx module, and every swingx module is
// also an advanced module — so users graduate
// from one level to the next in order.
export const ACCESS_REQUIREMENTS = {
  // Search: always open (no requirement)
  search: [],

  // Screener: know stages + volume
  screener: ['core_foundation', 'volume_rules'],

  // SwingX: + RS + sector context
  swingx: [
    'core_foundation',
    'volume_rules',
    'stage2_advancing',
    'relative_strength_selection',
  ],

  // Advanced: all 8 modules read
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

  // ── Access-level computations ───────────────

  // WHY: Grandfathered users get everything
  // regardless of module progress.
  const isGrandfathered = profile?.academy_grandfathered === true

  // WHY: A module counts as "complete" for unlock
  // purposes when EITHER lessons_completed OR
  // passed is true. This means users who passed
  // the old-style quiz before lessons_completed
  // existed still unlock features.
  const isModuleComplete = (id) =>
    !!(progress[id]?.lessons_completed || progress[id]?.passed)

  // Check if all modules in a list are complete.
  // isGrandfathered short-circuits to true.
  // eslint-disable-next-line no-unused-vars
  const hasCompletedModules = (moduleIds) => {
    if (isGrandfathered) return true
    return moduleIds.every(isModuleComplete)
  }

  // ─────────────────────────────────────────────
  // GATING KILL-SWITCH
  //
  // Set to `false` to lock the screener, SwingX,
  // and advanced surfaces behind ACCESS_REQUIREMENTS.
  // While `true`, every user has full access and
  // the AcademyGate / Home click-time gates
  // short-circuit to "unlocked".
  //
  // Module progress is STILL tracked (lessons
  // completed, quiz scores, certificates) — only
  // the gating UX is suppressed. Flip this back
  // to `false` to re-enable.
  // ─────────────────────────────────────────────
  const OPEN_ACCESS = true

  // Each feature's unlock state.
  const hasScreenerAccess =
    OPEN_ACCESS ||
    isGrandfathered ||
    profile?.academy_completed ||
    hasCompletedModules(ACCESS_REQUIREMENTS.screener)

  const hasSwingXAccess =
    OPEN_ACCESS ||
    isGrandfathered ||
    hasCompletedModules(ACCESS_REQUIREMENTS.swingx)

  const hasAdvancedAccess =
    OPEN_ACCESS ||
    isGrandfathered ||
    hasCompletedModules(ACCESS_REQUIREMENTS.advanced)

  // Which module ids the user has finished
  // (lessons read OR quiz passed).
  const completedModuleIds = Object.keys(progress).filter(isModuleComplete)

  // FIRST outstanding module id for each level
  // — undefined when the level is already met.
  const nextRequiredForScreener = ACCESS_REQUIREMENTS.screener.find(
    (id) => !isModuleComplete(id),
  )
  const nextRequiredForSwingX = ACCESS_REQUIREMENTS.swingx.find(
    (id) => !isModuleComplete(id),
  )

  // ── Writers ─────────────────────────────────

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

        // Mirror the lesson-progress path: flip
        // academy_completed when the screener
        // requirement is satisfied — using EITHER
        // passed or lessons_completed.
        const screenerUnlocked = ACCESS_REQUIREMENTS.screener.every(
          (id) =>
            newProgress[id]?.lessons_completed ||
            newProgress[id]?.passed,
        )

        if (screenerUnlocked && !profile?.academy_completed) {
          // Compute the final academy_score using the same formula
          // Certificate.jsx uses — sum of best_score across all
          // modules divided by sum of total_questions, x 100. We
          // persist this so the admin Academy Graduates list can
          // surface it without re-running the client computation
          // for every row.
          const academyScore = (() => {
            const totalBest = (modules || []).reduce(
              (sum, m) => sum + (newProgress[m.id]?.best_score || 0),
              0,
            )
            const maxPossible = (modules || []).reduce(
              (sum, m) => sum + (m.total_questions || 0),
              0,
            )
            return maxPossible > 0
              ? Math.round((totalBest / maxPossible) * 100)
              : 0
          })()

          await supabase
            .from('profiles')
            .update({
              academy_completed: true,
              academy_completed_at: now,
              academy_score: academyScore,
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

        // Per spec: compute all three unlock
        // levels off the freshly-merged state.
        // Only the screener level mutates
        // `academy_completed` (kept as the
        // "you finished the academy" boolean
        // for downstream UI). SwingX / advanced
        // unlocks are derived in-hook from the
        // module progress directly.
        const screenerUnlocked = ACCESS_REQUIREMENTS.screener.every(
          (id) =>
            newProgress[id]?.lessons_completed ||
            newProgress[id]?.passed,
        )

        const updates = {}
        if (screenerUnlocked && !profile?.academy_completed) {
          updates.academy_completed = true
          updates.academy_completed_at = now
          // Same academy_score calc as the saveProgress path.
          // Lessons-only completers will typically have score = 0
          // (no quiz best_scores). Users who DID quiz alongside
          // marking lessons get their real percentage here.
          const totalBest = (modules || []).reduce(
            (sum, m) => sum + (newProgress[m.id]?.best_score || 0),
            0,
          )
          const maxPossible = (modules || []).reduce(
            (sum, m) => sum + (m.total_questions || 0),
            0,
          )
          updates.academy_score = maxPossible > 0
            ? Math.round((totalBest / maxPossible) * 100)
            : 0
        }
        if (Object.keys(updates).length) {
          await supabase
            .from('profiles')
            .update(updates)
            .eq('id', user.id)
        }
      } catch {
        // local-first: tolerate DB errors silently
      }
    }

    return updated
  }

  return {
    modules,
    progress,
    loading,
    saveProgress,
    saveLessonProgress,
    hasScreenerAccess,
    hasSwingXAccess,
    hasAdvancedAccess,
    isGrandfathered,
    completedModuleIds,
    nextRequiredForScreener,
    nextRequiredForSwingX,
    ACCESS_REQUIREMENTS,
  }
}
