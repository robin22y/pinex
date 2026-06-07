// ── User bootstrap helpers ─────────────────────────────────────────────────
// Shared by both signup paths (email/password via lib/auth.js and OAuth via
// AuthContext.insertProfile). Keeping the referral-code and points-row
// logic in one place stops them drifting out of sync the next time one
// surface gets refactored.
//
// Why a separate module: auth.js cannot import from AuthContext.jsx
// (AuthContext imports from auth.js for sign-in helpers — circular) and
// AuthContext shouldn't reach into auth.js for non-auth concerns.
// userBootstrap.js sits below both.

import { supabase } from './supabase'


// ── Referral code generation ──────────────────────────────────────────────
// Pattern: first 5 alphanumeric chars of the email local part (uppercased)
// followed by 4 random digits. Matches the existing population of codes in
// production (ROBIN3955, SINUB4080, FAYAZ5134, ABDUL2847, AKASH8989, …).
//
// If the local part has fewer than 5 alphanumeric chars we pad with 'X' so
// the prefix is always exactly 5 long — keeps the output a uniform 9-char
// string regardless of email shape.
//
// Collisions: ~1 in 10,000 per prefix. The caller can rely on the unique
// constraint on profiles.referral_code to surface a duplicate at insert
// time; if that becomes a real problem at scale we'd switch to a SECURITY
// DEFINER RPC that retries server-side. Not worth the complexity until we
// see actual 23505s in the wild.
//
// Example: "robin@pinex.in" → "ROBIN" + "2847" → "ROBIN2847"
export function generateReferralCode(email) {
  const local = String(email || '').split('@')[0] || ''
  const cleaned = local.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const prefix = (cleaned + 'XXXXX').slice(0, 5)
  const suffix = Math.floor(1000 + Math.random() * 9000) // 1000-9999 inclusive
  return `${prefix}${suffix}`
}


// ── Points row bootstrap ──────────────────────────────────────────────────
// Idempotent. Inserts a user_points row keyed on user_id; the unique
// constraint on user_points.user_id turns a second call into a no-op
// (ON CONFLICT DO NOTHING via ignoreDuplicates).
//
// All other columns (total_points, lifetime_points, streaks, etc.) get
// their DB-side defaults — we don't override them client-side so the
// points schema stays the single source of truth.
//
// Failure is logged but NEVER raised: a missing points row should not
// break signup. The points cron job (or the next user action that
// upserts) will heal the gap.
export async function ensureUserPoints(userId) {
  if (!userId) return
  try {
    const { error } = await supabase
      .from('user_points')
      .upsert(
        { user_id: userId },
        { onConflict: 'user_id', ignoreDuplicates: true },
      )
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[userBootstrap] ensureUserPoints failed:', error.message)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[userBootstrap] ensureUserPoints exception:', e)
  }
}


// ── Referral capture (localStorage) ───────────────────────────────────────
// Used by both the /join/:code on-ramp (Join.jsx) and any downstream
// surface that wants to consume / clear the captured referral. Centralised
// so the storage key isn't string-duplicated across files.
export const REFERRAL_LS_KEY = 'pinex_referral_code'

export function stashReferralCode(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return
  // Defensive cap at 16 chars in case someone pastes a malformed URL
  // with trailing garbage. Uppercase to match the canonical storage
  // shape of profiles.referral_code.
  const cleaned = rawCode.trim().toUpperCase().slice(0, 16)
  if (!cleaned) return
  try {
    localStorage.setItem(REFERRAL_LS_KEY, cleaned)
  } catch {
    // Privacy mode / quota exceeded — ignore. Signup still works,
    // the referrer just won't get credit for this conversion.
  }
}

export function readReferralCode() {
  try {
    return localStorage.getItem(REFERRAL_LS_KEY) || null
  } catch {
    return null
  }
}

export function clearReferralCode() {
  try {
    localStorage.removeItem(REFERRAL_LS_KEY)
  } catch {
    // ignore
  }
}
