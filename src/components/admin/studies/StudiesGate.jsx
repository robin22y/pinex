/**
 * Second gate inside the existing AdminRoute: the Studies admin also needs
 * profiles.role admin/superadmin (useAuth().isAdmin), which is what the
 * database's is_admin() RLS checks — without it every write would fail.
 */
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context'
import './studies-admin.css'

export default function StudiesGate({ children }) {
  const { loading, isAdmin, profile } = useAuth()
  if (loading) return <p className="sa-muted">Checking access…</p>
  if (!isAdmin) {
    return (
      <div className="sa">
        <div className="sa-alert sa-alert-error" role="alert">
          <div>
            <strong>Admin role required.</strong> The Studies editor needs <code>profiles.role</code> = admin or superadmin
            (current: <code>{profile?.role || 'none'}</code>). The database rejects study edits from any other role.{' '}
            <Link to="/admin">Back to admin</Link>
          </div>
        </div>
      </div>
    )
  }
  return <div className="sa">{children}</div>
}
