import { useEffect, useState } from 'react'
import Skeleton from '../../components/ui/Skeleton'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'

const BORDER = '#1E293B'
const CARD = '#0f172a'
const MUTED = '#94a3b8'

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: CARD }}>
      <p className="text-xs uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">{value}</p>
    </div>
  )
}

function isOverrideActive(row) {
  if (!row?.stage_override) return false
  const exp = row.stage_override_expires_at
  if (!exp) return true
  const t = new Date(exp).getTime()
  return Number.isFinite(t) && t > Date.now()
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(hasSupabaseEnv)
  const [stats, setStats] = useState(null)
  const [logRows, setLogRows] = useState([])

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setLoading(false)
      return
    }
    let active = true

    ;(async () => {
      setLoading(true)

      const [
        totalCompaniesRes,
        approvedRes,
        profilesCountRes,
        stage2Res,
        stage4Res,
        liteCosRes,
        logsRes,
      ] = await Promise.all([
        supabase.from('companies').select('id', { count: 'exact', head: true }),
        supabase.from('companies').select('id', { count: 'exact', head: true }).eq('description_approved', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('price_data').select('id', { count: 'exact', head: true }).eq('is_latest', true).eq('stage', 'Stage 2'),
        supabase.from('price_data').select('id', { count: 'exact', head: true }).eq('is_latest', true).eq('stage', 'Stage 4'),
        supabase
          .from('companies')
          .select(
            'id, description, description_approved, stage_override, stage_override_expires_at, data_quality_flag',
          )
          .limit(20000),
        supabase.from('admin_log').select('*').order('created_at', { ascending: false }).limit(20),
      ])

      const cos = liteCosRes.data || []
      const pendingDesc = cos.filter(
        (c) =>
          String(c.description || '').trim().length > 0 &&
          c.description_approved !== true,
      ).length
      const overrides = cos.filter(isOverrideActive).length
      const dq = cos.filter((c) => {
        const f = c.data_quality_flag
        return f != null && String(f).trim() !== ''
      }).length

      const logData = logsRes.error ? [] : logsRes.data || []

      if (!active) return
      setStats({
        row1: {
          totalCompanies: totalCompaniesRes.count ?? '—',
          approvedDesc: approvedRes.count ?? '—',
          overrides,
          profilesCt: profilesCountRes.count ?? '—',
        },
        row2: {
          stage2: stage2Res.count ?? '—',
          stage4: stage4Res.count ?? '—',
          dq,
          pendingDesc,
        },
      })
      setLogRows(logData)
      setLoading(false)
    })()

    return () => {
      active = false
    }
  }, [])

  function fmtTime(v) {
    if (!v) return '—'
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
        <p className="text-sm" style={{ color: MUTED }}>
          Overview and recent admin activity
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((k) => (
              <Skeleton key={k} height={88} />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((k) => (
              <Skeleton key={k} height={88} />
            ))}
          </div>
          <Skeleton height={220} />
        </div>
      ) : (
        <>
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>
              KPIs — volume
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total companies tracked" value={stats?.row1.totalCompanies ?? '—'} />
              <StatCard label="Approved descriptions" value={stats?.row1.approvedDesc ?? '—'} />
              <StatCard label="Active stage overrides (sample≤20k rows)" value={stats?.row1.overrides ?? '—'} />
              <StatCard label="Registered users" value={stats?.row1.profilesCt ?? '—'} />
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>
              Market snapshot
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Stage 2 (latest)" value={stats?.row2.stage2 ?? '—'} />
              <StatCard label="Stage 4 (latest)" value={stats?.row2.stage4 ?? '—'} />
              <StatCard label="Data-quality flag set (sample)" value={stats?.row2.dq ?? '—'} />
              <StatCard label="Pending descriptions (sample)" value={stats?.row2.pendingDesc ?? '—'} />
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>
              Recent admin activity
            </p>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: BORDER, background: CARD }}>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase" style={{ borderColor: BORDER, color: MUTED }}>
                    <th className="p-3">Time</th>
                    <th className="p-3">Admin</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Target</th>
                    <th className="p-3">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {logRows.length ? (
                    logRows.map((r, idx) => (
                      <tr key={r.id || idx} className="border-b text-slate-200" style={{ borderColor: BORDER }}>
                        <td className="p-3 text-xs whitespace-nowrap">{fmtTime(r.created_at ?? r.createdAt)}</td>
                        <td className="p-3">{r.admin_email ?? r.adminEmail ?? '—'}</td>
                        <td className="p-3">{r.action ?? '—'}</td>
                        <td className="p-3 text-xs">
                          {[r.target_type, r.target_id].filter(Boolean).join(': ') || '—'}
                        </td>
                        <td className="p-3 max-w-xs text-xs truncate" title={`${r.old_value || ''} → ${r.new_value || ''}`}>
                          {(r.old_value || '∅')} → {(r.new_value || '∅')}
                          {r.notes ? ` — ${r.notes}` : ''}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="p-4" colSpan={5} style={{ color: MUTED }}>
                        No admin log entries yet (or admin_log table / created_at column missing).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
