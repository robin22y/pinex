import { supabase } from './supabase'

/**
 * @param {{
 *   action: string,
 *   target_type?: string | null,
 *   target_id?: string | number | null,
 *   old_value?: unknown,
 *   new_value?: unknown,
 *   notes?: string | null,
 * }} opts
 */
export async function logAdminAction({
  action,
  target_type = null,
  target_id = null,
  old_value,
  new_value,
  notes = '',
}) {
  const { data: { user } } = await supabase.auth.getUser()

  await supabase.from('admin_log').insert({
    admin_email: user?.email ?? '',
    action,
    target_type,
    target_id: target_id != null ? String(target_id) : '',
    old_value: String(old_value ?? ''),
    new_value: String(new_value ?? ''),
    notes: notes || '',
  })
}
