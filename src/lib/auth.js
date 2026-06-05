import { CONFIG } from '../config'
import { supabase } from './supabase'

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/dashboard` },
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
      emailRedirectTo: `${window.location.origin}/dashboard`,
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
  }
  if (tosAccepted) {
    profileRow.tos_accepted = true
    profileRow.tos_accepted_at = new Date().toISOString()
  }

  const { error: profileError } = await supabase.from('profiles').insert(profileRow)

  if (profileError) return { data, error: profileError }
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
