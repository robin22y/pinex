import { CONFIG } from '../config'
import { supabase } from './supabase'
import { ensureUserPoints } from './userBootstrap'

export function signInWithGoogle() {
  // Redirect lands on /auth/callback, NOT a feature page. The callback
  // page waits for getSession() and then forwards to /home (success) or
  // /login (failure). Supabase Dashboard's Redirect URLs allowlist
  // must include https://pinex.in/auth/callback for prod; without that
  // entry Google login lands on a Supabase error page.
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
}

export function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signUpWithEmail(email, password, fullName, opts = {}) {
  // opts.tosAccepted — required to be `true` by the Register form's
  // checkbox gate. We persist tos_accepted + tos_accepted_at on the
  // initial profile insert so TosGate (in App.jsx) doesn't fire the
  // post-signup modal a second time for users who already agreed at
  // the registration step. Google OAuth users still hit TosAcceptance
  // because their profile is created without these columns set.
  const tosAccepted = opts.tosAccepted === true

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Email-confirm link lands on /auth/callback alongside the OAuth
      // flow above. The same callback page resolves either kind of
      // session and forwards to /home.
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) return { data, error }

  const user = data.user
  if (!user) return { data, error: null }

  const emailTrimmed = (email ?? '').trim()
  const superEmail = CONFIG.admin.superAdminEmail
  const role =
    superEmail && emailTrimmed && emailTrimmed === superEmail
      ? 'superadmin'
      : 'user'

  // No upsert here. Supabase's auth-trigger now writes the entire
  // base row (id, email, full_name, plan, role, is_active) on
  // auth.users INSERT. ANY frontend write that also touches those
  // columns re-fires the UNIQUE checks on the row even when values
  // are unchanged — and any orphan row (soft-deleted account, partial
  // prior signup, case-mismatch) with the same email then trips a
  // 23505 on the email constraint. The previous referral_code fix
  // closed one collision surface; this drops the rest by writing
  // ONLY columns the trigger doesn't fill.
  //
  // What the trigger already sets:
  //   id, email, full_name, plan='free', role='user', is_active=true
  // What this function still needs to set:
  //   - tos_accepted + tos_accepted_at (only when the user ticked the
  //     consent checkbox at signup; OAuth users do this later via
  //     TosGate)
  //   - role='superadmin' (only when the email matches CONFIG.admin
  //     allowlist; trigger writes 'user' for everyone)
  //   - referral_code (race-safe backfill — same pattern as before)
  //
  // Each of the three above is a targeted UPDATE WHERE id = X with no
  // overlap on UNIQUE columns the trigger touches. Failure of any one
  // is non-fatal — signup proceeds even if a backfill misses; later
  // visits can patch.

  if (tosAccepted) {
    try {
      await supabase
        .from('profiles')
        .update({
          tos_accepted: true,
          tos_accepted_at: new Date().toISOString(),
        })
        .eq('id', user.id)
    } catch {
      // Non-fatal — TosGate will catch a missing flag next visit.
    }
  }

  if (role === 'superadmin') {
    try {
      await supabase
        .from('profiles')
        .update({ role: 'superadmin' })
        .eq('id', user.id)
        .neq('role', 'superadmin')
    } catch {
      // Non-fatal — admin can be re-stamped manually.
    }
  }

  // referral_code is handled by the database trigger now. Frontend
  // must never send it — every write here was tripping 23505 on the
  // UNIQUE constraint because the trigger had already filled the
  // column with a server-generated value, and our backfill UPDATE
  // raced that with a new client-generated code.

  // Seed the user_points row so the streak/total counter exists from
  // day one. Idempotent; failures are logged but never raised so a
  // missing points row doesn't block signup.
  await ensureUserPoints(user.id)

  return { data, error: null }
}

export async function signOut() {
  await supabase.auth.signOut()
  window.location.assign('/')
}

export function sendPasswordReset(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
}

export function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword })
}
