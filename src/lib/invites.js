import { supabase } from './supabase'

// 8-char codes from an unambiguous alphabet (no 0/O/1/I/L) so they
// are easy to read aloud, copy-paste, and type into the /invite/:code
// URL. ~50 quadrillion combinations — collisions are negligible.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generateInviteCode() {
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

// WHY: Returns an object the UI can render in every state — never null.
// Previously this returned bare `data` (or null on error), and the
// InviteSection short-circuited to `return null` when null came back,
// making the entire referral card vanish on the smallest DB hiccup
// (RLS lag, missing row, network blip). Now we explicitly surface:
//   { invite_code, invite_credits }              on success
//   { invite_code: null, invite_credits: 0, error }  on failure
// so the card always renders and the user can retry.
//
// ALSO: if the profile exists but has no invite_code yet (older
// accounts created before the invite system shipped), we generate
// one on the fly and persist it. This fixes the "pinex.in/invite/"
// display showing an empty code at the end of the URL.
export async function getMyInviteCode() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { invite_code: null, invite_credits: 0, error: 'not_signed_in' }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('invite_code, invite_credits')
    .eq('id', user.id)
    .single()

  if (error || !data) {
    return {
      invite_code: null,
      invite_credits: 0,
      error: error?.message || 'profile_not_found',
    }
  }

  // Backfill an invite_code if missing. We do up to 3 attempts so a
  // (very rare) collision retries with a fresh code, then gives up
  // and lets the UI show its error state instead of looping forever.
  let code = data.invite_code
  if (!code) {
    for (let attempt = 0; attempt < 3 && !code; attempt++) {
      const candidate = generateInviteCode()
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ invite_code: candidate })
        .eq('id', user.id)
        .is('invite_code', null)  // only set if still null — race-safe
      if (!upErr) {
        // Re-read to confirm what's actually stored (someone else
        // may have raced us). Use this as the source of truth.
        const { data: after } = await supabase
          .from('profiles')
          .select('invite_code')
          .eq('id', user.id)
          .single()
        code = after?.invite_code || null
      }
    }
  }

  return {
    invite_code: code,
    invite_credits: data.invite_credits ?? 0,
    error: code ? null : 'could_not_generate_code',
  }
}

export async function validateInviteCode(code) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, invite_credits, full_name, invite_code')
    .eq('invite_code', code)
    .single()

  if (error || !data) {
    return { valid: false, error: 'Invalid invite link' }
  }

  if (data.invite_credits <= 0) {
    return { valid: false, error: 'This invite link has no credits remaining' }
  }

  return { valid: true, inviter: data }
}

export async function acceptInvite(code, email, name) {
  const { valid, inviter, error } = await validateInviteCode(code)

  if (!valid) return { error }

  await supabase
    .from('invites')
    .insert({
      inviter_id: inviter.id,
      inviter_code: code,
      invitee_email: email,
      invitee_name: name,
      status: 'pending',
    })

  await supabase
    .from('profiles')
    .update({ invite_credits: inviter.invite_credits - 1 })
    .eq('id', inviter.id)

  return { error: null, inviter }
}

export async function getMyInvites() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('invites')
    .select('*')
    .eq('inviter_id', user.id)
    .order('invited_at', { ascending: false })

  return data || []
}
