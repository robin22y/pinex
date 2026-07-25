import { supabase } from './supabase'

export async function submitWaitlist({ name, email, howHeard }) {
  // Check if email already exists
  const { data: existing } = await supabase
    .from('waitlist')
    .select('id, status')
    .eq('email', email.trim().toLowerCase())
    .single()

  if (existing) {
    if (existing.status === 'approved') {
      return { error: { message: 'already_approved', code: 'already_approved' } }
    }
    if (existing.status === 'pending') {
      return { error: { message: 'already_pending', code: 'already_pending' } }
    }
    if (existing.status === 'rejected') {
      // Allow resubmission if rejected
      const { error } = await supabase
        .from('waitlist')
        .update({
          name: name.trim(),
          how_heard: howHeard,
          requested_at: new Date().toISOString(),
          status: 'pending',
          rejection_reason: null,
        })
        .eq('id', existing.id)
      return { error }
    }
  }

  // New submission
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
  const isDev = import.meta.env.DEV

  // Get waitlist item
  const { data: wData } = await supabase
    .from('waitlist')
    .select('email, name')
    .eq('id', id)
    .single()

  if (!wData?.email) {
    return { error: new Error('Waitlist item not found') }
  }

  if (isDev) {
    // In development — just update the waitlist status without
    // sending actual invite email
    // (Supabase invite requires service key via server function)
    const { error } = await supabase
      .from('waitlist')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: adminEmail,
      })
      .eq('id', id)

    if (!error) {
      alert(
        `DEV MODE: Status updated to approved.\n` +
        `In production, invite email would\n` +
        `be sent to ${wData.email}`
      )
    }

    return { error, email: wData.email }
  }

  // Production — use Netlify function
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.access_token) {
    return { error: new Error('Not authenticated') }
  }

  try {
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
        error: new Error(result.error || 'Invite failed'),
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
