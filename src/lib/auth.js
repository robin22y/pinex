import { CONFIG } from '../config'
import { supabase } from './supabase'
import { ensureUserPoints, generateReferralCode } from './userBootstrap'

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

  const profileRow = {
    id: user.id,
    email: emailTrimmed,
    full_name: fullName ?? '',
    plan: 'free',
    role,
    // Referral code is generated client-side at signup. Pattern
    // ROBIN2847 — see generateReferralCode for shape. The new user
    // can share pinex.in/join/<code> immediately after signup.
    referral_code: generateReferralCode(emailTrimmed),
  }
  if (tosAccepted) {
    profileRow.tos_accepted = true
    profileRow.tos_accepted_at = new Date().toISOString()
  }

  // Supabase has an auth-trigger that already inserts a profiles row
  // (id, email, full_name) the moment auth.users gets the new user.
  // A plain .insert() here races that trigger and crashes with
  // "duplicate key value violates unique constraint". Upsert with
  // onConflict='id' resolves to ON CONFLICT DO UPDATE so we patch the
  // trigger's row with plan / role / referral_code / tos — the
  // app-specific columns the trigger doesn't fill in. We deliberately
  // DO NOT pass ignoreDuplicates:true, which would map to ON CONFLICT
  // DO NOTHING and silently drop those extra fields.
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(profileRow, { onConflict: 'id' })

  if (profileError) return { data, error: profileError }

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
