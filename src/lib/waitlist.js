import { supabase } from './supabase'

export async function submitWaitlist({ name, email, howHeard }) {
  const { data, error } = await supabase
    .from('waitlist')
    .insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      how_heard: howHeard,
      requested_at: new Date().toISOString(),
      status: 'pending',
    })
  return { data, error }
}

export async function getWaitlist(status = null) {
  let query = supabase
    .from('waitlist')
    .select('*')
    .order('requested_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  return { data, error }
}

export async function approveWaitlist(id, adminEmail) {
  // Get current user session token
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.access_token) {
    return { error: new Error('Not authenticated') }
  }

  // Get waitlist item email
  const { data: wData } = await supabase
    .from('waitlist')
    .select('email, name')
    .eq('id', id)
    .single()

  if (!wData?.email) {
    return { error: new Error('Waitlist item not found') }
  }

  try {
    // Call Netlify function
    const res = await fetch('/.netlify/functions/invite-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email: wData.email,
        name: wData.name,
        waitlistId: id,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      return {
        error: new Error(result.error || `Invite failed (HTTP ${res.status})`),
        email: wData.email,
      }
    }

    return { error: null, email: wData.email }
  } catch (err) {
    return { error: err }
  }
}

export async function rejectWaitlist(id, reason = '') {
  const { error } = await supabase
    .from('waitlist')
    .update({
      status: 'rejected',
      rejection_reason: reason,
    })
    .eq('id', id)
  return { error }
}
