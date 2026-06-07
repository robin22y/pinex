import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context'
import { supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'
import AdminPointsConfig from './AdminPointsConfig'

import Icon from '../../components/ui/Icon'
// ── /admin/points ────────────────────────────────────────────────────────
// Three tabs:
//   - Leaderboard      Top 50 by total_points (sortable table)
//   - High Performers  streak >= 7 OR total_points >= 200 (cards + bonus)
//   - Low Performers   inactive >= 10d OR points = 0 OR streak = 0 (table)
//
// All three pull from a single user_points JOIN profiles query so we
// switch tabs without re-fetching. Admin-bonus awards write to
// points_transactions + user_points (idempotent — bonus rows are unique
// by (user_id, created_at) so a second submit produces a different row).

// ── Local helpers ───────────────────────────────────────────────────────
function daysSince(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86400000)
}

function rankBadge(idx) {
  if (idx === 0) return '🥇'
  if (idx === 1) return '🥈'
  if (idx === 2) return '🥉'
  return String(idx + 1)
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  } catch {
    return iso.slice(0, 10)
  }
}

// ── Bonus modal ─────────────────────────────────────────────────────────
function BonusModal({ open, user, onClose, onAwarded }) {
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setPoints('')
      setReason('')
      setError('')
      setBusy(false)
    }
  }, [open])

  if (!open || !user) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const n = parseInt(points, 10)
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a positive number of points.')
      return
    }
    if (!reason.trim()) {
      setError('Reason is required for an audit trail.')
      return
    }
    setBusy(true)
    try {
      // 1. Insert the transaction row
      const { error: txErr } = await supabase
        .from('points_transactions')
        .insert({
          user_id: user.user_id,
          points: n,
          action_type: 'admin_bonus',
          notes: reason.trim(),
        })
      if (txErr) throw txErr

      // 2. Bump user_points totals. Read-then-write — fine for a manual
      //    admin tap; if we ever surface this to non-admin code paths,
      //    move it to a SECURITY DEFINER RPC.
      const { data: cur } = await supabase
        .from('user_points')
        .select('total_points,lifetime_points')
        .eq('user_id', user.user_id)
        .limit(1)
        .maybeSingle()
      const newTotal = (Number(cur?.total_points) || 0) + n
      const newLife  = (Number(cur?.lifetime_points) || 0) + n
      const { error: upErr } = await supabase
        .from('user_points')
        .update({
          total_points: newTotal,
          lifetime_points: newLife,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.user_id)
      if (upErr) throw upErr

      onAwarded({ ...user, total_points: newTotal, lifetime_points: newLife })
      onClose()
    } catch (e) {
      setError(e?.message || 'Award failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: 22,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>
          Award bonus to {user.name || user.email}
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
          Inserts a points_transactions row with action_type=&quot;admin_bonus&quot; and bumps user_points totals.
        </div>

        <label style={{ display: 'block', fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Points</label>
        <input
          type="number"
          min="1"
          value={points}
          onChange={e => setPoints(e.target.value)}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px',
            background: C.surface2, border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.text, fontSize: 14,
            marginBottom: 12,
          }}
        />

        <label style={{ display: 'block', fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Reason</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="Why are you awarding these points?"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px',
            background: C.surface2, border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.text, fontSize: 13,
            resize: 'vertical',
          }}
        />

        {error && (
          <div style={{ marginTop: 10, padding: 10, background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 8, color: C.red, fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              flex: 1, padding: '10px 0',
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.text, fontSize: 13, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              flex: 1, padding: '10px 0',
              background: busy ? C.surface2 : C.amber,
              border: 'none', borderRadius: 8,
              color: busy ? C.textMuted : C.accentOn,
              fontSize: 13, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Awarding…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Tabs ────────────────────────────────────────────────────────────────
// The Config tab is gated on superadmin role; regular admins never see it.
// Tab list is generated per-render below from the caller's profile.
const TABS_BASE = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'high',        label: 'High Performers' },
  { key: 'low',         label: 'Low Performers' },
]
const TAB_CONFIG = { key: 'config', label: '⚙ Config' }

function TabBar({ value, onChange, tabs }) {
  return (
    <div style={{
      display: 'flex', gap: 4,
      borderBottom: `1px solid ${C.border}`,
      marginBottom: 16,
    }}>
      {tabs.map(t => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              padding: '10px 16px',
              background: active ? C.surface2 : 'transparent',
              border: 'none',
              borderBottom: `2px solid ${active ? C.amber : 'transparent'}`,
              color: active ? C.text : C.textMuted,
              fontSize: 13, fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Leaderboard ─────────────────────────────────────────────────────────
function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function Leaderboard({ rows, currentAdminId }) {
  function downloadCsv() {
    const headers = [
      'Rank', 'Name', 'Email', 'Total Points',
      'Lifetime Points', 'Current Streak',
      'Redeemed Points', 'Last Active',
    ]
    const lines = [headers.join(',')]
    rows.forEach((r, i) => {
      lines.push([
        i + 1,
        csvEscape(r.name),
        csvEscape(r.email),
        r.total_points,
        r.lifetime_points,
        r.current_streak,
        r.redeemed_points,
        r.last_active_at || '',
      ].join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pinex-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button
          type="button"
          onClick={downloadCsv}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px',
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.text,
            fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Icon name="download" style={{ fontSize: 14 }} />
          Export CSV
        </button>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.surface }}>
              {['#', 'Name', 'Email', 'Total', 'Lifetime', 'Streak', 'Redeemed', 'Last active'].map(h => (
                <th key={h} style={{
                  padding: '10px 12px', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: C.textMuted, textAlign: 'left',
                  borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: C.textFaint }}>No users with points yet.</td></tr>
            ) : rows.map((r, i) => {
              const isMe = r.user_id === currentAdminId
              return (
                <tr key={r.user_id || i} style={{
                  background: isMe
                    ? `${C.amberBg}50`
                    : i % 2 ? C.surface : C.base,
                  borderLeft: isMe ? `3px solid ${C.amber}` : 'none',
                }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: i < 3 ? C.amber : C.textMuted }}>
                    {rankBadge(i)}
                  </td>
                  <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{r.name || '—'}</td>
                  <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 11 }}>{r.email || '—'}</td>
                  <td style={{ padding: '10px 12px', color: C.amber, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {(r.total_points || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ padding: '10px 12px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                    {(r.lifetime_points || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ padding: '10px 12px', color: r.current_streak > 0 ? C.amber : C.textMuted }}>
                    {r.current_streak > 0 ? `🔥 ${r.current_streak}` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                    {(r.redeemed_points || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 11 }}>
                    {fmtDate(r.last_active_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── High Performers ─────────────────────────────────────────────────────
function HighPerformers({ rows, onAward }) {
  const filtered = rows.filter(
    r => (r.current_streak || 0) >= 7 || (r.total_points || 0) >= 200
  )

  if (filtered.length === 0) {
    return <p style={{ color: C.textMuted, padding: '20px 0' }}>No high performers yet.</p>
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 12,
    }}>
      {filtered.map(r => (
        <div key={r.user_id} style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{r.name || '—'}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>{r.email || '—'}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>Points</span>
              <span style={{ fontSize: 13, color: C.amber, fontWeight: 700 }}>
                {(r.total_points || 0).toLocaleString('en-IN')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>Streak</span>
              <span style={{ fontSize: 13, color: C.amber, fontWeight: 700 }}>
                {(r.current_streak || 0) > 0 ? `🔥 ${r.current_streak} days` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>Academy</span>
              <span style={{ fontSize: 12, color: r.academy_completed ? C.green : C.textMuted }}>
                {r.academy_completed ? '✅ certified' : 'pending'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>Last active</span>
              <span style={{ fontSize: 12, color: C.textMuted }}>{fmtDate(r.last_active_at)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onAward(r)}
            style={{
              marginTop: 14, width: '100%',
              padding: '8px 0',
              background: C.amberBg,
              border: `1px solid ${C.amberBorder}`,
              borderRadius: 8, color: C.amber,
              fontSize: 12, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ⭐ Award bonus
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Low Performers ──────────────────────────────────────────────────────
function nudgeTemplate(name) {
  const safeName = name?.trim() || 'there'
  const txt =
    `Hi ${safeName} — your PineX streak has paused. ` +
    `Log in today to keep earning points toward Pro access. pinex.in`
  return txt
}

function LowPerformers({ rows, onAward, onView }) {
  const [sortKey, setSortKey] = useState('daysInactive')
  const [sortDir, setSortDir] = useState('desc')

  const filtered = useMemo(() => {
    const out = rows
      .map(r => ({
        ...r,
        daysInactive: r.last_active_at ? daysSince(r.last_active_at) : 9999,
      }))
      .filter(r =>
        r.daysInactive >= 10
        || (r.total_points || 0) === 0
        || (r.current_streak || 0) === 0
      )
    out.sort((a, b) => {
      const av = a[sortKey] ?? (sortKey === 'name' || sortKey === 'email' ? '' : 0)
      const bv = b[sortKey] ?? (sortKey === 'name' || sortKey === 'email' ? '' : 0)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return out
  }, [rows, sortKey, sortDir])

  function header(key, label) {
    return (
      <th
        onClick={() => {
          if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
          else { setSortKey(key); setSortDir('desc') }
        }}
        style={{
          padding: '10px 12px', fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: sortKey === key ? C.amber : C.textMuted,
          textAlign: 'left', cursor: 'pointer',
          borderBottom: `1px solid ${C.border}`,
          whiteSpace: 'nowrap', userSelect: 'none',
        }}
      >
        {label}{sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  function sendNudge(r) {
    const text = nudgeTemplate(r.name)
    try {
      navigator.clipboard.writeText(text)
      window.alert('Nudge template copied to clipboard.')
    } catch {
      window.prompt('Copy the nudge text below:', text)
    }
  }

  if (filtered.length === 0) {
    return <p style={{ color: C.textMuted, padding: '20px 0' }}>No low performers (good news!).</p>
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.surface }}>
            {header('name',          'Name')}
            {header('email',         'Email')}
            {header('total_points',  'Points')}
            {header('last_active_at', 'Last active')}
            {header('daysInactive',  'Days inactive')}
            {header('academy_completed', 'Academy')}
            <th style={{
              padding: '10px 12px', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', color: C.textMuted, textAlign: 'left',
              borderBottom: `1px solid ${C.border}`,
            }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => (
            <tr key={r.user_id || i} style={{ background: i % 2 ? C.surface : C.base }}>
              <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{r.name || '—'}</td>
              <td style={{ padding: '10px 12px', color: C.textMuted, fontSize: 11 }}>{r.email || '—'}</td>
              <td style={{ padding: '10px 12px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                {(r.total_points || 0).toLocaleString('en-IN')}
              </td>
              <td style={{ padding: '10px 12px', color: C.textMuted }}>{fmtDate(r.last_active_at)}</td>
              <td style={{ padding: '10px 12px', color: r.daysInactive >= 30 ? C.red : C.amber, fontWeight: 600 }}>
                {r.daysInactive >= 9999 ? 'Never' : `${r.daysInactive}d`}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 11, color: r.academy_completed ? C.green : C.textMuted }}>
                {r.academy_completed ? '✅' : 'pending'}
              </td>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => sendNudge(r)} style={btn(C.blue)}>Nudge</button>
                  <button type="button" onClick={() => onAward(r)} style={btn(C.amber)}>Award</button>
                  <button type="button" onClick={() => onView(r)} style={btn(C.textMuted)}>View</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function btn(color) {
  return {
    padding: '5px 9px', fontSize: 11, fontWeight: 600,
    background: 'transparent', border: `1px solid ${color}66`,
    borderRadius: 6, color, cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

// ── Top-level ───────────────────────────────────────────────────────────
export default function AdminPoints() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  // Config tab visible to superadmins ONLY. Regular admins see the
  // leaderboard + high/low performers but cannot edit the catalogue.
  const isSuperAdmin = profile?.role === 'superadmin'
  const tabs = isSuperAdmin ? [...TABS_BASE, TAB_CONFIG] : TABS_BASE
  const [tab, setTab] = useState('leaderboard')
  const [rows, setRows] = useState(null)
  const [bonusFor, setBonusFor] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Pull user_points (small) + the matching profile rows in one go.
      const { data: pts } = await supabase
        .from('user_points')
        .select('*')
        .limit(5000)
      const ids = (pts || []).map(p => p.user_id).filter(Boolean)
      const { data: profs } = ids.length
        ? await supabase
            .from('profiles')
            .select('id,email,full_name,last_active_at,academy_completed,academy_grandfathered')
            .in('id', ids)
        : { data: [] }
      const pMap = {}
      ;(profs || []).forEach(p => { pMap[p.id] = p })

      const merged = (pts || []).map(p => {
        const prof = pMap[p.user_id] || {}
        return {
          user_id: p.user_id,
          name: prof.full_name || '',
          email: prof.email || '',
          last_active_at: prof.last_active_at,
          academy_completed: prof.academy_completed,
          academy_grandfathered: prof.academy_grandfathered,
          total_points: p.total_points || 0,
          lifetime_points: p.lifetime_points || 0,
          redeemed_points: p.redeemed_points || 0,
          current_streak: p.current_streak || 0,
          longest_streak: p.longest_streak || 0,
        }
      })

      if (!cancelled) {
        merged.sort((a, b) => b.total_points - a.total_points)
        setRows(merged.slice(0, 200))
      }
    })()
    return () => { cancelled = true }
  }, [])

  function handleAwarded(updatedRow) {
    setRows(prev => (prev || []).map(r => r.user_id === updatedRow.user_id ? updatedRow : r))
  }

  if (!rows) {
    return <p style={{ color: C.textMuted }}>Loading…</p>
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
        Points &amp; Rewards
      </h1>
      <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 18px' }}>
        Leaderboard, high-performers (with bonus award) and low-performers (with nudge + bonus).
      </p>

      <TabBar value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'leaderboard'  && <Leaderboard rows={rows.slice(0, 50)} currentAdminId={user?.id} />}
      {tab === 'high'         && <HighPerformers rows={rows} onAward={setBonusFor} />}
      {tab === 'low'          && (
        <LowPerformers
          rows={rows}
          onAward={setBonusFor}
          onView={(r) => navigate(`/admin/users?search=${encodeURIComponent(r.email)}`)}
        />
      )}
      {tab === 'config' && isSuperAdmin && <AdminPointsConfig />}

      <BonusModal
        open={!!bonusFor}
        user={bonusFor}
        onClose={() => setBonusFor(null)}
        onAwarded={handleAwarded}
      />
    </div>
  )
}
