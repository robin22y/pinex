import { Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { LoadingSpinner } from './LoadingSpinner'
import { isAdmin } from '../lib/isAdmin'

export function AdminRoute({ children }) {
  const { loading, user } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  if (!isAdmin(user)) {
    return <Navigate to="/" replace />
  }

  return children
}
