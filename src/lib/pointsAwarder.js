// ── Points awarder — single entrypoint for all client-side awards ────────
// Every JS surface that grants points should call this helper instead of
// hardcoding values. The helper:
//
//   1. Looks up the base value from points_config (action_type → integer).
//      Falls back to options.fallbackPoints if the action_type isn't in
//      the catalogue, so legacy callers keep working until they're
//      migrated.
//
//   2. Checks points_offers for any active multipliers / bonuses that
//      apply to this action_type (or to all actions when offer.action_type
//      IS NULL). Picks the best multiplier and adds the best flat bonus —
//      they're treated independently so an admin can stack a 2× general
//      offer with a +10 streak-specific offer if they're both active.
//
//   3. Inserts a points_transactions row + bumps user_points
//      (total_points + lifetime_points). Read-then-write — fine for
//      single-user awards; if we ever surface a batch path, move it to
//      a SECURITY DEFINER RPC.
//
// IMPORTANT: this helper is for the AUTHENTICATED-CALLER awarding
// pattern. The admin-bonus modal in AdminPoints.jsx and the retroactive
// migration script in scripts/award_retroactive_points.py both bypass
// this helper because their semantics are different (admin types the
// value; retroactive picks fixed historical amounts).
//
// Returns { points, error }:
//   - points: the amount ACTUALLY awarded (after multiplier + bonus)
//   - error:  null on success, otherwise the Supabase / unexpected error

import { supabase } from './supabase'

const MIN_POINTS = 0
const MAX_POINTS = 100000   // sanity cap so a misconfigured offer can't grant insane amounts
const BONUS_RPC_ACTIONS = new Set([
  'welcome_bonus',
  'academy_module_1',
  'academy_module_2',
  'academy_module_3',
  'academy_module_4',
  'academy_module_5',
  'academy_module_6',
  'academy_module_7',
  'academy_module_8',
  'academy_final_exam',
  'streak_7_day_bonus',
  'streak_14_day_bonus',
  'streak_30_day_bonus',
  'streak_100_day_bonus',
])

export async function awardPoints(userId, actionType, options = {}) {
  if (!userId) {
    return { points: 0, error: new Error('userId is required') }
  }

  const {
    notes = null,
    fallbackPoints = 0,
    referenceId = null,
  } = options

  // ── 1. Base value from points_config ─────────────────────────────────
  let basePoints = Math.max(MIN_POINTS, Number(fallbackPoints) || 0)
  if (actionType) {
    try {
      const { data: cfg } = await supabase
        .from('points_config')
        .select('points_value,is_active')
        .eq('action_type', actionType)
        .limit(1)
        .maybeSingle()
      if (cfg?.is_active && Number.isFinite(cfg.points_value) && cfg.points_value >= 0) {
        basePoints = cfg.points_value
      }
    } catch {
      // Network / RLS error — fall through to fallback. We never throw
      // here because the caller may still want the legacy hardcoded
      // amount to land.
    }
  }

  // ── 2. Apply offers ──────────────────────────────────────────────────
  let finalPoints = basePoints
  try {
    const nowIso = new Date().toISOString()
    const { data: offers } = await supabase
      .from('points_offers')
      .select('multiplier,bonus_points,action_type')
      .eq('is_active', true)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)

    if (Array.isArray(offers) && offers.length > 0) {
      let bestMult = 1
      let bestBonus = 0
      for (const o of offers) {
        // null action_type on the offer = applies to every action
        if (o.action_type && o.action_type !== actionType) continue
        const m = Number(o.multiplier) || 1
        const b = Number(o.bonus_points) || 0
        if (m > bestMult) bestMult = m
        if (b > bestBonus) bestBonus = b
      }
      finalPoints = Math.round(basePoints * bestMult + bestBonus)
    }
  } catch {
    // Falling through with un-multiplied base is acceptable — the user
    // still gets their points, just without the seasonal bonus.
  }

  // Sanity cap — defensive only. If we ever see this trip we want it in
  // the error log, not silently capped.
  if (!Number.isFinite(finalPoints) || finalPoints < MIN_POINTS) finalPoints = MIN_POINTS
  if (finalPoints > MAX_POINTS) finalPoints = MAX_POINTS

  // Bonus-style actions intentionally bypass the browser INSERT policy
  // and land through the SECURITY DEFINER RPC instead.
  if (BONUS_RPC_ACTIONS.has(actionType)) {
    try {
      const { data: newTotal, error: rpcErr } = await supabase.rpc('award_user_bonus', {
        p_action_type: actionType,
        p_fallback_points: finalPoints,
        p_notes: notes,
      })
      if (rpcErr) throw rpcErr

      try {
        await supabase
          .from('profiles')
          .update({ points_balance: Number(newTotal) || finalPoints })
          .eq('id', userId)
      } catch {
        // Non-fatal shadow write. Rewards spends now key off user_points.
      }

      if (typeof window !== 'undefined' && finalPoints > 0) {
        try {
          window.dispatchEvent(
            new CustomEvent('pinex:points-awarded', {
              detail: {
                points:     finalPoints,
                actionType: actionType || null,
                notes:      notes || null,
              },
            })
          )
        } catch { /* no-op */ }
      }

      return { points: finalPoints, error: null }
    } catch (error) {
      return { points: 0, error }
    }
  }

  // ── 3. Write transaction + bump totals ───────────────────────────────
  try {
    const { error: txErr } = await supabase
      .from('points_transactions')
      .insert({
        user_id: userId,
        points: finalPoints,
        action_type: actionType,
        notes,
        reference_id: referenceId,
      })
    if (txErr) throw txErr

    const { data: cur } = await supabase
      .from('user_points')
      .select('total_points,lifetime_points')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()

    const { error: upErr } = await supabase
      .from('user_points')
      .update({
        total_points:    (Number(cur?.total_points)    || 0) + finalPoints,
        lifetime_points: (Number(cur?.lifetime_points) || 0) + finalPoints,
        updated_at:      new Date().toISOString(),
      })
      .eq('user_id', userId)
    if (upErr) throw upErr

    const newTotal = (Number(cur?.total_points) || 0) + finalPoints
    try {
      await supabase
        .from('profiles')
        .update({ points_balance: newTotal })
        .eq('id', userId)
    } catch {
      // Non-fatal shadow write. user_points stays canonical.
    }

    // Fire a window event so the global PointsToast listener can
    // surface a "+N pts" card. Guarded against SSR, gated on
    // finalPoints > 0 so silent zero-point updates don't toast.
    // Wrapped in try/catch because a dispatch failure must never
    // break the awarding contract — the points already landed.
    if (typeof window !== 'undefined' && finalPoints > 0) {
      try {
        window.dispatchEvent(
          new CustomEvent('pinex:points-awarded', {
            detail: {
              points:     finalPoints,
              actionType: actionType || null,
              notes:      notes || null,
            },
          })
        )
      } catch { /* no-op */ }
    }

    return { points: finalPoints, error: null }
  } catch (error) {
    return { points: 0, error }
  }
}
