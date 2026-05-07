import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { useAuth } from '../../context'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

const SUPERADMIN_EMAIL = 'robin22y@gmail.com'

function fmtDate(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString()
}

export default function AdminUsers() {
  const { user: currentUser, isSuperAdmin } = useAuth()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [activityFilter, setActivityFilter] = useState('all')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [activityUserId, setActivityUserId] = useState(null)
  const [activityRows, setActivityRows] = useState([])
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!isSuperAdmin || !hasSupabaseEnv) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const [profilesRes, usageRes] = await Promise.all([
          supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(10000),
          supabase.from('usage_events').select('*').order('created_at', { ascending: false }).limit(10000),
        ])
        if (!active) return
        const profiles = profilesRes.data || []
        const events = usageRes.data || []
        const latestByUser = {}
        for (const e of events) {
          const userId = e.user_id || e.metadata?.user_id
          if (!userId || latestByUser[userId]) continue
          latestByUser[userId] = e.created_at
        }
        setRows(
          profiles.map((p) => ({
            ...p,
            last_active: p.last_active_at || latestByUser[p.id] || null,
            activity_score: latestByUser[p.id] ? 1 : 0,
          })),
        )
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [isSuperAdmin, reloadTick])

  async function logAdminAction(action, target, beforeValue, afterValue) {
    const payload = {
      admin_id: currentUser?.id || null,
      target_user_id: target.id,
      action,
      before_value: beforeValue ?? null,
      after_value: afterValue ?? null,
      note: `${action} for ${target.email || target.id}`,
      created_at: new Date().toISOString(),
    }
    await supabase.from('admin_notes').insert(payload)
  }

  async function applyAction(row, action) {
    if (!isSuperAdmin) return
    const isTargetSuperadmin = String(row.email || '').toLowerCase() === SUPERADMIN_EMAIL
    const isSelf = row.id === currentUser?.id

    if (isTargetSuperadmin && action === 'deactivate') {
      setMessage('Cannot deactivate superadmin account.')
      return
    }
    if (isSelf && (action === 'promote_admin' || action === 'remove_admin')) {
      setMessage('Cannot modify your own superadmin role.')
      return
    }

    setBusyId(row.id)
    setMessage('')
    try {
      let updatePayload = {}
      let beforeValue = null
      let afterValue = null

      if (action === 'upgrade_paid') {
        beforeValue = row.plan
        afterValue = 'paid'
        updatePayload = { plan: 'paid' }
      } else if (action === 'downgrade_free') {
        beforeValue = row.plan
        afterValue = 'free'
        updatePayload = { plan: 'free' }
      } else if (action === 'promote_admin') {
        beforeValue = row.role
        afterValue = 'admin'
        updatePayload = { role: 'admin' }
      } else if (action === 'remove_admin') {
        beforeValue = row.role
        afterValue = 'user'
        updatePayload = { role: 'user' }
      } else if (action === 'deactivate') {
        beforeValue = row.deactivated_at || null
        afterValue = new Date().toISOString()
        updatePayload = { deactivated_at: afterValue }
      }

      updatePayload.updated_at = new Date().toISOString()
      const { error } = await supabase.from('profiles').update(updatePayload).eq('id', row.id)
      if (error) {
        setMessage(`Action failed for ${row.email || row.id}.`)
        setBusyId(null)
        return
      }

      try {
        await logAdminAction(action, row, beforeValue, afterValue)
      } catch {
        setMessage('User updated, but failed to write admin_notes log.')
      }
      setMessage(`Action "${action}" completed for ${row.email || row.id}.`)
      setReloadTick((x) => x + 1)
    } finally {
      setBusyId(null)
    }
  }

  async function viewActivityLog(row) {
    setActivityUserId(row.id)
    const { data } = await supabase
      .from('usage_events')
      .select('*')
      .or(`user_id.eq.${row.id},metadata->>user_id.eq.${row.id}`)
      .order('created_at', { ascending: false })
      .limit(50)
    setActivityRows(data || [])
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.email || ''} ${r.full_name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (planFilter !== 'all' && String(r.plan || '') !== planFilter) return false
      if (roleFilter !== 'all' && String(r.role || '') !== roleFilter) return false
      if (activityFilter === 'active' && !r.last_active) return false
      if (activityFilter === 'inactive' && r.last_active) return false
      return true
    })
  }, [rows, search, planFilter, roleFilter, activityFilter])

  if (!isSuperAdmin) return <Navigate to="/" replace />

  return (
    <AdminLayout>
      <div className="space-y-5">
        <h2 className="text-xl font-semibold" style={{ color: C.text }}>User Management</h2>
        <Card>
          <div className="grid gap-2 md:grid-cols-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or name"
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: C.border, background: C.surface2, color: C.text }}
            />
            <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="all">All plans</option>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="all">All roles</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Superadmin</option>
            </select>
            <select value={activityFilter} onChange={(e) => setActivityFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, background: C.surface2, color: C.text }}>
              <option value="all">All activity</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {message ? <p className="mt-2 text-sm" style={{ color: C.textMuted }}>{message}</p> : null}
        </Card>

        <Card>
          <SectionLabel text="Users" />
          {loading ? (
            <div className="space-y-2">
              <Skeleton height={38} />
              <Skeleton height={38} />
              <Skeleton height={38} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr style={{ color: C.textMuted }}>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Email</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Name</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Plan</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Role</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Joined</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Last active</th>
                    <th className="border-b p-2 text-left" style={{ borderColor: C.border }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const isTargetSuperadmin = String(r.email || '').toLowerCase() === SUPERADMIN_EMAIL
                    const isSelf = r.id === currentUser?.id
                    const disabled = busyId === r.id
                    return (
                      <tr key={r.id} style={{ color: C.text }}>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>{r.email}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>{r.full_name || '-'}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>{r.plan || 'free'}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>{r.role || 'user'}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border, color: C.textMuted }}>{fmtDate(r.created_at)}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border, color: C.textMuted }}>{fmtDate(r.last_active)}</td>
                        <td className="border-b p-2" style={{ borderColor: C.border }}>
                          <div className="flex flex-wrap gap-1">
                            <button disabled={disabled} type="button" onClick={() => applyAction(r, 'upgrade_paid')} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.green }}>Upgrade</button>
                            <button disabled={disabled} type="button" onClick={() => applyAction(r, 'downgrade_free')} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted }}>Downgrade</button>
                            <button disabled={disabled || isSelf} type="button" onClick={() => applyAction(r, 'promote_admin')} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.blue }}>Promote</button>
                            <button disabled={disabled || isSelf} type="button" onClick={() => applyAction(r, 'remove_admin')} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.amber }}>Remove admin</button>
                            <button disabled={disabled || isTargetSuperadmin} type="button" onClick={() => applyAction(r, 'deactivate')} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.red }}>Deactivate</button>
                            <button disabled={disabled} type="button" onClick={() => viewActivityLog(r)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.textMuted }}>Activity log</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {activityUserId ? (
          <Card>
            <SectionLabel text={`Activity Log (${activityRows.length})`} />
            <div className="space-y-1 text-sm" style={{ color: C.textMuted }}>
              {activityRows.length ? activityRows.map((e, idx) => (
                <p key={`${e.id || idx}`}>
                  {fmtDate(e.created_at)} • {String(e.event_type || e.type || '-')}
                </p>
              )) : <p>No activity events found.</p>}
            </div>
          </Card>
        ) : null}
      </div>
    </AdminLayout>
  )
}
