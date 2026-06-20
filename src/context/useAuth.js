import { useContext } from 'react'
import { AuthContext } from './auth-context'

const IS_DEV = import.meta.env.DEV

const DEV_ADMIN_USER = {
  id: 'dev-admin-local',
  email: 'robin22y@gmail.com',
  user_metadata: { full_name: 'Dev Admin' },
}

const DEV_ADMIN_PROFILE = {
  id: 'dev-admin-local',
  email: 'robin22y@gmail.com',
  full_name: 'Dev Admin',
  role: 'admin',
  is_active: true,
  tos_accepted: true,
  plan: 'pro',
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  // localStorage-based dev bypass — localhost only, never active in production
  const devBypass = IS_DEV && localStorage.getItem('dev_bypass') === 'true'
  if (devBypass) {
    return {
      user: DEV_ADMIN_USER,
      profile: DEV_ADMIN_PROFILE,
      loading: false,
      refreshProfile: async () => DEV_ADMIN_PROFILE,
      isPaid: true,
      isAdmin: true,
      isSuperAdmin: false,
    }
  }

  return {
    ...ctx,
    isPaid: ctx.profile?.plan === 'paid',
    isAdmin: ['admin', 'superadmin'].includes(ctx.profile?.role),
    isSuperAdmin: ctx.profile?.role === 'superadmin',
  }
}
