import { Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { LoadingSpinner } from './LoadingSpinner'

export function AdminRoute({ children }) {
  const { loading, isAdmin } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  return children
}
