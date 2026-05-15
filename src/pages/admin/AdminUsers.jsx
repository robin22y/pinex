import { useEffect, useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { useAuth } from '../../context'
import { ADMIN_EMAIL } from '../../lib/isAdmin'
import { logAdminAction } from '../../lib/adminLog'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'

const BORDER = '#334155'
const MUTED = '#94a3b8'

function startOfUtcDay() {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState([])
  const [usageToday, setUsageToday] = useState({})
  const [lastSeenMap, setLastSeenMap] = useState({})
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState('newest')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [activityFor, setActivityFor] = useState(null)
  const [activityRows, setActivityRows] = useState([])

  async function load() {
    if (!hasSupabaseEnv) {
      setLoading(false)
      return
    }
    setLoading(true)
    setMessage('')
    try {
      // Fetch all auth users (via service-key function) + usage events in parallel
      const fnRoot = (import.meta.env.VITE_NETLIFY_FUNCTIONS_URL || '/.netlify/functions').replace(/\/$/, '')
      const [usersRes, { data: evToday }, { data: evRecent }] = await Promise.all([
        fetch(`${fnRoot}/admin-list-users`).then((r) => r.json()).catch(() => ({ ok: false, users: [] })),
        supabase.from('usage_events').select('user_id,metadata').gte('created_at', startOfUtcDay()).limit(25000),
        supabase.from('usage_events').select('user_id,metadata,created_at').order('created_at', { ascending: false }).limit(25000),
      ])

      const vt = {}
      for (const e of evToday || []) {
        const uid = e.user_id || e.metadata?.user_id
        if (!uid) continue
        vt[uid] = (vt[uid] || 0) + 1
      }

      const seen = {}
      for (const e of evRecent || []) {
        const uid = e.user_id || e.metadata?.user_id
        if (!uid || seen[uid]) continue
        seen[uid] = e.created_at
      }

      if (!usersRes.ok) {
        // Fallback to profiles table if function not available
        const { data: prow } = await supabase.from('profiles').select('*').limit(10000)
        setProfiles(prow || [])
        const errDetail = usersRes.error ? ` (${usersRes.error})` : ''
        setMessage(
          `⚠️ admin-list-users function unavailable${errDetail} — showing profiles table only (RLS-limited). ` +
          `To see ALL auth users, add SUPABASE_SERVICE_KEY to Netlify environment variables.`
        )
      } else {
        setProfiles(usersRes.users || [])
        if (usersRes.users?.length === 0) {
          setMessage('Function returned 0 users — check SUPABASE_URL and SUPABASE_SERVICE_KEY in Netlify.')
        }
      }
      setUsageToday(vt)
      setLastSeenMap(seen)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [])

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = (profiles || []).filter((p) => {
      if (!q) return true
      return String(p.email || p.id || '').toLowerCase().includes(q)
    })

    if (sortMode === 'newest') {
      list = [...list].sort((a, b) => {
        const ta = new Date(a.created_at || 0).getTime()
        const tb = new Date(b.created_at || 0).getTime()
        return tb - ta
      })
    } else if (sortMode === 'active') {
      list = [...list].sort((a, b) => {
        const ta = new Date(lastSeenMap[a.id] || 0).getTime()
        const tb = new Date(lastSeenMap[b.id] || 0).getTime()
        return tb - ta
      })
    } else {
      list = [...list].sort((a, b) => String(a.plan || '').localeCompare(String(b.plan || '')))
    }
    return list
  }, [profiles, search, sortMode, lastSeenMap])

  function fmt(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
  }

  async function upgradePro(row) {
    setBusyId(row.id)
    setMessage('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ plan: 'pro', updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) {
        setMessage(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'user_upgrade_pro',
          target_type: 'profile',
          target_id: row.id,
          old_value: row.plan,
          new_value: 'pro',
          notes: row.email,
        })
      } catch {
        /* optional */
      }
      setMessage(`Upgraded ${row.email || row.id} to Pro.`)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function banUser(row) {
    const em = String(row.email || '').toLowerCase()
    if (em === ADMIN_EMAIL) {
      setMessage('Cannot ban primary admin.')
      return
    }
    if (row.id === currentUser?.id) {
      setMessage('Cannot ban yourself.')
      return
    }
    setBusyId(row.id)
    setMessage('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ banned: true, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) {
        setMessage(error.message)
        return
      }
      try {
        await logAdminAction({
          action: 'user_ban',
          target_type: 'profile',
          target_id: row.id,
          old_value: row.banned,
          new_value: true,
          notes: row.email,
        })
      } catch {
        /* optional */
      }
      setMessage(`Banned ${row.email || row.id}.`)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function viewActivity(row) {
    setActivityFor(row.id)
    const { data } = await supabase
      .from('usage_events')
      .select('*')
      .or(`user_id.eq.${row.id},metadata->>user_id.eq.${row.id}`)
      .order('created_at', { ascending: false })
      .limit(40)
    setActivityRows(data || [])
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Users</h1>

      <Card>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email"
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: BORDER, background: '#0f172a', color: '#e2e8f0' }}
          />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: BORDER, background: '#0f172a', color: '#e2e8f0' }}
          >
            <option value="newest">Sort: newest</option>
            <option value="active">Sort: most active</option>
            <option value="plan">Sort: plan</option>
          </select>
        </div>
        {message ? (
          <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: '#92400e', background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
            {message}
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionLabel text="Registered users" />
        {loading ? (
          <div className="space-y-2">
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase" style={{ borderColor: BORDER, color: MUTED }}>
                  <th className="p-2">Email</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Provider</th>
                  <th className="p-2">Plan</th>
                  <th className="p-2">Joined</th>
                  <th className="p-2">Last sign-in</th>
                  <th className="p-2">Views today</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((row) => {
                  const disabled = busyId === row.id
                  return (
                    <tr key={row.id} className="border-b text-slate-200" style={{ borderColor: BORDER }}>
                      <td className="p-2">{row.email || row.id}</td>
                      <td className="p-2 text-xs" style={{ color: MUTED }}>{row.full_name || '—'}</td>
                      <td className="p-2 text-xs" style={{ color: MUTED }}>{row.provider || '—'}</td>
                      <td className="p-2">{row.plan || 'free'}</td>
                      <td className="p-2 text-xs" style={{ color: MUTED }}>
                        {fmt(row.created_at)}
                      </td>
                      <td className="p-2 text-xs" style={{ color: MUTED }}>
                        {fmt(lastSeenMap[row.id] || row.last_sign_in_at || row.last_active_at)}
                      </td>
                      <td className="p-2 font-data tabular-nums">{usageToday[row.id] ?? 0}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={disabled}
                            className="rounded border px-2 py-1 text-xs"
                            style={{ borderColor: BORDER, color: '#6ee7b7' }}
                            onClick={() => void upgradePro(row)}
                          >
                            Upgrade to Pro
                          </button>
                          <button
                            type="button"
                            disabled={disabled}
                            className="rounded border px-2 py-1 text-xs"
                            style={{ borderColor: BORDER, color: '#fca5a5' }}
                            onClick={() => void banUser(row)}
                          >
                            Ban
                          </button>
                          <button
                            type="button"
                            className="rounded border px-2 py-1 text-xs"
                            style={{ borderColor: BORDER, color: MUTED }}
                            onClick={() => void viewActivity(row)}
                          >
                            View activity
                          </button>
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

      {activityFor ? (
        <Card>
          <SectionLabel text="Recent activity" />
          <div className="max-h-64 space-y-1 overflow-auto text-xs" style={{ color: MUTED }}>
            {activityRows.length ? (
              activityRows.map((e, i) => (
                <p key={e.id || i}>
                  {fmt(e.created_at)} · {String(e.event_type || e.type || '—')}
                </p>
              ))
            ) : (
              <p>No events.</p>
            )}
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-sky-400 underline"
            onClick={() => {
              setActivityFor(null)
              setActivityRows([])
            }}
          >
            Close
          </button>
        </Card>
      ) : null}
    </div>
  )
}
