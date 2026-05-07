import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context'
import { LoadingSpinner } from './LoadingSpinner'

export function ProtectedRoute({ children }) {
  const location = useLocation()
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
