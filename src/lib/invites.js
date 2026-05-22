import { supabase } from './supabase'

export async function getMyInviteCode() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('invite_code, invite_credits')
    .eq('id', user.id)
    .single()

  return data
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
