/**
 * PointsManager — admin tab for bulk point operations.
 *
 * Three award modes (all active users / hand-picked / conditional), a
 * moderation deduct section, and a 20-row activity log of recent admin
 * point operations. Mounted as a tab inside IQjetDesk; the admin-email
 * gate on IQjetDesk's outer component is what keeps non-admins out.
 *
 * SCHEMA — uses the codebase's existing points tables, NOT the
 * point_events / profiles.points_balance names from the original brief:
 *   - awards write to points_transactions(action_type='admin_award')
 *   - deducts write to points_transactions(action_type='admin_deduct')
 *   - balances live on user_points.total_points + lifetime_points
 *
 * BULK CALLS — the "award everyone" path could be 2,000+ users at once.
 * We never loop client-side. Two RPCs do the work server-side:
 *   - admin_award_points(p_user_ids uuid[], p_points int, p_reason text)
 *   - admin_deduct_points(p_user_id uuid, p_points int, p_reason text)
 * Defined in scripts/sql/admin_award_points_fn.sql. Both verify
 * auth.email() === 'robin22y@gmail.com' inside the function, so the
 * UI gate is defence-in-depth, not the only check.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context'
import { isAdmin } from '../../lib/isAdmin'

// ── Styling tokens — match IQjetDesk's dark admin aesthetic. ──────────
const S = {
  card: {
    background: '#0F1217',
    border: '1px solid #1E2530',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  heading: {
    margin: '0 0 4px',
    fontSize: 16,
    fontWeight: 800,
    color: '#E2E8F0',
    letterSpacing: '-0.01em',
  },
  sub: {
    margin: '0 0 16px',
    fontSize: 12,
    color: '#94A3B8',
  },
  label: {
    display: 'block',
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#94A3B8',
    fontWeight: 700,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    background: '#0B0E11',
    border: '1px solid #1E2530',
    borderRadius: 6,
    color: '#E2E8F0',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  },
  btnPrimary: {
    padding: '10px 18px',
    background: '#FBBF24',
    color: '#0B0E11',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.01em',
  },
  btnGhost: {
    padding: '10px 14px',
    background: 'transparent',
    color: '#CBD5E1',
    border: '1px solid #1E2530',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '10px 18px',
    background: '#DC2626',
    color: '#FFF',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  pill: (active) => ({
    padding: '8px 14px',
    background: active ? '#FBBF24' : 'transparent',
    color: active ? '#0B0E11' : '#CBD5E1',
    border: `1px solid ${active ? '#FBBF24' : '#1E2530'}`,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.01em',
  }),
  errorBanner: {
    padding: '10px 12px',
    background: 'rgba(220, 38, 38, 0.1)',
    border: '1px solid rgba(220, 38, 38, 0.3)',
    borderRadius: 6,
    color: '#FCA5A5',
    fontSize: 12,
    marginBottom: 12,
  },
  okBanner: {
    padding: '10px 12px',
    background: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: 6,
    color: '#86EFAC',
    fontSize: 12,
    marginBottom: 12,
  },
  tableHead: {
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#64748B',
    fontWeight: 700,
    padding: '8px 10px',
    borderBottom: '1px solid #1E2530',
    textAlign: 'left',
  },
  td: {
    padding: '10px 10px',
    fontSize: 12,
    color: '#CBD5E1',
    borderBottom: '1px solid #1E2530',
    verticalAlign: 'top',
  },
}

// ── Mode strip ────────────────────────────────────────────────────────
const MODES = [
  { id: 'all',         label: 'Award all users' },
  { id: 'selected',    label: 'Award selected users' },
  { id: 'conditional', label: 'Award by condition' },
  { id: 'deduct',      label: 'Deduct (moderation)' },
]

// ── Conditional filters ───────────────────────────────────────────────
// label, slug, predicate that returns a Supabase query restricted to
// matching profiles ids. Each predicate runs against profiles + (lazy)
// JOINs to user_points / points_transactions only when needed.
const CONDITIONS = [
  {
    id: 'inactive_7d',
    label: 'Inactive 7+ days',
    description: 'last_active_at older than 7 days',
  },
  {
    id: 'streak_gt5',
    label: 'Streak > 5',
    description: 'user_points.current_streak > 5',
  },
  {
    id: 'academy_complete',
    label: 'Academy completed',
    description: 'profiles.academy_completed = true',
  },
  {
    id: 'free_plan',
    label: 'Free plan only',
    description: "plan = 'free' or NULL",
  },
  {
    id: 'joined_week',
    label: 'Joined this week',
    description: 'created_at within last 7 days',
  },
  {
    id: 'no_stock_views',
    label: '0 stock views',
    description: "no points_transactions with action_type='stock_view'",
  },
]

// Resolve a CONDITIONS id into an array of profile UUIDs. Each branch
// makes its own minimal SELECT — avoid joining everything just because
// we might need it.
async function resolveConditionUserIds(condId) {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

  // Always filter out banned and inactive accounts at the candidate
  // pool stage so awards never land on cleaned-up users.
  const baseFilter = (q) => q.eq('banned', false).eq('is_active', true)

  switch (condId) {
    case 'inactive_7d': {
      const { data } = await baseFilter(
        supabase.from('profiles').select('id').lt('last_active_at', sevenDaysAgo),
      )
      return (data || []).map((r) => r.id)
    }
    case 'streak_gt5': {
      // user_points → profile id, then filter banned/inactive client-side
      // since the join would force a view.
      const { data: pts } = await supabase
        .from('user_points')
        .select('user_id, current_streak')
        .gt('current_streak', 5)
      const ids = (pts || []).map((r) => r.user_id)
      if (ids.length === 0) return []
      const { data: ps } = await baseFilter(
        supabase.from('profiles').select('id').in('id', ids),
      )
      return (ps || []).map((r) => r.id)
    }
    case 'academy_complete': {
      const { data } = await baseFilter(
        supabase.from('profiles').select('id').eq('academy_completed', true),
      )
      return (data || []).map((r) => r.id)
    }
    case 'free_plan': {
      // plan NULL also counts as free in this app's existing logic.
      const { data } = await baseFilter(
        supabase.from('profiles').select('id, plan'),
      )
      return (data || [])
        .filter((r) => !r.plan || r.plan === 'free')
        .map((r) => r.id)
    }
    case 'joined_week': {
      const { data } = await baseFilter(
        supabase.from('profiles').select('id').gte('created_at', sevenDaysAgo),
      )
      return (data || []).map((r) => r.id)
    }
    case 'no_stock_views': {
      // Two-step: get every user_id that DOES have a stock_view event,
      // then SELECT profiles MINUS that set. We can't .not('id','in', …)
      // on a huge subquery via PostgREST, so do it client-side.
      const { data: viewers } = await supabase
        .from('points_transactions')
        .select('user_id')
        .eq('action_type', 'stock_view')
      const viewerSet = new Set((viewers || []).map((r) => r.user_id))
      const { data: all } = await baseFilter(
        supabase.from('profiles').select('id'),
      )
      return (all || []).map((r) => r.id).filter((id) => !viewerSet.has(id))
    }
    default:
      return []
  }
}

// ── Confirm dialog ─────────────────────────────────────────────────────
function Confirm({ open, title, body, confirmLabel, danger, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(11,14,17,0.94)',
        backdropFilter: 'blur(6px)',
        zIndex: 9998,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{ ...S.card, maxWidth: 460, width: '100%', marginBottom: 0 }}>
        <h3 style={S.heading}>{title}</h3>
        <div style={{ ...S.sub, marginBottom: 18, color: '#CBD5E1', lineHeight: 1.5 }}>
          {body}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" style={S.btnGhost} onClick={onCancel}>Cancel</button>
          <button type="button" style={danger ? S.btnDanger : S.btnPrimary} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Mode 1 — Award all active users ─────────────────────────────────────
function AwardAll({ onDone }) {
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [candidateCount, setCandidateCount] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('banned', false)
      if (!cancelled) setCandidateCount(count ?? null)
    })()
    return () => { cancelled = true }
  }, [])

  function open() {
    setError(''); setOk('')
    const n = parseInt(points, 10)
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a positive amount.'); return }
    if (!reason.trim()) { setError('Reason is required.'); return }
    setConfirmOpen(true)
  }

  async function confirm() {
    setConfirmOpen(false); setBusy(true)
    try {
      const { data: users } = await supabase
        .from('profiles')
        .select('id')
        .eq('is_active', true)
        .eq('banned', false)
      const ids = (users || []).map((u) => u.id)
      if (ids.length === 0) { setError('No eligible users.'); return }
      const { data, error: rpcErr } = await supabase.rpc('admin_award_points', {
        p_user_ids: ids,
        p_points:   parseInt(points, 10),
        p_reason:   reason.trim(),
      })
      if (rpcErr) throw rpcErr
      setOk(`Awarded ${points} pts to ${data ?? ids.length} users.`)
      setPoints(''); setReason('')
      onDone?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.card}>
      <h3 style={S.heading}>Award all active users</h3>
      <p style={S.sub}>
        Targets every profile where <code>is_active = true AND banned = false</code>.
        {candidateCount != null && ` ${candidateCount.toLocaleString('en-IN')} users currently eligible.`}
      </p>
      {error && <div style={S.errorBanner}>{error}</div>}
      {ok && <div style={S.okBanner}>{ok}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={S.label}>Points</label>
          <input
            type="number"
            min="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            style={S.input}
            placeholder="50"
          />
        </div>
        <div>
          <label style={S.label}>Reason (audit trail)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={S.input}
            placeholder="Launch celebration"
          />
        </div>
      </div>
      <button type="button" style={S.btnPrimary} onClick={open} disabled={busy}>
        {busy ? 'Awarding…' : 'Award to all active users'}
      </button>

      <Confirm
        open={confirmOpen}
        title="Confirm bulk award"
        body={
          <>
            Award <b>{points} pts</b> to <b>{candidateCount?.toLocaleString('en-IN') ?? '?'} users</b>?<br />
            Reason: <i>{reason}</i><br />
            <span style={{ color: '#FBBF24' }}>This cannot be undone.</span>
          </>
        }
        confirmLabel="Confirm award"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirm}
      />
    </div>
  )
}

// ── Mode 2 — Award selected users ──────────────────────────────────────
function AwardSelected({ onDone }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [picked, setPicked] = useState({}) // {userId: profileRow}
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  // Debounced search by email or full_name.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name, plan')
        .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
        .eq('is_active', true)
        .eq('banned', false)
        .limit(25)
      setResults(data || [])
    }, 220)
    return () => clearTimeout(t)
  }, [query])

  const pickedIds = Object.keys(picked)

  function toggle(profile) {
    setPicked((cur) => {
      const next = { ...cur }
      if (next[profile.id]) delete next[profile.id]
      else next[profile.id] = profile
      return next
    })
  }

  async function award() {
    setError(''); setOk('')
    const n = parseInt(points, 10)
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a positive amount.'); return }
    if (!reason.trim()) { setError('Reason is required.'); return }
    if (pickedIds.length === 0) { setError('Select at least one user.'); return }
    setBusy(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_award_points', {
        p_user_ids: pickedIds,
        p_points:   n,
        p_reason:   reason.trim(),
      })
      if (rpcErr) throw rpcErr
      setOk(`Awarded ${n} pts to ${data ?? pickedIds.length} users.`)
      setPicked({}); setPoints(''); setReason(''); setQuery(''); setResults([])
      onDone?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.card}>
      <h3 style={S.heading}>Award selected users</h3>
      <p style={S.sub}>Search by email or name, tick rows, then award.</p>
      {error && <div style={S.errorBanner}>{error}</div>}
      {ok && <div style={S.okBanner}>{ok}</div>}

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Search</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={S.input}
          placeholder="email or name"
        />
      </div>

      {results.length > 0 && (
        <div style={{
          maxHeight: 260,
          overflowY: 'auto',
          border: '1px solid #1E2530',
          borderRadius: 6,
          marginBottom: 12,
        }}>
          {results.map((r) => (
            <label
              key={r.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', cursor: 'pointer',
                borderBottom: '1px solid #1E2530',
                fontSize: 12, color: '#CBD5E1',
              }}
            >
              <input
                type="checkbox"
                checked={!!picked[r.id]}
                onChange={() => toggle(r)}
              />
              <span style={{ fontWeight: 600, color: '#E2E8F0' }}>
                {r.full_name || '—'}
              </span>
              <span style={{ color: '#94A3B8' }}>{r.email}</span>
              {r.plan === 'pro' && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 10, fontWeight: 700, color: '#FBBF24',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  Pro
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 14 }}>
        {pickedIds.length} {pickedIds.length === 1 ? 'user' : 'users'} selected
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={S.label}>Points</label>
          <input
            type="number" min="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            style={S.input}
            placeholder="100"
          />
        </div>
        <div>
          <label style={S.label}>Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={S.input}
            placeholder="Beta feedback"
          />
        </div>
      </div>

      <button type="button" style={S.btnPrimary} onClick={award} disabled={busy}>
        {busy ? 'Awarding…' : 'Award to selected'}
      </button>
    </div>
  )
}

// ── Mode 3 — Conditional award ─────────────────────────────────────────
function AwardConditional({ onDone }) {
  const [picked, setPicked] = useState([]) // array of condition ids
  const [previewIds, setPreviewIds] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  // Reset preview when picks change.
  useEffect(() => { setPreviewIds(null) }, [picked])

  function toggle(id) {
    setPicked((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }

  async function preview() {
    setError(''); setOk(''); setPreviewing(true)
    try {
      if (picked.length === 0) { setError('Pick at least one condition.'); return }
      // INTERSECTION semantics — a user must match every selected
      // condition. Multi-condition AND is more useful than OR for
      // targeted awards ("inactive 7d AND free plan") and matches the
      // checkbox UX better.
      const sets = await Promise.all(picked.map((id) => resolveConditionUserIds(id)))
      let intersect = new Set(sets[0])
      for (let i = 1; i < sets.length; i++) {
        const s = new Set(sets[i])
        intersect = new Set([...intersect].filter((x) => s.has(x)))
      }
      setPreviewIds(Array.from(intersect))
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setPreviewing(false)
    }
  }

  function openConfirm() {
    setError(''); setOk('')
    const n = parseInt(points, 10)
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a positive amount.'); return }
    if (!reason.trim()) { setError('Reason is required.'); return }
    if (!previewIds || previewIds.length === 0) { setError('Preview first — no users match.'); return }
    setConfirmOpen(true)
  }

  async function confirm() {
    setConfirmOpen(false); setBusy(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_award_points', {
        p_user_ids: previewIds,
        p_points:   parseInt(points, 10),
        p_reason:   reason.trim(),
      })
      if (rpcErr) throw rpcErr
      setOk(`Awarded ${points} pts to ${data ?? previewIds.length} users.`)
      setPicked([]); setPreviewIds(null); setPoints(''); setReason('')
      onDone?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.card}>
      <h3 style={S.heading}>Award by condition</h3>
      <p style={S.sub}>Multiple conditions are AND-ed. Preview before awarding.</p>
      {error && <div style={S.errorBanner}>{error}</div>}
      {ok && <div style={S.okBanner}>{ok}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
        {CONDITIONS.map((c) => (
          <label
            key={c.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px',
              border: `1px solid ${picked.includes(c.id) ? '#FBBF24' : '#1E2530'}`,
              background: picked.includes(c.id) ? 'rgba(251,191,36,0.06)' : 'transparent',
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={picked.includes(c.id)}
              onChange={() => toggle(c.id)}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{c.label}</div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{c.description}</div>
            </div>
          </label>
        ))}
      </div>

      {previewIds && (
        <div style={{
          padding: '10px 12px',
          background: 'rgba(96,165,250,0.08)',
          border: '1px solid rgba(96,165,250,0.3)',
          borderRadius: 6,
          marginBottom: 14,
          fontSize: 12, color: '#BFDBFE',
        }}>
          This matches <b>{previewIds.length}</b> {previewIds.length === 1 ? 'user' : 'users'}.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={S.label}>Points</label>
          <input
            type="number" min="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            style={S.input}
            placeholder="25"
          />
        </div>
        <div>
          <label style={S.label}>Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={S.input}
            placeholder="Re-engagement bonus"
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" style={S.btnGhost} onClick={preview} disabled={previewing}>
          {previewing ? 'Counting…' : 'Preview match count'}
        </button>
        <button type="button" style={S.btnPrimary} onClick={openConfirm} disabled={busy || !previewIds}>
          {busy ? 'Awarding…' : 'Confirm award'}
        </button>
      </div>

      <Confirm
        open={confirmOpen}
        title="Confirm conditional award"
        body={
          <>
            Award <b>{points} pts</b> to <b>{previewIds?.length || 0} users</b>?<br />
            Reason: <i>{reason}</i><br />
            <span style={{ color: '#FBBF24' }}>This cannot be undone.</span>
          </>
        }
        confirmLabel="Confirm award"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirm}
      />
    </div>
  )
}

// ── Mode 4 — Deduct ────────────────────────────────────────────────────
function Deduct({ onDone }) {
  const [email, setEmail] = useState('')
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  async function deduct() {
    setError(''); setOk('')
    const n = parseInt(points, 10)
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a positive amount.'); return }
    if (!reason.trim()) { setError('Reason is required.'); return }
    if (!email.trim()) { setError('User email required.'); return }
    setBusy(true)
    try {
      // Resolve email → id first; the RPC takes a uuid.
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id, email')
        .ilike('email', email.trim())
        .limit(1)
        .maybeSingle()
      if (profErr) throw profErr
      if (!prof?.id) { setError('User not found.'); return }
      const { data: newBalance, error: rpcErr } = await supabase.rpc('admin_deduct_points', {
        p_user_id: prof.id,
        p_points:  n,
        p_reason:  reason.trim(),
      })
      if (rpcErr) throw rpcErr
      setOk(
        newBalance == null
          ? `Deducted ${n} pts from ${prof.email}. (No user_points row — balance now treated as 0.)`
          : `Deducted ${n} pts from ${prof.email}. New balance: ${newBalance}.`
      )
      setEmail(''); setPoints(''); setReason('')
      onDone?.()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.card}>
      <h3 style={S.heading}>Deduct points (moderation)</h3>
      <p style={S.sub}>
        Floors balance at 0. <code>lifetime_points</code> is preserved — only
        the spendable <code>total_points</code> drops.
      </p>
      {error && <div style={S.errorBanner}>{error}</div>}
      {ok && <div style={S.okBanner}>{ok}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={S.label}>User email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={S.input}
            placeholder="user@example.com"
          />
        </div>
        <div>
          <label style={S.label}>Points to deduct</label>
          <input
            type="number" min="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            style={S.input}
            placeholder="50"
          />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Reason (required)</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={S.input}
          placeholder="Abuse of refer-a-friend flow"
        />
      </div>
      <button type="button" style={S.btnDanger} onClick={deduct} disabled={busy}>
        {busy ? 'Deducting…' : 'Deduct points'}
      </button>
    </div>
  )
}

// ── Activity log ───────────────────────────────────────────────────────
function ActivityLog({ refreshKey }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [emails, setEmails] = useState({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('points_transactions')
        .select('id, user_id, points, action_type, notes, created_at')
        .in('action_type', ['admin_award', 'admin_deduct'])
        .order('created_at', { ascending: false })
        .limit(60)
      if (cancelled) return
      setRows(data || [])
      // Resolve user emails for the rows that aren't bulk awards
      // (bulk rows often share notes; we still want a per-row label).
      const uniq = Array.from(new Set((data || []).map((r) => r.user_id)))
      if (uniq.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', uniq)
        const map = {}
        for (const p of profs || []) map[p.id] = p.email
        if (!cancelled) setEmails(map)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  // Collapse rows that share (notes, points, action_type) within the
  // same minute into a single "N users" log entry — that's how the
  // bulk-award path shows up after one RPC call.
  const grouped = useMemo(() => {
    const out = []
    const byKey = {}
    for (const r of rows) {
      const min = (r.created_at || '').slice(0, 16) // YYYY-MM-DDTHH:MM
      const key = `${min}|${r.action_type}|${r.points}|${r.notes || ''}`
      if (!byKey[key]) {
        byKey[key] = { ...r, count: 1, sampleEmail: emails[r.user_id] }
        out.push(byKey[key])
      } else {
        byKey[key].count += 1
      }
    }
    return out.slice(0, 20)
  }, [rows, emails])

  return (
    <div style={S.card}>
      <h3 style={S.heading}>Activity log</h3>
      <p style={S.sub}>Last 20 admin point operations. Same-minute bulk awards collapse into a single row.</p>
      {loading ? (
        <div style={{ fontSize: 12, color: '#94A3B8' }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94A3B8' }}>No admin awards yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.tableHead}>Date</th>
                <th style={S.tableHead}>Awarded to</th>
                <th style={{ ...S.tableHead, textAlign: 'right' }}>Points</th>
                <th style={S.tableHead}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((r) => (
                <tr key={r.id}>
                  <td style={S.td}>
                    {new Date(r.created_at).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td style={S.td}>
                    {r.count > 1
                      ? `${r.count} users`
                      : (r.sampleEmail || '—')}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right',
                    color: r.points >= 0 ? '#86EFAC' : '#FCA5A5', fontWeight: 700 }}>
                    {r.points > 0 ? '+' : ''}{r.points}
                  </td>
                  <td style={{ ...S.td, color: '#94A3B8' }}>{r.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────
export default function PointsManager() {
  const { user } = useAuth()
  const [mode, setMode] = useState('all')
  const [logKey, setLogKey] = useState(0)

  // Defence-in-depth — even though IQjetDesk gates on admin email at
  // the outer level, refuse to render if the local check disagrees.
  if (!isAdmin(user)) {
    return (
      <div style={S.card}>
        <h3 style={S.heading}>Admin only</h3>
        <p style={S.sub}>This panel is restricted to the admin email.</p>
      </div>
    )
  }

  const onAwarded = () => setLogKey((k) => k + 1)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            style={S.pill(mode === m.id)}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'all' &&         <AwardAll onDone={onAwarded} />}
      {mode === 'selected' &&    <AwardSelected onDone={onAwarded} />}
      {mode === 'conditional' && <AwardConditional onDone={onAwarded} />}
      {mode === 'deduct' &&      <Deduct onDone={onAwarded} />}

      <ActivityLog refreshKey={logKey} />
    </div>
  )
}
