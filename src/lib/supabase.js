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
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'pinex-auth',
    },
  },
)

// On load: if the stored session is expired, sign out cleanly.
if (hasSupabaseEnv) {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session && session.expires_at && session.expires_at * 1000 < Date.now()) {
      supabase.auth.signOut()
    }
  })
}

// Refresh session when user returns to the tab after being away.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasSupabaseEnv) {
      supabase.auth.getSession()
    }
  })
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) return null
  return user ?? null
}
