import { Link } from 'react-router-dom'

const MUTED = '#94a3b8'

export default function AdminCorporateActions() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold text-slate-100">Corporate actions</h1>
      <p className="text-sm" style={{ color: MUTED }}>
        Global corporate-actions CRUD will live here. For now record and review actions per stock on the{' '}
        <Link to="/admin/stocks" style={{ color: '#38bdf8' }}>
          stock edit page
        </Link>
        .
      </p>
    </div>
  )
}
