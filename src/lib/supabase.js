import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabaseEnv = Boolean(url && anonKey)

const fallbackUrl = 'https://placeholder.supabase.co'
const fallbackAnon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder'

if (!hasSupabaseEnv) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. App will run with limited auth/data features.',
  )
}

export const supabase = createClient(
  hasSupabaseEnv ? url : fallbackUrl,
  hasSupabaseEnv ? anonKey : fallbackAnon,
)

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) return null
  return user ?? null
}
