import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { useAuth } from '../../context'
import { ADMIN_EMAIL } from '../../lib/isAdmin'
import { logAdminAction } from '../../lib/adminLog'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'

const BORDER = 'var(--border-strong)'
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
  // Tab state — 'platform' (existing Supabase auth users) or 'telegram'
  // (telegram_subscribers table). Default to platform so the prior
  // bookmark / link behaviour is unchanged.
  // Tab state synced to ?tab= URL param so the page is deep-linkable.
  //   /admin/users               -> platform (default)
  //   /admin/users?tab=telegram  -> Telegram Users tab
  //   /admin/users?tab=research  -> Research AI Users tab
  // Bookmarkable, shareable, survives reload.
  const [searchParams, setSearchParams] = useSearchParams()
  const VALID_TABS = ['platform', 'telegram', 'research']
  const tabFromUrl = searchParams.get('tab')
  const tab = VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'platform'
  function setTab(next) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      if (next === 'platform') p.delete('tab')
      else p.set('tab', next)
      return p
    }, { replace: true })
  }

  async function load() {
    setLoading(true)
    setMessage('')
    try {
      // Fetch real auth users (with email) + usage data in parallel
      const [usersRes, { data: evToday }, { data: evRecent }] = await Promise.all([
        fetch('/.netlify/functions/admin-list-users').then(r => r.json()).catch(() => ({ ok: false, users: [] })),
        hasSupabaseEnv
          ? supabase.from('usage_events').select('user_id,metadata').gte('created_at', startOfUtcDay()).limit(5000)
          : Promise.resolve({ data: [] }),
        hasSupabaseEnv
          ? supabase.from('usage_events').select('user_id,created_at').order('created_at', { ascending: false }).limit(3000)
          : Promise.resolve({ data: [] }),
      ])

      const vt = {}
      for (const e of evToday || []) {
        const uid = e.user_id || e.metadata?.user_id
        if (!uid) continue
        vt[uid] = (vt[uid] || 0) + 1
      }

      const seen = {}
      for (const e of evRecent || []) {
        const uid = e.user_id
        if (!uid || seen[uid]) continue
        seen[uid] = e.created_at
      }

      if (usersRes.ok && usersRes.users?.length) {
        setProfiles(usersRes.users)
        if (usersRes.warning) setMessage(usersRes.warning)
      } else if (!usersRes.ok) {
        setMessage(`Could not load users: ${usersRes.error || 'admin-list-users failed'}`)
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

      {/* Tab bar — Platform Users (existing) | Telegram Users (new).
          Each tab owns its own data fetch + table render below. */}
      <div className="flex gap-1 border-b" style={{ borderColor: BORDER }}>
        {[
          { key: 'platform', label: 'Platform Users' },
          { key: 'telegram', label: 'Telegram Users' },
          { key: 'research', label: '🔬 Research AI Users' },
        ].map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="px-4 py-2 text-sm"
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid #f59e0b' : '2px solid transparent',
                color: active ? '#f59e0b' : MUTED,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'platform' && (
      <>
      <p className="text-sm" style={{ color: MUTED }}>
        Users via <code className="text-slate-400">admin-list-users</code> (service key). Falls back to profiles if auth API is unavailable.
      </p>

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
          <p className="mt-2 text-sm" style={{ color: MUTED }}>
            {message}
          </p>
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
                  <th className="p-2">Plan</th>
                  <th className="p-2">Joined</th>
                  <th className="p-2">Last seen</th>
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
      </>
      )}

      {tab === 'telegram' && <TelegramUsersTab />}
      {tab === 'research' && <ResearchUsersTab />}
    </div>
  )
}

// ── Research Assistant Users tab ───────────────────────────────────────────
// Shows who has registered (research_key_saved event) and who has actively
// used Research Assistant (research_question_asked event). Exposes errors
// + raw counts inline so we can DIAGNOSE silent-zero failures: if the
// query returns 0 rows it tells us "Supabase returned 0 rows" rather than
// just rendering an empty table. If RLS blocks the read it shows the
// error message so the admin knows it's not "no users" but "access denied".
function ResearchUsersTab() {
  const [keySaves, setKeySaves]       = useState(null)
  const [questions, setQuestions]     = useState(null)
  const [profilesById, setProfilesById] = useState({})
  const [keyError, setKeyError]       = useState('')
  const [qError, setQError]           = useState('')
  const [currentUserRole, setCurrentUserRole] = useState('')
  const [currentUid, setCurrentUid]   = useState('')
  // Test-write probe — when admin clicks the button, we attempt to
  // insert a marker event into usage_events. The result tells us
  // whether the WRITE side of usage_events is broken (RLS-denied) or
  // whether the issue is that logKeySaved / logResearchUsage simply
  // never fired in the first place.
  const [testWriteState, setTestWriteState] = useState('idle') // idle | running | ok | fail
  const [testWriteMsg, setTestWriteMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // ── Self-check: what role does my current session have? ──────────
      try {
        const { data: u } = await supabase.auth.getUser()
        const uid = u?.user?.id
        if (uid) {
          const { data: p } = await supabase
            .from('profiles')
            .select('role, email')
            .eq('id', uid)
            .maybeSingle()
          if (!cancelled) {
            setCurrentUid(uid)
            setCurrentUserRole(`${p?.email || '?'} → role=${p?.role || 'NULL'}`)
          }
        }
      } catch (e) {
        if (!cancelled) setCurrentUserRole(`self-check failed: ${e?.message || e}`)
      }

      // ── Research key-save events ─────────────────────────────────────
      try {
        const { data, error } = await supabase
          .from('usage_events')
          .select('user_id,metadata,created_at')
          .eq('event_type', 'research_key_saved')
          .order('created_at', { ascending: false })
          .limit(5000)
        if (cancelled) return
        if (error) {
          setKeyError(`${error.code || ''} ${error.message || ''} ${error.details || ''}`.trim())
          setKeySaves([])
        } else {
          setKeySaves(data || [])
        }
      } catch (e) {
        if (cancelled) return
        setKeyError(String(e?.message || e))
        setKeySaves([])
      }

      // ── Research question events ─────────────────────────────────────
      try {
        const { data, error } = await supabase
          .from('usage_events')
          .select('user_id,metadata,created_at')
          .eq('event_type', 'research_question_asked')
          .order('created_at', { ascending: false })
          .limit(5000)
        if (cancelled) return
        if (error) {
          setQError(`${error.code || ''} ${error.message || ''} ${error.details || ''}`.trim())
          setQuestions([])
        } else {
          setQuestions(data || [])
        }
      } catch (e) {
        if (cancelled) return
        setQError(String(e?.message || e))
        setQuestions([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Profile join for any user_id we've seen ───────────────────────────
  useEffect(() => {
    if (!keySaves || !questions) return
    let cancelled = false
    ;(async () => {
      const uids = new Set()
      for (const ev of (keySaves || [])) {
        const uid = ev.user_id || (ev.metadata && ev.metadata.user_id)
        if (uid) uids.add(uid)
      }
      for (const ev of (questions || [])) {
        const uid = ev.user_id || (ev.metadata && ev.metadata.user_id)
        if (uid) uids.add(uid)
      }
      if (uids.size === 0) return
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, email, full_name, plan, role')
        .in('id', Array.from(uids))
      if (cancelled) return
      const map = {}
      for (const p of (profs || [])) map[p.id] = p
      setProfilesById(map)
    })()
    return () => { cancelled = true }
  }, [keySaves, questions])

  // Test-write probe — attempts an INSERT into usage_events with a
  // marker event_type. Result tells us:
  //   - 200 + row returned     -> writes work; the real issue is that
  //                               logKeySaved/logResearchUsage was never
  //                               fired (saved key BEFORE the new commit
  //                               that added logKeySaved; never used
  //                               Research Assistant since).
  //   - 42501 permission denied -> RLS is blocking inserts. The SQL
  //                               migration setup_usage_events_rls_and_backfill.sql
  //                               hasn't been applied yet.
  //   - 42P01 relation missing  -> usage_events table doesn't exist.
  //   - 23505 unique violation  -> harmless, our marker conflicted.
  // Either way we read back the just-inserted row to prove SELECT works
  // on the new row too.
  async function runTestWrite() {
    setTestWriteState('running')
    setTestWriteMsg('Inserting marker event…')
    try {
      const { data, error } = await supabase
        .from('usage_events')
        .insert({
          event_type: 'admin_diagnostic_write_test',
          user_id: currentUid || null,
          metadata: {
            user_id: currentUid || null,
            source: 'admin_diagnostic',
            note: 'safe-to-delete marker',
            timestamp: new Date().toISOString(),
          },
        })
        .select()
        .maybeSingle()
      if (error) {
        setTestWriteState('fail')
        setTestWriteMsg(
          `INSERT failed: ${error.code || ''} ${error.message || ''} ${error.details || ''}`.trim()
        )
        return
      }
      setTestWriteState('ok')
      setTestWriteMsg(
        `INSERT succeeded. Row id=${data?.id || '(no id returned)'}. ` +
        `Writes are NOT the problem — the issue is that logKeySaved/logResearchUsage ` +
        `was never called (no one has used Research Assistant since the new ` +
        `telemetry shipped, OR the existing key holders saved their key BEFORE ` +
        `the logKeySaved helper existed).`
      )
    } catch (e) {
      setTestWriteState('fail')
      setTestWriteMsg(`INSERT threw: ${e?.message || e}`)
    }
  }

  if (keySaves === null || questions === null) {
    return (
      <Card>
        <Skeleton height={36} />
        <Skeleton height={36} />
        <Skeleton height={36} />
      </Card>
    )
  }

  // ── Aggregate per user ────────────────────────────────────────────────
  const byUid = {}
  for (const ev of keySaves) {
    const uid = ev.user_id || (ev.metadata && ev.metadata.user_id)
    if (!uid) continue
    if (!byUid[uid]) byUid[uid] = { uid, registered_at: ev.created_at, question_count: 0, last_question: null }
    if (new Date(ev.created_at) < new Date(byUid[uid].registered_at)) {
      byUid[uid].registered_at = ev.created_at
    }
  }
  for (const ev of questions) {
    const uid = ev.user_id || (ev.metadata && ev.metadata.user_id)
    if (!uid) continue
    if (!byUid[uid]) byUid[uid] = { uid, registered_at: null, question_count: 0, last_question: null }
    byUid[uid].question_count += 1
    if (!byUid[uid].last_question || new Date(ev.created_at) > new Date(byUid[uid].last_question)) {
      byUid[uid].last_question = ev.created_at
    }
  }
  const rows = Object.values(byUid).sort((a, b) => {
    if (a.question_count !== b.question_count) return b.question_count - a.question_count
    return new Date(b.registered_at || 0) - new Date(a.registered_at || 0)
  })

  const fmtDate = (iso) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    } catch { return String(iso).slice(0, 10) }
  }

  return (
    <>
      {/* DIAGNOSTIC PANEL — surfaces the raw state so silent-zero failures
          are no longer silent. Read these numbers FIRST before drawing
          conclusions about whether anyone has used Research Assistant. */}
      <Card>
        <SectionLabel text="Diagnostic — raw query state" />
        <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
          <div>Current session: <code style={{ color: '#cbd5e1' }}>{currentUserRole || '(unknown)'}</code></div>
          <div>research_key_saved rows returned: <strong style={{ color: keySaves.length > 0 ? '#34D399' : '#F87171' }}>{keySaves.length}</strong></div>
          <div>research_question_asked rows returned: <strong style={{ color: questions.length > 0 ? '#34D399' : '#F87171' }}>{questions.length}</strong></div>
          {keyError && (
            <div style={{ color: '#F87171', marginTop: 6 }}>
              ❌ Key-saved query error: <code>{keyError}</code>
            </div>
          )}
          {qError && (
            <div style={{ color: '#F87171', marginTop: 6 }}>
              ❌ Question query error: <code>{qError}</code>
            </div>
          )}
          {!keyError && !qError && keySaves.length === 0 && questions.length === 0 && (
            <div style={{ color: '#FBBF24', marginTop: 6, lineHeight: 1.5 }}>
              No errors and no rows. Click <strong>Run Test Write</strong> below
              to find out which of these is true:
              <br />a) Writes are working — no one has actually used Research Assistant yet, OR
              <br />b) RLS is silently blocking writes — run{' '}
              <code>scripts/sql/setup_usage_events_rls_and_backfill.sql</code>
            </div>
          )}

          {/* Test-write probe — single button, plain English result. */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #1f2938' }}>
            <button
              type="button"
              onClick={runTestWrite}
              disabled={testWriteState === 'running'}
              style={{
                padding: '7px 14px',
                background: testWriteState === 'ok' ? '#052818'
                  : testWriteState === 'fail' ? '#1f0a0a'
                  : '#0B0F18',
                color: testWriteState === 'ok' ? '#34D399'
                  : testWriteState === 'fail' ? '#F87171'
                  : '#cbd5e1',
                border: '1px solid ' + (
                  testWriteState === 'ok' ? '#166534'
                  : testWriteState === 'fail' ? '#991B1B'
                  : '#1f2938'
                ),
                borderRadius: 8,
                fontSize: 12, fontWeight: 700,
                cursor: testWriteState === 'running' ? 'wait' : 'pointer',
              }}
            >
              {testWriteState === 'running' ? 'Testing…'
                : testWriteState === 'ok'  ? '✅ Test Write succeeded — click to retry'
                : testWriteState === 'fail' ? '❌ Test Write failed — click to retry'
                : '🔬 Run Test Write'}
            </button>
            {testWriteMsg && (
              <div style={{
                marginTop: 10,
                padding: '10px 12px',
                background: testWriteState === 'ok' ? '#052818' : '#1f0a0a',
                border: '1px solid ' + (testWriteState === 'ok' ? '#166534' : '#991B1B'),
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
                color: testWriteState === 'ok' ? '#34D399' : '#F87171',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {testWriteMsg}
              </div>
            )}
          </div>
          {!keyError && !qError && keySaves.length === 0 && questions.length > 0 && (
            <div style={{ color: '#FBBF24', marginTop: 6, lineHeight: 1.5 }}>
              Found question events but NO key-saved events — the backfill SQL hasn&apos;t been run.
              Run <code>scripts/sql/setup_usage_events_rls_and_backfill.sql</code> in Supabase SQL editor.
            </div>
          )}
        </div>
      </Card>

      {/* Stats */}
      <Card>
        <SectionLabel text="Research Assistant adoption" />
        <div className="grid gap-3 md:grid-cols-4 text-sm" style={{ color: MUTED }}>
          <div>
            <p className="text-xs uppercase tracking-wider">Keys registered</p>
            <p className="text-xl font-bold text-amber-400 tabular-nums">
              {rows.filter(r => r.registered_at).length}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider">Actually using it</p>
            <p className="text-xl font-bold text-emerald-400 tabular-nums">
              {rows.filter(r => r.question_count > 0).length}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider">Total questions</p>
            <p className="text-xl font-bold text-slate-100 tabular-nums">
              {rows.reduce((s, r) => s + r.question_count, 0)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider">Idle (key but no use)</p>
            <p className="text-xl font-bold text-amber-400 tabular-nums">
              {rows.filter(r => r.registered_at && r.question_count === 0).length}
            </p>
          </div>
        </div>
      </Card>

      {/* User table */}
      <Card>
        <SectionLabel text="All Research Assistant users" />
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>
            Nothing to show yet. See the diagnostic panel above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase" style={{ borderColor: BORDER, color: MUTED }}>
                  <th className="p-2">Name</th>
                  <th className="p-2">Email</th>
                  <th className="p-2">Plan</th>
                  <th className="p-2">Registered</th>
                  <th className="p-2">Questions</th>
                  <th className="p-2">Last Question</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = profilesById[r.uid] || {}
                  const idle = r.registered_at && r.question_count === 0
                  return (
                    <tr key={r.uid} className="border-b text-slate-200"
                      style={{
                        borderColor: BORDER,
                        background: idle ? 'rgba(245,159,11,0.04)' : 'transparent',
                      }}>
                      <td className="p-2">
                        {p.full_name || (p.email || '').split('@')[0] || '—'}
                        {idle && (
                          <span style={{
                            marginLeft: 6, fontSize: 9, fontWeight: 700,
                            color: '#F59E0B', background: '#1f1500',
                            border: '1px solid #92400e',
                            padding: '1px 5px', borderRadius: 4,
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                          }}>Idle</span>
                        )}
                      </td>
                      <td className="p-2" style={{ color: MUTED, fontSize: 11 }}>{p.email || '—'}</td>
                      <td className="p-2">
                        <span style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          padding: '2px 6px', borderRadius: 99,
                          color: p.plan === 'paid' ? '#F59E0B' : MUTED,
                          background: p.plan === 'paid' ? 'rgba(245,159,11,0.15)' : 'rgba(148,158,171,0.10)',
                        }}>
                          {p.plan || 'free'}
                        </span>
                      </td>
                      <td className="p-2" style={{ color: r.registered_at ? '#34D399' : MUTED }}>
                        {fmtDate(r.registered_at)}
                      </td>
                      <td className="p-2 tabular-nums" style={{ color: '#FBBF24', fontWeight: 700 }}>
                        {r.question_count.toLocaleString('en-IN')}
                      </td>
                      <td className="p-2" style={{ color: MUTED }}>{fmtDate(r.last_question)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}


// ── Telegram Users tab ─────────────────────────────────────────────────────
// Reads telegram_subscribers (chat_id, username, first_name, user_id,
// created_at), joins to profiles for the linked-account email if user_id
// is set, and renders a read-only table with three summary stats above
// it. No actions — that's a future commit.
function TelegramUsersTab() {
  const [rows, setRows]           = useState(null)
  const [emailByUserId, setEmail] = useState({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: subs } = await supabase
          .from('telegram_subscribers')
          .select('chat_id, username, first_name, user_id, created_at')
          .order('created_at', { ascending: false })
          .limit(1000)
        if (cancelled) return
        setRows(subs || [])

        // Hydrate emails for linked accounts in one bulk lookup.
        const linkedIds = (subs || [])
          .map(s => s.user_id)
          .filter(Boolean)
        if (linkedIds.length) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, email')
            .in('id', linkedIds)
          if (cancelled) return
          const map = {}
          for (const p of profs || []) {
            if (p?.id) map[p.id] = p.email || null
          }
          setEmail(map)
        }
      } catch {
        if (!cancelled) setRows([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (rows === null) {
    return (
      <Card>
        <Skeleton height={36} />
        <Skeleton height={36} />
        <Skeleton height={36} />
      </Card>
    )
  }

  const total    = rows.length
  const linked   = rows.filter(r => r.user_id).length
  const unlinked = total - linked

  // Mask the chat_id for privacy — last 6 digits only. Telegram chat
  // IDs can be 9-12 digits long; the truncation isn't a security
  // measure (admins have full access via the DB) but it avoids long
  // numbers stretching the column.
  function maskChatId(v) {
    const s = String(v ?? '')
    if (s.length <= 6) return s
    return '...' + s.slice(-6)
  }

  function fmtDate(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    } catch { return String(iso).slice(0, 10) }
  }

  return (
    <>
      <Card>
        <SectionLabel text="Telegram subscribers" />
        <div className="grid gap-3 md:grid-cols-3 text-sm" style={{ color: MUTED }}>
          <div>
            <p className="text-xs uppercase tracking-wider">Total subscribers</p>
            <p className="text-xl font-bold text-slate-100 tabular-nums">{total}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider">Linked to PineX account</p>
            <p className="text-xl font-bold text-emerald-400 tabular-nums">{linked}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider">Unlinked</p>
            <p className="text-xl font-bold text-slate-400 tabular-nums">{unlinked}</p>
          </div>
        </div>
      </Card>

      <Card>
        <SectionLabel text="All Telegram users" />
        {total === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>
            No Telegram subscribers yet. They appear here after sending
            <code className="mx-1 text-slate-300">/start</code> to the
            bot or completing the <code className="mx-1 text-slate-300">/link</code>
            email-binding flow.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase" style={{ borderColor: BORDER, color: MUTED }}>
                  <th className="p-2">Name</th>
                  <th className="p-2">Username</th>
                  <th className="p-2">Chat ID</th>
                  <th className="p-2">Linked Account</th>
                  <th className="p-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isLinked = Boolean(r.user_id)
                  const email = r.user_id ? emailByUserId[r.user_id] : null
                  return (
                    <tr
                      key={r.chat_id || i}
                      className="border-b text-slate-200"
                      style={{ borderColor: BORDER }}
                    >
                      <td className="p-2">{r.first_name || '—'}</td>
                      <td className="p-2" style={{ color: r.username ? '#cbd5e1' : MUTED }}>
                        {r.username ? `@${r.username}` : '—'}
                      </td>
                      <td className="p-2 text-xs font-mono" style={{ color: MUTED }}>
                        {maskChatId(r.chat_id)}
                      </td>
                      <td className="p-2 text-xs">
                        <span style={{
                          display: 'inline-block', width: 8, height: 8,
                          borderRadius: '50%',
                          background: isLinked ? '#34d399' : '#f87171',
                          marginRight: 6,
                        }} />
                        {isLinked ? (
                          email || (
                            <span style={{ color: MUTED }}>
                              linked (no email)
                            </span>
                          )
                        ) : (
                          <span style={{ color: MUTED }}>Not linked</span>
                        )}
                      </td>
                      <td className="p-2 text-xs" style={{ color: MUTED }}>
                        {fmtDate(r.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
