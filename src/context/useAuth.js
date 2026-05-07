import { useContext } from 'react'
import { AuthContext } from './auth-context'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return {
    ...ctx,
    isPaid: ctx.profile?.plan === 'paid',
    isAdmin: ['admin', 'superadmin'].includes(ctx.profile?.role),
    isSuperAdmin: ctx.profile?.role === 'superadmin',
  }
}
